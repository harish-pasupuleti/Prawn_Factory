import type { Prisma, ShipmentStatus } from '@prisma/client';
import { env } from '../../config/env';
import { recordAudit } from '../../lib/audit';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from '../../lib/errors';
import { lockRequest } from '../../lib/locks';
import { pageMeta } from '../../lib/pagination';
import { prisma, type Tx } from '../../lib/prisma';
import { exceedsVariance, formatHundredths, varianceHundredths } from '../../lib/quantity';
import { assertShipmentTransition } from '../../lib/stateMachine';
import { targetMinutes } from '../../lib/timers';
import type { AuthUser } from '../../types/express';
import { moveRequest } from '../procurement/transitions';
import { currentDeclaration } from '../procurement/view';
import { computeNet, currentWeights, type WeightRow } from './weights';

const shipmentInclude = {
  request: { include: { amendments: { orderBy: { seq: 'asc' } } } },
  collectionJob: {
    select: {
      status: true,
      collectedQuantityKg: true,
      vehicle: { select: { registrationNumber: true } },
      transportOfficer: { select: { fullName: true } },
    },
  },
  weights: { orderBy: { createdAt: 'asc' }, include: { recordedBy: { select: { fullName: true } } } },
  exceptions: { select: { id: true, type: true, status: true } },
  queueEntry: { select: { id: true, status: true } },
  bookings: { orderBy: { createdAt: 'desc' }, take: 1, include: { slot: { select: { startsAt: true, endsAt: true } } } },
} satisfies Prisma.ShipmentInclude;

type ShipmentRow = Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>;

const isManager = (actor: AuthUser) => actor.role === 'PURCHASE_MANAGER' || actor.role === 'ADMIN';

function assertCanView(actor: AuthUser) {
  if (!isManager(actor) && actor.role !== 'FACTORY_OPERATOR') throw forbidden();
}

const weightRows = (row: ShipmentRow): (WeightRow & { createdAt: Date; recordedBy: { fullName: string }; reason: string | null })[] =>
  row.weights.map((w) => ({
    id: w.id,
    kind: w.kind,
    valueKg: w.valueKg.toFixed(3),
    supersedesId: w.supersedesId,
    createdAt: w.createdAt,
    recordedBy: w.recordedBy,
    reason: w.reason,
  }));

function toDto(row: ShipmentRow, actor: AuthUser) {
  const manager = isManager(actor);
  const rows = weightRows(row);
  const current = currentWeights(rows);
  const declaration = currentDeclaration(row.request, row.request.amendments);
  const collected = row.collectionJob.collectedQuantityKg?.toFixed(3) ?? null;
  const received = row.receivedQuantityKg?.toFixed(3) ?? null;
  const variance = collected && received ? varianceHundredths(collected, received) : null;
  const hasOpenDiscrepancy = row.exceptions.some((e) => e.type === 'RECEPTION_DISCREPANCY' && e.status === 'OPEN');
  const handedOver = row.collectionJob.status === 'HANDED_OVER';
  const netKg = row.netWeightKg?.toFixed(3) ?? null;
  const operator = actor.role === 'FACTORY_OPERATOR';
  const view = (w: (typeof rows)[number] | null) => (w ? { valueKg: w.valueKg, recordedBy: w.recordedBy.fullName, at: w.createdAt, corrected: w.supersedesId !== null } : null);

  return {
    id: row.id,
    code: row.code,
    status: row.status,
    request: { id: row.request.id, code: row.request.code },
    species: declaration.species,
    declaredSizeCount: declaration.declaredSizeCount,
    vehicleRegistration: row.collectionJob.vehicle.registrationNumber,
    driverName: row.collectionJob.transportOfficer.fullName,
    handedOver,
    slot: row.bookings[0] ? { startsAt: row.bookings[0].slot.startsAt, endsAt: row.bookings[0].slot.endsAt, status: row.bookings[0].status } : null,
    weights: { gross: view(current.GROSS), tare: view(current.TARE), netKg },
    receivedQuantityKg: received,
    receivedAt: row.receivedAt,
    hasOpenDiscrepancy,
    queue: row.queueEntry ? { id: row.queueEntry.id, status: row.queueEntry.status } : null,
    can: {
      recordGross: operator && row.status === 'ADMITTED' && !current.GROSS,
      recordTare: operator && row.status === 'ADMITTED' && !current.TARE,
      receive: operator && row.status === 'ADMITTED' && netKg !== null && handedOver,
      release: operator && row.status === 'RECEIVED' && !hasOpenDiscrepancy,
      correct: actor.role === 'PURCHASE_MANAGER' ? rows.length > 0 : false,
    },
    waitingForHandover: row.status === 'ADMITTED' && netKg !== null && !handedOver,
    // Previous measurements and variance are visible to managers only, so operators record weights without bias.
    ...(manager
      ? {
          collectedQuantityKg: collected,
          variancePct: variance === null ? null : formatHundredths(variance),
          thresholdPct: env.RECEPTION_VARIANCE_THRESHOLD_PCT,
          history: rows.map((w) => ({ id: w.id, kind: w.kind, valueKg: w.valueKg, by: w.recordedBy.fullName, at: w.createdAt, reason: w.reason, supersedesId: w.supersedesId })),
          exceptions: row.exceptions,
        }
      : {}),
  };
}

export async function getShipment(actor: AuthUser, id: string) {
  assertCanView(actor);
  const row = await prisma.shipment.findUnique({ where: { id }, include: shipmentInclude, relationLoadStrategy: 'join' });
  if (!row) throw notFound('Shipment not found');
  return toDto(row, actor);
}

export async function listShipments(actor: AuthUser, query: { page: number; pageSize: number; status?: ShipmentStatus; q?: string }) {
  assertCanView(actor);
  const where: Prisma.ShipmentWhereInput = {
    // Shipments are only relevant on the factory floor once a booking exists; the code is created with the first booking.
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? { code: { contains: query.q, mode: 'insensitive' } } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.shipment.findMany({ where, include: shipmentInclude, relationLoadStrategy: 'join', orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.shipment.count({ where }),
  ]);
  return { items: rows.map((r) => toDto(r, actor)), meta: pageMeta(query.page, query.pageSize, total) };
}

/** Takes the request lock, then loads the shipment so every change to it is serialised. */
async function withShipment<T>(id: string, fn: (tx: Tx, row: ShipmentRow) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const ref = await tx.shipment.findUnique({ where: { id }, select: { requestId: true } });
    if (!ref) throw notFound('Shipment not found');
    await lockRequest(tx, ref.requestId);
    const row = await tx.shipment.findUniqueOrThrow({ where: { id }, include: shipmentInclude, relationLoadStrategy: 'join' });
    return fn(tx, row);
  });
}

/** Compares the received (net) weight with the collected quantity and raises an exception above the threshold. */
async function evaluateDiscrepancy(tx: Tx, row: ShipmentRow, receivedKg: string, actorId: string) {
  const collected = row.collectionJob.collectedQuantityKg?.toFixed(3);
  if (!collected) return { exceeded: false, variance: null as bigint | null };
  const variance = varianceHundredths(collected, receivedKg);
  const exceeded = exceedsVariance(collected, receivedKg, env.RECEPTION_VARIANCE_THRESHOLD_PCT);
  if (exceeded) {
    const open = await tx.exceptionCase.findFirst({ where: { shipmentId: row.id, type: 'RECEPTION_DISCREPANCY', status: 'OPEN' }, select: { id: true } });
    if (!open) {
      const pct = variance === null ? 'n/a' : formatHundredths(variance);
      const created = await tx.exceptionCase.create({
        data: {
          type: 'RECEPTION_DISCREPANCY',
          shipmentId: row.id,
          requestId: row.requestId,
          summary: `Received ${receivedKg} kg against ${collected} kg collected (${pct}% difference)`,
          details: {
            collectedKg: collected,
            receivedKg,
            variancePct: pct,
            thresholdPct: env.RECEPTION_VARIANCE_THRESHOLD_PCT,
            direction: Number(receivedKg) < Number(collected) ? 'SHORT' : 'OVER',
          },
          raisedById: actorId,
        },
      });
      await tx.exceptionEvent.create({ data: { exceptionId: created.id, type: 'RAISED', actorId, note: `Weight difference of ${pct}% exceeds the ${env.RECEPTION_VARIANCE_THRESHOLD_PCT}% threshold` } });
      await recordAudit(tx, { actorId, action: 'exception.raise', entityType: 'ExceptionCase', entityId: created.id, after: { type: 'RECEPTION_DISCREPANCY', shipmentCode: row.code, variancePct: pct } });
    }
  }
  return { exceeded, variance };
}

export async function recordWeight(actor: AuthUser, id: string, input: { kind: 'GROSS' | 'TARE'; valueKg: string }, ip: string | undefined) {
  try {
    await withShipment(id, async (tx, row) => {
      if (row.status !== 'ADMITTED') throw conflict('NOT_ADMITTED', 'The vehicle must be admitted at the gate before it is weighed');
      const current = currentWeights(weightRows(row));
      if (current[input.kind]) throw conflict('ALREADY_RECORDED', 'This weight is already recorded. A purchase manager can correct it with a reason.');

      const other = current[input.kind === 'GROSS' ? 'TARE' : 'GROSS'];
      let net: string | null = null;
      if (other) {
        const gross = input.kind === 'GROSS' ? input.valueKg : other.valueKg;
        const tare = input.kind === 'TARE' ? input.valueKg : other.valueKg;
        net = computeNet(gross, tare);
        if (net === null) throw badRequest('TARE_EXCEEDS_GROSS', 'Tare weight cannot be greater than gross weight', { grossKg: gross, tareKg: tare });
      }

      await tx.weightMeasurement.create({ data: { shipmentId: id, kind: input.kind, valueKg: input.valueKg, recordedById: actor.id } });
      if (net !== null) await tx.shipment.update({ where: { id }, data: { netWeightKg: net } });
      await recordAudit(tx, {
        actorId: actor.id,
        action: 'weight.record',
        entityType: 'Shipment',
        entityId: id,
        after: { shipmentCode: row.code, kind: input.kind, valueKg: input.valueKg, netKg: net },
        ip,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('ALREADY_RECORDED', 'This weight was just recorded by someone else');
    throw err;
  }
  return getShipment(actor, id);
}

/**
 * Corrects a recorded weight. The original row is kept; a new row points at it with the reason, the user and the time.
 * The shipment's net / received snapshots are refreshed and the discrepancy check is repeated.
 */
export async function correctWeight(actor: AuthUser, id: string, input: { kind: 'GROSS' | 'TARE'; valueKg: string; reason: string }, ip: string | undefined) {
  await withShipment(id, async (tx, row) => {
    const current = currentWeights(weightRows(row));
    const target = current[input.kind];
    if (!target) throw notFound('There is no recorded measurement of this kind to correct');
    if (target.valueKg === input.valueKg) throw badRequest('NO_CHANGE', 'The corrected value is the same as the current value');

    const other = current[input.kind === 'GROSS' ? 'TARE' : 'GROSS'];
    let net: string | null = row.netWeightKg?.toFixed(3) ?? null;
    if (other) {
      const gross = input.kind === 'GROSS' ? input.valueKg : other.valueKg;
      const tare = input.kind === 'TARE' ? input.valueKg : other.valueKg;
      net = computeNet(gross, tare);
      if (net === null) throw badRequest('TARE_EXCEEDS_GROSS', 'Tare weight cannot be greater than gross weight', { grossKg: gross, tareKg: tare });
    }

    await tx.weightMeasurement.create({
      data: { shipmentId: id, kind: input.kind, valueKg: input.valueKg, recordedById: actor.id, supersedesId: target.id, reason: input.reason },
    });
    const data: Prisma.ShipmentUpdateInput = {};
    if (other && net !== null) data.netWeightKg = net;
    const alreadyReceived = row.status === 'RECEIVED' || row.status === 'RELEASED';
    if (alreadyReceived && net !== null) data.receivedQuantityKg = net;
    if (Object.keys(data).length > 0) await tx.shipment.update({ where: { id }, data });
    if (alreadyReceived && net !== null) await evaluateDiscrepancy(tx, row, net, actor.id);

    await recordAudit(tx, {
      actorId: actor.id,
      action: 'weight.correct',
      entityType: 'Shipment',
      entityId: id,
      before: { kind: input.kind, valueKg: target.valueKg, netKg: row.netWeightKg?.toFixed(3) ?? null },
      after: { kind: input.kind, valueKg: input.valueKg, netKg: net, reason: input.reason, supersedes: target.id },
      ip,
    });
  });
  return getShipment(actor, id);
}

/** Completes reception: the net weight becomes the received quantity and is compared with what was collected. */
export async function receiveShipment(actor: AuthUser, id: string, ip: string | undefined) {
  await withShipment(id, async (tx, row) => {
    assertShipmentTransition(row.status, 'RECEIVED');
    if (row.netWeightKg === null) throw conflict('WEIGHING_INCOMPLETE', 'Record both the gross and the tare weight first');
    if (row.collectionJob.status !== 'HANDED_OVER') {
      throw conflict('HANDOVER_REQUIRED', 'The driver must record the handover before reception can be completed');
    }
    const net = row.netWeightKg.toFixed(3);
    await tx.shipment.update({ where: { id }, data: { status: 'RECEIVED', receivedQuantityKg: net, receivedAt: new Date(), receivedById: actor.id } });
    await moveRequest(tx, row.requestId, 'RECEIVED', actor.id);
    const { exceeded, variance } = await evaluateDiscrepancy(tx, row, net, actor.id);
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'shipment.receive',
      entityType: 'Shipment',
      entityId: id,
      before: { status: row.status },
      after: { status: 'RECEIVED', shipmentCode: row.code, receivedKg: net, discrepancy: exceeded, variancePct: variance === null ? null : formatHundredths(variance) },
      ip,
    });
  });
  return getShipment(actor, id);
}

/** Releases a received shipment to the processing queue. An open reception exception blocks release. */
export async function releaseToProcessing(actor: AuthUser, id: string, ip: string | undefined) {
  await withShipment(id, async (tx, row) => {
    assertShipmentTransition(row.status, 'RELEASED');
    const open = await tx.exceptionCase.count({ where: { shipmentId: id, type: 'RECEPTION_DISCREPANCY', status: 'OPEN' } });
    if (open > 0) throw conflict('EXCEPTION_OPEN', 'A weight discrepancy is open. A purchase manager must resolve it before this shipment can be processed.');
    if (row.receivedQuantityKg === null) throw conflict('WEIGHING_INCOMPLETE', 'There is no received quantity');

    const target = targetMinutes(row.receivedQuantityKg.toFixed(3), env.PROCESSING_MINUTES_PER_TONNE, env.PROCESSING_MIN_MINUTES);
    const entry = await tx.queueEntry.create({ data: { shipmentId: id, targetDurationMin: target, releasedById: actor.id }, select: { id: true } });
    await tx.shipment.update({ where: { id }, data: { status: 'RELEASED', releasedAt: new Date() } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'shipment.release',
      entityType: 'Shipment',
      entityId: id,
      after: { shipmentCode: row.code, queueEntryId: entry.id, targetDurationMin: target },
      ip,
    });
  });
  return getShipment(actor, id);
}
