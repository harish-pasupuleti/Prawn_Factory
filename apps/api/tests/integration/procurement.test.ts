import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import {
  app, bearer, createUser, daysFromToday, loginAs, submitRequest, validRequestBody, type TestUser,
} from './helpers';

let manager: TestUser;
let managerToken: string;

beforeAll(async () => {
  manager = await createUser('PURCHASE_MANAGER');
  managerToken = await loginAs(manager);
});

async function newFarmer() {
  const user = await createUser('FARMER');
  return { user, token: await loginAs(user) };
}

const decide = (token: string, id: string, body: Record<string, unknown>) =>
  request(app).post(`/api/v1/procurement/${id}/decision`).set(bearer(token)).send(body);

describe('submission', () => {
  it('creates a SUBMITTED request with a unique PR code and preserves the original declaration', async () => {
    const { token } = await newFarmer();
    const a = await submitRequest(token, { species: 'Vannamei' });
    const b = await submitRequest(token, { species: 'Black Tiger' });
    expect(a.code).toMatch(/^PR-\d{4}-\d{6}$/);
    expect(a.code).not.toBe(b.code);
    expect(a.status).toBe('SUBMITTED');
    const res = await request(app).get(`/api/v1/procurement/${a.id}`).set(bearer(token));
    expect(res.body.data.original.declaredQuantityKg).toBe('1000.000');
    expect(res.body.data.original.expectedPriceInrPerKg).toBe('420.00');
  });

  it('only farmers can submit', async () => {
    for (const user of [manager, await createUser('ADMIN'), await createUser('FIELD_OFFICER')]) {
      const res = await request(app).post('/api/v1/procurement').set(bearer(await loginAs(user))).send(validRequestBody());
      expect(res.status).toBe(403);
    }
    expect((await request(app).post('/api/v1/procurement').send(validRequestBody())).status).toBe(401);
  });

  it('rejects invalid quantities, prices, dates and unknown fields at the API', async () => {
    const { token } = await newFarmer();
    for (const body of [
      validRequestBody({ declaredQuantityKg: '-1' }),
      validRequestBody({ declaredQuantityKg: '10.1234' }),
      validRequestBody({ expectedPriceInrPerKg: 'free' }),
      validRequestBody({ availabilityDate: daysFromToday(-3) }),
      validRequestBody({ status: 'APPROVED' }),
      validRequestBody({ farmerId: randomUUID() }),
    ]) {
      const res = await request(app).post('/api/v1/procurement').set(bearer(token)).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects an identical open request from the same farmer (duplicate submission)', async () => {
    const { token } = await newFarmer();
    const body = validRequestBody();
    expect((await request(app).post('/api/v1/procurement').set(bearer(token)).send(body)).status).toBe(201);
    const dup = await request(app).post('/api/v1/procurement').set(bearer(token)).send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_REQUEST');
  });

  it('handles simultaneous identical submissions: exactly one succeeds', async () => {
    const { user, token } = await newFarmer();
    const body = validRequestBody();
    const results = await Promise.all(
      [1, 2, 3].map(() => request(app).post('/api/v1/procurement').set(bearer(token)).send(body)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.procurementRequest.count({ where: { farmer: { userId: user.id } } })).toBe(1);
  });

  it('persists in PostgreSQL with an audit event', async () => {
    const { user, token } = await newFarmer();
    const created = await submitRequest(token);
    const row = await prisma.procurementRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.declaredQuantityKg.toFixed(3)).toBe('1000.000');
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: created.id, action: 'procurement.submit' } });
    expect(audit?.actorId).toBe(user.id);
  });
});

describe('ownership and role access', () => {
  it("a farmer cannot see, cancel or amend another farmer's request (404, not 403)", async () => {
    const owner = await newFarmer();
    const other = await newFarmer();
    const req = await submitRequest(owner.token);
    expect((await request(app).get(`/api/v1/procurement/${req.id}`).set(bearer(other.token))).status).toBe(404);
    expect((await request(app).post(`/api/v1/procurement/${req.id}/cancel`).set(bearer(other.token)).send({ reason: 'not mine' })).status).toBe(404);
    expect(
      (await request(app).post(`/api/v1/procurement/${req.id}/amendments`).set(bearer(other.token)).send({ field: 'species', newValue: 'Hacked', reason: 'not mine' })).status,
    ).toBe(403);
    const after = await prisma.procurementRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe('SUBMITTED');
  });

  it('lists only the farmer’s own requests but all requests for managers', async () => {
    const a = await newFarmer();
    const b = await newFarmer();
    await submitRequest(a.token);
    await submitRequest(b.token);
    const own = await request(app).get('/api/v1/procurement').set(bearer(a.token));
    expect(own.body.meta.total).toBe(1);
    const all = await request(app).get('/api/v1/procurement?pageSize=100').set(bearer(managerToken));
    expect(all.body.meta.total).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(own.body)).not.toContain('"farmer":');
    expect(all.body.data[0].farmer.name).toBeDefined();
  });

  it('roles without procurement access get 403', async () => {
    for (const role of ['FIELD_OFFICER', 'TRANSPORT_OFFICER', 'SECURITY_OFFICER', 'FACTORY_OPERATOR'] as const) {
      const token = await loginAs(await createUser(role));
      expect((await request(app).get('/api/v1/procurement').set(bearer(token))).status).toBe(403);
      expect((await request(app).get('/api/v1/procurement/stats').set(bearer(token))).status).toBe(403);
    }
  });

  it('stats reflect real data per role scope', async () => {
    const f = await newFarmer();
    const r1 = await submitRequest(f.token, { species: 'A species' });
    await submitRequest(f.token, { species: 'B species' });
    await decide(managerToken, r1.id, { decision: 'APPROVE' });
    const res = await request(app).get('/api/v1/procurement/stats').set(bearer(f.token));
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.byStatus).toMatchObject({ SUBMITTED: 1, APPROVED: 1, REJECTED: 0 });
  });
});

describe('purchase review', () => {
  it('only the purchase manager can decide; farmers and admins cannot', async () => {
    const f = await newFarmer();
    const req = await submitRequest(f.token);
    expect((await decide(f.token, req.id, { decision: 'APPROVE' })).status).toBe(403);
    expect((await decide(await loginAs(await createUser('ADMIN')), req.id, { decision: 'APPROVE' })).status).toBe(403);
  });

  it('approves, records who decided, and audits', async () => {
    const f = await newFarmer();
    const req = await submitRequest(f.token);
    const res = await decide(managerToken, req.id, { decision: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    expect(res.body.data.lastStatusChange.by).toBe('Test PURCHASE_MANAGER');
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: req.id, action: 'procurement.approve' } });
    expect(audit?.actorId).toBe(manager.id);
    expect(audit?.before).toMatchObject({ status: 'SUBMITTED' });
    expect(audit?.after).toMatchObject({ status: 'APPROVED' });
    // farmers do not see staff identity
    const asFarmer = await request(app).get(`/api/v1/procurement/${req.id}`).set(bearer(f.token));
    expect(asFarmer.body.data.lastStatusChange.by).toBeUndefined();
  });

  it('requires a reason to reject or to request clarification', async () => {
    const f = await newFarmer();
    const req = await submitRequest(f.token);
    expect((await decide(managerToken, req.id, { decision: 'REJECT' })).status).toBe(400);
    expect((await decide(managerToken, req.id, { decision: 'REQUEST_CLARIFICATION' })).status).toBe(400);
    const ok = await decide(managerToken, req.id, { decision: 'REJECT', reason: 'Size below spec' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.lastStatusChange.reason).toBe('Size below spec');
  });

  it('rejects invalid transitions with 409', async () => {
    const f = await newFarmer();
    const req = await submitRequest(f.token);
    expect((await decide(managerToken, req.id, { decision: 'APPROVE' })).status).toBe(200);
    const again = await decide(managerToken, req.id, { decision: 'APPROVE' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
    expect((await decide(managerToken, req.id, { decision: 'REJECT', reason: 'changed my mind' })).status).toBe(409);

    const rejected = await submitRequest(f.token, { species: 'Another' });
    await decide(managerToken, rejected.id, { decision: 'REJECT', reason: 'Quality' });
    const cancel = await request(app).post(`/api/v1/procurement/${rejected.id}/cancel`).set(bearer(f.token)).send({ reason: 'too late' });
    expect(cancel.status).toBe(409);
  });

  it('two simultaneous conflicting decisions: exactly one wins', async () => {
    const f = await newFarmer();
    const req = await submitRequest(f.token);
    const [a, b] = await Promise.all([
      decide(managerToken, req.id, { decision: 'APPROVE' }),
      decide(managerToken, req.id, { decision: 'REJECT', reason: 'Quality' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const audits = await prisma.auditEvent.count({
      where: { entityId: req.id, action: { in: ['procurement.approve', 'procurement.reject'] } },
    });
    expect(audits).toBe(1);
  });

  it('clarification loop: request clarification → farmer resubmits → approve', async () => {
    const f = await newFarmer();
    const req = await submitRequest(f.token);
    expect((await decide(managerToken, req.id, { decision: 'REQUEST_CLARIFICATION', reason: 'Confirm size grade' })).body.data.status).toBe('CLARIFICATION_REQUESTED');
    expect((await decide(managerToken, req.id, { decision: 'APPROVE' })).status).toBe(409);
    const resubmit = await request(app).post(`/api/v1/procurement/${req.id}/resubmit`).set(bearer(f.token)).send({ note: 'Size is 30-40' });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data.status).toBe('SUBMITTED');
    expect((await decide(managerToken, req.id, { decision: 'APPROVE' })).body.data.status).toBe('APPROVED');
  });

  it('resubmit is only valid from CLARIFICATION_REQUESTED and only for the owner', async () => {
    const f = await newFarmer();
    const other = await newFarmer();
    const req = await submitRequest(f.token);
    expect((await request(app).post(`/api/v1/procurement/${req.id}/resubmit`).set(bearer(f.token)).send({})).status).toBe(409);
    await decide(managerToken, req.id, { decision: 'REQUEST_CLARIFICATION', reason: 'Please confirm' });
    expect((await request(app).post(`/api/v1/procurement/${req.id}/resubmit`).set(bearer(other.token)).send({})).status).toBe(404);
    expect((await request(app).post(`/api/v1/procurement/${req.id}/resubmit`).set(bearer(managerToken)).send({})).status).toBe(403);
  });

  it('cancellation needs a reason and works for the owner or a manager before final states', async () => {
    const f = await newFarmer();
    const req = await submitRequest(f.token);
    expect((await request(app).post(`/api/v1/procurement/${req.id}/cancel`).set(bearer(f.token)).send({})).status).toBe(400);
    const ok = await request(app).post(`/api/v1/procurement/${req.id}/cancel`).set(bearer(f.token)).send({ reason: 'Harvest failed' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('CANCELLED');
    const approved = await submitRequest(f.token, { species: 'Approved one' });
    await decide(managerToken, approved.id, { decision: 'APPROVE' });
    expect((await request(app).post(`/api/v1/procurement/${approved.id}/cancel`).set(bearer(managerToken)).send({ reason: 'Supplier withdrew' })).body.data.status).toBe('CANCELLED');
  });
});

describe('amendments', () => {
  it('preserve the original, record old/new/reason/actor, and update the current view', async () => {
    const f = await newFarmer();
    const req = await submitRequest(f.token);
    const res = await request(app)
      .post(`/api/v1/procurement/${req.id}/amendments`)
      .set(bearer(managerToken))
      .send({ field: 'declaredQuantityKg', newValue: '900', reason: 'Re-weighed at pond' });
    expect(res.status).toBe(201);
    expect(res.body.data.original.declaredQuantityKg).toBe('1000.000');
    expect(res.body.data.current.declaredQuantityKg).toBe('900.000');
    expect(res.body.data.amendments[0]).toMatchObject({ field: 'declaredQuantityKg', oldValue: '1000.000', newValue: '900.000', reason: 'Re-weighed at pond' });
    const stored = await prisma.procurementRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(stored.declaredQuantityKg.toFixed(3)).toBe('1000.000');
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: req.id, action: 'procurement.amend' } });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).not.toBe(f.user.id);
  });

  it('require a reason, a real change and an amendable status', async () => {
    const f = await newFarmer();
    const req = await submitRequest(f.token);
    const post = (body: Record<string, unknown>) =>
      request(app).post(`/api/v1/procurement/${req.id}/amendments`).set(bearer(managerToken)).send(body);
    expect((await post({ field: 'species', newValue: 'Tiger' })).status).toBe(400);
    expect((await post({ field: 'status', newValue: 'APPROVED', reason: 'sneaky' })).status).toBe(400);
    const same = await post({ field: 'species', newValue: 'Vannamei', reason: 'no actual change' });
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe('NO_CHANGE');
    await decide(managerToken, req.id, { decision: 'APPROVE' });
    const late = await post({ field: 'species', newValue: 'Tiger', reason: 'after approval' });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('AMENDMENT_NOT_ALLOWED');
  });

  it('only the purchase manager can amend; farmers are refused', async () => {
    const f = await newFarmer();
    const req = await submitRequest(f.token);
    const body = { field: 'notes', newValue: 'Edited', reason: 'Trying to edit' };
    expect((await request(app).post(`/api/v1/procurement/${req.id}/amendments`).set(bearer(f.token)).send(body)).status).toBe(403);
    const res = await request(app).post(`/api/v1/procurement/${req.id}/amendments`).set(bearer(managerToken)).send({ ...body, reason: 'Clarified by phone' });
    expect(res.status).toBe(201);
    expect(res.body.data.current.notes).toBe('Edited');
    expect(res.body.data.amendments.map((a: { byRole: string }) => a.byRole)).toEqual(['PURCHASE_MANAGER']);
  });
});

describe('list filtering, sorting and pagination', () => {
  it('filters by status and code and paginates', async () => {
    const f = await newFarmer();
    const a = await submitRequest(f.token, { species: 'S1' });
    await submitRequest(f.token, { species: 'S2' });
    await submitRequest(f.token, { species: 'S3' });
    await decide(managerToken, a.id, { decision: 'APPROVE' });
    const approved = await request(app).get('/api/v1/procurement?status=APPROVED').set(bearer(f.token));
    expect(approved.body.meta.total).toBe(1);
    const byCode = await request(app).get(`/api/v1/procurement?q=${a.code.toLowerCase()}`).set(bearer(f.token));
    expect(byCode.body.data).toHaveLength(1);
    const page = await request(app).get('/api/v1/procurement?pageSize=2&page=2&sort=code&order=asc').set(bearer(f.token));
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect((await request(app).get('/api/v1/procurement?sort=farmerId').set(bearer(f.token))).status).toBe(400);
  });

  it('returns 400 for a malformed id', async () => {
    const f = await newFarmer();
    expect((await request(app).get('/api/v1/procurement/not-a-uuid').set(bearer(f.token))).status).toBe(400);
    expect((await request(app).get(`/api/v1/procurement/${randomUUID()}`).set(bearer(f.token))).status).toBe(404);
  });
});
