import { randomUUID } from 'node:crypto';
import type { Role, UserStatus } from '@prisma/client';
import request from 'supertest';
import { expect } from 'vitest';
import { env } from '../../src/config/env';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/lib/password';
import { prisma } from '../../src/lib/prisma';
import { todayInTimezone } from '../../src/modules/procurement/schemas';

export const app = createApp({ loginMax: 10_000, registerMax: 10_000 });
export const PASSWORD = 'Str0ng-Test-Passw0rd!';

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: Role;
}

export async function createUser(
  role: Role,
  overrides: { password?: string; status?: UserStatus } = {},
): Promise<TestUser> {
  const password = overrides.password ?? PASSWORD;
  const email = `${role.toLowerCase()}-${randomUUID()}@test.local`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      fullName: `Test ${role}`,
      role,
      status: overrides.status ?? 'ACTIVE',
      ...(role === 'FARMER'
        ? { farmerProfile: { create: { phone: '9876543210', village: 'Razole', district: 'Konaseema', state: 'Andhra Pradesh' } } }
        : {}),
    },
  });
  return { id: user.id, email, password, role };
}

export async function loginAs(user: TestUser): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export function daysFromToday(days: number): string {
  const d = new Date(`${todayInTimezone(env.FACTORY_TIMEZONE)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const validRequestBody = (overrides: Record<string, unknown> = {}) => ({
  species: 'Vannamei',
  declaredSizeCount: '30-40 count/kg',
  declaredQuantityKg: '1000',
  expectedPriceInrPerKg: '420',
  availabilityDate: daysFromToday(5),
  notes: 'Harvest pond 3',
  ...overrides,
});

export async function submitRequest(token: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/v1/procurement').set(bearer(token)).send(validRequestBody(overrides));
  expect(res.status).toBe(201);
  return res.body.data as { id: string; code: string; status: string };
}

export function refreshCookieFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('pf_refresh='));
  expect(cookie).toBeDefined();
  return cookie!.split(';')[0]!;
}

// ---------------------------------------------------------------------------------------------
// Phase 4 helpers
// ---------------------------------------------------------------------------------------------
export async function createVehicle(overrides: { capacityKg?: string; isActive?: boolean } = {}) {
  return prisma.vehicle.create({
    data: {
      registrationNumber: `AP${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      capacityKg: overrides.capacityKg ?? '500',
      isActive: overrides.isActive ?? true,
    },
  });
}

export const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

export const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/v1${path}`).set(bearer(token)).send(body);

export const get = (token: string, path: string) => request(app).get(`/api/v1${path}`).set(bearer(token));

export interface Staff {
  manager: TestUser;
  managerToken: string;
  officer: TestUser;
  officerToken: string;
  otherOfficer: TestUser;
  otherOfficerToken: string;
  driver: TestUser;
  driverToken: string;
  otherDriver: TestUser;
  otherDriverToken: string;
  admin: TestUser;
  adminToken: string;
}

export async function createStaff(): Promise<Staff> {
  const [manager, officer, otherOfficer, driver, otherDriver, admin] = await Promise.all([
    createUser('PURCHASE_MANAGER'),
    createUser('FIELD_OFFICER'),
    createUser('FIELD_OFFICER'),
    createUser('TRANSPORT_OFFICER'),
    createUser('TRANSPORT_OFFICER'),
    createUser('ADMIN'),
  ]);
  return {
    manager,
    officer,
    otherOfficer,
    driver,
    otherDriver,
    admin,
    managerToken: await loginAs(manager),
    officerToken: await loginAs(officer),
    otherOfficerToken: await loginAs(otherOfficer),
    driverToken: await loginAs(driver),
    otherDriverToken: await loginAs(otherDriver),
    adminToken: await loginAs(admin),
  };
}

/** Farmer submits and the manager approves a request. Returns ids and tokens. */
export async function approvedRequest(staff: Staff, overrides: Record<string, unknown> = {}) {
  const farmer = await createUser('FARMER');
  const farmerToken = await loginAs(farmer);
  const created = await submitRequest(farmerToken, { declaredQuantityKg: '400', ...overrides });
  const res = await post(staff.managerToken, `/procurement/${created.id}/decision`, { decision: 'APPROVE' });
  expect(res.status).toBe(200);
  return { farmer, farmerToken, id: created.id, code: created.code };
}

export const goodFindings = (overrides: Record<string, unknown> = {}) => ({
  outcome: 'PASS',
  observedSpecies: 'Vannamei',
  observedSizeCount: '30-40',
  inspectedQuantityKg: '400',
  qualityNotes: 'Fresh, good colour, no odour',
  ...overrides,
});

/** Approved request with a completed PASS inspection by staff.officer. Returns the inspection id too. */
export async function passedRequest(staff: Staff, overrides: Record<string, unknown> = {}) {
  const base = await approvedRequest(staff, overrides);
  const assigned = await post(staff.managerToken, `/procurement/${base.id}/inspections`, { officerId: staff.officer.id });
  expect(assigned.status).toBe(201);
  const inspectionId = assigned.body.data.id as string;
  expect((await post(staff.officerToken, `/inspections/${inspectionId}/start`)).status).toBe(200);
  const done = await post(staff.officerToken, `/inspections/${inspectionId}/complete`, goodFindings());
  expect(done.status).toBe(200);
  return { ...base, inspectionId };
}

/** A brand-new transport officer. Each collection job needs its own, because an officer can hold only one active job. */
export async function newDriver() {
  const driver = await createUser('TRANSPORT_OFFICER');
  return { driver, driverToken: await loginAs(driver) };
}

/** Passed request with transport assigned to a FRESH driver and the given vehicle. Returns the driver too. */
export async function assignedCollection(staff: Staff, vehicleId: string, overrides: Record<string, unknown> = {}) {
  const base = await passedRequest(staff, overrides);
  const { driver, driverToken } = await newDriver();
  const res = await post(staff.managerToken, `/procurement/${base.id}/collections`, {
    transportOfficerId: driver.id,
    vehicleId,
    expectedArrivalAt: hoursFromNow(6),
  });
  expect(res.status).toBe(201);
  return { ...base, collectionId: res.body.data.id as string, driver, driverToken };
}

export async function requestStatus(id: string): Promise<string> {
  return (await prisma.procurementRequest.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
}

// ---------------------------------------------------------------------------------------------
// Phase 5 helpers (factory floor)
// ---------------------------------------------------------------------------------------------
export interface FactoryStaff {
  security: TestUser;
  securityToken: string;
  operator: TestUser;
  operatorToken: string;
}

export async function createFactoryStaff(): Promise<FactoryStaff> {
  const [security, operator] = await Promise.all([createUser('SECURITY_OFFICER'), createUser('FACTORY_OPERATOR')]);
  return { security, operator, securityToken: await loginAs(security), operatorToken: await loginAs(operator) };
}

/** Creates a slot directly in the database so tests can use windows the API would refuse (for example in the past). */
export async function makeSlot(staff: Staff, opts: { startHours?: number; durationHours?: number; capacity?: number; isActive?: boolean } = {}) {
  const jitter = Math.floor(Math.random() * 1000); // keeps (startsAt, endsAt) unique between tests
  const start = Date.now() + (opts.startHours ?? 0.5) * 3_600_000 + jitter;
  return prisma.factorySlot.create({
    data: {
      startsAt: new Date(start),
      endsAt: new Date(start + (opts.durationHours ?? 3) * 3_600_000),
      capacity: opts.capacity ?? 10,
      isActive: opts.isActive ?? true,
      createdById: staff.manager.id,
    },
  });
}

type Slot = Awaited<ReturnType<typeof makeSlot>>;

/** Transport assigned and the shipment booked into a slot (default: a slot that is open right now). */
export async function bookedShipment(staff: Staff, opts: { slot?: Slot; capacityKg?: string } = {}) {
  const vehicle = await createVehicle(opts.capacityKg ? { capacityKg: opts.capacityKg } : {});
  const base = await assignedCollection(staff, vehicle.id);
  const slot = opts.slot ?? (await makeSlot(staff));
  const res = await post(staff.managerToken, '/bookings', { collectionJobId: base.collectionId, slotId: slot.id });
  expect(res.status).toBe(201);
  return {
    ...base,
    vehicle,
    slot,
    bookingId: res.body.data.id as string,
    shipmentId: res.body.data.shipment.id as string,
    shipmentCode: res.body.data.shipment.code as string,
  };
}

/** The driver has collected the goods, dispatched and arrived at the factory. */
export async function arrivedShipment(staff: Staff, opts: { slot?: Slot; collectedKg?: string } = {}) {
  const b = await bookedShipment(staff, opts.slot ? { slot: opts.slot } : {});
  const base = `/collections/${b.collectionId}`;
  expect((await post(b.driverToken, `${base}/pickup`)).status).toBe(200);
  expect((await post(b.driverToken, `${base}/load`, { collectedQuantityKg: opts.collectedKg ?? '400', notes: 'Collected as agreed with the farmer' })).status).toBe(200);
  expect((await post(b.driverToken, `${base}/dispatch`)).status).toBe(200);
  expect((await post(b.driverToken, `${base}/arrive`)).status).toBe(200);
  return b;
}

/** The vehicle has been through the gate and is admitted. */
export async function admittedShipment(staff: Staff, fs: FactoryStaff, opts: { slot?: Slot; collectedKg?: string } = {}) {
  const a = await arrivedShipment(staff, opts);
  const path = `/bookings/${a.bookingId}`;
  expect((await post(fs.securityToken, `${path}/arrive`)).status).toBe(200);
  expect((await post(fs.securityToken, `${path}/verify`, { registrationNumber: a.vehicle.registrationNumber })).status).toBe(200);
  const admitted = await post(fs.securityToken, `${path}/admit`);
  expect(admitted.status).toBe(200);
  return a;
}

/** Admitted, driver has handed over, gross and tare recorded. Net weight = gross - tare. */
export async function weighedShipment(staff: Staff, fs: FactoryStaff, opts: { gross?: string; tare?: string; collectedKg?: string; handover?: boolean } = {}) {
  const a = await admittedShipment(staff, fs, opts.collectedKg ? { collectedKg: opts.collectedKg } : {});
  const sh = `/shipments/${a.shipmentId}`;
  expect((await post(fs.operatorToken, `${sh}/weights`, { kind: 'GROSS', valueKg: opts.gross ?? '1000' })).status).toBe(201);
  expect((await post(fs.operatorToken, `${sh}/weights`, { kind: 'TARE', valueKg: opts.tare ?? '600' })).status).toBe(201);
  if (opts.handover !== false) expect((await post(a.driverToken, `/collections/${a.collectionId}/handover`)).status).toBe(200);
  return a;
}

/** Fully received shipment (net 400 kg by default, matching the 400 kg collected). */
export async function receivedShipment(staff: Staff, fs: FactoryStaff, opts: { gross?: string; tare?: string; collectedKg?: string } = {}) {
  const w = await weighedShipment(staff, fs, opts);
  const res = await post(fs.operatorToken, `/shipments/${w.shipmentId}/receive`);
  expect(res.status).toBe(200);
  return w;
}

export async function createStation(admin: Staff, name = `Line ${randomUUID().slice(0, 6)}`) {
  const res = await post(admin.adminToken, '/stations', { name });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; name: string };
}

/** Released shipment waiting in the processing queue. */
export async function queuedShipment(staff: Staff, fs: FactoryStaff) {
  const r = await receivedShipment(staff, fs);
  const res = await post(fs.operatorToken, `/shipments/${r.shipmentId}/release`);
  expect(res.status).toBe(200);
  const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { shipmentId: r.shipmentId } });
  return { ...r, queueId: entry.id };
}
