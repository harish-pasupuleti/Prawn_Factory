/** Pure helpers (no database access) so the rules are unit-testable. */
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
