import type { ProcurementStatus } from '@prisma/client';
import { AppError } from './errors';

export const PROCUREMENT_STATUSES = [
  'SUBMITTED',
  'CLARIFICATION_REQUESTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'INSPECTION_ASSIGNED',
  'INSPECTION_PASSED',
  'INSPECTION_FAILED',
  'INSPECTION_REVIEW',
  'TRANSPORT_ASSIGNED',
  'IN_TRANSIT',
  'DELIVERED',
  'RECEIVED',
] as const satisfies readonly ProcurementStatus[];

/** Allowed procurement status transitions. Anything not listed is rejected. */
export const PROCUREMENT_TRANSITIONS: Record<ProcurementStatus, readonly ProcurementStatus[]> = {
  SUBMITTED: ['CLARIFICATION_REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED'],
  CLARIFICATION_REQUESTED: ['SUBMITTED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['INSPECTION_ASSIGNED', 'CANCELLED'],
  // A cancelled assignment returns the request to APPROVED so another officer can be assigned.
  INSPECTION_ASSIGNED: ['INSPECTION_PASSED', 'INSPECTION_FAILED', 'INSPECTION_REVIEW', 'APPROVED', 'CANCELLED'],
  // Only a PASS reaches transport. FAIL / REVIEW need an explicit, audited Purchase Manager decision.
  INSPECTION_PASSED: ['TRANSPORT_ASSIGNED', 'CANCELLED'],
  INSPECTION_FAILED: ['INSPECTION_PASSED', 'APPROVED', 'REJECTED', 'CANCELLED'],
  INSPECTION_REVIEW: ['INSPECTION_PASSED', 'APPROVED', 'REJECTED', 'CANCELLED'],
  // A cancelled collection job returns the request to INSPECTION_PASSED.
  TRANSPORT_ASSIGNED: ['IN_TRANSIT', 'INSPECTION_PASSED', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED'],
  // Reception (weighing and acceptance at the factory) completes the request's journey for now; later phases extend it.
  DELIVERED: ['RECEIVED'],
  RECEIVED: [],
  REJECTED: [],
  CANCELLED: [],
};

/** Statuses from which a FARMER may cancel their own request. Later cancellations go through the purchase team. */
export const FARMER_CANCELLABLE_STATUSES: readonly ProcurementStatus[] = ['SUBMITTED', 'CLARIFICATION_REQUESTED', 'APPROVED'];

/** Statuses in which the original declaration may still be amended. */
export const AMENDABLE_STATUSES: readonly ProcurementStatus[] = ['SUBMITTED', 'CLARIFICATION_REQUESTED'];

export function canTransition(from: ProcurementStatus, to: ProcurementStatus): boolean {
  return (PROCUREMENT_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: ProcurementStatus, to: ProcurementStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `A request that is ${from} cannot become ${to}`, { from, to });
  }
}

type InspectionStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
type CollectionStatus = 'ASSIGNED' | 'PICKED_UP' | 'LOADED' | 'DISPATCHED' | 'ARRIVED' | 'HANDED_OVER' | 'CANCELLED';

export const INSPECTION_TRANSITIONS: Record<InspectionStatus, readonly InspectionStatus[]> = {
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const COLLECTION_TRANSITIONS: Record<CollectionStatus, readonly CollectionStatus[]> = {
  ASSIGNED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['LOADED', 'CANCELLED'],
  LOADED: ['DISPATCHED', 'CANCELLED'],
  // After dispatch the goods are on the road: no cancellation, only arrival and handover.
  DISPATCHED: ['ARRIVED'],
  ARRIVED: ['HANDED_OVER'],
  HANDED_OVER: [],
  CANCELLED: [],
};

/** Collection statuses that occupy a vehicle and a transport officer. */
export const ACTIVE_COLLECTION_STATUSES = ['ASSIGNED', 'PICKED_UP', 'LOADED', 'DISPATCHED', 'ARRIVED'] as const;
export const ACTIVE_INSPECTION_STATUSES = ['ASSIGNED', 'IN_PROGRESS'] as const;

export function assertInspectionTransition(from: InspectionStatus, to: InspectionStatus): void {
  if (!(INSPECTION_TRANSITIONS[from] ?? []).includes(to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `An inspection that is ${from} cannot become ${to}`, { from, to });
  }
}

export function assertCollectionTransition(from: CollectionStatus, to: CollectionStatus): void {
  if (!(COLLECTION_TRANSITIONS[from] ?? []).includes(to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `A collection that is ${from} cannot become ${to}`, { from, to });
  }
}

type BookingStatus = 'RESERVED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED' | 'NO_SHOW';
type ShipmentStatus = 'EXPECTED' | 'ADMITTED' | 'RECEIVED' | 'RELEASED';
type QueueStatus = 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED';

export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  RESERVED: ['CHECKED_IN', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW'],
  CHECKED_IN: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  RESCHEDULED: [],
  NO_SHOW: [],
};

export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  EXPECTED: ['ADMITTED'],
  ADMITTED: ['RECEIVED'],
  RECEIVED: ['RELEASED'],
  RELEASED: [],
};

export const QUEUE_TRANSITIONS: Record<QueueStatus, readonly QueueStatus[]> = {
  QUEUED: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
};

/** Booking statuses that hold capacity in a slot and tie a shipment to a time window. */
export const ACTIVE_BOOKING_STATUSES = ['RESERVED', 'CHECKED_IN'] as const;

export function assertBookingTransition(from: BookingStatus, to: BookingStatus): void {
  if (!(BOOKING_TRANSITIONS[from] ?? []).includes(to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `A booking that is ${from} cannot become ${to}`, { from, to });
  }
}

export function assertShipmentTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (!(SHIPMENT_TRANSITIONS[from] ?? []).includes(to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `A shipment that is ${from} cannot become ${to}`, { from, to });
  }
}

export function assertQueueTransition(from: QueueStatus, to: QueueStatus): void {
  if (!(QUEUE_TRANSITIONS[from] ?? []).includes(to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `A queue entry that is ${from} cannot become ${to}`, { from, to });
  }
}
