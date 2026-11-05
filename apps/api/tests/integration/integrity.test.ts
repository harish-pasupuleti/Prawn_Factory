import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { app, bearer, createUser, loginAs, submitRequest } from './helpers';

describe('database-level integrity', () => {
  it('audit events cannot be updated or deleted, even by application code', async () => {
    const farmer = await createUser('FARMER');
    const created = await submitRequest(await loginAs(farmer));
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: created.id } });
    await expect(prisma.auditEvent.update({ where: { id: event.id }, data: { action: 'tampered' } })).rejects.toThrow();
    await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow();
    const still = await prisma.auditEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(still.action).toBe(event.action);
  });

  it('CHECK constraints reject non-positive quantities even if validation is bypassed', async () => {
    const farmer = await createUser('FARMER');
    const profile = await prisma.farmerProfile.findUniqueOrThrow({ where: { userId: farmer.id } });
    await expect(
      prisma.procurementRequest.create({
        data: {
          code: `PR-TEST-${Date.now()}`,
          farmerId: profile.id,
          species: 'x',
          declaredSizeCount: 'x',
          declaredQuantityKg: '0',
          expectedPriceInrPerKg: '10',
          availabilityDate: new Date('2099-01-01T00:00:00Z'),
        },
      }),
    ).rejects.toThrow();
  });

  it('status-changing and amending requests never alter the original declaration columns', async () => {
    const farmer = await createUser('FARMER');
    const manager = await createUser('PURCHASE_MANAGER');
    const created = await submitRequest(await loginAs(farmer));
    await request(app)
      .post(`/api/v1/procurement/${created.id}/decision`)
      .set(bearer(await loginAs(manager)))
      .send({ decision: 'APPROVE' });
    const row = await prisma.procurementRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.declaredQuantityKg.toFixed(3)).toBe('1000.000');
    expect(row.species).toBe('Vannamei');
  });
});
