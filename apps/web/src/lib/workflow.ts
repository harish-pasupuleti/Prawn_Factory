import type { CollectionStatus, InspectionStatus } from './types';

export type TransportAction = 'pickup' | 'load' | 'dispatch' | 'arrive' | 'handover';

/** The one step a transport officer can take next, or null when the job is closed. Mirrors the server state machine. */
export function nextTransportAction(status: CollectionStatus): TransportAction | null {
  switch (status) {
    case 'ASSIGNED':
      return 'pickup';
    case 'PICKED_UP':
      return 'load';
    case 'LOADED':
      return 'dispatch';
    case 'DISPATCHED':
      return 'arrive';
    case 'ARRIVED':
      return 'handover';
    default:
      return null;
  }
}

export const TRANSPORT_STEPS: { status: CollectionStatus; label: string; field: string }[] = [
  { status: 'ASSIGNED', label: 'Assigned', field: 'assignedAt' },
  { status: 'PICKED_UP', label: 'Picked up', field: 'pickedUpAt' },
  { status: 'LOADED', label: 'Loaded', field: 'loadedAt' },
  { status: 'DISPATCHED', label: 'Dispatched', field: 'dispatchedAt' },
  { status: 'ARRIVED', label: 'Arrived at factory', field: 'arrivedAt' },
  { status: 'HANDED_OVER', label: 'Handed over', field: 'handedOverAt' },
];

export const isCollectionActive = (status: CollectionStatus) => status !== 'HANDED_OVER' && status !== 'CANCELLED';
export const canCancelCollection = (status: CollectionStatus) => status === 'ASSIGNED' || status === 'PICKED_UP' || status === 'LOADED';
export const canCancelInspection = (status: InspectionStatus) => status === 'ASSIGNED' || status === 'IN_PROGRESS';

/** Percentage difference for display only; the server makes the authoritative, exact comparison. */
export function variancePercent(reference: string, actual: string): number | null {
  const ref = Number(reference);
  const act = Number(actual);
  if (!Number.isFinite(ref) || !Number.isFinite(act) || ref === 0) return null;
  return (Math.abs(act - ref) / ref) * 100;
}

/** Converts a datetime-local input value to an ISO string, or undefined when empty. */
export function localToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

import type { ProcurementStatus } from './types';

/** Groups the per-status counts into the headline numbers shown on dashboards. */
export function summarizeStats(byStatus: Record<ProcurementStatus, number>) {
  const sum = (...keys: ProcurementStatus[]) => keys.reduce((total, key) => total + (byStatus[key] ?? 0), 0);
  return {
    awaitingReview: sum('SUBMITTED', 'CLARIFICATION_REQUESTED'),
    needsDecision: sum('INSPECTION_FAILED', 'INSPECTION_REVIEW'),
    inProgress: sum('APPROVED', 'INSPECTION_ASSIGNED', 'INSPECTION_PASSED', 'TRANSPORT_ASSIGNED', 'IN_TRANSIT'),
    delivered: sum('DELIVERED', 'RECEIVED'),
    closed: sum('REJECTED', 'CANCELLED'),
  };
}
