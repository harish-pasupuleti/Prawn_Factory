import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import {
  app, arrivedShipment, assignedCollection, bearer, bookedShipment, createVehicle, createFactoryStaff, createStaff, createUser, get, hoursFromNow, loginAs, makeSlot, post,
  type FactoryStaff, type Staff,
} from './helpers';

let staff: Staff;
let fs: FactoryStaff;
beforeAll(async () => {
  staff = await createStaff();
  fs = await createFactoryStaff();
});

const patch = (token: string, path: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/v1${path}`).set(bearer(token)).send(body);

describe('factory slots', () => {
  const body = (extra: Record<string, unknown> = {}) => {
    const jitter = Math.floor(Math.random() * 1000);
    const start = Date.now() + 5 * 3_600_000 + jitter;
    return { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * 3_600_000).toISOString(), capacity: 3, ...extra };
  };

  it('the purchase manager and the administrator can create slots; nobody else can', async () => {
    expect((await post(staff.managerToken, '/slots', body())).status).toBe(201);
    expect((await post(staff.adminToken, '/slots', body())).status).toBe(201);
    for (const token of [fs.securityToken, fs.operatorToken, staff.officerToken, staff.driverToken]) {
      expect((await post(token, '/slots', body())).status).toBe(403);
      expect((await get(token, '/slots')).status).toBe(403);
    }
    const farmer = await loginAs(await createUser('FARMER'));
    expect((await post(farmer, '/slots', body())).status).toBe(403);
  });

  it('validates the window and the capacity, and rejects duplicates', async () => {
    const start = new Date(Date.now() + 8 * 3_600_000).toISOString();
    const end = new Date(Date.now() + 9 * 3_600_000).toISOString();
    expect((await post(staff.managerToken, '/slots', { startsAt: end, endsAt: start, capacity: 2 })).status).toBe(400);
    expect((await post(staff.managerToken, '/slots', { startsAt: hoursFromNow(-6), endsAt: hoursFromNow(-4), capacity: 2 })).status).toBe(400);
    expect((await post(staff.managerToken, '/slots', { startsAt: start, endsAt: end, capacity: 0 })).status).toBe(400);
    expect((await post(staff.managerToken, '/slots', { startsAt: start, endsAt: end, capacity: 2, createdById: randomUUID() })).status).toBe(400);
    expect((await post(staff.managerToken, '/slots', { startsAt: start, endsAt: end, capacity: 2 })).status).toBe(201);
    const dup = await post(staff.managerToken, '/slots', { startsAt: start, endsAt: end, capacity: 5 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SLOT_EXISTS');
  });

  it('shows how many places are booked and refuses capacity below that', async () => {
    const slot = await makeSlot(staff, { capacity: 2 });
    await bookedShipment(staff, { slot });
    const listed = await get(staff.managerToken, '/slots?pageSize=100');
    const row = listed.body.data.find((s: { id: string }) => s.id === slot.id);
    expect(row).toMatchObject({ capacity: 2, bookedCount: 1, available: 1 });
    expect((await patch(staff.managerToken, `/slots/${slot.id}`, { capacity: 0 })).status).toBe(400);
    expect((await patch(staff.managerToken, `/slots/${slot.id}`, { capacity: 3 })).status).toBe(200);
    await bookedShipment(staff, { slot });
    const tooLow = await patch(staff.managerToken, `/slots/${slot.id}`, { capacity: 1 });
    expect(tooLow.status).toBe(409);
    expect(tooLow.body.error.code).toBe('CAPACITY_BELOW_BOOKINGS');
  });
});

describe('booking a shipment into a slot', () => {
  it('only the purchase manager books; the booking creates a shipment with a unique code', async () => {
    const b = await bookedShipment(staff);
    expect(b.shipmentCode).toMatch(/^SH-\d{4}-\d{6}$/);
    const other = await bookedShipment(staff);
    expect(other.shipmentCode).not.toBe(b.shipmentCode);
    const slot = await makeSlot(staff);
    for (const token of [staff.adminToken, fs.securityToken, fs.operatorToken, staff.driverToken, b.farmerToken]) {
      expect((await post(token, '/bookings', { collectionJobId: b.collectionId, slotId: slot.id })).status).toBe(403);
    }
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: b.bookingId, action: 'booking.create' } });
    expect(audit?.actorId).toBe(staff.manager.id);
  });

  it('a shipment can have only one active booking', async () => {
    const b = await bookedShipment(staff);
    const slot = await makeSlot(staff);
    const again = await post(staff.managerToken, '/bookings', { collectionJobId: b.collectionId, slotId: slot.id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_BOOKED');
  });

  it('refuses a job that is not active', async () => {
    const b = await bookedShipment(staff);
    await post(staff.managerToken, `/bookings/${b.bookingId}/cancel`, { reason: 'Rebooking later' });
    await post(staff.managerToken, `/collections/${b.collectionId}/cancel`, { reason: 'Vehicle unavailable' });
    const slot = await makeSlot(staff);
    const res = await post(staff.managerToken, '/bookings', { collectionJobId: b.collectionId, slotId: slot.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('JOB_NOT_ACTIVE');
  });

  it('never exceeds slot capacity', async () => {
    const slot = await makeSlot(staff, { capacity: 1 });
    await bookedShipment(staff, { slot });
    const second = await arrivedShipmentWithoutBooking();
    const full = await post(staff.managerToken, '/bookings', { collectionJobId: second, slotId: slot.id });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('SLOT_FULL');
  });

  it('two simultaneous bookings for the last place: exactly one wins', async () => {
    const slot = await makeSlot(staff, { capacity: 1 });
    const [a, b] = [await arrivedShipmentWithoutBooking(), await arrivedShipmentWithoutBooking()];
    const results = await Promise.all([
      post(staff.managerToken, '/bookings', { collectionJobId: a, slotId: slot.id }),
      post(staff.managerToken, '/bookings', { collectionJobId: b, slotId: slot.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.slotBooking.count({ where: { slotId: slot.id, status: { in: ['RESERVED', 'CHECKED_IN'] } } })).toBe(1);
  });

  it('refuses inactive and finished slots', async () => {
    const jobId = await arrivedShipmentWithoutBooking();
    const inactive = await makeSlot(staff, { isActive: false });
    const past = await makeSlot(staff, { startHours: -5, durationHours: 1 });
    for (const slot of [inactive, past]) {
      const res = await post(staff.managerToken, '/bookings', { collectionJobId: jobId, slotId: slot.id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
    }
  });

  it('transport officers see their booked slot on the collection', async () => {
    const b = await bookedShipment(staff);
    const res = await get(b.driverToken, `/collections/${b.collectionId}`);
    expect(res.body.data.shipment.code).toBe(b.shipmentCode);
    expect(res.body.data.shipment.booking.id).toBe(b.bookingId);
  });
});

describe('rescheduling, cancelling and no-shows', () => {
  it('reschedule keeps the old booking as history and moves the capacity', async () => {
    const from = await makeSlot(staff, { capacity: 1 });
    const to = await makeSlot(staff, { capacity: 1, startHours: 6 });
    const b = await bookedShipment(staff, { slot: from });
    expect((await post(staff.managerToken, `/bookings/${b.bookingId}/reschedule`, { slotId: to.id })).status).toBe(400); // reason needed
    const res = await post(staff.managerToken, `/bookings/${b.bookingId}/reschedule`, { slotId: to.id, reason: 'Harvest delayed by a day' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RESERVED');
    expect(res.body.data.slot.id).toBe(to.id);
    expect((await prisma.slotBooking.findUniqueOrThrow({ where: { id: b.bookingId } })).status).toBe('RESCHEDULED');
    // the first slot has room again
    const next = await bookedShipment(staff, { slot: from });
    expect(next.slot.id).toBe(from.id);
  });

  it('reschedule to a full or identical slot is refused', async () => {
    const full = await makeSlot(staff, { capacity: 1, startHours: 7 });
    await bookedShipment(staff, { slot: full });
    const b = await bookedShipment(staff);
    const toFull = await post(staff.managerToken, `/bookings/${b.bookingId}/reschedule`, { slotId: full.id, reason: 'Needs a later slot' });
    expect(toFull.status).toBe(409);
    expect(toFull.body.error.code).toBe('SLOT_FULL');
    const same = await post(staff.managerToken, `/bookings/${b.bookingId}/reschedule`, { slotId: b.slot.id, reason: 'Same slot again' });
    expect(same.status).toBe(409);
  });

  it('cancelling needs a reason, frees the place, and is manager-only', async () => {
    const slot = await makeSlot(staff, { capacity: 1 });
    const b = await bookedShipment(staff, { slot });
    expect((await post(staff.managerToken, `/bookings/${b.bookingId}/cancel`, {})).status).toBe(400);
    expect((await post(fs.securityToken, `/bookings/${b.bookingId}/cancel`, { reason: 'Not my call' })).status).toBe(403);
    expect((await post(staff.managerToken, `/bookings/${b.bookingId}/cancel`, { reason: 'Farmer postponed harvest' })).status).toBe(200);
    expect((await bookedShipment(staff, { slot })).slot.id).toBe(slot.id);
  });

  it('a booking cannot be cancelled once the vehicle has arrived at the gate', async () => {
    const a = await arrivedShipment(staff);
    await post(fs.securityToken, `/bookings/${a.bookingId}/arrive`);
    const res = await post(staff.managerToken, `/bookings/${a.bookingId}/cancel`, { reason: 'Too late to cancel' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_ARRIVED');
  });

  it('no-show is only possible after the slot and its grace period have ended', async () => {
    const live = await bookedShipment(staff);
    const early = await post(staff.managerToken, `/bookings/${live.bookingId}/no-show`, {});
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('SLOT_NOT_OVER');

    const ended = await bookedShipment(staff);
    await prisma.factorySlot.update({ where: { id: ended.slot.id }, data: { startsAt: new Date(Date.now() - 6 * 3_600_000), endsAt: new Date(Date.now() - 4 * 3_600_000) } });
    const ok = await post(staff.managerToken, `/bookings/${ended.bookingId}/no-show`, { reason: 'Vehicle never came' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('NO_SHOW');
  });
});

describe('who can see bookings', () => {
  it('security sees only active bookings and no farmer or request details', async () => {
    const live = await bookedShipment(staff);
    const done = await bookedShipment(staff);
    await post(staff.managerToken, `/bookings/${done.bookingId}/cancel`, { reason: 'Replaced by another vehicle' });
    const list = await get(fs.securityToken, '/bookings?pageSize=100');
    expect(list.status).toBe(200);
    const ids = list.body.data.map((b: { id: string }) => b.id);
    expect(ids).toContain(live.bookingId);
    expect(ids).not.toContain(done.bookingId);
    const json = JSON.stringify(list.body.data.find((b: { id: string }) => b.id === live.bookingId));
    expect(json).not.toMatch(/farmer|village|phone|expectedPrice|PR-\d{4}/i);
    expect((await get(fs.securityToken, `/bookings/${done.bookingId}`)).status).toBe(404);
    expect((await get(staff.managerToken, `/bookings/${done.bookingId}`)).status).toBe(200);
  });

  it('farmers, drivers, field officers and factory operators cannot list bookings', async () => {
    const farmer = await loginAs(await createUser('FARMER'));
    for (const token of [farmer, staff.driverToken, staff.officerToken, fs.operatorToken]) {
      expect((await get(token, '/bookings')).status).toBe(403);
    }
  });
});

// ------------------------------------------------------------------ local helper
/** A collection job that has arrived at the factory but is not booked into any slot. */
async function arrivedShipmentWithoutBooking(): Promise<string> {
  const vehicle = await createVehicle();
  const base = await assignedCollection(staff, vehicle.id);
  return base.collectionId;
}
