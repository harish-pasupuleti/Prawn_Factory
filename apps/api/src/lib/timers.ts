/**
 * Processing timers. Nothing here is stored: every value is computed from the server-recorded start time,
 * the configured target duration and the current server time, so a timer is identical after a page refresh,
 * a reconnect, or a restart. Reaching zero only produces an OVERDUE flag; it never completes anything.
 */
import { toGrams } from './quantity';

/** Minutes = ceil(received tonnes x minutesPerTonne), but never below minMinutes. Exact integer arithmetic. */
export function targetMinutes(receivedKg: string, minutesPerTonne: number, minMinutes: number): number {
  const grams = toGrams(receivedKg);
  const numerator = grams * BigInt(minutesPerTonne);
  const denominator = 1_000_000n; // grams per tonne
  const minutes = Number((numerator + denominator - 1n) / denominator);
  return Math.max(minMinutes, minutes);
}

export type TimerState = 'NOT_STARTED' | 'RUNNING' | 'OVERDUE' | 'COMPLETED';

export interface TimerInput {
  status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED';
  startedAt: Date | null;
  completedAt: Date | null;
  targetDurationMin: number;
}

export interface TimerView {
  state: TimerState;
  targetSec: number;
  elapsedSec: number;
  remainingSec: number;
  overdueSec: number;
}

export function computeTimer(entry: TimerInput, now: Date): TimerView {
  const targetSec = entry.targetDurationMin * 60;
  if (entry.status === 'QUEUED' || !entry.startedAt) {
    return { state: 'NOT_STARTED', targetSec, elapsedSec: 0, remainingSec: targetSec, overdueSec: 0 };
  }
  const end = entry.status === 'COMPLETED' && entry.completedAt ? entry.completedAt : now;
  const elapsedSec = Math.max(0, Math.floor((end.getTime() - entry.startedAt.getTime()) / 1000));
  const overdueSec = Math.max(0, elapsedSec - targetSec);
  const state: TimerState = entry.status === 'COMPLETED' ? 'COMPLETED' : overdueSec > 0 ? 'OVERDUE' : 'RUNNING';
  return { state, targetSec, elapsedSec, remainingSec: Math.max(0, targetSec - elapsedSec), overdueSec };
}
