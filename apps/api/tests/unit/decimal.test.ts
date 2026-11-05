import { describe, expect, it } from 'vitest';
import { normalizeDecimal } from '../../src/lib/decimal';

describe('normalizeDecimal', () => {
  it('pads to fixed decimal places without floating point', () => {
    expect(normalizeDecimal('12', 3)).toBe('12.000');
    expect(normalizeDecimal('12.5', 3)).toBe('12.500');
    expect(normalizeDecimal('0.1', 2)).toBe('0.10');
    expect(normalizeDecimal('1250.125', 3)).toBe('1250.125');
  });
  it('strips leading zeros but keeps a single zero', () => {
    expect(normalizeDecimal('007.5', 2)).toBe('7.50');
    expect(normalizeDecimal('0', 2)).toBe('0.00');
  });
});
