import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// Wrap the real recordAudit so one call can be forced to fail.
vi.mock('../../src/lib/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/audit')>();
  return { ...actual, recordAudit: vi.fn(actual.recordAudit) };
});

import { recordAudit } from '../../src/lib/audit';
import { prisma } from '../../src/lib/prisma';
import { app, bearer, createUser, loginAs, validRequestBody } from './helpers';

describe('transaction atomicity', () => {
  it('rolls back the business change when the audit write fails, and returns a safe 500', async () => {
    const farmer = await createUser('FARMER');
    const token = await loginAs(farmer);
    vi.mocked(recordAudit).mockRejectedValueOnce(new Error('simulated audit failure'));

    const res = await request(app).post('/api/v1/procurement').set(bearer(token)).send(validRequestBody());
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('simulated');
    expect(await prisma.procurementRequest.count({ where: { farmer: { userId: farmer.id } } })).toBe(0);

    // The system recovers: the next identical submission succeeds.
    const retry = await request(app).post('/api/v1/procurement').set(bearer(token)).send(validRequestBody());
    expect(retry.status).toBe(201);
  });
});
