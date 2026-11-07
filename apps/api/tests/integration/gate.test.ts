import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import {
  admittedShipment, arrivedShipment, bookedShipment, createFactoryStaff, createStaff, createUser, get, loginAs, makeSlot, post,
  type FactoryStaff, type Staff,
} from './helpers';

let staff: Staff;
let fs: FactoryStaff;
beforeAll(async () => {
  staff = await createStaff();
  fs = await createFactoryStaff();
});

const gate = (token: string, bookingId: string, step: string, body: Record<string, unknown> = {}) => post(token, `/bookings/${bookingId}/${step}`, body);

describe('gate entry', () => {
  it('follows arrive → verify → admit and records every step', async () => {
    const a = await arrivedShipment(staff);
    const id = a.bookingId;
    expect((await gate(fs.securityToken, id, 'arrive')).body.data.actions).toEqual(expect.arrayContaining(['verify', 'hold', 'reject']));
    expect((await gate(fs.securityToken, id, 'verify', { registrationNumber: a.vehicle.registrationNumber.toLowerCase(), sealCode: a.sealCode })).status).toBe(200);
    const admitted = await gate(fs.securityToken, id, 'admit');
    expect(admitted.status).toBe(200);
    expect(admitted.body.data.status).toBe('CHECKED_IN');
    expect(admitted.body.data.shipment.status).toBe('ADMITTED');
    const events = await prisma.gateEvent.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(['ARRIVED', 'VERIFIED', 'ADMITTED']);
    expect(events.every((e) => e.actorId === fs.security.id)).toBe(true);
  });

  it('steps cannot be skipped or repeated', async () => {
    const a = await arrivedShipment(staff);
    for (const step of ['verify', 'admit', 'hold', 'reject', 'exit']) {
      const res = await gate(fs.securityToken, a.bookingId, step, { registrationNumber: a.vehicle.registrationNumber, reason: 'testing order' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_GATE_ACTION');
    }
    await gate(fs.securityToken, a.bookingId, 'arrive');
    expect((await gate(fs.securityToken, a.bookingId, 'arrive')).status).toBe(409);
    expect((await gate(fs.securityToken, a.bookingId, 'admit')).status).toBe(409); // not verified yet
  });

  it('a wrong registration number is refused and nothing is recorded', async () => {
    const a = await arrivedShipment(staff);
    await gate(fs.securityToken, a.bookingId, 'arrive');
    const res = await gate(fs.securityToken, a.bookingId, 'verify', { registrationNumber: 'ZZ99ZZ9999' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PLATE_MISMATCH');
    expect(await prisma.gateEvent.count({ where: { bookingId: a.bookingId, type: 'VERIFIED' } })).toBe(0);
  });

  it('a consignment that has not left the farm cannot be verified', async () => {
    const b = await bookedShipment(staff);
    await gate(fs.securityToken, b.bookingId, 'arrive');
    const res = await gate(fs.securityToken, b.bookingId, 'verify', { registrationNumber: b.vehicle.registrationNumber });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VEHICLE_NOT_DISPATCHED');
  });

  it('only security officers perform gate steps; managers only authorise', async () => {
    const a = await arrivedShipment(staff);
    for (const token of [staff.managerToken, staff.adminToken, fs.operatorToken, staff.driverToken, staff.officerToken]) {
      expect((await gate(token, a.bookingId, 'arrive')).status).toBe(403);
    }
    expect((await gate(fs.securityToken, a.bookingId, 'override', { reason: 'Security cannot authorise' })).status).toBe(403);
    expect((await gate(fs.securityToken, a.bookingId, 'release-hold', { reason: 'Security cannot authorise' })).status).toBe(403);
  });
});

describe('holds and rejections', () => {
  it('a hold needs a reason, blocks admission, and only a manager can release it (with a reason)', async () => {
    const a = await arrivedShipment(staff);
    const id = a.bookingId;
    await gate(fs.securityToken, id, 'arrive');
    await gate(fs.securityToken, id, 'verify', { registrationNumber: a.vehicle.registrationNumber, sealCode: a.sealCode });
    expect((await gate(fs.securityToken, id, 'hold', {})).status).toBe(400);
    expect((await gate(fs.securityToken, id, 'hold', { reason: 'Ice box seal looks broken' })).status).toBe(200);
    expect((await gate(fs.securityToken, id, 'admit')).status).toBe(409);
    expect((await gate(staff.managerToken, id, 'release-hold', {})).status).toBe(400);
    expect((await gate(staff.managerToken, id, 'release-hold', { reason: 'Seal inspected and re-applied' })).status).toBe(200);
    expect((await gate(fs.securityToken, id, 'admit')).status).toBe(200);
  });

  it('rejecting entry needs a reason, cancels the booking and opens an exception for the manager', async () => {
    const a = await arrivedShipment(staff);
    await gate(fs.securityToken, a.bookingId, 'arrive');
    expect((await gate(fs.securityToken, a.bookingId, 'reject', {})).status).toBe(400);
    const res = await gate(fs.securityToken, a.bookingId, 'reject', { reason: 'Strong ammonia smell, not fit for entry' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    const exception = await prisma.exceptionCase.findFirstOrThrow({ where: { shipmentId: a.shipmentId, type: 'GATE_REJECTION' } });
    expect(exception.status).toBe('OPEN');
    expect(await prisma.exceptionEvent.count({ where: { exceptionId: exception.id } })).toBe(1);
    expect((await gate(fs.securityToken, a.bookingId, 'admit')).status).toBe(409);
  });

  it('after a rejection the manager can book the shipment again', async () => {
    const a = await arrivedShipment(staff);
    await gate(fs.securityToken, a.bookingId, 'arrive');
    await gate(fs.securityToken, a.bookingId, 'reject', { reason: 'Documents missing at the gate' });
    const slot = await makeSlot(staff, { startHours: 1 });
    const again = await post(staff.managerToken, '/bookings', { collectionJobId: a.collectionId, slotId: slot.id });
    expect(again.status).toBe(201);
  });
});

describe('time window and authorised override', () => {
  async function arrivedInSlot(startHours: number) {
    const slot = await makeSlot(staff, { startHours, durationHours: 2 });
    const a = await arrivedShipment(staff, { slot });
    await gate(fs.securityToken, a.bookingId, 'arrive');
    await gate(fs.securityToken, a.bookingId, 'verify', { registrationNumber: a.vehicle.registrationNumber, sealCode: a.sealCode });
    return a;
  }

  it('admission is refused outside the window until a manager overrides it with a reason', async () => {
    const a = await arrivedInSlot(6); // far in the future
    const res = await gate(fs.securityToken, a.bookingId, 'admit');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUTSIDE_WINDOW');
    expect((await gate(staff.managerToken, a.bookingId, 'override', {})).status).toBe(400);
    const ok = await gate(staff.managerToken, a.bookingId, 'override', { reason: 'Factory ready early, farmer waiting' });
    expect(ok.status).toBe(200);
    expect((await gate(fs.securityToken, a.bookingId, 'admit')).status).toBe(200);
    const override = await prisma.gateEvent.findFirstOrThrow({ where: { bookingId: a.bookingId, type: 'OVERRIDE' } });
    expect(override.actorId).toBe(staff.manager.id);
    expect(override.reason).toBe('Factory ready early, farmer waiting');
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: a.bookingId, action: 'gate.override' } });
    expect(audit?.actorId).toBe(staff.manager.id);
  });

  it('a late arrival is handled the same way', async () => {
    const a = await arrivedInSlot(-8);
    expect((await gate(fs.securityToken, a.bookingId, 'admit')).body.error.code).toBe('OUTSIDE_WINDOW');
  });

  it('an override is not offered, and is refused, when the vehicle is on time', async () => {
    const a = await arrivedShipment(staff);
    await gate(fs.securityToken, a.bookingId, 'arrive');
    const res = await gate(staff.managerToken, a.bookingId, 'override', { reason: 'Not needed at all' });
    expect(res.status).toBe(409);
  });
});

describe('leaving the factory', () => {
  it('a vehicle cannot exit before it is weighed in and out', async () => {
    const a = await admittedShipment(staff, fs);
    const res = await gate(fs.securityToken, a.bookingId, 'exit');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('WEIGHING_INCOMPLETE');
  });

  it('after weighing, exit completes the booking', async () => {
    const a = await admittedShipment(staff, fs);
    await post(fs.operatorToken, `/shipments/${a.shipmentId}/weights`, { kind: 'GROSS', valueKg: '1000' });
    await post(fs.operatorToken, `/shipments/${a.shipmentId}/weights`, { kind: 'TARE', valueKg: '600' });
    const res = await gate(fs.securityToken, a.bookingId, 'exit');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect((await gate(fs.securityToken, a.bookingId, 'exit')).status).toBe(409);
  });
});

describe('gate history cannot be altered', () => {
  it('gate events are append-only in the database', async () => {
    const a = await arrivedShipment(staff);
    await gate(fs.securityToken, a.bookingId, 'arrive');
    const event = await prisma.gateEvent.findFirstOrThrow({ where: { bookingId: a.bookingId } });
    await expect(prisma.gateEvent.update({ where: { id: event.id }, data: { reason: 'tampered' } })).rejects.toThrow();
    await expect(prisma.gateEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  });

  it('managers see the full event history; security sees only the current state', async () => {
    const a = await arrivedShipment(staff);
    await gate(fs.securityToken, a.bookingId, 'arrive');
    const manager = await get(staff.managerToken, `/bookings/${a.bookingId}`);
    expect(manager.body.data.events).toHaveLength(1);
    const security = await get(fs.securityToken, `/bookings/${a.bookingId}`);
    expect(security.body.data.events).toBeUndefined();
    expect(security.body.data.gate.arrived).toBe(true);
    const other = await loginAs(await createUser('FARMER'));
    expect((await get(other, `/bookings/${a.bookingId}`)).status).toBe(403);
  });
});
