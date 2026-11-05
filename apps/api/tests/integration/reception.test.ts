import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import {
  admittedShipment, createFactoryStaff, createStaff, createUser, get, loginAs, post, queuedShipment, receivedShipment, requestStatus, weighedShipment,
  type FactoryStaff, type Staff,
} from './helpers';

let staff: Staff;
let fs: FactoryStaff;
beforeAll(async () => {
  staff = await createStaff();
  fs = await createFactoryStaff();
});

const weights = (shipmentId: string, token: string, kind: string, valueKg: string) => post(token, `/shipments/${shipmentId}/weights`, { kind, valueKg });
const correct = (shipmentId: string, token: string, body: Record<string, unknown>) => post(token, `/shipments/${shipmentId}/weights/correct`, body);

describe('recording weights', () => {
  it('only factory operators record weights, and only after the vehicle is admitted', async () => {
    const a = await admittedShipment(staff, fs);
    for (const token of [fs.securityToken, staff.managerToken, staff.adminToken, a.driverToken, a.farmerToken]) {
      expect((await weights(a.shipmentId, token, 'GROSS', '1000')).status).toBe(403);
    }
    const early = await (await import('./helpers')).bookedShipment(staff);
    const res = await weights(early.shipmentId, fs.operatorToken, 'GROSS', '1000');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_ADMITTED');
  });

  it('computes net = gross - tare exactly and stores it', async () => {
    const a = await admittedShipment(staff, fs);
    expect((await weights(a.shipmentId, fs.operatorToken, 'GROSS', '1250.500')).status).toBe(201);
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: a.shipmentId } });
    expect(shipment.netWeightKg).toBeNull(); // not until both are known
    const second = await weights(a.shipmentId, fs.operatorToken, 'TARE', '250.250');
    expect(second.status).toBe(201);
    expect(second.body.data.weights.netKg).toBe('1000.250');
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: a.shipmentId } })).netWeightKg?.toFixed(3)).toBe('1000.250');
  });

  it('tare can be recorded before gross, with the same result', async () => {
    const a = await admittedShipment(staff, fs);
    await weights(a.shipmentId, fs.operatorToken, 'TARE', '0.1');
    const res = await weights(a.shipmentId, fs.operatorToken, 'GROSS', '0.3');
    expect(res.body.data.weights.netKg).toBe('0.200');
  });

  it('rejects invalid measurements and a tare above the gross', async () => {
    const a = await admittedShipment(staff, fs);
    for (const bad of ['-1', '1.2345', 'abc', '']) expect((await weights(a.shipmentId, fs.operatorToken, 'GROSS', bad)).status).toBe(400);
    expect((await weights(a.shipmentId, fs.operatorToken, 'GROSS', '0')).status).toBe(400);
    await weights(a.shipmentId, fs.operatorToken, 'GROSS', '500');
    const res = await weights(a.shipmentId, fs.operatorToken, 'TARE', '500.001');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TARE_EXCEEDS_GROSS');
    expect(await prisma.weightMeasurement.count({ where: { shipmentId: a.shipmentId } })).toBe(1);
  });

  it('a weight cannot be recorded twice; it has to be corrected instead', async () => {
    const a = await admittedShipment(staff, fs);
    await weights(a.shipmentId, fs.operatorToken, 'GROSS', '1000');
    const again = await weights(a.shipmentId, fs.operatorToken, 'GROSS', '1100');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_RECORDED');
    const [x, y] = await Promise.all([weights(a.shipmentId, fs.operatorToken, 'TARE', '300'), weights(a.shipmentId, fs.operatorToken, 'TARE', '310')]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
  });
});

describe('correcting weights', () => {
  it('keeps the original, records reason, user and time, and refreshes the net weight', async () => {
    const a = await weighedShipment(staff, fs);
    const res = await correct(a.shipmentId, staff.managerToken, { kind: 'GROSS', valueKg: '990.5', reason: 'Weighbridge was mis-calibrated' });
    expect(res.status).toBe(200);
    expect(res.body.data.weights.gross.valueKg).toBe('990.500');
    expect(res.body.data.weights.netKg).toBe('390.500');
    const rows = await prisma.weightMeasurement.findMany({ where: { shipmentId: a.shipmentId, kind: 'GROSS' }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.valueKg.toFixed(3)).toBe('1000.000'); // original untouched
    expect(rows[1]!.supersedesId).toBe(rows[0]!.id);
    expect(rows[1]!.reason).toBe('Weighbridge was mis-calibrated');
    expect(rows[1]!.recordedById).toBe(staff.manager.id);
    const history = res.body.data.history.filter((h: { kind: string }) => h.kind === 'GROSS');
    expect(history).toHaveLength(2);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: a.shipmentId, action: 'weight.correct' } });
    expect(audit?.before).toMatchObject({ valueKg: '1000.000' });
    expect(audit?.after).toMatchObject({ valueKg: '990.500', reason: 'Weighbridge was mis-calibrated' });
  });

  it('can be corrected more than once, and the measurement rows can never be changed or deleted', async () => {
    const a = await weighedShipment(staff, fs);
    await correct(a.shipmentId, staff.managerToken, { kind: 'TARE', valueKg: '610', reason: 'First correction' });
    const second = await correct(a.shipmentId, staff.adminToken, { kind: 'TARE', valueKg: '605', reason: 'Second correction' });
    expect(second.body.data.weights.tare.valueKg).toBe('605.000');
    const rows = await prisma.weightMeasurement.findMany({ where: { shipmentId: a.shipmentId, kind: 'TARE' } });
    expect(rows).toHaveLength(3);
    await expect(prisma.weightMeasurement.update({ where: { id: rows[0]!.id }, data: { valueKg: '1' } })).rejects.toThrow();
    await expect(prisma.weightMeasurement.delete({ where: { id: rows[0]!.id } })).rejects.toThrow();
  });

  it('is limited to the purchase manager and administrator, and needs a reason and a real change', async () => {
    const a = await weighedShipment(staff, fs);
    for (const token of [fs.operatorToken, fs.securityToken, a.driverToken, a.farmerToken]) {
      expect((await correct(a.shipmentId, token, { kind: 'GROSS', valueKg: '900', reason: 'Not allowed to do this' })).status).toBe(403);
    }
    expect((await correct(a.shipmentId, staff.managerToken, { kind: 'GROSS', valueKg: '900' })).status).toBe(400);
    const same = await correct(a.shipmentId, staff.managerToken, { kind: 'GROSS', valueKg: '1000', reason: 'No actual change' });
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe('NO_CHANGE');
    const bad = await correct(a.shipmentId, staff.managerToken, { kind: 'GROSS', valueKg: '500', reason: 'Would make tare larger than gross' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('TARE_EXCEEDS_GROSS');
    expect(await prisma.weightMeasurement.count({ where: { shipmentId: a.shipmentId, kind: 'GROSS' } })).toBe(1);
  });

  it('there is nothing to correct before a weight has been recorded', async () => {
    const a = await admittedShipment(staff, fs);
    expect((await correct(a.shipmentId, staff.managerToken, { kind: 'GROSS', valueKg: '900', reason: 'Nothing recorded yet' })).status).toBe(404);
  });
});

describe('visibility of previous measurements', () => {
  it('operators do not see the collected quantity or the variance; managers do', async () => {
    const a = await weighedShipment(staff, fs);
    const operator = await get(fs.operatorToken, `/shipments/${a.shipmentId}`);
    expect(operator.status).toBe(200);
    expect(JSON.stringify(operator.body)).not.toMatch(/collectedQuantityKg|variancePct|thresholdPct|farmer|village/);
    expect(operator.body.data.weights.netKg).toBe('400.000');
    const manager = await get(staff.managerToken, `/shipments/${a.shipmentId}`);
    expect(manager.body.data.collectedQuantityKg).toBe('400.000');
    expect(manager.body.data.thresholdPct).toBeTypeOf('number');
  });

  it('farmers, drivers, officers and security cannot open shipments', async () => {
    const a = await weighedShipment(staff, fs);
    for (const token of [a.farmerToken, a.driverToken, staff.officerToken, fs.securityToken]) {
      expect((await get(token, `/shipments/${a.shipmentId}`)).status).toBe(403);
    }
    expect((await get(await loginAs(await createUser('FARMER')), '/shipments')).status).toBe(403);
  });
});

describe('completing reception', () => {
  it('needs both weights and the driver’s handover', async () => {
    const noWeights = await admittedShipment(staff, fs);
    const missing = await post(fs.operatorToken, `/shipments/${noWeights.shipmentId}/receive`);
    expect(missing.status).toBe(409);
    expect(missing.body.error.code).toBe('WEIGHING_INCOMPLETE');

    const noHandover = await weighedShipment(staff, fs, { handover: false });
    const res = await post(fs.operatorToken, `/shipments/${noHandover.shipmentId}/receive`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HANDOVER_REQUIRED');
    expect((await get(fs.operatorToken, `/shipments/${noHandover.shipmentId}`)).body.data.waitingForHandover).toBe(true);
  });

  it('only the operator completes reception; the received quantity is the net weight and the request moves on', async () => {
    const a = await weighedShipment(staff, fs);
    for (const token of [staff.managerToken, fs.securityToken, a.driverToken]) {
      expect((await post(token, `/shipments/${a.shipmentId}/receive`)).status).toBe(403);
    }
    const res = await post(fs.operatorToken, `/shipments/${a.shipmentId}/receive`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RECEIVED');
    expect(res.body.data.receivedQuantityKg).toBe('400.000');
    expect(await requestStatus(a.id)).toBe('RECEIVED');
    expect((await post(fs.operatorToken, `/shipments/${a.shipmentId}/receive`)).status).toBe(409);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: a.shipmentId, action: 'shipment.receive' } });
    expect(audit?.actorId).toBe(fs.operator.id);
  });

  it('declared, inspected, collected and received quantities all stay separate', async () => {
    const a = await receivedShipment(staff, fs, { gross: '1000', tare: '612.5', collectedKg: '400' });
    const request = await prisma.procurementRequest.findUniqueOrThrow({ where: { id: a.id } });
    const inspection = await prisma.fieldInspection.findUniqueOrThrow({ where: { id: a.inspectionId } });
    const job = await prisma.collectionJob.findUniqueOrThrow({ where: { id: a.collectionId } });
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: a.shipmentId } });
    expect(request.declaredQuantityKg.toFixed(3)).toBe('400.000');
    expect(inspection.inspectedQuantityKg?.toFixed(3)).toBe('400.000');
    expect(job.collectedQuantityKg?.toFixed(3)).toBe('400.000');
    expect(shipment.receivedQuantityKg?.toFixed(3)).toBe('387.500');
  });

  it('the farmer sees the received quantity but no processing details', async () => {
    const a = await receivedShipment(staff, fs);
    const res = await get(a.farmerToken, `/procurement/${a.id}`);
    const sh = res.body.data.shipments[0];
    expect(sh).toMatchObject({ code: a.shipmentCode, status: 'RECEIVED', receivedQuantityKg: '400.000' });
    expect(sh.queueStatus).toBeUndefined();
    expect(sh.openExceptions).toBeUndefined();
    expect(res.body.data.status).toBe('RECEIVED');
  });
});

describe('weight discrepancy exceptions', () => {
  it('no exception when the received weight is within the threshold', async () => {
    const a = await receivedShipment(staff, fs, { gross: '1000', tare: '620' }); // 380 vs 400 = 5.00 %, not above 5 %
    expect(await prisma.exceptionCase.count({ where: { shipmentId: a.shipmentId, type: 'RECEPTION_DISCREPANCY' } })).toBe(0);
  });

  it('raises an OPEN exception above the threshold, with the figures and a history entry', async () => {
    const a = await receivedShipment(staff, fs, { gross: '1000', tare: '650' }); // 350 vs 400 = 12.5 %
    const exception = await prisma.exceptionCase.findFirstOrThrow({ where: { shipmentId: a.shipmentId, type: 'RECEPTION_DISCREPANCY' } });
    expect(exception.status).toBe('OPEN');
    expect(exception.details).toMatchObject({ collectedKg: '400.000', receivedKg: '350.000', variancePct: '12.50', direction: 'SHORT' });
    expect(await prisma.exceptionEvent.count({ where: { exceptionId: exception.id, type: 'RAISED' } })).toBe(1);
    const sh = await get(staff.managerToken, `/shipments/${a.shipmentId}`);
    expect(sh.body.data.variancePct).toBe('12.50');
    expect((await get(fs.operatorToken, `/shipments/${a.shipmentId}`)).body.data.hasOpenDiscrepancy).toBe(true);
  });

  it('an open discrepancy blocks release until the manager resolves it with a reason', async () => {
    const a = await receivedShipment(staff, fs, { gross: '1000', tare: '650' });
    const blocked = await post(fs.operatorToken, `/shipments/${a.shipmentId}/release`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('EXCEPTION_OPEN');

    const exception = await prisma.exceptionCase.findFirstOrThrow({ where: { shipmentId: a.shipmentId, type: 'RECEPTION_DISCREPANCY' } });
    for (const token of [fs.operatorToken, staff.adminToken, fs.securityToken]) {
      expect((await post(token, `/exceptions/${exception.id}/resolve`, { resolution: 'Not authorised to do this' })).status).toBe(403);
    }
    expect((await post(staff.managerToken, `/exceptions/${exception.id}/resolve`, {})).status).toBe(400);
    const note = await post(staff.adminToken, `/exceptions/${exception.id}/notes`, { note: 'Asked the driver about ice melt' });
    expect(note.status).toBe(201);
    const resolved = await post(staff.managerToken, `/exceptions/${exception.id}/resolve`, { resolution: 'Ice melt during transport, driver confirmed' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.status).toBe('RESOLVED');
    expect(resolved.body.data.events.map((e: { type: string }) => e.type)).toEqual(['RAISED', 'NOTE', 'RESOLVED']);
    expect((await post(staff.managerToken, `/exceptions/${exception.id}/resolve`, { resolution: 'Resolving twice' })).status).toBe(409);

    const released = await post(fs.operatorToken, `/shipments/${a.shipmentId}/release`);
    expect(released.status).toBe(200);
    expect(released.body.data.status).toBe('RELEASED');
  });

  it('exception history is append-only in the database', async () => {
    const a = await receivedShipment(staff, fs, { gross: '1000', tare: '650' });
    const exception = await prisma.exceptionCase.findFirstOrThrow({ where: { shipmentId: a.shipmentId } });
    const event = await prisma.exceptionEvent.findFirstOrThrow({ where: { exceptionId: exception.id } });
    await expect(prisma.exceptionEvent.update({ where: { id: event.id }, data: { note: 'tampered' } })).rejects.toThrow();
    await expect(prisma.exceptionEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  });

  it('a correction after reception refreshes the received quantity and re-checks the threshold', async () => {
    const a = await receivedShipment(staff, fs); // net 400, no exception
    expect(await prisma.exceptionCase.count({ where: { shipmentId: a.shipmentId } })).toBe(0);
    const res = await correct(a.shipmentId, staff.managerToken, { kind: 'TARE', valueKg: '700', reason: 'Tare slip was misread' });
    expect(res.status).toBe(200);
    expect(res.body.data.receivedQuantityKg).toBe('300.000');
    expect(await prisma.exceptionCase.count({ where: { shipmentId: a.shipmentId, type: 'RECEPTION_DISCREPANCY', status: 'OPEN' } })).toBe(1);
  });

  it('only managers and administrators can read exceptions', async () => {
    const a = await receivedShipment(staff, fs, { gross: '1000', tare: '650' });
    expect((await get(staff.managerToken, '/exceptions?status=OPEN&pageSize=100')).status).toBe(200);
    expect((await get(staff.adminToken, '/exceptions')).status).toBe(200);
    for (const token of [fs.operatorToken, fs.securityToken, a.farmerToken, a.driverToken]) {
      expect((await get(token, '/exceptions')).status).toBe(403);
    }
  });
});

describe('release to processing', () => {
  it('creates a queue entry with a target duration from the received weight', async () => {
    const q = await queuedShipment(staff, fs); // 400 kg received -> 0.4 t x 120 min/t = 48 min (minimum 30)
    const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: q.queueId } });
    expect(entry.status).toBe('QUEUED');
    expect(entry.targetDurationMin).toBe(48);
    expect(entry.releasedById).toBe(fs.operator.id);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: q.shipmentId } })).status).toBe('RELEASED');
  });

  it('only the operator releases, and only a received shipment, once', async () => {
    const w = await weighedShipment(staff, fs);
    expect((await post(fs.operatorToken, `/shipments/${w.shipmentId}/release`)).status).toBe(409); // not received yet
    await post(fs.operatorToken, `/shipments/${w.shipmentId}/receive`);
    expect((await post(staff.managerToken, `/shipments/${w.shipmentId}/release`)).status).toBe(403);
    expect((await post(fs.operatorToken, `/shipments/${w.shipmentId}/release`)).status).toBe(200);
    expect((await post(fs.operatorToken, `/shipments/${w.shipmentId}/release`)).status).toBe(409);
    expect(await prisma.queueEntry.count({ where: { shipmentId: w.shipmentId } })).toBe(1);
  });
});
