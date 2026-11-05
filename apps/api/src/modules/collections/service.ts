import type { CollectionStatus, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { fixed } from '../../lib/decimal';
import { recordAudit } from '../../lib/audit';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from '../../lib/errors';
import { lockRequest } from '../../lib/locks';
import { pageMeta } from '../../lib/pagination';
import { prisma, type Tx } from '../../lib/prisma';
import { exceedsCapacity, exceedsVariance } from '../../lib/quantity';
import { ACTIVE_COLLECTION_STATUSES, assertCollectionTransition } from '../../lib/stateMachine';
import type { AuthUser } from '../../types/express';
import { moveRequest } from '../procurement/transitions';
import { currentDeclaration } from '../procurement/view';
import { arrivedLate, isActiveCollection, isCollectionOverdue } from './rules';
import type { AssignTransportInput, IncidentInput, LoadInput } from './schemas';

const collectionInclude = {
  vehicle: { select: { id: true, registrationNumber: true, capacityKg: true } },
  transportOfficer: { select: { fullName: true } },
  incidents: { orderBy: { createdAt: 'asc' }, include: { reporter: { select: { fullName: true } } } },
  shipment: {
    select: {
      id: true,
      code: true,
      status: true,
      bookings: {
        where: { status: { in: ['RESERVED', 'CHECKED_IN'] } },
        take: 1,
        select: { id: true, status: true, slot: { select: { startsAt: true, endsAt: true } } },
      },
    },
  },
  request: {
    include: {
      amendments: { orderBy: { seq: 'asc' } },
      farmer: { include: { user: { select: { fullName: true } } } },
      inspections: {
        where: { status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        take: 1,
        select: { inspectedQuantityKg: true },
      },
    },
  },
} satisfies Prisma.CollectionJobInclude;

type CollectionRow = Prisma.CollectionJobGetPayload<{ include: typeof collectionInclude }>;

/** Transport officers see only their own jobs; the manager and administrator see all. */
function scopeFor(actor: AuthUser): Prisma.CollectionJobWhereInput {
  if (actor.role === 'TRANSPORT_OFFICER') return { transportOfficerId: actor.id };
  if (actor.role === 'PURCHASE_MANAGER' || actor.role === 'ADMIN') return {};
  throw forbidden();
}

function toDto(row: CollectionRow, now = new Date()) {
  // A transport officer needs pickup details and the farmer's contact, but not the expected price.
  const { expectedPriceInrPerKg: _price, ...declaration } = currentDeclaration(row.request, row.request.amendments);
  return {
    id: row.id,
    status: row.status,
    request: {
      id: row.request.id,
      code: row.request.code,
      status: row.request.status,
      declaration,
      inspectedQuantityKg: fixed(row.request.inspections[0]?.inspectedQuantityKg, 3),
      farmer: {
        name: row.request.farmer.user.fullName,
        phone: row.request.farmer.phone,
        village: row.request.farmer.village,
        district: row.request.farmer.district,
        state: row.request.farmer.state,
      },
    },
    vehicle: {
      id: row.vehicle.id,
      registrationNumber: row.vehicle.registrationNumber,
      capacityKg: row.vehicle.capacityKg.toFixed(3),
    },
    transportOfficer: { name: row.transportOfficer.fullName },
    assignedAt: row.assignedAt,
    scheduledPickupAt: row.scheduledPickupAt,
    expectedArrivalAt: row.expectedArrivalAt,
    pickedUpAt: row.pickedUpAt,
    loadedAt: row.loadedAt,
    collectedQuantityKg: fixed(row.collectedQuantityKg, 3),
    collectionNotes: row.collectionNotes,
    dispatchedAt: row.dispatchedAt,
    arrivedAt: row.arrivedAt,
    handedOverAt: row.handedOverAt,
    handoverNotes: row.handoverNotes,
    cancelReason: row.cancelReason,
    // The arrival slot booked by the purchase manager, if any.
    shipment: row.shipment
      ? {
          id: row.shipment.id,
          code: row.shipment.code,
          status: row.shipment.status,
          booking: row.shipment.bookings[0]
            ? { id: row.shipment.bookings[0].id, status: row.shipment.bookings[0].status, startsAt: row.shipment.bookings[0].slot.startsAt, endsAt: row.shipment.bookings[0].slot.endsAt }
            : null,
        }
      : null,
    overdue: isCollectionOverdue(row.status, row.expectedArrivalAt, now),
    arrivedLate: arrivedLate(row.arrivedAt, row.expectedArrivalAt),
    incidents: row.incidents.map((i) => ({
      id: i.id,
      type: i.type,
      description: i.description,
      quantityAffectedKg: fixed(i.quantityAffectedKg, 3),
      by: i.reporter.fullName,
      at: i.createdAt,
    })),
  };
}

export async function getCollection(actor: AuthUser, id: string) {
  const row = await prisma.collectionJob.findFirst({ where: { id, ...scopeFor(actor) }, include: collectionInclude, relationLoadStrategy: 'join' });
  if (!row) throw notFound('Collection job not found');
  return toDto(row);
}

export async function listCollections(actor: AuthUser, query: { page: number; pageSize: number; status?: CollectionStatus }) {
  const where: Prisma.CollectionJobWhereInput = { ...scopeFor(actor), ...(query.status ? { status: query.status } : {}) };
  const [rows, total] = await prisma.$transaction([
    prisma.collectionJob.findMany({
      where,
      include: collectionInclude,
      relationLoadStrategy: 'join',
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.collectionJob.count({ where }),
  ]);
  const now = new Date();
  return { items: rows.map((r) => toDto(r, now)), meta: pageMeta(query.page, query.pageSize, total) };
}

/** Transport may be assigned alongside the field officer, so it no longer waits for the inspection to pass. */
const TRANSPORT_ASSIGNABLE_STATUSES = ['APPROVED', 'INSPECTION_ASSIGNED', 'INSPECTION_PASSED'];

/** Creates the collection job. The caller holds the request lock inside the same transaction. */
export async function assignTransportTx(tx: Tx, actor: AuthUser, requestId: string, input: AssignTransportInput, ip: string | undefined): Promise<string> {
  const request = await tx.procurementRequest.findUnique({ where: { id: requestId }, select: { status: true } });
  if (!request) throw notFound('Procurement request not found');
  if (!TRANSPORT_ASSIGNABLE_STATUSES.includes(request.status)) {
    // Failed or under-review inspections, and anything past transport assignment, cannot get a new job.
    throw conflict('INVALID_TRANSITION', `Transport cannot be assigned while the request is ${request.status}`);
  }
  // Already inspected: the request moves on now. Otherwise it moves on when the inspection clears (see advanceIfTransportAssigned).
  if (request.status === 'INSPECTION_PASSED') await moveRequest(tx, requestId, 'TRANSPORT_ASSIGNED', actor.id);

  const [officer, vehicle] = await Promise.all([
    tx.user.findFirst({ where: { id: input.transportOfficerId, role: 'TRANSPORT_OFFICER', status: 'ACTIVE' }, select: { id: true } }),
    tx.vehicle.findFirst({ where: { id: input.vehicleId, isActive: true }, select: { id: true } }),
  ]);
  if (!officer) throw badRequest('INVALID_ASSIGNEE', 'Choose an active transport officer');
  if (!vehicle) throw badRequest('INVALID_VEHICLE', 'Choose an active vehicle');

  const active = [...ACTIVE_COLLECTION_STATUSES];
  const busy = await tx.collectionJob.findFirst({
    where: { status: { in: active }, OR: [{ transportOfficerId: officer.id }, { vehicleId: vehicle.id }] },
    select: { transportOfficerId: true },
  });
  if (busy) {
    throw busy.transportOfficerId === officer.id
      ? conflict('OFFICER_BUSY', 'This transport officer already has an active collection job')
      : conflict('VEHICLE_BUSY', 'This vehicle already has an active collection job');
  }

  const job = await tx.collectionJob.create({
    data: {
      requestId,
      transportOfficerId: officer.id,
      vehicleId: vehicle.id,
      assignedById: actor.id,
      scheduledPickupAt: input.scheduledPickupAt ?? null,
      expectedArrivalAt: input.expectedArrivalAt ?? null,
    },
    select: { id: true },
  });
  await recordAudit(tx, {
    actorId: actor.id,
    action: 'collection.assign',
    entityType: 'CollectionJob',
    entityId: job.id,
    before: { requestStatus: request.status },
    after: {
      requestId,
      transportOfficerId: officer.id,
      vehicleId: vehicle.id,
      scheduledPickupAt: input.scheduledPickupAt,
      expectedArrivalAt: input.expectedArrivalAt,
    },
    ip,
  });
  return job.id;
}

/** Purchase Manager assigns an officer and a vehicle to a request. */
export async function assignTransport(actor: AuthUser, requestId: string, input: AssignTransportInput, ip: string | undefined) {
  try {
    const id = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);
      return assignTransportTx(tx, actor, requestId, input, ip);
    });
    return await getCollection(actor, id);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('ASSIGNMENT_CONFLICT', 'The vehicle, officer or request already has an active collection job');
    throw err;
  }
}

/** Locks the parent request, then loads the job. Only the assigned transport officer may act on it. */
async function loadOwnedJob(tx: Tx, actor: AuthUser, id: string) {
  const ref = await tx.collectionJob.findFirst({ where: { id, transportOfficerId: actor.id }, select: { requestId: true } });
  if (!ref) throw notFound('Collection job not found');
  await lockRequest(tx, ref.requestId);
  const job = await tx.collectionJob.findUniqueOrThrow({ where: { id }, include: { vehicle: true } });
  return job;
}

async function step(
  actor: AuthUser,
  id: string,
  to: CollectionStatus,
  action: string,
  ip: string | undefined,
  apply: (tx: Tx, job: Awaited<ReturnType<typeof loadOwnedJob>>) => Promise<{ data: Prisma.CollectionJobUpdateInput; audit?: Record<string, unknown>; requestMove?: 'IN_TRANSIT' | 'DELIVERED' }>,
) {
  await prisma.$transaction(async (tx) => {
    const job = await loadOwnedJob(tx, actor, id);
    assertCollectionTransition(job.status, to);
    const { data, audit, requestMove } = await apply(tx, job);
    await tx.collectionJob.update({ where: { id }, data: { ...data, status: to } });
    if (requestMove) await moveRequest(tx, job.requestId, requestMove, actor.id);
    await recordAudit(tx, {
      actorId: actor.id,
      action,
      entityType: 'CollectionJob',
      entityId: id,
      before: { status: job.status },
      after: { status: to, ...(audit ?? {}), ...(requestMove ? { requestStatus: requestMove } : {}) },
      ip,
    });
  });
  return getCollection(actor, id);
}

export const pickup = (actor: AuthUser, id: string, ip: string | undefined) =>
  step(actor, id, 'PICKED_UP', 'collection.pickup', ip, async () => ({ data: { pickedUpAt: new Date() } }));

export const load = (actor: AuthUser, id: string, input: LoadInput, ip: string | undefined) =>
  step(actor, id, 'LOADED', 'collection.load', ip, async (tx, job) => {
    if (exceedsCapacity(input.collectedQuantityKg, job.vehicle.capacityKg.toFixed(3))) {
      throw badRequest('EXCEEDS_VEHICLE_CAPACITY', `Collected quantity exceeds the vehicle capacity of ${job.vehicle.capacityKg.toFixed(3)} kg`);
    }
    // Assignment happens in parallel with the inspection, but goods are only loaded once it has cleared.
    const request = await tx.procurementRequest.findUnique({ where: { id: job.requestId }, select: { status: true } });
    if (request?.status !== 'TRANSPORT_ASSIGNED') {
      throw conflict('INSPECTION_NOT_CLEARED', 'Loading can start once the field inspection has passed.');
    }
    const inspected = await tx.fieldInspection.findFirst({
      where: { requestId: job.requestId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { inspectedQuantityKg: true },
    });
    const reference = inspected?.inspectedQuantityKg?.toFixed(3);
    const differs = reference !== undefined && exceedsVariance(reference, input.collectedQuantityKg, env.QUANTITY_VARIANCE_THRESHOLD_PCT);
    if (differs && (input.notes ?? '').length < 3) {
      throw badRequest('NOTES_REQUIRED', 'The collected quantity differs from the inspected quantity. Add a note explaining why.', {
        inspectedQuantityKg: reference,
        thresholdPct: env.QUANTITY_VARIANCE_THRESHOLD_PCT,
      });
    }
    return {
      data: { loadedAt: new Date(), collectedQuantityKg: input.collectedQuantityKg, collectionNotes: input.notes ? input.notes : null },
      audit: { collectedQuantityKg: input.collectedQuantityKg, inspectedQuantityKg: reference ?? null, differs },
    };
  });

export const dispatch = (actor: AuthUser, id: string, expectedArrivalAt: Date | undefined, ip: string | undefined) =>
  step(actor, id, 'DISPATCHED', 'collection.dispatch', ip, async (_tx, job) => {
    const expected = expectedArrivalAt ?? job.expectedArrivalAt;
    if (!expected) throw badRequest('EXPECTED_ARRIVAL_REQUIRED', 'Provide the expected arrival time before dispatching');
    return { data: { dispatchedAt: new Date(), expectedArrivalAt: expected }, audit: { expectedArrivalAt: expected }, requestMove: 'IN_TRANSIT' };
  });

export const arrive = (actor: AuthUser, id: string, ip: string | undefined) =>
  step(actor, id, 'ARRIVED', 'collection.arrive', ip, async (_tx, job) => {
    const now = new Date();
    return { data: { arrivedAt: now }, audit: { late: arrivedLate(now, job.expectedArrivalAt) } };
  });

export const handover = (actor: AuthUser, id: string, notes: string | undefined, ip: string | undefined) =>
  step(actor, id, 'HANDED_OVER', 'collection.handover', ip, async () => ({
    data: { handedOverAt: new Date(), handoverNotes: notes ? notes : null },
    requestMove: 'DELIVERED',
  }));

/** Delays, damage and similar events are recorded as append-only incidents; they never alter measurements. */
export async function reportIncident(actor: AuthUser, id: string, input: IncidentInput, ip: string | undefined) {
  await prisma.$transaction(async (tx) => {
    const job = await loadOwnedJob(tx, actor, id);
    if (!isActiveCollection(job.status)) throw conflict('INVALID_STATE', 'Incidents can only be reported on an active collection job');
    const incident = await tx.collectionIncident.create({
      data: {
        collectionJobId: id,
        reporterId: actor.id,
        type: input.type,
        description: input.description,
        quantityAffectedKg: input.quantityAffectedKg ?? null,
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'collection.incident',
      entityType: 'CollectionJob',
      entityId: id,
      after: { incidentId: incident.id, ...input },
      ip,
    });
  });
  return getCollection(actor, id);
}

/** Purchase Manager cancels a job before dispatch; the request returns to INSPECTION_PASSED if the inspection had already cleared. */
export async function cancelCollection(actor: AuthUser, id: string, reason: string, ip: string | undefined) {
  await prisma.$transaction(async (tx) => {
    const ref = await tx.collectionJob.findUnique({ where: { id }, select: { requestId: true } });
    if (!ref) throw notFound('Collection job not found');
    await lockRequest(tx, ref.requestId);
    const job = await tx.collectionJob.findUniqueOrThrow({ where: { id } });
    assertCollectionTransition(job.status, 'CANCELLED');
    await tx.collectionJob.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
    // The request only moved to TRANSPORT_ASSIGNED once the inspection had cleared; before that it is left alone.
    const request = await tx.procurementRequest.findUniqueOrThrow({ where: { id: ref.requestId }, select: { status: true } });
    const from = request.status;
    if (from === 'TRANSPORT_ASSIGNED') await moveRequest(tx, ref.requestId, 'INSPECTION_PASSED', actor.id, `Collection cancelled: ${reason}`);
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'collection.cancel',
      entityType: 'CollectionJob',
      entityId: id,
      before: { status: job.status, requestStatus: from },
      after: { status: 'CANCELLED', reason, requestStatus: from === 'TRANSPORT_ASSIGNED' ? 'INSPECTION_PASSED' : from },
      ip,
    });
  });
  return getCollection(actor, id);
}
