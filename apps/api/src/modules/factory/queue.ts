import type { Prisma, QueueStatus } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { conflict, isUniqueViolation, notFound } from '../../lib/errors';
import { lockRequest } from '../../lib/locks';
import { pageMeta } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { assertQueueTransition } from '../../lib/stateMachine';
import { computeTimer } from '../../lib/timers';
import type { AuthUser } from '../../types/express';
import { currentDeclaration } from '../procurement/view';

const queueInclude = {
  station: { select: { id: true, name: true } },
  shipment: {
    select: {
      id: true,
      code: true,
      receivedQuantityKg: true,
      request: { include: { amendments: { orderBy: { seq: 'asc' } } } },
    },
  },
} satisfies Prisma.QueueEntryInclude;

type QueueRow = Prisma.QueueEntryGetPayload<{ include: typeof queueInclude }>;

function toDto(row: QueueRow, position: number | null, now: Date) {
  const declaration = currentDeclaration(row.shipment.request, row.shipment.request.amendments);
  return {
    id: row.id,
    status: row.status,
    position,
    targetDurationMin: row.targetDurationMin,
    station: row.station,
    shipment: { id: row.shipment.id, code: row.shipment.code, receivedQuantityKg: row.shipment.receivedQuantityKg?.toFixed(3) ?? null },
    request: { id: row.shipment.request.id, code: row.shipment.request.code, species: declaration.species, declaredSizeCount: declaration.declaredSizeCount },
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    notes: row.notes,
    // Computed from server-recorded times, never stored.
    timer: computeTimer({ status: row.status, startedAt: row.startedAt, completedAt: row.completedAt, targetDurationMin: row.targetDurationMin }, now),
  };
}

/** 1-based place of each waiting entry, oldest first. */
async function queuePositions(): Promise<Map<string, number>> {
  const waiting = await prisma.queueEntry.findMany({ where: { status: 'QUEUED' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
  return new Map(waiting.map((w, i) => [w.id, i + 1]));
}

export async function getQueueEntry(id: string) {
  const row = await prisma.queueEntry.findUnique({ where: { id }, include: queueInclude, relationLoadStrategy: 'join' });
  if (!row) throw notFound('Queue entry not found');
  const positions = await queuePositions();
  return toDto(row, positions.get(id) ?? null, new Date());
}

export async function listQueue(query: { page: number; pageSize: number; status?: QueueStatus }) {
  // Default view: what is running or waiting. Running entries first, then waiting in arrival order.
  const where: Prisma.QueueEntryWhereInput = query.status ? { status: query.status } : { status: { in: ['IN_PROGRESS', 'QUEUED'] } };
  const orderBy: Prisma.QueueEntryOrderByWithRelationInput[] =
    query.status === 'COMPLETED' ? [{ completedAt: 'desc' }] : [{ status: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }];
  const [rows, total] = await prisma.$transaction([
    prisma.queueEntry.findMany({ where, include: queueInclude, relationLoadStrategy: 'join', orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.queueEntry.count({ where }),
  ]);
  const positions = await queuePositions();
  const now = new Date();
  return {
    items: rows.map((r) => toDto(r, positions.get(r.id) ?? null, now)),
    // The client uses serverNow to correct for any difference between its clock and the server's.
    meta: { ...pageMeta(query.page, query.pageSize, total), serverNow: now.toISOString() },
  };
}

async function withEntry<T>(id: string, fn: (tx: Prisma.TransactionClient, row: { status: QueueStatus; startedAt: Date | null; completedAt: Date | null; targetDurationMin: number; shipmentCode: string }) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    const ref = await tx.queueEntry.findUnique({ where: { id }, select: { shipment: { select: { requestId: true } } } });
    if (!ref) throw notFound('Queue entry not found');
    await lockRequest(tx, ref.shipment.requestId);
    const row = await tx.queueEntry.findUniqueOrThrow({ where: { id }, include: { shipment: { select: { code: true } } } });
    return fn(tx, { status: row.status, startedAt: row.startedAt, completedAt: row.completedAt, targetDurationMin: row.targetDurationMin, shipmentCode: row.shipment.code });
  });
}

export async function startProcessing(actor: AuthUser, id: string, stationId: string, ip: string | undefined) {
  try {
    await withEntry(id, async (tx, row) => {
      assertQueueTransition(row.status, 'IN_PROGRESS');
      const station = await tx.processingStation.findUnique({ where: { id: stationId } });
      if (!station || !station.isActive) throw conflict('INVALID_STATION', 'Choose an active processing station');
      if ((await tx.queueEntry.count({ where: { stationId, status: 'IN_PROGRESS' } })) > 0) {
        throw conflict('STATION_BUSY', 'This station is already processing another shipment');
      }
      await tx.queueEntry.update({ where: { id }, data: { status: 'IN_PROGRESS', stationId, startedAt: new Date(), startedById: actor.id } });
      await recordAudit(tx, {
        actorId: actor.id,
        action: 'processing.start',
        entityType: 'QueueEntry',
        entityId: id,
        before: { status: row.status },
        after: { status: 'IN_PROGRESS', stationId, stationName: station.name, shipmentCode: row.shipmentCode, targetDurationMin: row.targetDurationMin },
        ip,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('STATION_BUSY', 'This station is already processing another shipment');
    throw err;
  }
  return getQueueEntry(id);
}

/** Completion is always an explicit action. A timer that has run out only shows as overdue. */
export async function completeProcessing(actor: AuthUser, id: string, notes: string | undefined, ip: string | undefined) {
  await withEntry(id, async (tx, row) => {
    assertQueueTransition(row.status, 'COMPLETED');
    const now = new Date();
    const timer = computeTimer({ status: 'IN_PROGRESS', startedAt: row.startedAt, completedAt: null, targetDurationMin: row.targetDurationMin }, now);
    await tx.queueEntry.update({ where: { id }, data: { status: 'COMPLETED', completedAt: now, completedById: actor.id, notes: notes ? notes : null } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'processing.complete',
      entityType: 'QueueEntry',
      entityId: id,
      before: { status: row.status },
      after: { status: 'COMPLETED', shipmentCode: row.shipmentCode, elapsedSec: timer.elapsedSec, targetSec: timer.targetSec, overdueSec: timer.overdueSec, notes },
      ip,
    });
  });
  return getQueueEntry(id);
}
