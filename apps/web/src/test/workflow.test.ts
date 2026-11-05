import { describe, expect, it } from 'vitest';
import { PROCUREMENT_STATUSES, type CollectionStatus, type ProcurementStatus } from '../lib/types';
import { canCancelCollection, canCancelInspection, isCollectionActive, localToIso, nextTransportAction, summarizeStats, TRANSPORT_STEPS, variancePercent } from '../lib/workflow';

describe('transport workflow helpers', () => {
  it('offers exactly one next step per status, in the server order', () => {
    const expected: Record<CollectionStatus, string | null> = {
      ASSIGNED: 'pickup', PICKED_UP: 'load', LOADED: 'dispatch', DISPATCHED: 'arrive', ARRIVED: 'handover', HANDED_OVER: null, CANCELLED: null,
    };
    for (const [status, action] of Object.entries(expected)) expect(nextTransportAction(status as CollectionStatus)).toBe(action);
  });
  it('allows cancelling only before dispatch', () => {
    expect((['ASSIGNED', 'PICKED_UP', 'LOADED'] as const).every(canCancelCollection)).toBe(true);
    expect((['DISPATCHED', 'ARRIVED', 'HANDED_OVER', 'CANCELLED'] as const).some(canCancelCollection)).toBe(false);
    expect(isCollectionActive('ARRIVED')).toBe(true);
    expect(isCollectionActive('HANDED_OVER')).toBe(false);
    expect(canCancelInspection('IN_PROGRESS')).toBe(true);
    expect(canCancelInspection('COMPLETED')).toBe(false);
  });
  it('lists the progress steps in order', () => {
    expect(TRANSPORT_STEPS.map((s) => s.status)).toEqual(['ASSIGNED', 'PICKED_UP', 'LOADED', 'DISPATCHED', 'ARRIVED', 'HANDED_OVER']);
  });
});

describe('display helpers', () => {
  it('computes percentage difference for display', () => {
    expect(variancePercent('400', '360')).toBeCloseTo(10);
    expect(variancePercent('400', '440')).toBeCloseTo(10);
    expect(variancePercent('0', '5')).toBeNull();
    expect(variancePercent('400', 'abc')).toBeNull();
  });
  it('converts datetime-local values to ISO strings', () => {
    expect(localToIso('')).toBeUndefined();
    expect(localToIso('not a date')).toBeUndefined();
    expect(localToIso('2030-05-01T10:30')).toMatch(/^2030-05-01T\d{2}:\d{2}:00\.000Z$|^2030-05-0[12]T/);
  });
  it('groups every status into exactly one dashboard bucket', () => {
    const byStatus = Object.fromEntries(PROCUREMENT_STATUSES.map((s, i) => [s, i + 1])) as Record<ProcurementStatus, number>;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const g = summarizeStats(byStatus);
    expect(g.awaitingReview + g.needsDecision + g.inProgress + g.delivered + g.closed).toBe(total);
    expect(summarizeStats({ ...Object.fromEntries(PROCUREMENT_STATUSES.map((s) => [s, 0])), INSPECTION_FAILED: 2, INSPECTION_REVIEW: 1 } as Record<ProcurementStatus, number>).needsDecision).toBe(3);
  });
});
