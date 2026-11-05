import type { QueueStatus, Timer } from './types';

/**
 * Mirrors the server's timer rules. The server sends startedAt, the target and its own clock; the browser only
 * has to keep ticking. Because the numbers come from stored times, a refresh or reconnect shows the same countdown.
 * Reaching zero changes nothing except the OVERDUE flag.
 */
export function liveTimer(
  entry: { status: QueueStatus; startedAt: string | null; completedAt: string | null; targetDurationMin: number },
  serverNowMs: number,
): Timer {
  const targetSec = entry.targetDurationMin * 60;
  if (entry.status === 'QUEUED' || !entry.startedAt) {
    return { state: 'NOT_STARTED', targetSec, elapsedSec: 0, remainingSec: targetSec, overdueSec: 0 };
  }
  const endMs = entry.status === 'COMPLETED' && entry.completedAt ? Date.parse(entry.completedAt) : serverNowMs;
  const elapsedSec = Math.max(0, Math.floor((endMs - Date.parse(entry.startedAt)) / 1000));
  const overdueSec = Math.max(0, elapsedSec - targetSec);
  const state = entry.status === 'COMPLETED' ? 'COMPLETED' : overdueSec > 0 ? 'OVERDUE' : 'RUNNING';
  return { state, targetSec, elapsedSec, remainingSec: Math.max(0, targetSec - elapsedSec), overdueSec };
}

/** Difference between the server's clock and this browser's clock at the moment the data was fetched. */
export function clockOffsetMs(serverNowIso: string | undefined, fetchedAtClientMs: number): number {
  if (!serverNowIso) return 0;
  const server = Date.parse(serverNowIso);
  return Number.isNaN(server) ? 0 : server - fetchedAtClientMs;
}

/** 3725 -> "1h 02m 05s", 125 -> "2m 05s", 9 -> "9s". */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
