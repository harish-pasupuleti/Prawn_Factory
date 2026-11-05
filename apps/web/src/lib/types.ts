export const ROLES = [
  'FARMER',
  'PURCHASE_MANAGER',
  'FIELD_OFFICER',
  'TRANSPORT_OFFICER',
  'SECURITY_OFFICER',
  'FACTORY_OPERATOR',
  'ADMIN',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  FARMER: 'Farmer',
  PURCHASE_MANAGER: 'Purchase Manager',
  FIELD_OFFICER: 'Field Officer',
  TRANSPORT_OFFICER: 'Transport Officer',
  SECURITY_OFFICER: 'Security Officer',
  FACTORY_OPERATOR: 'Factory Operator',
  ADMIN: 'Administrator',
};

export const STAFF_ROLES = ROLES.filter((r) => r !== 'FARMER');

export type UserStatus = 'ACTIVE' | 'DISABLED';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export const PROCUREMENT_STATUSES = [
  'SUBMITTED',
  'CLARIFICATION_REQUESTED',
  'APPROVED',
  'INSPECTION_ASSIGNED',
  'INSPECTION_PASSED',
  'INSPECTION_FAILED',
  'INSPECTION_REVIEW',
  'TRANSPORT_ASSIGNED',
  'IN_TRANSIT',
  'DELIVERED',
  'RECEIVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type ProcurementStatus = (typeof PROCUREMENT_STATUSES)[number];

export const STATUS_LABELS: Record<ProcurementStatus, string> = {
  SUBMITTED: 'Submitted',
  CLARIFICATION_REQUESTED: 'Clarification requested',
  APPROVED: 'Approved',
  INSPECTION_ASSIGNED: 'Inspection assigned',
  INSPECTION_PASSED: 'Inspection passed',
  INSPECTION_FAILED: 'Inspection failed',
  INSPECTION_REVIEW: 'Inspection needs review',
  TRANSPORT_ASSIGNED: 'Transport assigned',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered to factory',
  RECEIVED: 'Received at factory',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/** Statuses from which each kind of user may cancel. The server enforces the same rules. */
export const FARMER_CANCELLABLE: readonly ProcurementStatus[] = ['SUBMITTED', 'CLARIFICATION_REQUESTED', 'APPROVED'];
export const STAFF_CANCELLABLE: readonly ProcurementStatus[] = [
  'SUBMITTED',
  'CLARIFICATION_REQUESTED',
  'APPROVED',
  'INSPECTION_ASSIGNED',
  'INSPECTION_PASSED',
  'INSPECTION_FAILED',
  'INSPECTION_REVIEW',
  'TRANSPORT_ASSIGNED',
];

export const AMENDABLE_FIELDS = [
  'species',
  'declaredSizeCount',
  'declaredQuantityKg',
  'expectedPriceInrPerKg',
  'availabilityDate',
  'notes',
] as const;
export type AmendableField = (typeof AMENDABLE_FIELDS)[number];
export type Declaration = Record<AmendableField, string>;

export const FIELD_LABELS: Record<AmendableField, string> = {
  species: 'Species',
  declaredSizeCount: 'Size / count',
  declaredQuantityKg: 'Quantity (kg)',
  expectedPriceInrPerKg: 'Expected price (₹/kg)',
  availabilityDate: 'Availability date',
  notes: 'Notes',
};

export interface Amendment {
  id: string;
  field: string;
  oldValue: string;
  newValue: string;
  reason: string;
  by: string;
  byRole: Role;
  at: string;
}

export type InspectionStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type InspectionOutcome = 'PASS' | 'FAIL' | 'REVIEW';
export type DecisionKind = 'PROCEED' | 'REJECT' | 'REINSPECT';
export type CollectionStatus = 'ASSIGNED' | 'PICKED_UP' | 'LOADED' | 'DISPATCHED' | 'ARRIVED' | 'HANDED_OVER' | 'CANCELLED';
export type IncidentType = 'DELAY' | 'DAMAGE' | 'QUANTITY_SHORTFALL' | 'VEHICLE_BREAKDOWN' | 'OTHER';

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
export const OUTCOME_LABELS: Record<InspectionOutcome, string> = { PASS: 'Pass', FAIL: 'Fail', REVIEW: 'Needs review' };
export const COLLECTION_STATUS_LABELS: Record<CollectionStatus, string> = {
  ASSIGNED: 'Assigned',
  PICKED_UP: 'Picked up',
  LOADED: 'Loaded',
  DISPATCHED: 'Dispatched',
  ARRIVED: 'Arrived at factory',
  HANDED_OVER: 'Handed over',
  CANCELLED: 'Cancelled',
};
export const INCIDENT_LABELS: Record<IncidentType, string> = {
  DELAY: 'Delay',
  DAMAGE: 'Damage',
  QUANTITY_SHORTFALL: 'Quantity shortfall',
  VEHICLE_BREAKDOWN: 'Vehicle breakdown',
  OTHER: 'Other',
};

export interface FarmerContact {
  name: string;
  phone: string;
  village: string;
  district: string;
  state: string;
}

export type PublicDeclaration = Omit<Declaration, 'expectedPriceInrPerKg'>;

export interface Inspection {
  id: string;
  status: InspectionStatus;
  outcome: InspectionOutcome | null;
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  officer: { name: string };
  request: { id: string; code: string; status: ProcurementStatus; declaration: PublicDeclaration; farmer: FarmerContact };
  observedSpecies: string | null;
  observedSizeCount: string | null;
  inspectedQuantityKg: string | null;
  declaredQuantityKgAtInspection: string | null;
  quantityVariancePct: string | null;
  qualityNotes: string | null;
  discrepancyNotes: string | null;
  cancelReason: string | null;
  decision: { kind: DecisionKind; reason: string; by: string; at: string } | null;
}

export interface Incident {
  id: string;
  type: IncidentType;
  description: string;
  quantityAffectedKg: string | null;
  by: string;
  at: string;
}

export interface Collection {
  id: string;
  status: CollectionStatus;
  request: { id: string; code: string; status: ProcurementStatus; declaration: PublicDeclaration; inspectedQuantityKg: string | null; farmer: FarmerContact };
  vehicle: { id: string; registrationNumber: string; capacityKg: string };
  transportOfficer: { name: string };
  assignedAt: string;
  scheduledPickupAt: string | null;
  expectedArrivalAt: string | null;
  pickedUpAt: string | null;
  loadedAt: string | null;
  collectedQuantityKg: string | null;
  collectionNotes: string | null;
  dispatchedAt: string | null;
  arrivedAt: string | null;
  handedOverAt: string | null;
  handoverNotes: string | null;
  cancelReason: string | null;
  overdue: boolean;
  arrivedLate: boolean | null;
  incidents: Incident[];
  shipment: { id: string; code: string; status: ShipmentStatus; booking: { id: string; status: BookingStatus; startsAt: string; endsAt: string } | null } | null;
}

export interface Vehicle {
  id: string;
  registrationNumber: string;
  description: string | null;
  capacityKg: string;
  isActive: boolean;
  busy: boolean;
  createdAt: string;
}

export interface Assignee {
  id: string;
  fullName: string;
  activeCount: number;
}

/** Inspection as shown inside a procurement request. Staff-only fields are optional. */
export interface InspectionSummary {
  id: string;
  status: InspectionStatus;
  outcome: InspectionOutcome | null;
  completedAt: string | null;
  officerName: string;
  observedSpecies: string | null;
  observedSizeCount: string | null;
  inspectedQuantityKg: string | null;
  qualityNotes: string | null;
  discrepancyNotes: string | null;
  assignedAt?: string;
  startedAt?: string | null;
  declaredQuantityKgAtInspection?: string | null;
  quantityVariancePct?: string | null;
  cancelReason?: string | null;
  decision?: { kind: DecisionKind; reason: string; by: string; at: string } | null;
}

export interface CollectionSummary {
  id: string;
  status: CollectionStatus;
  vehicleRegistration: string;
  officerName: string;
  scheduledPickupAt: string | null;
  expectedArrivalAt: string | null;
  pickedUpAt: string | null;
  collectedQuantityKg: string | null;
  dispatchedAt: string | null;
  arrivedAt: string | null;
  handedOverAt: string | null;
  overdue: boolean;
  collectionNotes?: string | null;
  handoverNotes?: string | null;
  cancelReason?: string | null;
  incidents?: Incident[];
}

export interface ShipmentSummary {
  id: string;
  code: string;
  status: ShipmentStatus;
  receivedQuantityKg: string | null;
  receivedAt: string | null;
  queueStatus?: QueueStatus | null;
  openExceptions?: ExceptionType[];
}

export interface ProcurementRequest {
  shipments: ShipmentSummary[];
  inspections: InspectionSummary[];
  collections: CollectionSummary[];
  id: string;
  code: string;
  status: ProcurementStatus;
  original: Declaration;
  current: Declaration;
  lastStatusChange: { at: string; reason: string | null; by?: string | null } | null;
  amendments: Amendment[];
  farmer?: { name: string; phone: string; village: string; district: string; state: string };
  createdAt: string;
  updatedAt: string;
}

/** What the request list and dashboard receive: the declaration and farmer name, without workflow history. */
export type RequestSummary = Pick<ProcurementRequest, 'id' | 'code' | 'status' | 'original' | 'current' | 'createdAt' | 'updatedAt'> & { farmer?: { name: string } };

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Present on the processing queue: the server's clock when the response was produced. */
  serverNow?: string;
}

export interface Paged<T> {
  items: T[];
  meta: PageMeta;
}

export interface RequestStats {
  total: number;
  byStatus: Record<ProcurementStatus, number>;
}

// ------------------------------------------------------------------ Phase 5: factory floor
export type BookingStatus = 'RESERVED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED' | 'NO_SHOW';
export type ShipmentStatus = 'EXPECTED' | 'ADMITTED' | 'RECEIVED' | 'RELEASED';
export type QueueStatus = 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED';
export type ExceptionType = 'RECEPTION_DISCREPANCY' | 'GATE_REJECTION';
export type ExceptionStatus = 'OPEN' | 'RESOLVED';
export type GateAction = 'arrive' | 'verify' | 'hold' | 'reject' | 'admit' | 'exit' | 'releaseHold' | 'override';
export type WindowState = 'TOO_EARLY' | 'IN_WINDOW' | 'LATE';
export type TimerState = 'NOT_STARTED' | 'RUNNING' | 'OVERDUE' | 'COMPLETED';

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  RESERVED: 'Reserved',
  CHECKED_IN: 'On site',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  RESCHEDULED: 'Rescheduled',
  NO_SHOW: 'No-show',
};
export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  EXPECTED: 'Expected',
  ADMITTED: 'Admitted',
  RECEIVED: 'Received',
  RELEASED: 'Released to processing',
};
export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = { QUEUED: 'Waiting', IN_PROGRESS: 'Processing', COMPLETED: 'Completed' };
export const EXCEPTION_TYPE_LABELS: Record<ExceptionType, string> = {
  RECEPTION_DISCREPANCY: 'Weight discrepancy',
  GATE_REJECTION: 'Gate rejection',
};
export const WINDOW_LABELS: Record<WindowState, string> = { TOO_EARLY: 'Too early', IN_WINDOW: 'On time', LATE: 'Late' };

export interface Slot {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  isActive: boolean;
  bookedCount: number;
  available: number;
}

export interface GateStateView {
  arrived: boolean;
  verified: boolean;
  held: boolean;
  admitted: boolean;
  exited: boolean;
  rejected: boolean;
  overridden: boolean;
}

export interface Booking {
  id: string;
  status: BookingStatus;
  slot: { id: string; startsAt: string; endsAt: string };
  window: WindowState;
  shipment: { id: string; code: string; status: ShipmentStatus };
  vehicleRegistration: string;
  driverName: string;
  gate: GateStateView;
  weighed: boolean;
  actions: GateAction[];
  canReschedule: boolean;
  canCancel: boolean;
  request?: { id: string; code: string };
  reason?: string | null;
  events?: { id: string; type: string; by: string; reason: string | null; at: string }[];
}

export interface WeightView {
  valueKg: string;
  recordedBy: string;
  at: string;
  corrected: boolean;
}

export interface Shipment {
  id: string;
  code: string;
  status: ShipmentStatus;
  request: { id: string; code: string };
  species: string;
  declaredSizeCount: string;
  vehicleRegistration: string;
  driverName: string;
  handedOver: boolean;
  slot: { startsAt: string; endsAt: string; status: BookingStatus } | null;
  weights: { gross: WeightView | null; tare: WeightView | null; netKg: string | null };
  receivedQuantityKg: string | null;
  receivedAt: string | null;
  hasOpenDiscrepancy: boolean;
  queue: { id: string; status: QueueStatus } | null;
  can: { recordGross: boolean; recordTare: boolean; receive: boolean; release: boolean; correct: boolean };
  waitingForHandover: boolean;
  // Managers only:
  collectedQuantityKg?: string | null;
  variancePct?: string | null;
  thresholdPct?: number;
  history?: { id: string; kind: 'GROSS' | 'TARE'; valueKg: string; by: string; at: string; reason: string | null; supersedesId: string | null }[];
  exceptions?: { id: string; type: ExceptionType; status: ExceptionStatus }[];
}

export interface ExceptionCase {
  id: string;
  type: ExceptionType;
  status: ExceptionStatus;
  summary: string;
  details: Record<string, unknown> | null;
  shipment: { id: string; code: string };
  request: { id: string; code: string };
  raisedBy: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
  events: { id: string; type: 'RAISED' | 'NOTE' | 'RESOLVED'; note: string; by: string; at: string }[];
}

export interface Station {
  id: string;
  name: string;
  isActive: boolean;
  busy: boolean;
}

export interface Timer {
  state: TimerState;
  targetSec: number;
  elapsedSec: number;
  remainingSec: number;
  overdueSec: number;
}

export interface QueueEntry {
  id: string;
  status: QueueStatus;
  position: number | null;
  targetDurationMin: number;
  station: { id: string; name: string } | null;
  shipment: { id: string; code: string; receivedQuantityKg: string | null };
  request: { id: string; code: string; species: string; declaredSizeCount: string };
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  timer: Timer;
}
