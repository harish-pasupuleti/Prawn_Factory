/**
 * Pads a validated decimal string to a fixed number of decimal places using string
 * operations only (no floating point). Input must already match /^\d+(\.\d+)?$/.
 */
export function normalizeDecimal(input: string, decimalPlaces: number): string {
  const [integerRaw = '0', fraction = ''] = input.split('.');
  const integerPart = integerRaw.replace(/^0+(?=\d)/, '');
  return decimalPlaces === 0 ? integerPart : `${integerPart}.${fraction.padEnd(decimalPlaces, '0')}`;
}

/** Formats a Prisma Decimal (or null) as a fixed-point string for API output. */
export const fixed = (v: { toFixed(n: number): string } | null | undefined, places: number): string | null =>
  v ? v.toFixed(places) : null;
