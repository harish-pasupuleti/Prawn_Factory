/**
 * Exact weight arithmetic using integers (grams), never floating point.
 * Weights are decimal strings with at most 3 decimal places.
 */
export function toGrams(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) throw new Error('Invalid decimal weight');
  return BigInt(match[1]!) * 1000n + BigInt((match[2] ?? '').padEnd(3, '0'));
}

export function fromGrams(grams: bigint): string {
  return `${grams / 1000n}.${String(grams % 1000n).padStart(3, '0')}`;
}

/** Largest value that fits DECIMAL(12,2) once expressed in hundredths of a percent. */
const MAX_HUNDREDTHS = 999_999_999_999n;

/**
 * |actual - reference| / reference, as hundredths of a percent (1234n = 12.34 %), clamped to the column size.
 * Returns null when the reference is zero (a percentage is undefined).
 */
export function varianceHundredths(reference: string, actual: string): bigint | null {
  const ref = toGrams(reference);
  const act = toGrams(actual);
  if (ref === 0n) return null;
  const diff = act > ref ? act - ref : ref - act;
  const value = (diff * 10_000n) / ref;
  return value > MAX_HUNDREDTHS ? MAX_HUNDREDTHS : value;
}

export function formatHundredths(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

/**
 * True when actual differs from reference by MORE than thresholdPct percent.
 * Compared exactly with integers (no rounding), so 10.0001 % over a 10 % limit is flagged.
 */
export function exceedsVariance(reference: string, actual: string, thresholdPct: number): boolean {
  const ref = toGrams(reference);
  const act = toGrams(actual);
  if (ref === 0n) return act > 0n;
  const diff = act > ref ? act - ref : ref - act;
  const thresholdHundredths = BigInt(Math.round(thresholdPct * 100));
  // diff / ref * 100 % > threshold  <=>  diff * 10000 > ref * thresholdHundredths
  return diff * 10_000n > ref * thresholdHundredths;
}

export function exceedsCapacity(quantityKg: string, capacityKg: string): boolean {
  return toGrams(quantityKg) > toGrams(capacityKg);
}
