import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import {
  approvedRequest, createStaff, createUser, get, goodFindings, loginAs, passedRequest, post, requestStatus, type Staff,
} from './helpers';

let staff: Staff;
beforeAll(async () => {
  staff = await createStaff();
});

const assign = (requestId: string, officerId = staff.officer.id, token = staff.managerToken) =>
  post(token, `/procurement/${requestId}/inspections`, { officerId });

describe('assigning an inspection', () => {
  it('only the purchase manager can assign', async () => {
    const r = await approvedRequest(staff);
    const farmerToken = r.farmerToken;
    for (const token of [farmerToken, staff.adminToken, staff.officerToken, staff.driverToken]) {
      expect((await assign(r.id, staff.officer.id, token)).status).toBe(403);
    }
    expect(await requestStatus(r.id)).toBe('APPROVED');
  });

  it('works on an APPROVED request: moves it to INSPECTION_ASSIGNED and audits', async () => {
    const r = await approvedRequest(staff);
    const res = await assign(r.id);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('ASSIGNED');
    expect(await requestStatus(r.id)).toBe('INSPECTION_ASSIGNED');
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: res.body.data.id, action: 'inspection.assign' } });
    expect(audit?.actorId).toBe(staff.manager.id);
  });

  it('refuses requests that are not APPROVED, and a second assignment', async () => {
    const farmer = await createUser('FARMER');
    const fToken = await loginAs(farmer);
    const submitted = await post(fToken, '/procurement', {
      species: 'Vannamei', declaredSizeCount: '30', declaredQuantityKg: '100', expectedPriceInrPerKg: '400',
      availabilityDate: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
    });
    expect((await assign(submitted.body.data.id)).status).toBe(409);

    const r = await approvedRequest(staff);
    expect((await assign(r.id)).status).toBe(201);
    const again = await assign(r.id, staff.otherOfficer.id);
    expect(again.status).toBe(409);
  });

  it('rejects non-field-officers and disabled officers', async () => {
    const r = await approvedRequest(staff);
    const wrongRole = await assign(r.id, staff.driver.id);
    expect(wrongRole.status).toBe(400);
    expect(wrongRole.body.error.code).toBe('INVALID_ASSIGNEE');
    const disabled = await createUser('FIELD_OFFICER', { status: 'DISABLED' });
    expect((await assign(r.id, disabled.id)).status).toBe(400);
    expect((await assign(r.id, randomUUID())).status).toBe(400);
    expect(await requestStatus(r.id)).toBe('APPROVED');
  });

  it('simultaneous assignments: exactly one wins', async () => {
    const r = await approvedRequest(staff);
    const results = await Promise.all([assign(r.id, staff.officer.id), assign(r.id, staff.otherOfficer.id)]);
    expect(results.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(await prisma.fieldInspection.count({ where: { requestId: r.id } })).toBe(1);
  });
});

describe('field officer access', () => {
  it('officers see only their own inspections and never the farmer price', async () => {
    const r = await approvedRequest(staff);
    const a = await assign(r.id, staff.officer.id);
    const id = a.body.data.id as string;
    expect((await get(staff.officerToken, `/inspections/${id}`)).status).toBe(200);
    expect((await get(staff.otherOfficerToken, `/inspections/${id}`)).status).toBe(404);
    expect((await post(staff.otherOfficerToken, `/inspections/${id}/start`)).status).toBe(404);
    const own = await get(staff.officerToken, '/inspections?pageSize=100');
    expect(own.body.data.every((i: { officer: { name: string } }) => i.officer.name === 'Test FIELD_OFFICER')).toBe(true);
    expect(JSON.stringify((await get(staff.officerToken, `/inspections/${id}`)).body)).not.toContain('expectedPrice');
    const other = await get(staff.otherOfficerToken, '/inspections?pageSize=100');
    expect(other.body.data.find((i: { id: string }) => i.id === id)).toBeUndefined();
  });

  it('manager and admin can read all; farmers, drivers, security and factory staff cannot', async () => {
    const r = await approvedRequest(staff);
    const id = (await assign(r.id)).body.data.id as string;
    expect((await get(staff.managerToken, `/inspections/${id}`)).status).toBe(200);
    expect((await get(staff.adminToken, `/inspections/${id}`)).status).toBe(200);
    for (const role of ['FARMER', 'TRANSPORT_OFFICER', 'SECURITY_OFFICER', 'FACTORY_OPERATOR'] as const) {
      const token = await loginAs(await createUser(role));
      expect((await get(token, '/inspections')).status).toBe(403);
    }
  });

  it('the manager and admin cannot record findings', async () => {
    const r = await approvedRequest(staff);
    const id = (await assign(r.id)).body.data.id as string;
    expect((await post(staff.managerToken, `/inspections/${id}/start`)).status).toBe(403);
    expect((await post(staff.adminToken, `/inspections/${id}/complete`, goodFindings())).status).toBe(403);
  });
});

describe('recording an inspection', () => {
  async function started() {
    const r = await approvedRequest(staff);
    const id = (await assign(r.id)).body.data.id as string;
    expect((await post(staff.officerToken, `/inspections/${id}/start`)).status).toBe(200);
    return { ...r, inspectionId: id };
  }

  it('cannot complete before starting, or complete twice', async () => {
    const r = await approvedRequest(staff);
    const id = (await assign(r.id)).body.data.id as string;
    expect((await post(staff.officerToken, `/inspections/${id}/complete`, goodFindings())).status).toBe(409);
    await post(staff.officerToken, `/inspections/${id}/start`);
    expect((await post(staff.officerToken, `/inspections/${id}/start`)).status).toBe(409);
    expect((await post(staff.officerToken, `/inspections/${id}/complete`, goodFindings())).status).toBe(200);
    expect((await post(staff.officerToken, `/inspections/${id}/complete`, goodFindings())).status).toBe(409);
  });

  it('a PASS moves the request to INSPECTION_PASSED and keeps declared and inspected quantities separate', async () => {
    const r = await started();
    const res = await post(staff.officerToken, `/inspections/${r.inspectionId}/complete`, goodFindings({ inspectedQuantityKg: '390.5' }));
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('PASS');
    expect(res.body.data.inspectedQuantityKg).toBe('390.500');
    expect(res.body.data.declaredQuantityKgAtInspection).toBe('400.000');
    expect(await requestStatus(r.id)).toBe('INSPECTION_PASSED');
    const request = await prisma.procurementRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(request.declaredQuantityKg.toFixed(3)).toBe('400.000'); // never overwritten
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: r.inspectionId, action: 'inspection.complete' } });
    expect(audit?.actorId).toBe(staff.officer.id);
  });

  it('requires an explanation to PASS when quantity or species differ from the declaration', async () => {
    const r = await started();
    const bigGap = await post(staff.officerToken, `/inspections/${r.inspectionId}/complete`, goodFindings({ inspectedQuantityKg: '200' }));
    expect(bigGap.status).toBe(400);
    expect(bigGap.body.error.code).toBe('DISCREPANCY_NOTES_REQUIRED');
    const species = await post(staff.officerToken, `/inspections/${r.inspectionId}/complete`, goodFindings({ observedSpecies: 'Black Tiger' }));
    expect(species.status).toBe(400);
    expect(await requestStatus(r.id)).toBe('INSPECTION_ASSIGNED');
    const explained = await post(
      staff.officerToken,
      `/inspections/${r.inspectionId}/complete`,
      goodFindings({ inspectedQuantityKg: '200', discrepancyNotes: 'Half the pond was not yet harvested' }),
    );
    expect(explained.status).toBe(200);
    expect(explained.body.data.quantityVariancePct).toBe('50.00');
  });

  it('validates measurements', async () => {
    const r = await started();
    for (const bad of [
      goodFindings({ inspectedQuantityKg: '-5' }),
      goodFindings({ inspectedQuantityKg: '10.1234' }),
      goodFindings({ inspectedQuantityKg: '0' }),
      goodFindings({ qualityNotes: '' }),
      goodFindings({ outcome: 'GREAT' }),
      goodFindings({ officerId: randomUUID() }),
    ]) {
      expect((await post(staff.officerToken, `/inspections/${r.inspectionId}/complete`, bad)).status).toBe(400);
    }
    expect(await requestStatus(r.id)).toBe('INSPECTION_ASSIGNED');
  });

  it('a FAIL may record zero quantity and blocks the request', async () => {
    const r = await started();
    const res = await post(staff.officerToken, `/inspections/${r.inspectionId}/complete`, goodFindings({ outcome: 'FAIL', inspectedQuantityKg: '0', qualityNotes: 'Spoiled stock, strong ammonia smell' }));
    expect(res.status).toBe(200);
    expect(await requestStatus(r.id)).toBe('INSPECTION_FAILED');
  });
});

describe('failed and review inspections cannot reach transport without an authorised decision', () => {
  async function failed(outcome: 'FAIL' | 'REVIEW' = 'FAIL') {
    const r = await approvedRequest(staff);
    const id = (await assign(r.id)).body.data.id as string;
    await post(staff.officerToken, `/inspections/${id}/start`);
    await post(staff.officerToken, `/inspections/${id}/complete`, goodFindings({ outcome, inspectedQuantityKg: '380', qualityNotes: 'Soft shells, uneven sizes' }));
    return { ...r, inspectionId: id };
  }
  const transport = (requestId: string) =>
    post(staff.managerToken, `/procurement/${requestId}/collections`, { transportOfficerId: staff.driver.id, vehicleId: randomUUID() });

  it('transport assignment is refused after FAIL and REVIEW', async () => {
    for (const outcome of ['FAIL', 'REVIEW'] as const) {
      const r = await failed(outcome);
      const res = await transport(r.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    }
  });

  it('PROCEED needs a reason, is recorded, and then allows the normal flow', async () => {
    const r = await failed();
    const path = `/inspections/${r.inspectionId}/decision`;
    expect((await post(staff.officerToken, path, { decision: 'PROCEED', reason: 'I approve this' })).status).toBe(403);
    expect((await post(staff.managerToken, path, { decision: 'PROCEED' })).status).toBe(400);
    const ok = await post(staff.managerToken, path, { decision: 'PROCEED', reason: 'Re-checked by supervisor, acceptable for feed grade' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.decision.kind).toBe('PROCEED');
    expect(await requestStatus(r.id)).toBe('INSPECTION_PASSED');
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: r.inspectionId, action: 'inspection.decision' } });
    expect(audit?.actorId).toBe(staff.manager.id);
    expect(audit?.after).toMatchObject({ decision: 'PROCEED' });
    expect((await post(staff.managerToken, path, { decision: 'REJECT', reason: 'changed mind' })).status).toBe(409);
  });

  it('REJECT closes the request and REINSPECT allows a new assignment', async () => {
    const rej = await failed('REVIEW');
    expect((await post(staff.managerToken, `/inspections/${rej.inspectionId}/decision`, { decision: 'REJECT', reason: 'Below purchase standard' })).status).toBe(200);
    expect(await requestStatus(rej.id)).toBe('REJECTED');

    const re = await failed('REVIEW');
    expect((await post(staff.managerToken, `/inspections/${re.inspectionId}/decision`, { decision: 'REINSPECT', reason: 'Need a second opinion' })).status).toBe(200);
    expect(await requestStatus(re.id)).toBe('APPROVED');
    expect((await assign(re.id, staff.otherOfficer.id)).status).toBe(201);
    expect(await prisma.fieldInspection.count({ where: { requestId: re.id } })).toBe(2);
  });

  it('decisions do not apply to a PASS', async () => {
    const r = await passedRequest(staff);
    const res = await post(staff.managerToken, `/inspections/${r.inspectionId}/decision`, { decision: 'PROCEED', reason: 'not needed' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DECISION_NOT_APPLICABLE');
  });

  it('decision records are append-only in the database', async () => {
    const r = await failed();
    await post(staff.managerToken, `/inspections/${r.inspectionId}/decision`, { decision: 'PROCEED', reason: 'Acceptable after re-grading' });
    const row = await prisma.inspectionDecision.findFirstOrThrow({ where: { inspectionId: r.inspectionId } });
    await expect(prisma.inspectionDecision.update({ where: { id: row.id }, data: { reason: 'tampered' } })).rejects.toThrow();
    await expect(prisma.inspectionDecision.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});

describe('cancelling an inspection assignment', () => {
  it('the manager can withdraw it; the request returns to APPROVED and the officer cannot continue', async () => {
    const r = await approvedRequest(staff);
    const id = (await assign(r.id)).body.data.id as string;
    await post(staff.officerToken, `/inspections/${id}/start`);
    expect((await post(staff.officerToken, `/inspections/${id}/cancel`, { reason: 'mine now' })).status).toBe(403);
    expect((await post(staff.managerToken, `/inspections/${id}/cancel`, {})).status).toBe(400);
    const res = await post(staff.managerToken, `/inspections/${id}/cancel`, { reason: 'Officer on leave' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(await requestStatus(r.id)).toBe('APPROVED');
    expect((await post(staff.officerToken, `/inspections/${id}/complete`, goodFindings())).status).toBe(409);
  });
});

describe('what the farmer sees', () => {
  it('shows outcome and findings but not internal fields', async () => {
    const r = await passedRequest(staff);
    const res = await get(r.farmerToken, `/procurement/${r.id}`);
    expect(res.status).toBe(200);
    const inspection = res.body.data.inspections[0];
    expect(inspection.outcome).toBe('PASS');
    expect(inspection.inspectedQuantityKg).toBe('400.000');
    expect(inspection.officerName).toBeDefined();
    expect(inspection.quantityVariancePct).toBeUndefined();
    expect(inspection.decision).toBeUndefined();
    const staffView = await get(staff.managerToken, `/procurement/${r.id}`);
    expect(staffView.body.data.inspections[0].quantityVariancePct).toBeDefined();
  });
});

describe('cancelling the whole request', () => {
  it('farmers can cancel only before field work starts; staff cancellation cascades', async () => {
    const r = await approvedRequest(staff);
    const id = (await assign(r.id)).body.data.id as string;
    const farmerCancel = await post(r.farmerToken, `/procurement/${r.id}/cancel`, { reason: 'Changed my mind' });
    expect(farmerCancel.status).toBe(409);
    expect(farmerCancel.body.error.code).toBe('CANCEL_NOT_ALLOWED');
    const res = await post(staff.managerToken, `/procurement/${r.id}/cancel`, { reason: 'Farmer withdrew by phone' });
    expect(res.status).toBe(200);
    expect(await requestStatus(r.id)).toBe('CANCELLED');
    expect((await prisma.fieldInspection.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED');
    expect((await post(staff.officerToken, `/inspections/${id}/start`)).status).toBe(409);
  });
});
