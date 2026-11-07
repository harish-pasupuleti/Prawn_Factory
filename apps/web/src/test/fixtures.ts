import type { Booking, ExceptionCase, QueueEntry, Shipment, Slot, Collection, CollectionStatus, Inspection, InspectionStatus, ProcurementRequest, ProcurementStatus, Role } from '../lib/types';

export const userFor = (role: Role, name = 'Test User') => ({
  id: `user-${role}`,
  email: `${role.toLowerCase()}@example.com`,
  fullName: name,
  role,
  status: 'ACTIVE' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const farmer = { name: 'Ravi Kumar', phone: '9876543210', village: 'Razole', district: 'Konaseema', state: 'Andhra Pradesh' };
const declaration = { species: 'Vannamei', declaredSizeCount: '30-40', declaredQuantityKg: '400.000', availabilityDate: '2030-05-01', notes: '' };

export function inspectionFixture(status: InspectionStatus, overrides: Partial<Inspection> = {}): Inspection {
  return {
    id: 'i1', status, outcome: null, assignedAt: '2026-10-20T05:00:00.000Z', startedAt: null, completedAt: null,
    officer: { name: 'Officer One' },
    request: { id: 'r1', code: 'PR-2026-000001', status: 'INSPECTION_ASSIGNED', declaration, farmer },
    observedSpecies: null, observedSizeCount: null, inspectedQuantityKg: null, declaredQuantityKgAtInspection: null,
    quantityVariancePct: null, qualityNotes: null, discrepancyNotes: null, cancelReason: null, decision: null,
    ...overrides,
  };
}

export function collectionFixture(status: CollectionStatus, overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'c1', status,
    request: { id: 'r1', code: 'PR-2026-000001', status: 'TRANSPORT_ASSIGNED', declaration, inspectedQuantityKg: '400.000', farmer },
    vehicle: { id: 'v1', registrationNumber: 'AP31TX1234', capacityKg: '500.000' },
    transportOfficer: { name: 'Driver One' },
    assignedAt: '2026-10-20T05:00:00.000Z', scheduledPickupAt: null, expectedArrivalAt: '2026-10-22T15:00:00.000Z',
    pickedUpAt: null, loadedAt: null, collectedQuantityKg: null, collectionNotes: null, dispatchedAt: null,
    arrivedAt: null, handedOverAt: null, handoverNotes: null, cancelReason: null, photos: [], sealed: false, sealedAt: null, sealedBy: null, sealCode: null, overdue: false, arrivedLate: null, incidents: [], shipment: null,
    ...overrides,
  };
}

export function requestFixture(status: ProcurementStatus, overrides: Partial<ProcurementRequest> = {}, staff = true): ProcurementRequest {
  const current = { ...declaration, expectedPriceInrPerKg: '420.00' };
  return {
    id: 'r1', code: 'PR-2026-000001', status, original: current, current, lastStatusChange: null, amendments: [],
    inspections: [], collections: [], shipments: [],
    ...(staff ? { farmer } : {}),
    createdAt: '2026-10-19T05:00:00.000Z', updatedAt: '2026-10-19T05:00:00.000Z',
    ...overrides,
  };
}

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
export const minutes = (n: number) => n * 60_000;

export function bookingFixture(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b1', status: 'RESERVED', slot: { id: 's1', startsAt: iso(minutes(30)), endsAt: iso(minutes(210)) }, window: 'IN_WINDOW',
    shipment: { id: 'sh1', code: 'SH-2026-000001', status: 'EXPECTED' }, vehicleRegistration: 'AP31TX1234', driverName: 'Driver One', sealRequired: false,
    gate: { arrived: false, verified: false, held: false, admitted: false, exited: false, rejected: false, overridden: false },
    weighed: false, actions: ['arrive'], canReschedule: false, canCancel: false,
    ...overrides,
  };
}

export function shipmentFixture(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'sh1', code: 'SH-2026-000001', status: 'ADMITTED', request: { id: 'r1', code: 'PR-2026-000001' }, species: 'Vannamei', declaredSizeCount: '30-40',
    vehicleRegistration: 'AP31TX1234', driverName: 'Driver One', handedOver: false, slot: null,
    weights: { gross: null, tare: null, netKg: null }, receivedQuantityKg: null, receivedAt: null, hasOpenDiscrepancy: false, queue: null,
    can: { recordGross: true, recordTare: true, receive: false, release: false, correct: false }, waitingForHandover: false,
    ...overrides,
  };
}

export function queueFixture(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: 'q1', status: 'QUEUED', position: 1, targetDurationMin: 48, station: null,
    shipment: { id: 'sh1', code: 'SH-2026-000001', receivedQuantityKg: '400.000' },
    request: { id: 'r1', code: 'PR-2026-000001', species: 'Vannamei', declaredSizeCount: '30-40' },
    createdAt: iso(-minutes(60)), startedAt: null, completedAt: null, notes: null,
    timer: { state: 'NOT_STARTED', targetSec: 2880, elapsedSec: 0, remainingSec: 2880, overdueSec: 0 },
    ...overrides,
  };
}

export function exceptionFixture(overrides: Partial<ExceptionCase> = {}): ExceptionCase {
  return {
    id: 'e1', type: 'RECEPTION_DISCREPANCY', status: 'OPEN', summary: 'Received 350 kg against 400 kg collected (12.50% difference)',
    details: { collectedKg: '400.000', receivedKg: '350.000', variancePct: '12.50', thresholdPct: 5, direction: 'SHORT' },
    shipment: { id: 'sh1', code: 'SH-2026-000001' }, request: { id: 'r1', code: 'PR-2026-000001' },
    raisedBy: 'Operator One', resolvedBy: null, resolvedAt: null, resolution: null, createdAt: iso(-minutes(10)),
    events: [{ id: 'ev1', type: 'RAISED', note: 'Weight difference of 12.50% exceeds the 5% threshold', by: 'Operator One', at: iso(-minutes(10)) }],
    ...overrides,
  };
}

export function slotFixture(overrides: Partial<Slot> = {}): Slot {
  return { id: 's1', startsAt: iso(minutes(30)), endsAt: iso(minutes(210)), capacity: 3, isActive: true, bookedCount: 1, available: 2, ...overrides };
}
