import type { BookingStatus, GateEventType, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { recordAudit } from '../../lib/audit';
import { AppError, conflict, forbidden, isUniqueViolation, notFound } from '../../lib/errors';
import { nextShipmentCode } from '../../lib/ids';
import { lockRequest } from '../../lib/locks';
import { pageMeta } from '../../lib/pagination';
import { prisma, type Tx } from '../../lib/prisma';
import { ACTIVE_BOOKING_STATUSES, assertBookingTransition } from '../../lib/stateMachine';
import type { AuthUser } from '../../types/express';
import { isActiveCollection } from '../collections/rules';
import { allowedGateActions, gateState, MANAGER_GATE_ACTIONS, normalisePlate, windowState, type GateAction } from './gateRules';
import { bookedCount, lockSlot } from './slots';
import { currentWeights } from './weights';

const bookingInclude = {
  slot: true,
  gateEvents: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { fullName: true } } } },
  shipment: {
    include: {
      request: { select: { id: true, code: true } },
      collectionJob: { select: { status: true, vehicle: { select: { registrationNumber: true } }, transportOfficer: { select: { fullName: true } } } },
      weights: { select: { id: true, kind: true, valueKg: true, supersedesId: true } },
    },
  },
} satisfies Prisma.SlotBookingInclude;

type BookingRow = Prisma.SlotBookingGetPayload<{ include: typeof bookingInclude }>;

const isManager = (actor: AuthUser) => actor.role === 'PURCHASE_MANAGER' || actor.role === 'ADMIN';

function scopeFor(actor: AuthUser): Prisma.SlotBookingWhereInput {
  if (isManager(actor)) return {};
  // Gate staff only need the vehicles that are expected or on site.
  if (actor.role === 'SECURITY_OFFICER') return { status: { in: [...ACTIVE_BOOKING_STATUSES] } };
  throw forbidden();
}

function context(row: BookingRow, now: Date) {
  const state = gateState(row.gateEvents);
  const window = windowState(row.slot, now, env.GATE_EARLY_GRACE_MIN, env.GATE_LATE_GRACE_MIN);
  const weights = currentWeights(row.shipment.weights.map((w) => ({ ...w, valueKg: w.valueKg.toFixed(3) })));
  const weighed = weights.GROSS !== null && weights.TARE !== null;
  const actions = allowedGateActions({ bookingStatus: row.status, state, window, weighed });
  return { state, window, weighed, actions };
}

function toDto(row: BookingRow, actor: AuthUser, now = new Date()) {
  const { state, window, weighed, actions } = context(row, now);
  const manager = isManager(actor);
  const canEdit = row.status === 'RESERVED' && !state.admitted;
  const gateRoleActions = actions.filter((a) => (MANAGER_GATE_ACTIONS.includes(a) ? actor.role === 'PURCHASE_MANAGER' : actor.role === 'SECURITY_OFFICER'));
  return {
    id: row.id,
    status: row.status,
    slot: { id: row.slot.id, startsAt: row.slot.startsAt, endsAt: row.slot.endsAt },
    window,
    shipment: { id: row.shipment.id, code: row.shipment.code, status: row.shipment.status },
    vehicleRegistration: row.shipment.collectionJob.vehicle.registrationNumber,
    driverName: row.shipment.collectionJob.transportOfficer.fullName,
    gate: state,
    weighed,
    actions: gateRoleActions,
    // Scheduling changes belong to the Purchase Manager.
    canReschedule: actor.role === 'PURCHASE_MANAGER' && canEdit,
    canCancel: actor.role === 'PURCHASE_MANAGER' && canEdit && !state.arrived,
    ...(manager
      ? {
          request: row.shipment.request,
          reason: row.reason,
          events: row.gateEvents.map((e) => ({ id: e.id, type: e.type, by: e.actor.fullName, reason: e.reason, at: e.createdAt })),
        }
      : {}),
  };
}

async function loadRow(db: Tx | typeof prisma, id: string) {
  return db.slotBooking.findUnique({ where: { id }, include: bookingInclude, relationLoadStrategy: 'join' });
}

export async function getBooking(actor: AuthUser, id: string) {
  const row = await prisma.slotBooking.findFirst({ where: { id, ...scopeFor(actor) }, include: bookingInclude, relationLoadStrategy: 'join' });
  if (!row) throw notFound('Booking not found');
  return toDto(row, actor);
}

export async function listBookings(
  actor: AuthUser,
  query: { page: number; pageSize: number; status?: BookingStatus; from?: Date | undefined; to?: Date | undefined },
) {
  const where: Prisma.SlotBookingWhereInput = {
    ...scopeFor(actor),
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to ? { slot: { startsAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.slotBooking.findMany({
      where,
      include: bookingInclude, relationLoadStrategy: 'join',
      orderBy: [{ slot: { startsAt: 'asc' } }, { createdAt: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.slotBooking.count({ where }),
  ]);
  const now = new Date();
  return { items: rows.map((r) => toDto(r, actor, now)), meta: pageMeta(query.page, query.pageSize, total) };
}

// ------------------------------------------------------------------ scheduling (Purchase Manager)

async function assertSlotHasRoom(tx: Tx, slotId: string) {
  await lockSlot(tx, slotId);
  const slot = await tx.factorySlot.findUnique({ where: { id: slotId } });
  if (!slot) throw notFound('Slot not found');
  if (!slot.isActive || slot.endsAt <= new Date()) throw conflict('SLOT_UNAVAILABLE', 'This slot is inactive or has already ended');
  const booked = await bookedCount(tx, slotId);
  if (booked >= slot.capacity) throw conflict('SLOT_FULL', 'This slot is full. Choose another one.');
  return slot;
}

export async function createBooking(actor: AuthUser, input: { collectionJobId: string; slotId: string }, ip: string | undefined) {
  try {
    const id = await prisma.$transaction(async (tx) => {
      const ref = await tx.collectionJob.findUnique({ where: { id: input.collectionJobId }, select: { requestId: true } });
      if (!ref) throw notFound('Collection job not found');
      await lockRequest(tx, ref.requestId);

      const job = await tx.collectionJob.findUniqueOrThrow({ where: { id: input.collectionJobId }, select: { id: true, requestId: true, status: true } });
      if (!isActiveCollection(job.status)) throw conflict('JOB_NOT_ACTIVE', 'Only an active collection job can be booked into a slot');

      const shipment =
        (await tx.shipment.findUnique({ where: { collectionJobId: job.id } })) ??
        (await tx.shipment.create({ data: { code: await nextShipmentCode(tx), requestId: job.requestId, collectionJobId: job.id } }));
      if (shipment.status !== 'EXPECTED') throw conflict('SHIPMENT_ALREADY_ARRIVED', 'This shipment has already been admitted at the gate');

      const active = await tx.slotBooking.findFirst({ where: { shipmentId: shipment.id, status: { in: [...ACTIVE_BOOKING_STATUSES] } }, select: { id: true } });
      if (active) throw conflict('ALREADY_BOOKED', 'This shipment already has a booking. Reschedule it instead.');

      await assertSlotHasRoom(tx, input.slotId);
      const booking = await tx.slotBooking.create({ data: { shipmentId: shipment.id, slotId: input.slotId, reservedById: actor.id }, select: { id: true } });
      await recordAudit(tx, {
        actorId: actor.id,
        action: 'booking.create',
        entityType: 'SlotBooking',
        entityId: booking.id,
        after: { shipmentId: shipment.id, shipmentCode: shipment.code, slotId: input.slotId, collectionJobId: job.id },
        ip,
      });
      return booking.id;
    });
    return await getBooking(actor, id);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('ALREADY_BOOKED', 'This shipment already has a booking');
    throw err;
  }
}

/** Runs `fn` inside a transaction holding the request lock for this booking's shipment. */
async function withBooking<T>(bookingId: string, fn: (tx: Tx, row: BookingRow) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const ref = await tx.slotBooking.findUnique({ where: { id: bookingId }, select: { shipment: { select: { requestId: true } } } });
    if (!ref) throw notFound('Booking not found');
    await lockRequest(tx, ref.shipment.requestId);
    const row = await loadRow(tx, bookingId);
    if (!row) throw notFound('Booking not found');
    return fn(tx, row);
  });
}

export async function rescheduleBooking(actor: AuthUser, id: string, input: { slotId: string; reason: string }, ip: string | undefined) {
  const newId = await withBooking(id, async (tx, row) => {
    assertBookingTransition(row.status, 'RESCHEDULED');
    if (gateState(row.gateEvents).admitted) throw conflict('ALREADY_ADMITTED', 'The vehicle is already inside the factory');
    if (input.slotId === row.slotId) throw conflict('SAME_SLOT', 'Choose a different slot');

    // Always lock slots in a fixed order so two reschedules can never deadlock.
    for (const slotId of [row.slotId, input.slotId].sort()) await lockSlot(tx, slotId);
    await assertSlotHasRoom(tx, input.slotId);

    await tx.slotBooking.update({ where: { id }, data: { status: 'RESCHEDULED', reason: input.reason } });
    const created = await tx.slotBooking.create({
      data: { shipmentId: row.shipmentId, slotId: input.slotId, reservedById: actor.id, rescheduledFromId: id },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'booking.reschedule',
      entityType: 'SlotBooking',
      entityId: id,
      before: { slotId: row.slotId },
      after: { slotId: input.slotId, newBookingId: created.id, reason: input.reason },
      ip,
    });
    return created.id;
  });
  return getBooking(actor, newId);
}

export async function cancelBooking(actor: AuthUser, id: string, reason: string, ip: string | undefined) {
  await withBooking(id, async (tx, row) => {
    assertBookingTransition(row.status, 'CANCELLED');
    if (gateState(row.gateEvents).arrived) throw conflict('ALREADY_ARRIVED', 'The vehicle has arrived. Use reschedule, or let the gate reject it.');
    await tx.slotBooking.update({ where: { id }, data: { status: 'CANCELLED', reason } });
    await recordAudit(tx, { actorId: actor.id, action: 'booking.cancel', entityType: 'SlotBooking', entityId: id, before: { status: row.status }, after: { status: 'CANCELLED', reason }, ip });
  });
  return getBooking(actor, id);
}

export async function markNoShow(actor: AuthUser, id: string, reason: string | undefined, ip: string | undefined) {
  await withBooking(id, async (tx, row) => {
    assertBookingTransition(row.status, 'NO_SHOW');
    if (gateState(row.gateEvents).arrived) throw conflict('ALREADY_ARRIVED', 'The vehicle has arrived at the gate');
    if (windowState(row.slot, new Date(), env.GATE_EARLY_GRACE_MIN, env.GATE_LATE_GRACE_MIN) !== 'LATE') {
      throw conflict('SLOT_NOT_OVER', 'A booking can be marked no-show only after its slot and late grace period have ended');
    }
    await tx.slotBooking.update({ where: { id }, data: { status: 'NO_SHOW', reason: reason ?? null } });
    await recordAudit(tx, { actorId: actor.id, action: 'booking.no_show', entityType: 'SlotBooking', entityId: id, after: { reason }, ip });
  });
  return getBooking(actor, id);
}

// ------------------------------------------------------------------ gate

const EVENT_FOR: Record<GateAction, GateEventType> = {
  arrive: 'ARRIVED',
  verify: 'VERIFIED',
  hold: 'HELD',
  releaseHold: 'HOLD_RELEASED',
  reject: 'REJECTED',
  override: 'OVERRIDE',
  admit: 'ADMITTED',
  exit: 'EXITED',
};

export async function gateAction(
  actor: AuthUser,
  bookingId: string,
  action: GateAction,
  input: { registrationNumber?: string | undefined; reason?: string | undefined },
  ip: string | undefined,
) {
  await withBooking(bookingId, async (tx, row) => {
    const now = new Date();
    const { state, window, weighed, actions } = context(row, now);

    if (action === 'admit' && !actions.includes('admit') && state.verified && !state.held && window !== 'IN_WINDOW' && !state.overridden) {
      throw conflict('OUTSIDE_WINDOW', 'This vehicle is outside its booked time window. A purchase manager must authorise entry with a reason.', { window });
    }
    if (action === 'exit' && state.admitted && !state.exited && !weighed) {
      throw conflict('WEIGHING_INCOMPLETE', 'Weigh the vehicle in and out before it leaves');
    }
    if (!actions.includes(action)) {
      throw conflict('INVALID_GATE_ACTION', 'This gate step is not available for the vehicle right now', { allowed: actions });
    }

    if (action === 'verify') {
      const typed = normalisePlate(input.registrationNumber ?? '');
      const expected = normalisePlate(row.shipment.collectionJob.vehicle.registrationNumber);
      if (!['DISPATCHED', 'ARRIVED', 'HANDED_OVER'].includes(row.shipment.collectionJob.status)) {
        throw conflict('VEHICLE_NOT_DISPATCHED', 'This consignment has not been dispatched from the farm yet');
      }
      if (typed !== expected) throw new AppError(400, 'PLATE_MISMATCH', 'The registration number does not match the booked vehicle');
    }

    await tx.gateEvent.create({ data: { shipmentId: row.shipmentId, bookingId, type: EVENT_FOR[action], actorId: actor.id, reason: input.reason ?? null } });

    if (action === 'admit') {
      assertBookingTransition(row.status, 'CHECKED_IN');
      await tx.slotBooking.update({ where: { id: bookingId }, data: { status: 'CHECKED_IN' } });
      await tx.shipment.update({ where: { id: row.shipmentId }, data: { status: 'ADMITTED' } });
    }
    if (action === 'exit') {
      assertBookingTransition(row.status, 'COMPLETED');
      await tx.slotBooking.update({ where: { id: bookingId }, data: { status: 'COMPLETED' } });
    }
    if (action === 'reject') {
      assertBookingTransition(row.status, 'CANCELLED');
      await tx.slotBooking.update({ where: { id: bookingId }, data: { status: 'CANCELLED', reason: input.reason ?? null } });
      const open = await tx.exceptionCase.findFirst({ where: { shipmentId: row.shipmentId, type: 'GATE_REJECTION', status: 'OPEN' }, select: { id: true } });
      if (!open) {
        const created = await tx.exceptionCase.create({
          data: {
            type: 'GATE_REJECTION',
            shipmentId: row.shipmentId,
            requestId: row.shipment.requestId,
            summary: `Vehicle ${row.shipment.collectionJob.vehicle.registrationNumber} was refused entry at the gate`,
            details: { reason: input.reason, bookingId },
            raisedById: actor.id,
          },
        });
        await tx.exceptionEvent.create({ data: { exceptionId: created.id, type: 'RAISED', actorId: actor.id, note: input.reason ?? 'Entry refused' } });
      }
    }

    await recordAudit(tx, {
      actorId: actor.id,
      action: `gate.${action}`,
      entityType: 'SlotBooking',
      entityId: bookingId,
      after: { shipmentCode: row.shipment.code, window, reason: input.reason },
      ip,
    });
  });
  return getBooking(actor, bookingId);
}
