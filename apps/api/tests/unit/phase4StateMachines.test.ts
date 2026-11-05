import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors';
import {
  ACTIVE_COLLECTION_STATUSES,
  assertCollectionTransition,
  assertInspectionTransition,
  canTransition,
  COLLECTION_TRANSITIONS,
  FARMER_CANCELLABLE_STATUSES,
  INSPECTION_TRANSITIONS,
  PROCUREMENT_STATUSES,
  PROCUREMENT_TRANSITIONS,
} from '../../src/lib/stateMachine';

describe('procurement workflow after approval', () => {
  it('follows the full happy path', () => {
    const path = ['SUBMITTED', 'APPROVED', 'INSPECTION_ASSIGNED', 'INSPECTION_PASSED', 'TRANSPORT_ASSIGNED', 'IN_TRANSIT', 'DELIVERED'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });

  it('inspection failure can never reach transport directly', () => {
    expect(canTransition('INSPECTION_FAILED', 'TRANSPORT_ASSIGNED')).toBe(false);
    expect(canTransition('INSPECTION_REVIEW', 'TRANSPORT_ASSIGNED')).toBe(false);
    expect(canTransition('INSPECTION_ASSIGNED', 'TRANSPORT_ASSIGNED')).toBe(false);
    expect(canTransition('APPROVED', 'TRANSPORT_ASSIGNED')).toBe(false);
    expect(canTransition('APPROVED', 'INSPECTION_PASSED')).toBe(false);
  });

  it('the only ways out of FAILED / REVIEW are explicit manager decisions or cancellation', () => {
    for (const from of ['INSPECTION_FAILED', 'INSPECTION_REVIEW'] as const) {
      expect([...(PROCUREMENT_TRANSITIONS[from] ?? [])].sort()).toEqual(['APPROVED', 'CANCELLED', 'INSPECTION_PASSED', 'REJECTED']);
    }
  });

  it('only PASS leads to transport assignment', () => {
    const sources = PROCUREMENT_STATUSES.filter((s) => canTransition(s, 'TRANSPORT_ASSIGNED'));
    expect(sources).toEqual(['INSPECTION_PASSED']);
  });

  it('goods in transit or delivered cannot be cancelled or reversed', () => {
    expect(canTransition('IN_TRANSIT', 'CANCELLED')).toBe(false);
    expect(canTransition('IN_TRANSIT', 'TRANSPORT_ASSIGNED')).toBe(false);
    // Delivered goods can only move forward to reception, never back or to cancellation.
    expect(PROCUREMENT_TRANSITIONS.DELIVERED).toEqual(['RECEIVED']);
    expect(PROCUREMENT_TRANSITIONS.RECEIVED).toEqual([]);
  });

  it('cancelled assignments return the request to the previous stage', () => {
    expect(canTransition('INSPECTION_ASSIGNED', 'APPROVED')).toBe(true);
    expect(canTransition('TRANSPORT_ASSIGNED', 'INSPECTION_PASSED')).toBe(true);
  });

  it('farmers may only self-cancel before field work starts', () => {
    expect([...FARMER_CANCELLABLE_STATUSES]).toEqual(['SUBMITTED', 'CLARIFICATION_REQUESTED', 'APPROVED']);
  });

  it('has an entry for every status', () => {
    for (const s of PROCUREMENT_STATUSES) expect(PROCUREMENT_TRANSITIONS[s]).toBeDefined();
  });
});

describe('inspection state machine', () => {
  it('goes ASSIGNED -> IN_PROGRESS -> COMPLETED and cannot skip the start', () => {
    expect(() => assertInspectionTransition('ASSIGNED', 'IN_PROGRESS')).not.toThrow();
    expect(() => assertInspectionTransition('IN_PROGRESS', 'COMPLETED')).not.toThrow();
    expect(() => assertInspectionTransition('ASSIGNED', 'COMPLETED')).toThrow(AppError);
  });
  it('completed and cancelled inspections are final', () => {
    expect(INSPECTION_TRANSITIONS.COMPLETED).toEqual([]);
    expect(INSPECTION_TRANSITIONS.CANCELLED).toEqual([]);
    expect(() => assertInspectionTransition('COMPLETED', 'CANCELLED')).toThrow();
  });
  it('errors are 409 INVALID_TRANSITION', () => {
    try {
      assertInspectionTransition('COMPLETED', 'IN_PROGRESS');
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).status).toBe(409);
      expect((e as AppError).code).toBe('INVALID_TRANSITION');
    }
  });
});

describe('collection state machine', () => {
  const happy = ['ASSIGNED', 'PICKED_UP', 'LOADED', 'DISPATCHED', 'ARRIVED', 'HANDED_OVER'] as const;

  it('must follow the sequence in order', () => {
    for (let i = 0; i < happy.length - 1; i++) expect(() => assertCollectionTransition(happy[i]!, happy[i + 1]!)).not.toThrow();
  });
  it('cannot skip steps or go backwards', () => {
    expect(() => assertCollectionTransition('ASSIGNED', 'LOADED')).toThrow();
    expect(() => assertCollectionTransition('LOADED', 'ARRIVED')).toThrow();
    expect(() => assertCollectionTransition('DISPATCHED', 'HANDED_OVER')).toThrow();
    expect(() => assertCollectionTransition('LOADED', 'PICKED_UP')).toThrow();
  });
  it('can be cancelled only before dispatch', () => {
    for (const s of ['ASSIGNED', 'PICKED_UP', 'LOADED'] as const) expect(() => assertCollectionTransition(s, 'CANCELLED')).not.toThrow();
    for (const s of ['DISPATCHED', 'ARRIVED', 'HANDED_OVER', 'CANCELLED'] as const) expect(() => assertCollectionTransition(s, 'CANCELLED')).toThrow();
  });
  it('active statuses are exactly those that occupy a vehicle and officer', () => {
    expect([...ACTIVE_COLLECTION_STATUSES]).toEqual(['ASSIGNED', 'PICKED_UP', 'LOADED', 'DISPATCHED', 'ARRIVED']);
    for (const s of Object.keys(COLLECTION_TRANSITIONS)) {
      const active = (ACTIVE_COLLECTION_STATUSES as readonly string[]).includes(s);
      expect(active).toBe(!['HANDED_OVER', 'CANCELLED'].includes(s));
    }
  });
});
