import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import {
  approvedRequest, assignedCollection, createStaff, createUser, createVehicle, get, hoursFromNow, loginAs,
  newDriver, passedRequest, post, requestStatus, type Staff,
} from './helpers';

let staff: Staff;
beforeAll(async () => {
  staff = await createStaff();
});

const assignTo = (requestId: string, body: Record<string, unknown>, token = staff.managerToken) =>
  post(token, `/procurement/${requestId}/collections`, body);

describe('assigning transport', () => {
  it('only the purchase manager can assign', async () => {
    const v = await createVehicle();
    const r = await passedRequest(staff);
    for (const token of [r.farmerToken, staff.adminToken, staff.driverToken, staff.officerToken]) {
      expect((await assignTo(r.id, { transportOfficerId: staff.driver.id, vehicleId: v.id }, token)).status).toBe(403);
    }
    expect(await requestStatus(r.id)).toBe('INSPECTION_PASSED');
  });

  it('works after a PASS: request becomes TRANSPORT_ASSIGNED and the assignment is audited', async () => {
    const v = await createVehicle();
    const r = await passedRequest(staff);
    const d = await newDriver();
    const res = await assignTo(r.id, { transportOfficerId: d.driver.id, vehicleId: v.id, scheduledPickupAt: hoursFromNow(1), expectedArrivalAt: hoursFromNow(6) });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('ASSIGNED');
    expect(res.body.data.vehicle.registrationNumber).toBe(v.registrationNumber);
    expect(await requestStatus(r.id)).toBe('TRANSPORT_ASSIGNED');
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: res.body.data.id, action: 'collection.assign' } });
    expect(audit?.actorId).toBe(staff.manager.id);
  });

  it('refuses requests that have not passed inspection', async () => {
    const v = await createVehicle();
    const approved = await approvedRequest(staff);
    expect((await assignTo(approved.id, { transportOfficerId: staff.driver.id, vehicleId: v.id })).status).toBe(409);
    expect(await requestStatus(approved.id)).toBe('APPROVED');
  });

  it('validates the officer, the vehicle and the times', async () => {
    const v = await createVehicle();
    const inactive = await createVehicle({ isActive: false });
    const r = await passedRequest(staff);
    const wrongRole = await assignTo(r.id, { transportOfficerId: staff.officer.id, vehicleId: v.id });
    expect(wrongRole.status).toBe(400);
    expect(wrongRole.body.error.code).toBe('INVALID_ASSIGNEE');
    expect((await assignTo(r.id, { transportOfficerId: staff.driver.id, vehicleId: inactive.id })).body.error.code).toBe('INVALID_VEHICLE');
    expect((await assignTo(r.id, { transportOfficerId: staff.driver.id, vehicleId: randomUUID() })).status).toBe(400);
    expect((await assignTo(r.id, { transportOfficerId: staff.driver.id, vehicleId: v.id, scheduledPickupAt: hoursFromNow(-3) })).status).toBe(400);
    expect((await assignTo(r.id, { transportOfficerId: staff.driver.id, vehicleId: v.id, scheduledPickupAt: hoursFromNow(5), expectedArrivalAt: hoursFromNow(2) })).status).toBe(400);
    expect(await requestStatus(r.id)).toBe('INSPECTION_PASSED');
  });

  it('a vehicle or officer cannot hold two active jobs', async () => {
    const v = await createVehicle();
    const busyDriver = await newDriver();
    const idleDriver = await newDriver();
    const first = await passedRequest(staff);
    expect((await assignTo(first.id, { transportOfficerId: busyDriver.driver.id, vehicleId: v.id })).status).toBe(201);

    const second = await passedRequest(staff);
    const vehicleBusy = await assignTo(second.id, { transportOfficerId: idleDriver.driver.id, vehicleId: v.id });
    expect(vehicleBusy.status).toBe(409);
    expect(vehicleBusy.body.error.code).toBe('VEHICLE_BUSY');
    const officerBusy = await assignTo(second.id, { transportOfficerId: busyDriver.driver.id, vehicleId: (await createVehicle()).id });
    expect(officerBusy.status).toBe(409);
    expect(officerBusy.body.error.code).toBe('OFFICER_BUSY');
    expect(await requestStatus(second.id)).toBe('INSPECTION_PASSED');
  });

  it('simultaneous assignments of one vehicle: exactly one wins', async () => {
    const v = await createVehicle();
    const a = await passedRequest(staff);
    const b = await passedRequest(staff);
    const [d1, d2] = [await newDriver(), await newDriver()];
    const results = await Promise.all([
      assignTo(a.id, { transportOfficerId: d1.driver.id, vehicleId: v.id }),
      assignTo(b.id, { transportOfficerId: d2.driver.id, vehicleId: v.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.collectionJob.count({ where: { vehicleId: v.id } })).toBe(1);
  });
});

describe('transport steps', () => {
  it('must be performed in order by the assigned officer, with server timestamps', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    const base = `/collections/${r.collectionId}`;

    expect((await post(r.driverToken, `${base}/load`, { collectedQuantityKg: '400' })).status).toBe(409);
    expect((await post(r.driverToken, `${base}/dispatch`)).status).toBe(409);

    const picked = await post(r.driverToken, `${base}/pickup`);
    expect(picked.status).toBe(200);
    expect(picked.body.data.status).toBe('PICKED_UP');
    expect(picked.body.data.pickedUpAt).toBeTruthy();
    expect((await post(r.driverToken, `${base}/pickup`)).status).toBe(409);

    const loaded = await post(r.driverToken, `${base}/load`, { collectedQuantityKg: '395.25' });
    expect(loaded.status).toBe(200);
    expect(loaded.body.data.collectedQuantityKg).toBe('395.250');

    const dispatched = await post(r.driverToken, `${base}/dispatch`);
    expect(dispatched.status).toBe(200);
    expect(await requestStatus(r.id)).toBe('IN_TRANSIT');

    expect((await post(r.driverToken, `${base}/handover`)).status).toBe(409); // must arrive first
    expect((await post(r.driverToken, `${base}/arrive`)).status).toBe(200);
    const done = await post(r.driverToken, `${base}/handover`, { notes: 'Handed to gate supervisor' });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('HANDED_OVER');
    expect(await requestStatus(r.id)).toBe('DELIVERED');

    const audits = await prisma.auditEvent.findMany({ where: { entityId: r.collectionId }, select: { action: true } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['collection.assign', 'collection.pickup', 'collection.load', 'collection.dispatch', 'collection.arrive', 'collection.handover']));
  });

  it('declared, inspected and collected quantities stay separate', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    await post(r.driverToken, `/collections/${r.collectionId}/pickup`);
    await post(r.driverToken, `/collections/${r.collectionId}/load`, { collectedQuantityKg: '390' });
    const request = await prisma.procurementRequest.findUniqueOrThrow({ where: { id: r.id } });
    const inspection = await prisma.fieldInspection.findUniqueOrThrow({ where: { id: r.inspectionId } });
    const job = await prisma.collectionJob.findUniqueOrThrow({ where: { id: r.collectionId } });
    expect(request.declaredQuantityKg.toFixed(3)).toBe('400.000');
    expect(inspection.inspectedQuantityKg?.toFixed(3)).toBe('400.000');
    expect(job.collectedQuantityKg?.toFixed(3)).toBe('390.000');
  });

  it('refuses a load above vehicle capacity and invalid quantities', async () => {
    const small = await createVehicle({ capacityKg: '300' });
    const r = await assignedCollection(staff, small.id);
    await post(r.driverToken, `/collections/${r.collectionId}/pickup`);
    const tooMuch = await post(r.driverToken, `/collections/${r.collectionId}/load`, { collectedQuantityKg: '400' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('EXCEEDS_VEHICLE_CAPACITY');
    for (const bad of ['0', '-5', '1.2345', 'abc']) {
      expect((await post(r.driverToken, `/collections/${r.collectionId}/load`, { collectedQuantityKg: bad })).status).toBe(400);
    }
    expect((await prisma.collectionJob.findUniqueOrThrow({ where: { id: r.collectionId } })).status).toBe('PICKED_UP');
  });

  it('requires a note when the collected quantity differs a lot from the inspected quantity', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    await post(r.driverToken, `/collections/${r.collectionId}/pickup`);
    const missing = await post(r.driverToken, `/collections/${r.collectionId}/load`, { collectedQuantityKg: '250' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('NOTES_REQUIRED');
    const ok = await post(r.driverToken, `/collections/${r.collectionId}/load`, { collectedQuantityKg: '250', notes: 'Rest of the harvest not ready at pickup time' });
    expect(ok.status).toBe(200);
  });

  it('dispatch needs an expected arrival time', async () => {
    const v = await createVehicle();
    const base = await passedRequest(staff);
    const d = await newDriver();
    const res = await assignTo(base.id, { transportOfficerId: d.driver.id, vehicleId: v.id });
    const id = res.body.data.id as string;
    await post(d.driverToken, `/collections/${id}/pickup`);
    await post(d.driverToken, `/collections/${id}/load`, { collectedQuantityKg: '400' });
    const noEta = await post(d.driverToken, `/collections/${id}/dispatch`);
    expect(noEta.status).toBe(400);
    expect(noEta.body.error.code).toBe('EXPECTED_ARRIVAL_REQUIRED');
    expect((await post(d.driverToken, `/collections/${id}/dispatch`, { expectedArrivalAt: hoursFromNow(-1) })).status).toBe(400);
    expect((await post(d.driverToken, `/collections/${id}/dispatch`, { expectedArrivalAt: hoursFromNow(4) })).status).toBe(200);
  });

  it('frees the officer and vehicle after handover', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    const base = `/collections/${r.collectionId}`;
    await post(r.driverToken, `${base}/pickup`);
    await post(r.driverToken, `${base}/load`, { collectedQuantityKg: '400' });
    await post(r.driverToken, `${base}/dispatch`);
    await post(r.driverToken, `${base}/arrive`);
    await post(r.driverToken, `${base}/handover`);
    const next = await passedRequest(staff);
    expect((await assignTo(next.id, { transportOfficerId: r.driver.id, vehicleId: v.id })).status).toBe(201);
  });
});

describe('transport officer access and data limits', () => {
  it('officers act only on their own jobs; others are refused', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    const base = `/collections/${r.collectionId}`;
    expect((await get(staff.otherDriverToken, base)).status).toBe(404);
    expect((await post(staff.otherDriverToken, `${base}/pickup`)).status).toBe(404);
    for (const token of [staff.managerToken, staff.adminToken, staff.officerToken, r.farmerToken]) {
      expect((await post(token, `${base}/pickup`)).status).toBe(403);
    }
    const mine = await get(r.driverToken, '/collections?pageSize=100');
    expect(mine.body.data.some((c: { id: string }) => c.id === r.collectionId)).toBe(true);
    const theirs = await get(staff.otherDriverToken, '/collections?pageSize=100');
    expect(theirs.body.data.some((c: { id: string }) => c.id === r.collectionId)).toBe(false);
  });

  it('manager and admin can read; farmers, security and factory staff cannot list', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    expect((await get(staff.managerToken, `/collections/${r.collectionId}`)).status).toBe(200);
    expect((await get(staff.adminToken, `/collections/${r.collectionId}`)).status).toBe(200);
    for (const role of ['FARMER', 'SECURITY_OFFICER', 'FACTORY_OPERATOR', 'FIELD_OFFICER'] as const) {
      expect((await get(await loginAs(await createUser(role)), '/collections')).status).toBe(403);
    }
  });

  it('a transport officer sees pickup details but never the price, and cannot alter declarations or inspections', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    const res = await get(r.driverToken, `/collections/${r.collectionId}`);
    expect(JSON.stringify(res.body)).not.toContain('expectedPrice');
    expect(res.body.data.request.farmer.village).toBeDefined();
    expect(res.body.data.request.inspectedQuantityKg).toBe('400.000');
    const amend = await post(r.driverToken, `/procurement/${r.id}/amendments`, { field: 'declaredQuantityKg', newValue: '999', reason: 'trying to edit' });
    expect(amend.status).toBe(403);
    expect((await post(r.driverToken, `/inspections/${r.inspectionId}/decision`, { decision: 'PROCEED', reason: 'nope nope' })).status).toBe(403);
    expect((await get(r.driverToken, `/inspections/${r.inspectionId}`)).status).toBe(403);
  });
});

describe('incidents', () => {
  it('are recorded while the job is active, never alter measurements, and are append-only', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    const res = await post(r.driverToken, `/collections/${r.collectionId}/incidents`, { type: 'DELAY', description: 'Level crossing closed for 40 minutes' });
    expect(res.status).toBe(201);
    expect(res.body.data.incidents).toHaveLength(1);
    expect((await post(r.driverToken, `/collections/${r.collectionId}/incidents`, { type: 'DELAY', description: '' })).status).toBe(400);
    expect((await post(staff.otherDriverToken, `/collections/${r.collectionId}/incidents`, { type: 'DELAY', description: 'not my job' })).status).toBe(404);
    const row = await prisma.collectionIncident.findFirstOrThrow({ where: { collectionJobId: r.collectionId } });
    await expect(prisma.collectionIncident.update({ where: { id: row.id }, data: { description: 'tampered' } })).rejects.toThrow();
    await expect(prisma.collectionIncident.delete({ where: { id: row.id } })).rejects.toThrow();
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: r.collectionId, action: 'collection.incident' } });
    expect(audit?.actorId).toBe(r.driver.id);
  });

  it('cannot be added once the job is closed', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    await post(staff.managerToken, `/collections/${r.collectionId}/cancel`, { reason: 'Vehicle unavailable' });
    expect((await post(r.driverToken, `/collections/${r.collectionId}/incidents`, { type: 'DELAY', description: 'too late now' })).status).toBe(409);
  });
});

describe('cancelling', () => {
  it('manager cancels before dispatch: request returns to INSPECTION_PASSED and a new job can be assigned', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    await post(r.driverToken, `/collections/${r.collectionId}/pickup`);
    expect((await post(r.driverToken, `/collections/${r.collectionId}/cancel`, { reason: 'self cancel' })).status).toBe(403);
    expect((await post(staff.managerToken, `/collections/${r.collectionId}/cancel`, {})).status).toBe(400);
    const res = await post(staff.managerToken, `/collections/${r.collectionId}/cancel`, { reason: 'Vehicle breakdown at depot' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(await requestStatus(r.id)).toBe('INSPECTION_PASSED');
    expect((await assignTo(r.id, { transportOfficerId: r.driver.id, vehicleId: v.id })).status).toBe(201);
  });

  it('cannot cancel once dispatched, and the request cannot be cancelled in transit', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    const base = `/collections/${r.collectionId}`;
    await post(r.driverToken, `${base}/pickup`);
    await post(r.driverToken, `${base}/load`, { collectedQuantityKg: '400' });
    await post(r.driverToken, `${base}/dispatch`);
    expect((await post(staff.managerToken, `${base}/cancel`, { reason: 'too late to cancel' })).status).toBe(409);
    const cancelRequest = await post(staff.managerToken, `/procurement/${r.id}/cancel`, { reason: 'too late to cancel' });
    expect(cancelRequest.status).toBe(409);
    expect(await requestStatus(r.id)).toBe('IN_TRANSIT');
  });

  it('cancelling the request cascades to the active job and frees the vehicle', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    expect((await post(r.farmerToken, `/procurement/${r.id}/cancel`, { reason: 'Changed my mind' })).status).toBe(409);
    expect((await post(staff.managerToken, `/procurement/${r.id}/cancel`, { reason: 'Farmer withdrew by phone' })).status).toBe(200);
    expect((await prisma.collectionJob.findUniqueOrThrow({ where: { id: r.collectionId } })).status).toBe('CANCELLED');
    const next = await passedRequest(staff);
    expect((await assignTo(next.id, { transportOfficerId: r.driver.id, vehicleId: v.id })).status).toBe(201);
  });
});

describe('visibility and indicators', () => {
  it('the farmer sees collection progress but not internal notes or incidents', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    await post(r.driverToken, `/collections/${r.collectionId}/incidents`, { type: 'DELAY', description: 'Traffic jam near the highway' });
    const res = await get(r.farmerToken, `/procurement/${r.id}`);
    const c = res.body.data.collections[0];
    expect(c.status).toBe('ASSIGNED');
    expect(c.vehicleRegistration).toBe(v.registrationNumber);
    expect(c.incidents).toBeUndefined();
    expect(c.cancelReason).toBeUndefined();
    const staffView = await get(staff.managerToken, `/procurement/${r.id}`);
    expect(staffView.body.data.collections[0].incidents).toHaveLength(1);
  });

  it('flags overdue collections from stored times', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    expect((await get(staff.managerToken, `/collections/${r.collectionId}`)).body.data.overdue).toBe(false);
    await prisma.collectionJob.update({ where: { id: r.collectionId }, data: { expectedArrivalAt: new Date(Date.now() - 3_600_000) } });
    expect((await get(staff.managerToken, `/collections/${r.collectionId}`)).body.data.overdue).toBe(true);
  });
});

describe('vehicles and assignee directory', () => {
  const body = () => ({ registrationNumber: `ap${randomUUID().replace(/-/g, '').slice(0, 8)}`, capacityKg: '1200', description: 'Insulated truck' });

  it('only the administrator manages vehicles; the manager can list them', async () => {
    const created = await post(staff.adminToken, '/vehicles', body());
    expect(created.status).toBe(201);
    expect(created.body.data.registrationNumber).toBe(created.body.data.registrationNumber.toUpperCase());
    expect(created.body.data.capacityKg).toBe('1200.000');
    for (const token of [staff.managerToken, staff.driverToken, staff.officerToken]) {
      expect((await post(token, '/vehicles', body())).status).toBe(403);
    }
    expect((await get(staff.managerToken, '/vehicles?active=true&pageSize=100')).status).toBe(200);
    expect((await get(staff.driverToken, '/vehicles')).status).toBe(403);
    const dup = await post(staff.adminToken, '/vehicles', { registrationNumber: created.body.data.registrationNumber, capacityKg: '5' });
    expect(dup.status).toBe(409);
    expect((await post(staff.adminToken, '/vehicles', { ...body(), capacityKg: '0' })).status).toBe(400);
  });

  it('a vehicle with an active job cannot be deactivated', async () => {
    const v = await createVehicle();
    await assignedCollection(staff, v.id);
    const res = await request_patch(v.id, { isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VEHICLE_BUSY');
    const idle = await createVehicle();
    expect((await request_patch(idle.id, { isActive: false })).status).toBe(200);
  });

  it('the assignee directory is for the manager only and shows workload without personal data', async () => {
    const res = await get(staff.managerToken, '/assignees?role=FIELD_OFFICER');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toEqual(expect.objectContaining({ id: expect.any(String), fullName: expect.any(String), activeCount: expect.any(Number) }));
    expect(JSON.stringify(res.body)).not.toContain('@');
    expect((await get(staff.managerToken, '/assignees?role=ADMIN')).status).toBe(400);
    for (const token of [staff.adminToken, staff.officerToken, staff.driverToken]) {
      expect((await get(token, '/assignees?role=FIELD_OFFICER')).status).toBe(403);
    }
  });
});

import request from 'supertest';
import { app, bearer } from './helpers';
const request_patch = (id: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/v1/vehicles/${id}`).set(bearer(staff.adminToken)).send(body);
