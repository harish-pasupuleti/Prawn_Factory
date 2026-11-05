import { describe, expect, it } from 'vitest';
import { clockOffsetMs, formatDuration, liveTimer } from '../lib/timers';

const T0 = Date.parse('2026-10-22T10:00:00Z');
const entry = (over: Partial<Parameters<typeof liveTimer>[0]> = {}) => ({ status: 'IN_PROGRESS' as const, startedAt: '2026-10-22T10:00:00Z', completedAt: null, targetDurationMin: 60, ...over });

describe('liveTimer', () => {
  it('counts down from the server start time', () => {
    expect(liveTimer(entry(), T0 + 20 * 60_000)).toMatchObject({ state: 'RUNNING', elapsedSec: 1200, remainingSec: 2400, overdueSec: 0 });
  });
  it('is the same after a refresh: it depends only on stored times and the clock', () => {
    expect(liveTimer(entry(), T0 + 5_000)).toEqual(liveTimer(entry(), T0 + 5_000));
  });
  it('reaching zero makes it overdue and keeps counting; it never becomes COMPLETED by itself', () => {
    expect(liveTimer(entry(), T0 + 60 * 60_000)).toMatchObject({ state: 'RUNNING', remainingSec: 0, overdueSec: 0 });
    const late = liveTimer(entry(), T0 + 75 * 60_000);
    expect(late).toMatchObject({ state: 'OVERDUE', remainingSec: 0, overdueSec: 900 });
    expect(late.state).not.toBe('COMPLETED');
  });
  it('waiting entries show the full target', () => {
    expect(liveTimer(entry({ status: 'QUEUED', startedAt: null }), T0)).toMatchObject({ state: 'NOT_STARTED', remainingSec: 3600 });
  });
  it('a completed entry freezes at its completion time', () => {
    const done = entry({ status: 'COMPLETED', completedAt: '2026-10-22T10:45:00Z' });
    expect(liveTimer(done, T0 + 10 * 3_600_000)).toMatchObject({ state: 'COMPLETED', elapsedSec: 2700 });
  });
  it('never goes negative when the browser clock is slightly behind', () => {
    expect(liveTimer(entry(), T0 - 5_000).elapsedSec).toBe(0);
  });
});

describe('clock offset', () => {
  it('lets the countdown follow the server clock even when the PC clock is wrong', () => {
    const serverNow = '2026-10-22T10:30:00Z';
    const pcClockWhenFetched = Date.parse('2026-10-22T09:00:00Z'); // PC is 90 minutes behind
    const offset = clockOffsetMs(serverNow, pcClockWhenFetched);
    expect(offset).toBe(90 * 60_000);
    expect(liveTimer(entry(), pcClockWhenFetched + 10_000 + offset).elapsedSec).toBe(30 * 60 + 10);
  });
  it('falls back to no correction without a server time', () => {
    expect(clockOffsetMs(undefined, 123)).toBe(0);
    expect(clockOffsetMs('nonsense', 123)).toBe(0);
  });
});

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(9)).toBe('9s');
    expect(formatDuration(125)).toBe('2m 05s');
    expect(formatDuration(3725)).toBe('1h 02m 05s');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-30)).toBe('0s');
  });
});
