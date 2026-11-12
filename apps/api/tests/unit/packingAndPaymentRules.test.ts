import { describe, expect, it } from 'vitest';
import { progressFor, requirementKey, weightWithinTolerance } from '../../src/modules/packing/rules';
import { boxPlanSchema } from '../../src/modules/packing/schemas';
import { computeAmountInr } from '../../src/modules/payments/rules';

describe('box weight tolerance', () => {
  it('allows up to 2% either way and nothing more', () => {
    expect(weightWithinTolerance('10', '10')).toBe(true);
    expect(weightWithinTolerance('10', '10.2')).toBe(true);
    expect(weightWithinTolerance('10', '9.8')).toBe(true);
    expect(weightWithinTolerance('10', '10.201')).toBe(false);
    expect(weightWithinTolerance('10', '9.799')).toBe(false);
    expect(weightWithinTolerance('2.5', '2.55')).toBe(true);
  });
});

describe('requirement progress', () => {
  it('counts only boxes that are not voided', () => {
    const progress = progressFor(
      [{ id: 'a', quantity: 3 }, { id: 'b', quantity: 1 }],
      [{ requirementId: 'a', status: 'PACKED' }, { requirementId: 'a', status: 'VOID' }, { requirementId: 'b', status: 'PACKED' }],
    );
    expect(progress).toEqual([
      { requirementId: 'a', required: 3, packed: 1, remaining: 2 },
      { requirementId: 'b', required: 1, packed: 1, remaining: 0 },
    ]);
  });

  it('treats 10 and 10.000 kg as the same box size', () => {
    expect(requirementKey('HEAD_ON', '20-30', '10')).toBe(requirementKey('HEAD_ON', '20-30', '10.000'));
  });
});

describe('box plan validation', () => {
  const line = { form: 'HEADLESS', sizeGrade: '30-40', boxWeightKg: '10', quantity: 20 };
  it('accepts a normal plan and rejects duplicates, unknown sizes and bad weights', () => {
    expect(boxPlanSchema.safeParse({ lines: [line, { ...line, form: 'HEAD_ON' }] }).success).toBe(true);
    expect(boxPlanSchema.safeParse({ lines: [line, { ...line, boxWeightKg: '10.000' }] }).success).toBe(false);
    expect(boxPlanSchema.safeParse({ lines: [{ ...line, sizeGrade: '5-6' }] }).success).toBe(false);
    expect(boxPlanSchema.safeParse({ lines: [{ ...line, boxWeightKg: '0' }] }).success).toBe(false);
    expect(boxPlanSchema.safeParse({ lines: [] }).success).toBe(false);
  });
});

describe('invoice amount', () => {
  it('multiplies kilograms by the rate exactly, rounding to the paisa', () => {
    expect(computeAmountInr('1000.000', '450.00')).toBe('450000.00');
    expect(computeAmountInr('412.500', '388.75')).toBe('160359.38');
    expect(computeAmountInr('0.001', '0.50')).toBe('0.00');
    expect(computeAmountInr('1.000', '99.99')).toBe('99.99');
  });
});
