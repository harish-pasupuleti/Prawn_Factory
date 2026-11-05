/** Pure helpers for the append-only weight measurement chain. */
import { fromGrams, toGrams } from '../../lib/quantity';

export interface WeightRow {
  id: string;
  kind: 'GROSS' | 'TARE';
  valueKg: string;
  supersedesId: string | null;
}

/**
 * The current value of each kind is the row that no other row supersedes.
 * Older rows stay in the database as history.
 */
export function currentWeights<T extends WeightRow>(rows: readonly T[]): { GROSS: T | null; TARE: T | null } {
  const superseded = new Set(rows.map((r) => r.supersedesId).filter((id): id is string => id !== null));
  const pick = (kind: 'GROSS' | 'TARE') => rows.find((r) => r.kind === kind && !superseded.has(r.id)) ?? null;
  return { GROSS: pick('GROSS'), TARE: pick('TARE') };
}

/** Net = gross - tare, exactly. Returns null when tare exceeds gross (invalid). */
export function computeNet(grossKg: string, tareKg: string): string | null {
  const gross = toGrams(grossKg);
  const tare = toGrams(tareKg);
  if (tare > gross) return null;
  return fromGrams(gross - tare);
}
