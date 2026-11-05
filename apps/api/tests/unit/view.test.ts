import { describe, expect, it } from 'vitest';
import { currentDeclaration, originalDeclaration, type DeclarationRow } from '../../src/modules/procurement/view';

const dec = (value: string) => ({ toFixed: (dp: number) => Number(value).toFixed(dp) });

const row: DeclarationRow = {
  species: 'Vannamei',
  declaredSizeCount: '30-40',
  declaredQuantityKg: dec('1000'),
  expectedPriceInrPerKg: dec('400'),
  availabilityDate: new Date('2030-05-01T00:00:00Z'),
  notes: null,
};

describe('declaration views', () => {
  it('formats the original declaration', () => {
    expect(originalDeclaration(row)).toEqual({
      species: 'Vannamei',
      declaredSizeCount: '30-40',
      declaredQuantityKg: '1000.000',
      expectedPriceInrPerKg: '400.00',
      availabilityDate: '2030-05-01',
      notes: '',
    });
  });

  it('applies amendments in order without touching the original', () => {
    const amendments = [
      { field: 'declaredQuantityKg', newValue: '900.000' },
      { field: 'declaredQuantityKg', newValue: '850.000' },
      { field: 'notes', newValue: 'Harvest delayed' },
    ];
    const current = currentDeclaration(row, amendments);
    expect(current.declaredQuantityKg).toBe('850.000');
    expect(current.notes).toBe('Harvest delayed');
    expect(originalDeclaration(row).declaredQuantityKg).toBe('1000.000');
  });

  it('ignores amendments for unknown fields', () => {
    const current = currentDeclaration(row, [{ field: 'status', newValue: 'APPROVED' }]);
    expect(current).toEqual(originalDeclaration(row));
  });
});
