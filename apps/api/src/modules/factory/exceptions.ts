import type { ExceptionStatus, ExceptionType, Prisma } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { lockRequest } from '../../lib/locks';
import { pageMeta } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../types/express';

const exceptionInclude = {
  shipment: { select: { id: true, code: true } },
  request: { select: { id: true, code: true } },
  raisedBy: { select: { fullName: true } },
  resolvedBy: { select: { fullName: true } },
  events: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { fullName: true } } } },
} satisfies Prisma.ExceptionCaseInclude;

type ExceptionRow = Prisma.ExceptionCaseGetPayload<{ include: typeof exceptionInclude }>;

const toDto = (e: ExceptionRow) => ({
  id: e.id,
  type: e.type,
  status: e.status,
  summary: e.summary,
  details: e.details,
  shipment: e.shipment,
  request: e.request,
  raisedBy: e.raisedBy.fullName,
  resolvedBy: e.resolvedBy?.fullName ?? null,
  resolvedAt: e.resolvedAt,
  resolution: e.resolution,
  createdAt: e.createdAt,
  events: e.events.map((ev) => ({ id: ev.id, type: ev.type, note: ev.note, by: ev.actor.fullName, at: ev.createdAt })),
});

export async function getException(id: string) {
  const row = await prisma.exceptionCase.findUnique({ where: { id }, include: exceptionInclude, relationLoadStrategy: 'join' });
  if (!row) throw notFound('Exception not found');
  return toDto(row);
}

export async function listExceptions(query: { page: number; pageSize: number; status?: ExceptionStatus; type?: ExceptionType }) {
  const where: Prisma.ExceptionCaseWhereInput = { ...(query.status ? { status: query.status } : {}), ...(query.type ? { type: query.type } : {}) };
  const [rows, total] = await prisma.$transaction([
    prisma.exceptionCase.findMany({ where, include: exceptionInclude, relationLoadStrategy: 'join', orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.exceptionCase.count({ where }),
  ]);
  return { items: rows.map(toDto), meta: pageMeta(query.page, query.pageSize, total) };
}

async function withException<T>(id: string, fn: (tx: Prisma.TransactionClient, row: { status: ExceptionStatus; shipmentCode: string }) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    const ref = await tx.exceptionCase.findUnique({ where: { id }, select: { requestId: true } });
    if (!ref) throw notFound('Exception not found');
    await lockRequest(tx, ref.requestId);
    const row = await tx.exceptionCase.findUniqueOrThrow({ where: { id }, select: { status: true, shipment: { select: { code: true } } } });
    return fn(tx, { status: row.status, shipmentCode: row.shipment.code });
  });
}

export async function addNote(actor: AuthUser, id: string, note: string, ip: string | undefined) {
  await withException(id, async (tx) => {
    await tx.exceptionEvent.create({ data: { exceptionId: id, type: 'NOTE', actorId: actor.id, note } });
    await recordAudit(tx, { actorId: actor.id, action: 'exception.note', entityType: 'ExceptionCase', entityId: id, after: { note }, ip });
  });
  return getException(id);
}

/** Resolving is an authorisation by the Purchase Manager: it is what allows a flagged shipment to proceed. */
export async function resolveException(actor: AuthUser, id: string, resolution: string, ip: string | undefined) {
  await withException(id, async (tx, row) => {
    if (row.status !== 'OPEN') throw conflict('ALREADY_RESOLVED', 'This exception has already been resolved');
    await tx.exceptionCase.update({ where: { id }, data: { status: 'RESOLVED', resolvedById: actor.id, resolvedAt: new Date(), resolution } });
    await tx.exceptionEvent.create({ data: { exceptionId: id, type: 'RESOLVED', actorId: actor.id, note: resolution } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'exception.resolve',
      entityType: 'ExceptionCase',
      entityId: id,
      before: { status: 'OPEN' },
      after: { status: 'RESOLVED', resolution, shipmentCode: row.shipmentCode },
      ip,
    });
  });
  return getException(id);
}
