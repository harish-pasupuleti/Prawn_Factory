import { describe, expect, it } from 'vitest';
import { allowedGateActions, gateState, normalisePlate, windowState, type GateEventName, type GateState } from '../../src/modules/factory/gateRules';
import { computeNet, currentWeights } from '../../src/modules/factory/weights';

const ev = (...types: GateEventName[]) => types.map((type) => ({ type }));
const ctx = (events: GateEventName[], window: 'TOO_EARLY' | 'IN_WINDOW' | 'LATE' = 'IN_WINDOW', weighed = false, bookingStatus: 'RESERVED' | 'CHECKED_IN' | 'CANCELLED' = 'RESERVED') =>
  allowedGateActions({ bookingStatus, state: gateState(ev(...events)), window, weighed });

describe('gateState', () => {
  it('folds events into a state, and a released hold is no longer a hold', () => {
    const s: GateState = gateState(ev('ARRIVED', 'VERIFIED', 'HELD', 'HOLD_RELEASED'));
    expect(s).toMatchObject({ arrived: true, verified: true, held: false, admitted: false });
    expect(gateState(ev('ARRIVED', 'HELD')).held).toBe(true);
    expect(gateState([])).toMatchObject({ arrived: false, admitted: false, exited: false });
  });
});

describe('windowState', () => {
  const slot = { startsAt: new Date('2026-10-22T10:00:00Z'), endsAt: new Date('2026-10-22T11:00:00Z') };
  it('allows arrival from the early grace until the late grace ends', () => {
    expect(windowState(slot, new Date('2026-10-22T08:59:00Z'), 60, 30)).toBe('TOO_EARLY');
    expect(windowState(slot, new Date('2026-10-22T09:00:00Z'), 60, 30)).toBe('IN_WINDOW');
    expect(windowState(slot, new Date('2026-10-22T10:30:00Z'), 60, 30)).toBe('IN_WINDOW');
    expect(windowState(slot, new Date('2026-10-22T11:30:00Z'), 60, 30)).toBe('IN_WINDOW');
    expect(windowState(slot, new Date('2026-10-22T11:30:01Z'), 60, 30)).toBe('LATE');
  });
});

describe('allowedGateActions', () => {
  it('walks the normal path in order', () => {
    expect(ctx([])).toEqual(['arrive']);
    expect(ctx(['ARRIVED'])).toEqual(['verify', 'hold', 'reject']);
    expect(ctx(['ARRIVED', 'VERIFIED'])).toEqual(['hold', 'reject', 'admit']);
    expect(ctx(['ARRIVED', 'VERIFIED', 'ADMITTED'], 'IN_WINDOW', false, 'CHECKED_IN')).toEqual([]);
    expect(ctx(['ARRIVED', 'VERIFIED', 'ADMITTED'], 'IN_WINDOW', true, 'CHECKED_IN')).toEqual(['exit']);
    expect(ctx(['ARRIVED', 'VERIFIED', 'ADMITTED', 'EXITED'], 'IN_WINDOW', true, 'CHECKED_IN')).toEqual([]);
  });

  it('cannot admit without verification', () => {
    expect(ctx(['ARRIVED'])).not.toContain('admit');
  });

  it('a hold blocks everything except an authorised release or a rejection', () => {
    expect(ctx(['ARRIVED', 'VERIFIED', 'HELD'])).toEqual(['releaseHold', 'reject']);
    expect(ctx(['ARRIVED', 'VERIFIED', 'HELD', 'HOLD_RELEASED'])).toContain('admit');
  });

  it('outside the time window, admission needs an authorised override', () => {
    for (const window of ['TOO_EARLY', 'LATE'] as const) {
      const before = ctx(['ARRIVED', 'VERIFIED'], window);
      expect(before).not.toContain('admit');
      expect(before).toContain('override');
      const after = ctx(['ARRIVED', 'VERIFIED', 'OVERRIDE'], window);
      expect(after).toContain('admit');
      expect(after).not.toContain('override');
    }
    expect(ctx(['ARRIVED', 'VERIFIED'], 'IN_WINDOW')).not.toContain('override');
  });

  it('offers nothing once the booking is cancelled, rejected or finished', () => {
    expect(ctx(['ARRIVED'], 'IN_WINDOW', false, 'CANCELLED')).toEqual([]);
    expect(ctx(['ARRIVED', 'REJECTED'])).toEqual([]);
  });

  it('a vehicle cannot leave before it has been weighed in and out', () => {
    expect(ctx(['ARRIVED', 'VERIFIED', 'ADMITTED'], 'IN_WINDOW', false, 'CHECKED_IN')).not.toContain('exit');
  });
});

describe('plate normalisation', () => {
  it('ignores case, spaces and hyphens', () => {
    expect(normalisePlate('ap 31-tx 1234')).toBe('AP31TX1234');
    expect(normalisePlate('AP31TX1234')).toBe('AP31TX1234');
  });
});

describe('weight chain', () => {
  const row = (id: string, kind: 'GROSS' | 'TARE', valueKg: string, supersedesId: string | null = null) => ({ id, kind, valueKg, supersedesId });

  it('the current value is the one nothing supersedes; originals stay as history', () => {
    const rows = [row('g1', 'GROSS', '1000.000'), row('t1', 'TARE', '200.000'), row('g2', 'GROSS', '990.000', 'g1'), row('g3', 'GROSS', '995.000', 'g2')];
    const current = currentWeights(rows);
    expect(current.GROSS?.id).toBe('g3');
    expect(current.TARE?.id).toBe('t1');
    expect(rows).toHaveLength(4); // nothing was removed or overwritten
    expect(rows[0]!.valueKg).toBe('1000.000');
  });
  it('is empty before anything is recorded', () => {
    expect(currentWeights([])).toEqual({ GROSS: null, TARE: null });
  });
  it('net = gross - tare exactly, and refuses a tare above the gross', () => {
    expect(computeNet('1250.500', '250.250')).toBe('1000.250');
    expect(computeNet('0.3', '0.1')).toBe('0.200'); // no floating point error
    expect(computeNet('500', '500')).toBe('0.000');
    expect(computeNet('500', '500.001')).toBeNull();
  });
});
