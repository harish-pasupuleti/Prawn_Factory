import type { Prisma, ProcurementStatus } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound, AppError } from '../../lib/errors';
import { fixed } from '../../lib/decimal';
import { nextProcurementCode } from '../../lib/ids';
import { lockRequest } from '../../lib/locks';
import { pageMeta } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { AMENDABLE_STATUSES, assertTransition, FARMER_CANCELLABLE_STATUSES, PROCUREMENT_STATUSES } from '../../lib/stateMachine';
import type { AuthUser } from '../../types/express';
import { isCollectionOverdue } from '../collections/rules';
import type { AmendInput, CreateRequestInput, DecisionInput } from './schemas';
import { moveRequest } from './transitions';
import { currentDeclaration, originalDeclaration, type DeclarationView } from './view';

const requestInclude = {
  amendments: {
    orderBy: { seq: 'asc' },
    include: { actor: { select: { fullName: true, role: true } } },
  },
  farmer: {
    include: { user: { select: { fullName: true, email: true } } },
  },
  statusChangedBy: { select: { fullName: true } },
  inspections: {
    orderBy: { createdAt: 'asc' },
    include: {
      officer: { select: { fullName: true } },
      decision: { include: { decidedBy: { select: { fullName: true } } } },
    },
  },
  shipments: {
    orderBy: { createdAt: 'asc' },
    include: { queueEntry: { select: { status: true } }, exceptions: { select: { type: true, status: true } } },
  },
  collections: {
    orderBy: { createdAt: 'asc' },
    include: {
      vehicle: { select: { registrationNumber: true } },
      transportOfficer: { select: { fullName: true } },
      incidents: { orderBy: { createdAt: 'asc' }, include: { reporter: { select: { fullName: true } } } },
    },
  },
} satisfies Prisma.ProcurementRequestInclude;

type RequestRow = Prisma.ProcurementRequestGetPayload<{ include: typeof requestInclude }>;

/** The list and dashboard only need the declaration and farmer name, so they skip the heavy workflow relations. */
const listInclude = {
  amendments: { orderBy: { seq: 'asc' } },
  farmer: { include: { user: { select: { fullName: true } } } },
} satisfies Prisma.ProcurementRequestInclude;

type ListRow = Prisma.ProcurementRequestGetPayload<{ include: typeof listInclude }>;

function toListDto(row: ListRow, actor: AuthUser) {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    original: originalDeclaration(row),
    current: currentDeclaration(row, row.amendments),
    ...(isStaff(actor) ? { farmer: { name: row.farmer.user.fullName } } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const isStaff = (actor: AuthUser) => actor.role === 'PURCHASE_MANAGER' || actor.role === 'ADMIN';

/** Row-level scope: farmers only ever see their own requests; managers and admins see all. */
function scopeFor(actor: AuthUser): Prisma.ProcurementRequestWhereInput {
  if (actor.role === 'FARMER') return { farmer: { userId: actor.id } };
  if (isStaff(actor)) return {};
  throw forbidden();
}

type InspectionRow = RequestRow['inspections'][number];
type CollectionRow = RequestRow['collections'][number];

/** Farmers see outcomes and findings; internal fields (variance, decisions, cancel reasons, officer assignment times) are staff-only. */
function inspectionSummary(i: InspectionRow, staff: boolean) {
  return {
    id: i.id,
    status: i.status,
    outcome: i.outcome,
    completedAt: i.completedAt,
    officerName: i.officer.fullName,
    observedSpecies: i.observedSpecies,
    observedSizeCount: i.observedSizeCount,
    inspectedQuantityKg: fixed(i.inspectedQuantityKg, 3),
    qualityNotes: i.qualityNotes,
    discrepancyNotes: i.discrepancyNotes,
    ...(staff
      ? {
          assignedAt: i.assignedAt,
          startedAt: i.startedAt,
          declaredQuantityKgAtInspection: fixed(i.declaredQuantityKgAtInspection, 3),
          quantityVariancePct: fixed(i.quantityVariancePct, 2),
          cancelReason: i.cancelReason,
          decision: i.decision
            ? { kind: i.decision.kind, reason: i.decision.reason, by: i.decision.decidedBy.fullName, at: i.decision.createdAt }
            : null,
        }
      : {}),
  };
}

function collectionSummary(c: CollectionRow, staff: boolean, now: Date) {
  return {
    id: c.id,
    status: c.status,
    vehicleRegistration: c.vehicle.registrationNumber,
    officerName: c.transportOfficer.fullName,
    scheduledPickupAt: c.scheduledPickupAt,
    expectedArrivalAt: c.expectedArrivalAt,
    pickedUpAt: c.pickedUpAt,
    collectedQuantityKg: fixed(c.collectedQuantityKg, 3),
    dispatchedAt: c.dispatchedAt,
    arrivedAt: c.arrivedAt,
    handedOverAt: c.handedOverAt,
    overdue: isCollectionOverdue(c.status, c.expectedArrivalAt, now),
    ...(staff
      ? {
          collectionNotes: c.collectionNotes,
          handoverNotes: c.handoverNotes,
          cancelReason: c.cancelReason,
          incidents: c.incidents.map((i) => ({
            id: i.id,
            type: i.type,
            description: i.description,
            quantityAffectedKg: fixed(i.quantityAffectedKg, 3),
            by: i.reporter.fullName,
            at: i.createdAt,
          })),
        }
      : {}),
  };
}

type ShipmentRow = RequestRow['shipments'][number];

/** Farmers see where their consignment is and what was received; processing details are staff-only. */
function shipmentSummary(sh: ShipmentRow, staff: boolean) {
  return {
    id: sh.id,
    code: sh.code,
    status: sh.status,
    receivedQuantityKg: fixed(sh.receivedQuantityKg, 3),
    receivedAt: sh.receivedAt,
    ...(staff
      ? {
          queueStatus: sh.queueEntry?.status ?? null,
          openExceptions: sh.exceptions.filter((e) => e.status === 'OPEN').map((e) => e.type),
        }
      : {}),
  };
}

function toDto(row: RequestRow, actor: AuthUser) {
  const staff = isStaff(actor);
  const now = new Date();
  return {
    shipments: row.shipments.map((sh) => shipmentSummary(sh, staff)),
    inspections: row.inspections.map((i) => inspectionSummary(i, staff)),
    collections: row.collections.map((c) => collectionSummary(c, staff, now)),
    id: row.id,
    code: row.code,
    status: row.status,
    original: originalDeclaration(row),
    current: currentDeclaration(row, row.amendments),
    lastStatusChange: row.statusChangedAt
      ? {
          at: row.statusChangedAt,
          reason: row.statusReason,
          ...(staff ? { by: row.statusChangedBy?.fullName ?? null } : {}),
        }
      : null,
    amendments: row.amendments.map((a) => ({
      id: a.id,
      field: a.field,
      oldValue: a.oldValue,
      newValue: a.newValue,
      reason: a.reason,
      by: a.actor.fullName,
      byRole: a.actor.role,
      at: a.createdAt,
    })),
    ...(staff
      ? {
          farmer: {
            name: row.farmer.user.fullName,
            phone: row.farmer.phone,
            village: row.farmer.village,
            district: row.farmer.district,
            state: row.farmer.state,
          },
        }
      : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadDto(actor: AuthUser, id: string) {
  const row = await prisma.procurementRequest.findFirst({
    where: { id, ...scopeFor(actor) },
    include: requestInclude,
    relationLoadStrategy: 'join',
  });
  if (!row) throw notFound('Procurement request not found');
  return toDto(row, actor);
}

export async function submitRequest(actor: AuthUser, input: CreateRequestInput, ip: string | undefined) {
  const profile = await prisma.farmerProfile.findUnique({ where: { userId: actor.id }, select: { id: true } });
  if (!profile) throw forbidden('A farmer profile is required to submit requests');

  try {
    const id = await prisma.$transaction(async (tx) => {
      const code = await nextProcurementCode(tx);
      const created = await tx.procurementRequest.create({
        data: {
          code,
          farmerId: profile.id,
          species: input.species,
          declaredSizeCount: input.declaredSizeCount,
          declaredQuantityKg: input.declaredQuantityKg,
          expectedPriceInrPerKg: input.expectedPriceInrPerKg,
          availabilityDate: new Date(`${input.availabilityDate}T00:00:00Z`),
          notes: input.notes ? input.notes : null,
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: 'procurement.submit',
        entityType: 'ProcurementRequest',
        entityId: created.id,
        after: { code, ...input },
        ip,
      });
      return created.id;
    });
    return await loadDto(actor, id);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict('DUPLICATE_REQUEST', 'You already have an open request with identical details');
    }
    throw err;
  }
}

export async function listRequests(
  actor: AuthUser,
  query: { page: number; pageSize: number; status?: ProcurementStatus; q?: string; sort: 'createdAt' | 'code' | 'status'; order: 'asc' | 'desc' },
) {
  const where: Prisma.ProcurementRequestWhereInput = {
    ...scopeFor(actor),
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? { code: { contains: query.q, mode: 'insensitive' } } : {}),
  };
  const orderBy: Prisma.ProcurementRequestOrderByWithRelationInput =
    query.sort === 'code' ? { code: query.order } : query.sort === 'status' ? { status: query.order } : { createdAt: query.order };
  const [rows, total] = await prisma.$transaction([
    prisma.procurementRequest.findMany({
      where,
      include: listInclude,
      relationLoadStrategy: 'join',
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.procurementRequest.count({ where }),
  ]);
  return { items: rows.map((row) => toListDto(row, actor)), meta: pageMeta(query.page, query.pageSize, total) };
}

export async function requestStats(actor: AuthUser) {
  const groups = await prisma.procurementRequest.groupBy({
    by: ['status'],
    where: scopeFor(actor),
    _count: { _all: true },
  });
  const byStatus = Object.fromEntries(PROCUREMENT_STATUSES.map((s) => [s, 0])) as Record<ProcurementStatus, number>;
  for (const group of groups) byStatus[group.status] = group._count._all;
  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  return { total, byStatus };
}

export async function getRequest(actor: AuthUser, id: string) {
  return loadDto(actor, id);
}

const DECISION_TARGET = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  REQUEST_CLARIFICATION: 'CLARIFICATION_REQUESTED',
} as const satisfies Record<DecisionInput['decision'], ProcurementStatus>;

const DECISION_ACTION = {
  APPROVE: 'procurement.approve',
  REJECT: 'procurement.reject',
  REQUEST_CLARIFICATION: 'procurement.request_clarification',
} as const;

/** Moves a request to a new status under a row lock, validating the transition and writing the audit event. */
async function changeStatus(
  actor: AuthUser,
  id: string,
  target: ProcurementStatus,
  action: string,
  reason: string | undefined,
  ip: string | undefined,
) {
  await prisma.$transaction(async (tx) => {
    await lockRequest(tx, id);
    const row = await tx.procurementRequest.findFirst({
      where: { id, ...scopeFor(actor) },
      select: { status: true },
    });
    if (!row) throw notFound('Procurement request not found');
    assertTransition(row.status, target);

    await tx.procurementRequest.update({
      where: { id },
      data: {
        status: target,
        statusReason: reason ?? null,
        statusChangedById: actor.id,
        statusChangedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action,
      entityType: 'ProcurementRequest',
      entityId: id,
      before: { status: row.status },
      after: { status: target, reason },
      ip,
    });
  });
  return loadDto(actor, id);
}

export function decideRequest(actor: AuthUser, id: string, input: DecisionInput, ip: string | undefined) {
  return changeStatus(actor, id, DECISION_TARGET[input.decision], DECISION_ACTION[input.decision], input.reason, ip);
}

/**
 * Cancels a request. Active inspections and collection jobs are cancelled in the same transaction.
 * Farmers can cancel only before field work starts; later cancellations go through the purchase team.
 * Once goods are in transit (or delivered) a request can no longer be cancelled.
 */
export async function cancelRequest(actor: AuthUser, id: string, reason: string, ip: string | undefined) {
  await prisma.$transaction(async (tx) => {
    await lockRequest(tx, id);
    const row = await tx.procurementRequest.findFirst({ where: { id, ...scopeFor(actor) }, select: { status: true } });
    if (!row) throw notFound('Procurement request not found');
    if (actor.role === 'FARMER' && !FARMER_CANCELLABLE_STATUSES.includes(row.status)) {
      throw conflict('CANCEL_NOT_ALLOWED', 'Field work has already started. Please contact the purchase team to cancel.');
    }
    assertTransition(row.status, 'CANCELLED');

    const cascadeReason = `Request cancelled: ${reason}`;
    const inspections = await tx.fieldInspection.updateMany({
      where: { requestId: id, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
      data: { status: 'CANCELLED', cancelReason: cascadeReason },
    });
    const collections = await tx.collectionJob.updateMany({
      where: { requestId: id, status: { in: ['ASSIGNED', 'PICKED_UP', 'LOADED'] } },
      data: { status: 'CANCELLED', cancelReason: cascadeReason },
    });
    await moveRequest(tx, id, 'CANCELLED', actor.id, reason);
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'procurement.cancel',
      entityType: 'ProcurementRequest',
      entityId: id,
      before: { status: row.status },
      after: { status: 'CANCELLED', reason, cancelledInspections: inspections.count, cancelledCollections: collections.count },
      ip,
    });
  });
  return loadDto(actor, id);
}

export function resubmitRequest(actor: AuthUser, id: string, note: string | undefined, ip: string | undefined) {
  return changeStatus(actor, id, 'SUBMITTED', 'procurement.resubmit', note, ip);
}

export async function amendRequest(actor: AuthUser, id: string, input: AmendInput, ip: string | undefined) {
  // Declared prawn details are changed only by the Purchase Manager (every change is kept as an audited amendment).
  if (actor.role !== 'PURCHASE_MANAGER') throw forbidden('Only the purchase manager can amend a request');
  await prisma.$transaction(async (tx) => {
    await lockRequest(tx, id);
    const row = await tx.procurementRequest.findFirst({
      where: { id, ...scopeFor(actor) },
      include: { amendments: { orderBy: { seq: 'asc' } } },
    });
    if (!row) throw notFound('Procurement request not found');
    if (!AMENDABLE_STATUSES.includes(row.status)) {
      throw new AppError(409, 'AMENDMENT_NOT_ALLOWED', `A request that is ${row.status} can no longer be amended`);
    }

    const current: DeclarationView = currentDeclaration(row, row.amendments);
    const oldValue = current[input.field];
    if (oldValue === input.newValue) throw badRequest('NO_CHANGE', 'The new value is the same as the current value');

    const created = await tx.procurementAmendment.create({
      data: {
        requestId: id,
        field: input.field,
        oldValue,
        newValue: input.newValue,
        reason: input.reason,
        actorId: actor.id,
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'procurement.amend',
      entityType: 'ProcurementRequest',
      entityId: id,
      before: { field: input.field, value: oldValue },
      after: { field: input.field, value: input.newValue, reason: input.reason, amendmentId: created.id },
      ip,
    });
  });
  return loadDto(actor, id);
}
