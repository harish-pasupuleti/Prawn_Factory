import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import {
  amendSchema,
  cancelSchema,
  createRequestSchema,
  decisionSchema,
  listQuerySchema,
  todayInTimezone,
} from '../../src/modules/procurement/schemas';

const addDays = (days: number) => {
  const d = new Date(`${todayInTimezone(env.FACTORY_TIMEZONE)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const valid = {
  species: 'Vannamei',
  declaredSizeCount: '30-40 count/kg',
  declaredQuantityKg: '1250.5',
  expectedPriceInrPerKg: 420,
  availabilityDate: addDays(3),
};

describe('createRequestSchema', () => {
  it('accepts valid input and normalises decimals', () => {
    const parsed = createRequestSchema.parse(valid);
    expect(parsed.declaredQuantityKg).toBe('1250.500');
    expect(parsed.expectedPriceInrPerKg).toBe('420.00');
  });

  it('accepts today as availability date', () => {
    expect(() => createRequestSchema.parse({ ...valid, availabilityDate: addDays(0) })).not.toThrow();
  });

  it.each([
    ['zero quantity', { declaredQuantityKg: '0' }],
    ['negative quantity', { declaredQuantityKg: '-5' }],
    ['four decimal places', { declaredQuantityKg: '10.1234' }],
    ['exponent notation', { declaredQuantityKg: '1e3' }],
    ['non-numeric price', { expectedPriceInrPerKg: 'abc' }],
    ['three decimal price', { expectedPriceInrPerKg: '10.125' }],
    ['past date', { availabilityDate: addDays(-1) }],
    ['impossible date', { availabilityDate: '2099-02-30' }],
    ['wrong date format', { availabilityDate: '12/05/2030' }],
    ['empty species', { species: ' ' }],
  ])('rejects %s', (_name, patch) => {
    expect(createRequestSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('rejects unknown fields (mass assignment)', () => {
    expect(createRequestSchema.safeParse({ ...valid, status: 'APPROVED' }).success).toBe(false);
    expect(createRequestSchema.safeParse({ ...valid, farmerId: 'x' }).success).toBe(false);
  });
});

describe('decisionSchema', () => {
  it('requires a reason to reject or request clarification', () => {
    expect(decisionSchema.safeParse({ decision: 'REJECT' }).success).toBe(false);
    expect(decisionSchema.safeParse({ decision: 'REQUEST_CLARIFICATION' }).success).toBe(false);
    expect(decisionSchema.safeParse({ decision: 'REJECT', reason: 'Quality too low' }).success).toBe(true);
  });
  it('does not require a reason to approve', () => {
    expect(decisionSchema.safeParse({ decision: 'APPROVE' }).success).toBe(true);
  });
  it('rejects unknown decisions', () => {
    expect(decisionSchema.safeParse({ decision: 'DELETE' }).success).toBe(false);
  });
});

describe('cancelSchema and amendSchema', () => {
  it('cancel needs a reason', () => {
    expect(cancelSchema.safeParse({}).success).toBe(false);
    expect(cancelSchema.safeParse({ reason: 'ok!' }).success).toBe(true);
  });

  it('amend validates the value according to the field', () => {
    const good = amendSchema.parse({ field: 'declaredQuantityKg', newValue: 900, reason: 'Re-weighed' });
    expect(good.newValue).toBe('900.000');
    expect(amendSchema.safeParse({ field: 'declaredQuantityKg', newValue: '-1', reason: 'x1x' }).success).toBe(false);
    expect(amendSchema.safeParse({ field: 'availabilityDate', newValue: addDays(-2), reason: 'xyz' }).success).toBe(false);
  });

  it('amend refuses fields that are not amendable and requires a reason', () => {
    expect(amendSchema.safeParse({ field: 'status', newValue: 'APPROVED', reason: 'hack' }).success).toBe(false);
    expect(amendSchema.safeParse({ field: 'species', newValue: 'Tiger' }).success).toBe(false);
  });
});

describe('listQuerySchema', () => {
  it('applies defaults and caps page size', () => {
    const parsed = listQuerySchema.parse({});
    expect(parsed).toMatchObject({ page: 1, pageSize: 20, sort: 'createdAt', order: 'desc' });
    expect(listQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ sort: 'farmerId' }).success).toBe(false);
  });
});
