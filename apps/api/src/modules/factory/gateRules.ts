/**
 * Pure gate rules (no database access). The same function decides what is allowed in the UI and on the server,
 * so the two can never disagree.
 */
export type GateEventName = 'ARRIVED' | 'VERIFIED' | 'HELD' | 'HOLD_RELEASED' | 'REJECTED' | 'OVERRIDE' | 'ADMITTED' | 'EXITED' | 'SEAL_MISMATCH';

export interface GateState {
  arrived: boolean;
  verified: boolean;
  held: boolean;
  admitted: boolean;
  exited: boolean;
  rejected: boolean;
  overridden: boolean;
}

/** Folds a booking's gate events (oldest first) into its current state. */
export function gateState(events: ReadonlyArray<{ type: GateEventName }>): GateState {
  const state: GateState = { arrived: false, verified: false, held: false, admitted: false, exited: false, rejected: false, overridden: false };
  for (const { type } of events) {
    switch (type) {
      case 'ARRIVED': state.arrived = true; break;
      case 'VERIFIED': state.verified = true; break;
      case 'HELD': state.held = true; break;
      case 'HOLD_RELEASED': state.held = false; break;
      case 'REJECTED': state.rejected = true; break;
      case 'OVERRIDE': state.overridden = true; break;
      case 'ADMITTED': state.admitted = true; break;
      case 'EXITED': state.exited = true; break;
    }
  }
  return state;
}

export type WindowState = 'TOO_EARLY' | 'IN_WINDOW' | 'LATE';

/** Admission window = [slot start - early grace, slot end + late grace]. */
export function windowState(slot: { startsAt: Date; endsAt: Date }, now: Date, earlyGraceMin: number, lateGraceMin: number): WindowState {
  const opens = slot.startsAt.getTime() - earlyGraceMin * 60_000;
  const closes = slot.endsAt.getTime() + lateGraceMin * 60_000;
  if (now.getTime() < opens) return 'TOO_EARLY';
  if (now.getTime() > closes) return 'LATE';
  return 'IN_WINDOW';
}

export type GateAction = 'arrive' | 'verify' | 'hold' | 'reject' | 'admit' | 'exit' | 'releaseHold' | 'override';

/** Actions only the Purchase Manager may perform (authorisation steps). The rest belong to the Security Officer. */
export const MANAGER_GATE_ACTIONS: readonly GateAction[] = ['releaseHold', 'override'];

export interface GateContext {
  bookingStatus: 'RESERVED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED' | 'NO_SHOW';
  state: GateState;
  window: WindowState;
  /** True once both gross and tare are recorded, so a net weight exists. */
  weighed: boolean;
}

export function allowedGateActions({ bookingStatus, state, window, weighed }: GateContext): GateAction[] {
  if (bookingStatus !== 'RESERVED' && bookingStatus !== 'CHECKED_IN') return [];
  if (state.exited || state.rejected) return [];
  if (!state.arrived) return ['arrive'];

  if (state.admitted) return weighed ? ['exit'] : [];

  const actions: GateAction[] = [];
  if (state.held) {
    actions.push('releaseHold', 'reject');
    return actions;
  }
  if (!state.verified) actions.push('verify');
  actions.push('hold', 'reject');
  if (state.verified && (window === 'IN_WINDOW' || state.overridden)) actions.push('admit');
  if (window !== 'IN_WINDOW' && !state.overridden) actions.push('override');
  return actions;
}

export const normalisePlate = (value: string): string => value.toUpperCase().replace(/[\s-]+/g, '');
