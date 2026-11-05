import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import {
  app, bearer, createFactoryStaff, createStaff, createStation, createUser, get, loginAs, post, queuedShipment, type FactoryStaff, type Staff,
} from './helpers';

let staff: Staff;
let fs: FactoryStaff;
beforeAll(async () => {
  staff = await createStaff();
  fs = await createFactoryStaff();
});

const start = (queueId: string, stationId: string, token = fs.operatorToken) => post(token, `/queue/${queueId}/start`, { stationId });
const complete = (queueId: string, body: Record<string, unknown> = {}, token = fs.operatorToken) => post(token, `/queue/${queueId}/complete`, body);

describe('processing stations', () => {
  it('only the administrator manages stations; manager and operator can list them', async () => {
    const name = `Line ${randomUUID().slice(0, 6)}`;
    expect((await post(staff.adminToken, '/stations', { name })).status).toBe(201);
    const dup = await post(staff.adminToken, '/stations', { name });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('STATION_EXISTS');
    for (const token of [staff.managerToken, fs.operatorToken, fs.securityToken, staff.driverToken]) {
      expect((await post(token, '/stations', { name: 'Not allowed' })).status).toBe(403);
    }
    expect((await get(staff.managerToken, '/stations')).status).toBe(200);
    expect((await get(fs.operatorToken, '/stations')).status).toBe(200);
    expect((await get(fs.securityToken, '/stations')).status).toBe(403);
    expect((await post(staff.adminToken, '/stations', { name: ' ' })).status).toBe(400);
  });
});

describe('the processing queue', () => {
  it('lists waiting shipments in arrival order with their position', async () => {
    const first = await queuedShipment(staff, fs);
    const second = await queuedShipment(staff, fs);
    const list = await get(fs.operatorToken, '/queue?pageSize=100');
    expect(list.status).toBe(200);
    const a = list.body.data.find((e: { id: string }) => e.id === first.queueId);
    const b = list.body.data.find((e: { id: string }) => e.id === second.queueId);
    expect(a.position).toBeLessThan(b.position);
    expect(a.timer).toMatchObject({ state: 'NOT_STARTED', targetSec: 48 * 60, remainingSec: 48 * 60 });
    expect(a.shipment.code).toBe(first.shipmentCode);
    expect(typeof list.body.meta.serverNow).toBe('string');
  });

  it('only operators, managers and administrators can read the queue; farmers, drivers and security cannot', async () => {
    const farmer = await loginAs(await createUser('FARMER'));
    for (const token of [fs.operatorToken, staff.managerToken, staff.adminToken]) expect((await get(token, '/queue')).status).toBe(200);
    for (const token of [farmer, fs.securityToken, staff.driverToken, staff.officerToken]) expect((await get(token, '/queue')).status).toBe(403);
  });
});

describe('starting and finishing processing', () => {
  it('start needs an active station, records the server time and operator, and only the operator can do it', async () => {
    const q = await queuedShipment(staff, fs);
    const station = await createStation(staff);
    expect((await start(q.queueId, station.id, staff.managerToken)).status).toBe(403);
    expect((await post(fs.operatorToken, `/queue/${q.queueId}/start`, {})).status).toBe(400);
    expect((await start(q.queueId, randomUUID())).status).toBe(409);
    const res = await start(q.queueId, station.id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
    expect(res.body.data.station.id).toBe(station.id);
    expect(res.body.data.timer.state).toBe('RUNNING');
    const row = await prisma.queueEntry.findUniqueOrThrow({ where: { id: q.queueId } });
    expect(row.startedAt).not.toBeNull();
    expect(row.startedById).toBe(fs.operator.id);
    expect((await start(q.queueId, station.id)).status).toBe(409); // cannot start twice
  });

  it('a station can run only one shipment at a time, even for simultaneous starts', async () => {
    const [a, b] = [await queuedShipment(staff, fs), await queuedShipment(staff, fs)];
    const station = await createStation(staff);
    const results = await Promise.all([start(a.queueId, station.id), start(b.queueId, station.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.queueEntry.count({ where: { stationId: station.id, status: 'IN_PROGRESS' } })).toBe(1);
  });

  it('a busy station cannot be deactivated', async () => {
    const q = await queuedShipment(staff, fs);
    const station = await createStation(staff);
    await start(q.queueId, station.id);
    const res = await request(app).patch(`/api/v1/stations/${station.id}`).set(bearer(staff.adminToken)).send({ isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STATION_BUSY');
  });

  it('cannot complete before starting', async () => {
    const q = await queuedShipment(staff, fs);
    expect((await complete(q.queueId)).status).toBe(409);
  });

  it('completion is explicit, recorded with the operator, and frees the station', async () => {
    const q = await queuedShipment(staff, fs);
    const station = await createStation(staff);
    await start(q.queueId, station.id);
    expect((await complete(q.queueId, {}, staff.managerToken)).status).toBe(403);
    const res = await complete(q.queueId, { notes: 'All lots processed' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.timer.state).toBe('COMPLETED');
    const row = await prisma.queueEntry.findUniqueOrThrow({ where: { id: q.queueId } });
    expect(row.completedById).toBe(fs.operator.id);
    expect(row.notes).toBe('All lots processed');
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: q.queueId, action: 'processing.complete' } });
    expect(audit?.after).toMatchObject({ targetSec: 48 * 60 });
    expect((await complete(q.queueId)).status).toBe(409);
    // the station can be used again
    const next = await queuedShipment(staff, fs);
    expect((await start(next.queueId, station.id)).status).toBe(200);
  });
});

describe('timers are computed from stored server times', () => {
  it('give the same answer after a refresh, because nothing is held in the browser', async () => {
    const q = await queuedShipment(staff, fs);
    const station = await createStation(staff);
    await start(q.queueId, station.id);
    await prisma.queueEntry.update({ where: { id: q.queueId }, data: { startedAt: new Date(Date.now() - 20 * 60_000) } });
    const read = async () => (await get(staff.managerToken, '/queue?pageSize=100')).body.data.find((e: { id: string }) => e.id === q.queueId);
    const first = await read();
    const second = await read();
    expect(first.startedAt).toBe(second.startedAt);
    expect(first.timer.state).toBe('RUNNING');
    expect(first.timer.elapsedSec).toBeGreaterThanOrEqual(20 * 60);
    expect(first.timer.elapsedSec).toBeLessThan(21 * 60);
    expect(first.timer.remainingSec).toBeLessThanOrEqual(48 * 60 - 20 * 60);
  });

  it('a timer that reaches zero does NOT complete processing: it only becomes overdue', async () => {
    const q = await queuedShipment(staff, fs);
    const station = await createStation(staff);
    await start(q.queueId, station.id);
    await prisma.queueEntry.update({ where: { id: q.queueId }, data: { startedAt: new Date(Date.now() - 3 * 3_600_000) } }); // 3 h into a 48 min target
    const entry = (await get(fs.operatorToken, '/queue?pageSize=100')).body.data.find((e: { id: string }) => e.id === q.queueId);
    expect(entry.timer.state).toBe('OVERDUE');
    expect(entry.timer.remainingSec).toBe(0);
    expect(entry.timer.overdueSec).toBeGreaterThan(2 * 3600);
    expect(entry.status).toBe('IN_PROGRESS'); // still running until the operator confirms
    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: q.queueId } })).completedAt).toBeNull();
    const done = await complete(q.queueId, { notes: 'Delayed by a machine fault' });
    expect(done.status).toBe(200);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: q.queueId, action: 'processing.complete' } });
    expect((audit?.after as { overdueSec: number }).overdueSec).toBeGreaterThan(2 * 3600);
  });
});
