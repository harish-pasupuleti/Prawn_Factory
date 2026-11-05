import { describe, expect, it } from 'vitest';
import { isCollectionOverdue, arrivedLate } from '../../src/modules/collections/rules';
import {
  assignTransportSchema,
  dispatchSchema,
  incidentSchema,
  listCollectionsQuerySchema,
  loadSchema,
} from '../../src/modules/collections/schemas';
import {
  assignInspectionSchema,
  completeInspectionSchema,
  inspectionDecisionSchema,
  listInspectionsQuerySchema,
} from '../../src/modules/inspections/schemas';
import { createVehicleSchema, updateVehicleSchema } from '../../src/modules/vehicles/schemas';

const uuid = '11111111-1111-4111-8111-111111111111';
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const inspection = {
  outcome: 'PASS',
  observedSpecies: 'Vannamei',
  observedSizeCount: '30-40',
  inspectedQuantityKg: '950',
  qualityNotes: 'Fresh, good colour',
};

describe('completeInspectionSchema', () => {
  it('accepts a valid PASS and normalises the quantity', () => {
    expect(completeInspectionSchema.parse(inspection).inspectedQuantityKg).toBe('950.000');
  });
  it('requires quality observations', () => {
    expect(completeInspectionSchema.safeParse({ ...inspection, qualityNotes: '' }).success).toBe(false);
    const { qualityNotes: _q, ...without } = inspection;
    expect(completeInspectionSchema.safeParse(without).success).toBe(false);
  });
  it('rejects negative or over-precise quantities', () => {
    expect(completeInspectionSchema.safeParse({ ...inspection, inspectedQuantityKg: '-1' }).success).toBe(false);
    expect(completeInspectionSchema.safeParse({ ...inspection, inspectedQuantityKg: '1.2345' }).success).toBe(false);
  });
  it('allows zero only for a FAIL', () => {
    expect(completeInspectionSchema.safeParse({ ...inspection, outcome: 'FAIL', inspectedQuantityKg: '0' }).success).toBe(true);
    expect(completeInspectionSchema.safeParse({ ...inspection, outcome: 'PASS', inspectedQuantityKg: '0' }).success).toBe(false);
    expect(completeInspectionSchema.safeParse({ ...inspection, outcome: 'REVIEW', inspectedQuantityKg: '0' }).success).toBe(false);
  });
  it('rejects unknown outcomes and unknown fields', () => {
    expect(completeInspectionSchema.safeParse({ ...inspection, outcome: 'MAYBE' }).success).toBe(false);
    expect(completeInspectionSchema.safeParse({ ...inspection, status: 'COMPLETED' }).success).toBe(false);
    expect(completeInspectionSchema.safeParse({ ...inspection, officerId: uuid }).success).toBe(false);
  });
});

describe('assignment and decision schemas', () => {
  it('inspection assignment needs a UUID officer', () => {
    expect(assignInspectionSchema.safeParse({ officerId: uuid }).success).toBe(true);
    expect(assignInspectionSchema.safeParse({ officerId: 'nope' }).success).toBe(false);
    expect(assignInspectionSchema.safeParse({ officerId: uuid, requestId: uuid }).success).toBe(false);
  });
  it('inspection decisions always need a reason', () => {
    expect(inspectionDecisionSchema.safeParse({ decision: 'PROCEED' }).success).toBe(false);
    expect(inspectionDecisionSchema.safeParse({ decision: 'PROCEED', reason: 'ok' }).success).toBe(false);
    expect(inspectionDecisionSchema.safeParse({ decision: 'PROCEED', reason: 'Farmer re-graded on site' }).success).toBe(true);
    expect(inspectionDecisionSchema.safeParse({ decision: 'DELETE', reason: 'whatever' }).success).toBe(false);
  });
  it('list queries validate filters', () => {
    expect(listInspectionsQuerySchema.safeParse({ status: 'COMPLETED', outcome: 'FAIL' }).success).toBe(true);
    expect(listInspectionsQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
    expect(listCollectionsQuerySchema.safeParse({ status: 'ARRIVED' }).success).toBe(true);
    expect(listCollectionsQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
  });
});

describe('assignTransportSchema', () => {
  const base = { transportOfficerId: uuid, vehicleId: uuid };
  it('accepts ids with optional ISO times', () => {
    const parsed = assignTransportSchema.parse({ ...base, scheduledPickupAt: inHours(1), expectedArrivalAt: inHours(5) });
    expect(parsed.scheduledPickupAt).toBeInstanceOf(Date);
    expect(assignTransportSchema.safeParse(base).success).toBe(true);
  });
  it('rejects past times and arrival before pickup', () => {
    expect(assignTransportSchema.safeParse({ ...base, scheduledPickupAt: inHours(-2) }).success).toBe(false);
    expect(assignTransportSchema.safeParse({ ...base, expectedArrivalAt: inHours(-1) }).success).toBe(false);
    expect(assignTransportSchema.safeParse({ ...base, scheduledPickupAt: inHours(5), expectedArrivalAt: inHours(2) }).success).toBe(false);
  });
  it('rejects malformed dates and unknown fields', () => {
    expect(assignTransportSchema.safeParse({ ...base, scheduledPickupAt: 'tomorrow' }).success).toBe(false);
    expect(assignTransportSchema.safeParse({ ...base, status: 'LOADED' }).success).toBe(false);
  });
});

describe('transport step schemas', () => {
  it('load needs a positive collected quantity', () => {
    expect(loadSchema.parse({ collectedQuantityKg: 480.5 }).collectedQuantityKg).toBe('480.500');
    expect(loadSchema.safeParse({ collectedQuantityKg: '0' }).success).toBe(false);
    expect(loadSchema.safeParse({ collectedQuantityKg: '-3' }).success).toBe(false);
    expect(loadSchema.safeParse({ collectedQuantityKg: '5', status: 'LOADED' }).success).toBe(false);
  });
  it('dispatch expected arrival must be in the future', () => {
    expect(dispatchSchema.safeParse({}).success).toBe(true);
    expect(dispatchSchema.safeParse({ expectedArrivalAt: inHours(3) }).success).toBe(true);
    expect(dispatchSchema.safeParse({ expectedArrivalAt: inHours(-3) }).success).toBe(false);
  });
  it('incidents need a known type and a description', () => {
    expect(incidentSchema.safeParse({ type: 'DELAY', description: 'Heavy traffic on NH16' }).success).toBe(true);
    expect(incidentSchema.safeParse({ type: 'DELAY', description: '' }).success).toBe(false);
    expect(incidentSchema.safeParse({ type: 'EXPLOSION', description: 'Something' }).success).toBe(false);
    expect(incidentSchema.safeParse({ type: 'DAMAGE', description: 'Ice melted', quantityAffectedKg: '0' }).success).toBe(false);
  });
});

describe('vehicle schemas', () => {
  it('normalises registration numbers and validates capacity', () => {
    const v = createVehicleSchema.parse({ registrationNumber: ' ap31 tx 1234 ', capacityKg: '1500' });
    expect(v.registrationNumber).toBe('AP31TX1234');
    expect(v.capacityKg).toBe('1500.000');
    expect(createVehicleSchema.safeParse({ registrationNumber: 'A', capacityKg: '1' }).success).toBe(false);
    expect(createVehicleSchema.safeParse({ registrationNumber: 'AP31TX1234', capacityKg: '0' }).success).toBe(false);
    expect(createVehicleSchema.safeParse({ registrationNumber: 'AP31TX!234', capacityKg: '5' }).success).toBe(false);
  });
  it('updates need at least one known field', () => {
    expect(updateVehicleSchema.safeParse({}).success).toBe(false);
    expect(updateVehicleSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(updateVehicleSchema.safeParse({ registrationNumber: 'XX11' }).success).toBe(false);
  });
});

describe('collection timing rules', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const past = new Date('2026-10-22T10:00:00Z');
  const future = new Date('2026-10-22T14:00:00Z');

  it('is overdue only while still awaiting arrival after the expected time', () => {
    expect(isCollectionOverdue('DISPATCHED', past, now)).toBe(true);
    expect(isCollectionOverdue('LOADED', past, now)).toBe(true);
    expect(isCollectionOverdue('DISPATCHED', future, now)).toBe(false);
    expect(isCollectionOverdue('DISPATCHED', null, now)).toBe(false);
  });
  it('is never overdue once arrived, handed over or cancelled', () => {
    for (const s of ['ARRIVED', 'HANDED_OVER', 'CANCELLED'] as const) expect(isCollectionOverdue(s, past, now)).toBe(false);
  });
  it('reports late arrival', () => {
    expect(arrivedLate(new Date('2026-10-22T11:00:00Z'), past)).toBe(true);
    expect(arrivedLate(new Date('2026-10-22T09:00:00Z'), past)).toBe(false);
    expect(arrivedLate(null, past)).toBeNull();
  });
});
