/**
 * Pure helpers (no database access) that derive the "original" and "current" declaration.
 * The original columns are never modified; amendments are applied on top, in order.
 */
export const AMENDABLE_FIELDS = [
  'species',
  'declaredSizeCount',
  'declaredQuantityKg',
  'expectedPriceInrPerKg',
  'availabilityDate',
  'notes',
] as const;

export type AmendableField = (typeof AMENDABLE_FIELDS)[number];
export type DeclarationView = Record<AmendableField, string>;

interface DecimalLike {
  toFixed(decimalPlaces: number): string;
}

export interface DeclarationRow {
  species: string;
  declaredSizeCount: string;
  declaredQuantityKg: DecimalLike;
  expectedPriceInrPerKg: DecimalLike;
  availabilityDate: Date;
  notes: string | null;
}

export function originalDeclaration(row: DeclarationRow): DeclarationView {
  return {
    species: row.species,
    declaredSizeCount: row.declaredSizeCount,
    declaredQuantityKg: row.declaredQuantityKg.toFixed(3),
    expectedPriceInrPerKg: row.expectedPriceInrPerKg.toFixed(2),
    availabilityDate: row.availabilityDate.toISOString().slice(0, 10),
    notes: row.notes ?? '',
  };
}

export function currentDeclaration(
  row: DeclarationRow,
  amendmentsInOrder: ReadonlyArray<{ field: string; newValue: string }>,
): DeclarationView {
  const current = originalDeclaration(row);
  for (const amendment of amendmentsInOrder) {
    if ((AMENDABLE_FIELDS as readonly string[]).includes(amendment.field)) {
      current[amendment.field as AmendableField] = amendment.newValue;
    }
  }
  return current;
}
