import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors';
import {
  AMENDABLE_STATUSES,
  assertTransition,
  canTransition,
  PROCUREMENT_STATUSES,
  PROCUREMENT_TRANSITIONS,
} from '../../src/lib/stateMachine';

describe('procurement state machine', () => {
  it('allows the documented transitions', () => {
    expect(canTransition('SUBMITTED', 'APPROVED')).toBe(true);
    expect(canTransition('SUBMITTED', 'REJECTED')).toBe(true);
    expect(canTransition('SUBMITTED', 'CLARIFICATION_REQUESTED')).toBe(true);
    expect(canTransition('CLARIFICATION_REQUESTED', 'SUBMITTED')).toBe(true);
    expect(canTransition('APPROVED', 'CANCELLED')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition('APPROVED', 'REJECTED')).toBe(false);
    expect(canTransition('APPROVED', 'SUBMITTED')).toBe(false);
    expect(canTransition('CLARIFICATION_REQUESTED', 'APPROVED')).toBe(false);
    expect(canTransition('SUBMITTED', 'SUBMITTED')).toBe(false);
  });

  it('treats REJECTED and CANCELLED as terminal', () => {
    for (const from of ['REJECTED', 'CANCELLED'] as const) {
      for (const to of PROCUREMENT_STATUSES) expect(canTransition(from, to)).toBe(false);
    }
  });

  it('defines a transition list for every status', () => {
    for (const status of PROCUREMENT_STATUSES) expect(PROCUREMENT_TRANSITIONS[status]).toBeDefined();
  });

  it('assertTransition throws a 409 AppError with context', () => {
    try {
      assertTransition('REJECTED', 'APPROVED');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(409);
      expect((err as AppError).code).toBe('INVALID_TRANSITION');
    }
  });

  it('only allows amendments before a decision is final', () => {
    expect(AMENDABLE_STATUSES).toEqual(['SUBMITTED', 'CLARIFICATION_REQUESTED']);
  });
});
