import { describe, expect, it } from 'vitest';
import { PROCUREMENT_STATUSES, assertBookingTransition, assertQueueTransition, assertShipmentTransition, ACTIVE_BOOKING_STATUSES } from '../../src/lib/stateMachine';
import {
  completeQueueSchema, correctWeightSchema, createBookingSchema, createSlotSchema, createStationSchema, listQueueQuerySchema,
  recordWeightSchema, rescheduleBookingSchema, resolveExceptionSchema, startQueueSchema, updateSlotSchema, verifySchema,
} from '../../src/modules/factory/schemas';

const uuid = '11111111-1111-4111-8111-111111111111';
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('slot schemas', () => {
  it('accepts a future slot and converts times', () => {
    const slot = createSlotSchema.parse({ startsAt: inHours(2), endsAt: inHours(4), capacity: 3 });
    expect(slot.startsAt).toBeInstanceOf(Date);
    expect(slot.capacity).toBe(3);
  });
  it('rejects bad windows and capacities', () => {
    expect(createSlotSchema.safeParse({ startsAt: inHours(4), endsAt: inHours(2), capacity: 1 }).success).toBe(false);
    expect(createSlotSchema.safeParse({ startsAt: inHours(2), endsAt: inHours(2), capacity: 1 }).success).toBe(false);
    expect(createSlotSchema.safeParse({ startsAt: inHours(1), endsAt: inHours(30), capacity: 1 }).success).toBe(false);
    expect(createSlotSchema.safeParse({ startsAt: inHours(-5), endsAt: inHours(-3), capacity: 1 }).success).toBe(false);
    for (const capacity of [0, -1, 1.5, 101, '3']) {
      expect(createSlotSchema.safeParse({ startsAt: inHours(2), endsAt: inHours(4), capacity }).success).toBe(false);
    }
    expect(createSlotSchema.safeParse({ startsAt: inHours(2), endsAt: inHours(4), capacity: 2, createdById: uuid }).success).toBe(false);
  });
  it('updates need a known field', () => {
    expect(updateSlotSchema.safeParse({}).success).toBe(false);
    expect(updateSlotSchema.safeParse({ capacity: 5, isActive: false }).success).toBe(true);
    expect(updateSlotSchema.safeParse({ startsAt: inHours(1) }).success).toBe(false);
  });
});

describe('booking and gate schemas', () => {
  it('booking needs two UUIDs; reschedule needs a reason', () => {
    expect(createBookingSchema.safeParse({ collectionJobId: uuid, slotId: uuid }).success).toBe(true);
    expect(createBookingSchema.safeParse({ collectionJobId: 'x', slotId: uuid }).success).toBe(false);
    expect(rescheduleBookingSchema.safeParse({ slotId: uuid }).success).toBe(false);
    expect(rescheduleBookingSchema.safeParse({ slotId: uuid, reason: 'Driver delayed by flooding' }).success).toBe(true);
  });
  it('verify needs a registration number', () => {
    expect(verifySchema.safeParse({ registrationNumber: 'AP31TX1234' }).success).toBe(true);
    expect(verifySchema.safeParse({ registrationNumber: '' }).success).toBe(false);
    expect(verifySchema.safeParse({}).success).toBe(false);
  });
});

describe('weight schemas', () => {
  it('normalises weights and rejects negatives, excess precision and a zero gross', () => {
    expect(recordWeightSchema.parse({ kind: 'GROSS', valueKg: '1250.5' }).valueKg).toBe('1250.500');
    expect(recordWeightSchema.parse({ kind: 'TARE', valueKg: 0 }).valueKg).toBe('0.000');
    expect(recordWeightSchema.safeParse({ kind: 'GROSS', valueKg: '0' }).success).toBe(false);
    expect(recordWeightSchema.safeParse({ kind: 'GROSS', valueKg: '-5' }).success).toBe(false);
    expect(recordWeightSchema.safeParse({ kind: 'TARE', valueKg: '1.2345' }).success).toBe(false);
    expect(recordWeightSchema.safeParse({ kind: 'NET', valueKg: '5' }).success).toBe(false);
    expect(recordWeightSchema.safeParse({ kind: 'GROSS', valueKg: '5', recordedById: uuid }).success).toBe(false);
  });
  it('corrections always need a reason', () => {
    expect(correctWeightSchema.safeParse({ kind: 'GROSS', valueKg: '990' }).success).toBe(false);
    expect(correctWeightSchema.safeParse({ kind: 'GROSS', valueKg: '990', reason: 'ok' }).success).toBe(false);
    expect(correctWeightSchema.safeParse({ kind: 'GROSS', valueKg: '990', reason: 'Weighbridge recalibrated' }).success).toBe(true);
  });
});

describe('exception, station and queue schemas', () => {
  it('resolution needs an explanation', () => {
    expect(resolveExceptionSchema.safeParse({ resolution: '' }).success).toBe(false);
    expect(resolveExceptionSchema.safeParse({ resolution: 'Shrinkage during transport confirmed by driver' }).success).toBe(true);
  });
  it('station and queue input', () => {
    expect(createStationSchema.safeParse({ name: 'Line 1' }).success).toBe(true);
    expect(createStationSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(startQueueSchema.safeParse({ stationId: uuid }).success).toBe(true);
    expect(startQueueSchema.safeParse({ stationId: 'Line 1' }).success).toBe(false);
    expect(completeQueueSchema.safeParse({ notes: 'done' }).success).toBe(true);
    expect(completeQueueSchema.safeParse({ status: 'COMPLETED' }).success).toBe(false);
    expect(listQueueQuerySchema.safeParse({ status: 'QUEUED' }).success).toBe(true);
    expect(listQueueQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
  });
});

describe('phase 5 state machines', () => {
  it('bookings: only RESERVED can be cancelled, rescheduled, checked in or marked no-show', () => {
    for (const to of ['CHECKED_IN', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW'] as const) expect(() => assertBookingTransition('RESERVED', to)).not.toThrow();
    expect(() => assertBookingTransition('CHECKED_IN', 'CANCELLED')).toThrow();
    expect(() => assertBookingTransition('CHECKED_IN', 'COMPLETED')).not.toThrow();
    expect(() => assertBookingTransition('CANCELLED', 'RESERVED')).toThrow();
    expect([...ACTIVE_BOOKING_STATUSES]).toEqual(['RESERVED', 'CHECKED_IN']);
  });
  it('shipments move strictly forward', () => {
    expect(() => assertShipmentTransition('EXPECTED', 'ADMITTED')).not.toThrow();
    expect(() => assertShipmentTransition('ADMITTED', 'RECEIVED')).not.toThrow();
    expect(() => assertShipmentTransition('RECEIVED', 'RELEASED')).not.toThrow();
    expect(() => assertShipmentTransition('EXPECTED', 'RECEIVED')).toThrow();
    expect(() => assertShipmentTransition('ADMITTED', 'RELEASED')).toThrow(); // must be received first
    expect(() => assertShipmentTransition('RELEASED', 'RECEIVED')).toThrow();
  });
  it('queue entries cannot skip the start or restart', () => {
    expect(() => assertQueueTransition('QUEUED', 'IN_PROGRESS')).not.toThrow();
    expect(() => assertQueueTransition('IN_PROGRESS', 'COMPLETED')).not.toThrow();
    expect(() => assertQueueTransition('QUEUED', 'COMPLETED')).toThrow();
    expect(() => assertQueueTransition('COMPLETED', 'IN_PROGRESS')).toThrow();
  });
  it('RECEIVED is a request status', () => {
    expect(PROCUREMENT_STATUSES).toContain('RECEIVED');
  });
});
