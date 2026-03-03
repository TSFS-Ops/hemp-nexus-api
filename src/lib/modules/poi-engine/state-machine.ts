/**
 * POI State Machine — Single Source of Truth
 * 
 * Deterministic state machine for Proof-of-Intent lifecycle.
 * All valid states and transitions are defined here.
 * No other file may define or override transition logic.
 */

export const POI_STATES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'ELIGIBLE',
  'COLLAPSE_REQUESTED',
  'COLLAPSED',
  'EXPIRED',
  'ANNULLED',
  'REJECTED',
] as const;

export type PoiState = typeof POI_STATES[number];

/** Terminal states — no forward transitions allowed (except COLLAPSED → ANNULLED) */
export const TERMINAL_STATES: PoiState[] = ['EXPIRED', 'REJECTED'];

/** Immutable states — no field mutations permitted */
export const IMMUTABLE_STATES: PoiState[] = ['COLLAPSED', 'ANNULLED', 'EXPIRED', 'REJECTED'];

/**
 * Valid state transitions.
 * This is the ONLY place transitions are defined.
 */
export const VALID_TRANSITIONS: Record<PoiState, PoiState[]> = {
  DRAFT:              ['PENDING_APPROVAL', 'EXPIRED', 'REJECTED'],
  PENDING_APPROVAL:   ['ELIGIBLE', 'REJECTED', 'EXPIRED'],
  ELIGIBLE:           ['COLLAPSE_REQUESTED', 'EXPIRED', 'REJECTED'],
  COLLAPSE_REQUESTED: ['COLLAPSED', 'REJECTED'],
  COLLAPSED:          ['ANNULLED'],
  EXPIRED:            [],
  ANNULLED:           [],
  REJECTED:           [],
};

export interface TransitionRequest {
  matchId: string;
  fromState: PoiState;
  toState: PoiState;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface TransitionResult {
  success: boolean;
  error?: string;
  event?: {
    id: string;
    from_state: string;
    to_state: string;
    created_at: string;
  };
}

/**
 * Validate whether a state transition is permitted.
 * Returns null if valid, or an error message if invalid.
 */
export function validateTransition(from: PoiState, to: PoiState): string | null {
  if (!POI_STATES.includes(from)) {
    return `Invalid current state: ${from}`;
  }
  if (!POI_STATES.includes(to)) {
    return `Invalid target state: ${to}`;
  }
  if (from === to) {
    return `Cannot transition to the same state: ${from}`;
  }

  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    return `Transition from ${from} to ${to} is not permitted. Valid transitions from ${from}: [${(allowed || []).join(', ')}]`;
  }

  return null;
}

/**
 * Check if a POI in the given state can have its fields mutated.
 */
export function isMutable(state: PoiState): boolean {
  return !IMMUTABLE_STATES.includes(state);
}

/**
 * Check if collapse can proceed (must have all approvals).
 * This is a placeholder — the edge function enforces actual approval checks.
 */
export function canCollapse(approvalsComplete: boolean): boolean {
  return approvalsComplete;
}
