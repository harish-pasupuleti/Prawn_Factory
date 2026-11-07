/** Pure helpers (no database access) so the rules are unit-testable. */
import { timingSafeEqual } from 'node:crypto';
import { ACTIVE_COLLECTION_STATUSES } from '../../lib/stateMachine';

type CollectionStatusName = 'ASSIGNED' | 'PICKED_UP' | 'LOADED' | 'DISPATCHED' | 'ARRIVED' | 'HANDED_OVER' | 'CANCELLED';

const NOT_AWAITING_ARRIVAL: readonly CollectionStatusName[] = ['ARRIVED', 'HANDED_OVER', 'CANCELLED'];

/** A collection is overdue when its expected arrival time has passed and it has not arrived or been closed. */
export function isCollectionOverdue(status: CollectionStatusName, expectedArrivalAt: Date | null, now: Date = new Date()): boolean {
  if (!expectedArrivalAt) return false;
  if (NOT_AWAITING_ARRIVAL.includes(status)) return false;
  return now.getTime() > expectedArrivalAt.getTime();
}

/** True when the arrival was later than the expected time. */
export function arrivedLate(arrivedAt: Date | null, expectedArrivalAt: Date | null): boolean | null {
  if (!arrivedAt || !expectedArrivalAt) return null;
  return arrivedAt.getTime() > expectedArrivalAt.getTime();
}

export const isActiveCollection = (status: CollectionStatusName): boolean =>
  (ACTIVE_COLLECTION_STATUSES as readonly string[]).includes(status);

// ------------------------------------------------------------------ seal and photo rules

/** Photos can be added while the field officer is with the vehicle at the farm. */
export const PHOTO_STATUSES: readonly CollectionStatusName[] = ['PICKED_UP', 'LOADED'];
export const MAX_PHOTOS_PER_JOB = 8;
/** The load can only be sealed once at least this many photos are on record. */
export const MIN_PHOTOS_TO_SEAL = 1;

/** Wrong seal codes allowed at the gate before verification pauses. */
export const MAX_SEAL_ATTEMPTS = 5;
export const SEAL_LOCK_MINUTES = 15;

// No I, L, O, 0 or 1, so a code read off a seal is never ambiguous.
const SEAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SEAL_LENGTH = 8;

export function generateSealCode(randomInt: (max: number) => number): string {
  let code = '';
  for (let i = 0; i < SEAL_LENGTH; i += 1) code += SEAL_ALPHABET[randomInt(SEAL_ALPHABET.length)];
  return code;
}

/** Stored as 8 characters; shown as XXXX-XXXX. */
export const formatSealCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

/** Accepts what a person types: any case, with or without dash or spaces. */
export const normaliseSealCode = (typed: string): string => typed.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** When the gate may try again, or null if verification is open. Failures older than the lock window are forgotten. */
export function sealLockedUntil(failedAttempts: number, lastFailedAt: Date | null, now: Date): Date | null {
  if (failedAttempts < MAX_SEAL_ATTEMPTS || !lastFailedAt) return null;
  const until = new Date(lastFailedAt.getTime() + SEAL_LOCK_MINUTES * 60_000);
  return until.getTime() > now.getTime() ? until : null;
}

/** Recognises the image types we accept from the file's first bytes, ignoring whatever the browser claimed. */
export function detectImageType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'image/webp';
  return null;
}

/** Constant-time comparison of two seal codes (after normalising what was typed). */
export function sealCodesMatch(expected: string, typed: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(normaliseSealCode(typed));
  return a.length === b.length && timingSafeEqual(a, b);
}
