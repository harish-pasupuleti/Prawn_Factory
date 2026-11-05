import { describe, expect, it } from 'vitest';
import { formatDate, formatFieldValue, formatInr, formatKg } from '../lib/format';

describe('formatting', () => {
  it('formats rupees with Indian grouping', () => {
    expect(formatInr('420')).toContain('420.00');
    expect(formatInr('123456.5')).toMatch(/1,23,456\.50/);
    expect(formatInr('1')).toContain('₹');
  });
  it('formats kilograms and trims useless zeros', () => {
    expect(formatKg('1000.000')).toBe('1,000 kg');
    expect(formatKg('12.500')).toBe('12.5 kg');
    expect(formatKg('0.125')).toBe('0.125 kg');
  });
  it('formats calendar dates without time-zone drift', () => {
    expect(formatDate('2030-05-01')).toBe('01 May 2030');
    expect(formatDate('2030-05-01T00:00:00.000Z')).toBe('01 May 2030');
  });
  it('formats field values by type', () => {
    expect(formatFieldValue('declaredQuantityKg', '900.000')).toBe('900 kg');
    expect(formatFieldValue('species', 'Vannamei')).toBe('Vannamei');
    expect(formatFieldValue('notes', '')).toBe('—');
  });
});
