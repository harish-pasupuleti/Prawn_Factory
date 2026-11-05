import { describe, expect, it } from 'vitest';
import { exceedsCapacity, exceedsVariance, formatHundredths, fromGrams, toGrams, varianceHundredths } from '../../src/lib/quantity';

describe('exact weight arithmetic', () => {
  it('converts to and from grams without floating point error', () => {
    expect(toGrams('1250.5')).toBe(1_250_500n);
    expect(toGrams('0.001')).toBe(1n);
    expect(toGrams('12')).toBe(12_000n);
    expect(fromGrams(1_250_500n)).toBe('1250.500');
    expect(fromGrams(1n)).toBe('0.001');
    // The classic float trap: 0.1 + 0.2
    expect(fromGrams(toGrams('0.1') + toGrams('0.2'))).toBe('0.300');
  });

  it('rejects malformed input', () => {
    expect(() => toGrams('-1')).toThrow();
    expect(() => toGrams('1.2345')).toThrow();
    expect(() => toGrams('abc')).toThrow();
  });

  it('computes variance in hundredths of a percent', () => {
    expect(varianceHundredths('1000', '1100')).toBe(1000n); // 10.00 %
    expect(varianceHundredths('1000', '900')).toBe(1000n); // symmetric
    expect(varianceHundredths('1000', '1000')).toBe(0n);
    expect(varianceHundredths('300', '301')).toBe(33n); // 0.33 % (truncated)
    expect(formatHundredths(1234n)).toBe('12.34');
    expect(formatHundredths(5n)).toBe('0.05');
  });

  it('returns null when the reference is zero and clamps absurd values to the column size', () => {
    expect(varianceHundredths('0', '10')).toBeNull();
    expect(varianceHundredths('0.001', '999999999')).toBe(999_999_999_999n);
  });

  it('flags variance only when it is strictly above the threshold', () => {
    expect(exceedsVariance('1000', '1100', 10)).toBe(false); // exactly 10 %
    expect(exceedsVariance('1000', '1100.001', 10)).toBe(true);
    expect(exceedsVariance('1000', '890', 10)).toBe(true);
    expect(exceedsVariance('1000', '950', 10)).toBe(false);
    expect(exceedsVariance('1000', '1000', 0)).toBe(false);
    expect(exceedsVariance('1000', '1000.001', 0)).toBe(true);
    expect(exceedsVariance('1000', '1075', 7.5)).toBe(false);
    expect(exceedsVariance('1000', '1076', 7.5)).toBe(true);
  });

  it('treats any positive quantity against a zero reference as a variance', () => {
    expect(exceedsVariance('0', '5', 10)).toBe(true);
    expect(exceedsVariance('0', '0', 10)).toBe(false);
  });

  it('compares against vehicle capacity exactly', () => {
    expect(exceedsCapacity('500', '500.000')).toBe(false);
    expect(exceedsCapacity('500.001', '500')).toBe(true);
  });
});
