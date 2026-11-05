import { describe, expect, it } from 'vitest';
import { computeTimer, targetMinutes } from '../../src/lib/timers';

const at = (iso: string) => new Date(iso);

describe('targetMinutes', () => {
  it('scales with received tonnes and rounds up', () => {
    expect(targetMinutes('1000.000', 120, 30)).toBe(120); // exactly one tonne
    expect(targetMinutes('2500.000', 120, 30)).toBe(300);
    expect(targetMinutes('1000.001', 120, 30)).toBe(121); // ceil, never short
    expect(targetMinutes('4500', 60, 30)).toBe(270);
  });
  it('never goes below the minimum', () => {
    expect(targetMinutes('10', 120, 30)).toBe(30);
    expect(targetMinutes('0', 120, 45)).toBe(45);
  });
  it('uses exact arithmetic for large consignments', () => {
    expect(targetMinutes('999999999.999', 1, 1)).toBe(1_000_000);
  });
});

describe('computeTimer', () => {
  const started = at('2026-10-22T10:00:00Z');
  const base = { startedAt: started, completedAt: null, targetDurationMin: 60 };

  it('is NOT_STARTED while queued, with the full target remaining', () => {
    const t = computeTimer({ status: 'QUEUED', startedAt: null, completedAt: null, targetDurationMin: 60 }, at('2026-10-22T12:00:00Z'));
    expect(t).toEqual({ state: 'NOT_STARTED', targetSec: 3600, elapsedSec: 0, remainingSec: 3600, overdueSec: 0 });
  });

  it('counts down from the SERVER start time, so a refresh changes nothing', () => {
    const first = computeTimer({ status: 'IN_PROGRESS', ...base }, at('2026-10-22T10:20:00Z'));
    const afterRefresh = computeTimer({ status: 'IN_PROGRESS', ...base }, at('2026-10-22T10:20:00Z'));
    expect(first).toEqual(afterRefresh);
    expect(first).toMatchObject({ state: 'RUNNING', elapsedSec: 1200, remainingSec: 2400, overdueSec: 0 });
  });

  it('reaches zero without completing: it becomes OVERDUE and keeps counting up', () => {
    const exactly = computeTimer({ status: 'IN_PROGRESS', ...base }, at('2026-10-22T11:00:00Z'));
    expect(exactly).toMatchObject({ state: 'RUNNING', remainingSec: 0, overdueSec: 0 });
    const over = computeTimer({ status: 'IN_PROGRESS', ...base }, at('2026-10-22T11:15:30Z'));
    expect(over).toMatchObject({ state: 'OVERDUE', remainingSec: 0, overdueSec: 930 });
  });

  it('freezes at the completion time once completed', () => {
    const done = { status: 'COMPLETED' as const, startedAt: started, completedAt: at('2026-10-22T10:45:00Z'), targetDurationMin: 60 };
    expect(computeTimer(done, at('2026-10-23T09:00:00Z'))).toMatchObject({ state: 'COMPLETED', elapsedSec: 2700, remainingSec: 900, overdueSec: 0 });
    const late = { ...done, completedAt: at('2026-10-22T11:30:00Z') };
    expect(computeTimer(late, at('2026-10-30T00:00:00Z'))).toMatchObject({ state: 'COMPLETED', elapsedSec: 5400, overdueSec: 1800 });
  });

  it('never returns negative values if the clocks disagree slightly', () => {
    const t = computeTimer({ status: 'IN_PROGRESS', ...base }, at('2026-10-22T09:59:58Z'));
    expect(t.elapsedSec).toBe(0);
    expect(t.remainingSec).toBe(3600);
  });
});
