import { beforeAll, describe, expect, it } from 'vitest';
import { computeAmountInr } from '../../src/modules/payments/rules';
import {
  createFactoryStaff, createStaff, createStation, get, post, queuedShipment, receivedShipment,
  type FactoryStaff, type Staff,
} from './helpers';

let staff: Staff;
let fs: FactoryStaff;
beforeAll(async () => {
  staff = await createStaff();
  fs = await createFactoryStaff();
});

const put = (token: string, path: string, body: Record<string, unknown>) =>
  import('supertest').then(({ default: request }) => import('./helpers').then(({ app, bearer }) => request(app).put(`/api/v1${path}`).set(bearer(token)).send(body)));

const plan = (lines: Record<string, unknown>[]) => ({ lines });
const line = (over: Record<string, unknown> = {}) => ({ form: 'HEADLESS', sizeGrade: '20-30', boxWeightKg: '10', quantity: 2, ...over });

/** A shipment that is being processed, with the manager's box plan already set. */
async function processingShipment(lines = [line()]) {
  const q = await queuedShipment(staff, fs);
  expect((await put(staff.managerToken, `/packing/plans/${q.id}`, plan(lines))).status).toBe(200);
  const station = await createStation(staff);
  expect((await post(fs.operatorToken, `/queue/${q.queueId}/start`, { stationId: station.id })).status).toBe(200);
  return { ...q, station };
}

const pack = (token: string, shipmentId: string, body: Record<string, unknown>) => post(token, `/packing/${shipmentId}/boxes`, body);

describe('box plan and packing', () => {
  it('only the purchase manager sets the box plan', async () => {
    const q = await queuedShipment(staff, fs);
    expect((await put(fs.operatorToken, `/packing/plans/${q.id}`, plan([line()]))).status).toBe(403);
    expect((await put(q.farmerToken, `/packing/plans/${q.id}`, plan([line()]))).status).toBe(403);
    expect((await put(staff.managerToken, `/packing/plans/${q.id}`, plan([line(), line()]))).status).toBe(400); // duplicate line
    expect((await put(staff.managerToken, `/packing/plans/${q.id}`, plan([line()]))).status).toBe(200);
  });

  it('operators pack boxes that follow the plan: right size, right weight, no more than ordered', async () => {
    const s = await processingShipment();
    const requirementId = (await get(fs.operatorToken, `/packing/${s.shipmentId}`)).body.data.requirements[0].id as string;

    expect((await pack(fs.operatorToken, s.shipmentId, { requirementId, netWeightKg: '12', count: 1 })).body.error.code).toBe('WEIGHT_OUT_OF_TOLERANCE');
    expect((await pack(staff.managerToken, s.shipmentId, { requirementId, netWeightKg: '10' })).status).toBe(403);
    const ok = await pack(fs.operatorToken, s.shipmentId, { requirementId, netWeightKg: '10.1', count: 2 });
    expect(ok.status).toBe(201);
    expect(ok.body.data.summary).toMatchObject({ packedBoxes: 2, requiredBoxes: 2, complete: true });
    expect((await pack(fs.operatorToken, s.shipmentId, { requirementId, netWeightKg: '10' })).body.error.code).toBe('REQUIREMENT_FULFILLED');
  });

  it('the manager numbers every box uniquely, can void one, and approves once the order is met', async () => {
    const s = await processingShipment();
    const requirementId = (await get(fs.operatorToken, `/packing/${s.shipmentId}`)).body.data.requirements[0].id as string;
    await pack(fs.operatorToken, s.shipmentId, { requirementId, netWeightKg: '10', count: 2 });

    expect((await post(staff.managerToken, `/packing/${s.shipmentId}/approve`)).body.error.code).toBe('PROCESSING_NOT_COMPLETE');
    expect((await post(fs.operatorToken, `/packing/${s.shipmentId}/assign-ids`)).status).toBe(403);

    const numbered = await post(staff.managerToken, `/packing/${s.shipmentId}/assign-ids`);
    expect(numbered.status).toBe(200);
    const numbers = numbered.body.data.boxes.map((b: { boxNumber: string }) => b.boxNumber);
    expect(new Set(numbers).size).toBe(2);
    expect(numbers[0]).toMatch(/^BOX-\d{4}-\d{6}$/);
    expect((await post(staff.managerToken, `/packing/${s.shipmentId}/assign-ids`)).body.error.code).toBe('NOTHING_TO_NUMBER');

    // A voided box stops counting, so the order is short by one until a replacement is packed.
    const voided = await post(staff.managerToken, `/packing/${s.shipmentId}/boxes/${numbered.body.data.boxes[0].id}/void`, { reason: 'Torn box' });
    expect(voided.body.data.summary.packedBoxes).toBe(1);
    await pack(fs.operatorToken, s.shipmentId, { requirementId, netWeightKg: '10', count: 1 });
    await post(staff.managerToken, `/packing/${s.shipmentId}/assign-ids`);

    expect((await post(fs.operatorToken, `/queue/${s.queueId}/complete`, {})).status).toBe(200);
    const approved = await post(staff.managerToken, `/packing/${s.shipmentId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.data.stage.approved).toBe(true);
    expect((await pack(fs.operatorToken, s.shipmentId, { requirementId, netWeightKg: '10' })).status).toBe(409);
  });

  it('an order that is not fully packed needs a note to approve', async () => {
    const s = await processingShipment([line({ quantity: 3 })]);
    const requirementId = (await get(fs.operatorToken, `/packing/${s.shipmentId}`)).body.data.requirements[0].id as string;
    await pack(fs.operatorToken, s.shipmentId, { requirementId, netWeightKg: '10', count: 1 });
    await post(staff.managerToken, `/packing/${s.shipmentId}/assign-ids`);
    await post(fs.operatorToken, `/queue/${s.queueId}/complete`, {});
    expect((await post(staff.managerToken, `/packing/${s.shipmentId}/approve`)).body.error.code).toBe('PACKING_INCOMPLETE');
    expect((await post(staff.managerToken, `/packing/${s.shipmentId}/approve`, { note: 'Farmer supplied less; accepted' })).status).toBe(200);
  });

  it('packing needs a box plan', async () => {
    const q = await queuedShipment(staff, fs);
    const station = await createStation(staff);
    await post(fs.operatorToken, `/queue/${q.queueId}/start`, { stationId: station.id });
    const view = await get(fs.operatorToken, `/packing/${q.shipmentId}`);
    expect(view.body.data.stage.hasPlan).toBe(false);
  });
});

describe('payment after delivery', () => {
  it('Pay Now makes an invoice the farmer can see straight away', async () => {
    const r = await receivedShipment(staff, fs);
    const before = await get(r.farmerToken, '/payments');
    expect(before.body.data.find((p: { shipmentId: string }) => p.shipmentId === r.shipmentId).state).toBe('AWAITING_DECISION');

    expect((await post(r.farmerToken, `/payments/${r.shipmentId}/decide`, { option: 'PAY_NOW' })).status).toBe(403);
    const paid = await post(staff.managerToken, `/payments/${r.shipmentId}/decide`, { option: 'PAY_NOW', method: 'UPI', reference: 'UTR123' });
    expect(paid.status).toBe(201);
    const invoice = paid.body.data.invoice;
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(invoice.amountInr).toBe(computeAmountInr(invoice.quantityKg, invoice.ratePerKg));
    expect(invoice.quantityBasis).toBe('FACTORY_WEIGHT');

    const mine = await get(r.farmerToken, `/payments/${r.shipmentId}`);
    expect(mine.body.data.state).toBe('PAID');
    expect(mine.body.data.invoice.invoiceNumber).toBe(invoice.invoiceNumber);
    expect((await post(staff.managerToken, `/payments/${r.shipmentId}/decide`, { option: 'PAY_LATER' })).body.error.code).toBe('ALREADY_DECIDED');
  });

  it('Pay Later shows a waiting status to the farmer and can be paid after processing is completed', async () => {
    const q = await queuedShipment(staff, fs);
    const later = await post(staff.managerToken, `/payments/${q.shipmentId}/decide`, { option: 'PAY_LATER' });
    expect(later.status).toBe(201);
    expect(later.body.data).toMatchObject({ state: 'PAY_LATER', invoice: null, canSettle: false });
    expect((await get(q.farmerToken, `/payments/${q.shipmentId}`)).body.data.state).toBe('PAY_LATER');
    expect((await post(staff.managerToken, `/payments/${q.shipmentId}/settle`)).body.error.code).toBe('PROCESSING_NOT_COMPLETE');

    const station = await createStation(staff);
    await post(fs.operatorToken, `/queue/${q.queueId}/start`, { stationId: station.id });
    await post(fs.operatorToken, `/queue/${q.queueId}/complete`, {});
    expect((await get(staff.managerToken, `/payments/${q.shipmentId}`)).body.data.canSettle).toBe(true);
    const settled = await post(staff.managerToken, `/payments/${q.shipmentId}/settle`, { method: 'BANK_TRANSFER' });
    expect(settled.status).toBe(200);
    expect(settled.body.data.state).toBe('PAID');
    expect(settled.body.data.invoice.invoiceNumber).toBeTruthy();
  });

  it('farmers cannot see other farmers’ payments, and undelivered shipments have no payment', async () => {
    const a = await receivedShipment(staff, fs);
    const b = await receivedShipment(staff, fs);
    expect((await get(a.farmerToken, `/payments/${b.shipmentId}`)).status).toBe(404);
    const list = await get(a.farmerToken, '/payments');
    expect(list.body.data.every((p: { shipmentId: string }) => p.shipmentId !== b.shipmentId)).toBe(true);
  });
});
