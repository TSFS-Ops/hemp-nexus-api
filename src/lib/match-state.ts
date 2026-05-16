/**
 * Match State Machine - Single Source of Truth
 *
 * Two parallel state tracks:
 * 1. `status` (legacy): matched → settled → disputed → cancelled
 * 2. `state` (V3 lifecycle): discovery → intent_declared → counterparty_sighted → committed → completed
 *
 * Components MUST use these guards instead of inline checks.
 */

import { MATCH_STATUS } from "@/lib/constants";

// ─── Statuses (legacy) ──────────────────────────────────────────────
export const MATCH_STATUSES = ["matched", "settled"] as const;
export type MatchStatusValue = (typeof MATCH_STATUSES)[number];

// ─── V3 Lifecycle States ────────────────────────────────────────────
// Internal DB states (kept for backward compat)
export const MATCH_STATES_INTERNAL = [
  "discovery",
  "intent_declared",
  "counterparty_sighted",
  "committed",
  "completed",
] as const;

// Simplified visual states (what users see)
export const MATCH_STATES = [
  "discovery",
  "committed",       // = "POI Generated"
  "completed",
] as const;
export type MatchStateValue = (typeof MATCH_STATES_INTERNAL)[number];

export const STATE_LABELS: Record<string, string> = {
  discovery: "Discovery",
  intent_declared: "POI Generated",
  counterparty_sighted: "POI Generated",
  committed: "POI Generated",
  completed: "Completed",
};

export const STATE_DESCRIPTIONS: Record<string, string> = {
  discovery: "A trading partner has been matched. Review details and generate the Proof of Intent.",
  intent_declared: "POI has been generated. Awaiting counterparty engagement before you can proceed.",
  counterparty_sighted: "POI has been generated. Awaiting counterparty engagement before you can proceed.",
  committed: "POI has been generated. Awaiting counterparty engagement before you can proceed.",
  completed: "Transaction completed. Evidence record sealed.",
};

// ─── Valid state transitions ────────────────────────────────────────
const VALID_STATE_TRANSITIONS: Record<string, string[]> = {
  discovery: ["committed"],         // Single step: Generate POI
  intent_declared: ["committed"],   // Legacy compat
  counterparty_sighted: ["committed"],
  committed: ["completed"],
  completed: [],
};

// ─── Actions ────────────────────────────────────────────────────────
export const MATCH_ACTIONS = [
  "confirm_intent",
  "reveal_counterparty",
  "commit",
  "complete",
  "raise_dispute",
  "upload_document",
  "add_note",
  "edit_terms",
  "create_wad",
  "generate_evidence_pack",
  "select_for_bulk",
] as const;

export type MatchAction = (typeof MATCH_ACTIONS)[number];

// ─── Action guard map (by state, not status) ────────────────────────
const STATE_ALLOWED_ACTIONS: Record<string, readonly MatchAction[]> = {
  discovery: [
    "confirm_intent",
    "raise_dispute",
    "upload_document",
    "add_note",
    "edit_terms",
    "select_for_bulk",
  ],
  intent_declared: [
    "reveal_counterparty",
    "raise_dispute",
    "upload_document",
    "add_note",
    "edit_terms",
  ],
  counterparty_sighted: [
    "commit",
    "raise_dispute",
    "upload_document",
    "add_note",
    "edit_terms",
    "create_wad",
  ],
  committed: [
    "complete",
    "raise_dispute",
    "upload_document",
    "add_note",
    "create_wad",
    "generate_evidence_pack",
  ],
  completed: [
    "generate_evidence_pack",
    "upload_document",
    "add_note",
  ],
};

// ─── Legacy status-based action map (for backward compat) ───────────
const ALLOWED_ACTIONS: Record<MatchStatusValue, readonly MatchAction[]> = {
  matched: [
    "confirm_intent",
    "raise_dispute",
    "upload_document",
    "add_note",
    "edit_terms",
    "select_for_bulk",
  ],
  settled: [
    "reveal_counterparty",
    "raise_dispute",
    "upload_document",
    "add_note",
    "create_wad",
    "generate_evidence_pack",
  ],
};

// ─── Public API ─────────────────────────────────────────────────────

/** Check if an action is allowed based on the match state (V3) or status (legacy) */
export function canDo(statusOrState: string, action: MatchAction): boolean {
  // Try state-based first
  const stateAllowed = STATE_ALLOWED_ACTIONS[statusOrState];
  if (stateAllowed) return stateAllowed.includes(action);
  // Fall back to legacy status
  const allowed = ALLOWED_ACTIONS[statusOrState as MatchStatusValue];
  if (!allowed) return false;
  return allowed.includes(action);
}

/** Check if a specific state transition is valid */
export function canTransitionTo(currentState: string, targetState: string): boolean {
  const valid = VALID_STATE_TRANSITIONS[currentState];
  return valid ? valid.includes(targetState) : false;
}

/** Get the next state in the lifecycle */
export function getNextState(currentState: string): string | null {
  const valid = VALID_STATE_TRANSITIONS[currentState];
  return valid && valid.length > 0 ? valid[0] : null;
}

/** Get the API action path for a state transition */
export function getTransitionAction(targetState: string): string | null {
  const map: Record<string, string> = {
    committed: "generate-poi",     // Single action: discovery → committed
    completed: "complete",
    // Legacy compat
    intent_declared: "settle",
    counterparty_sighted: "reveal-counterparty",
  };
  return map[targetState] ?? null;
}

/** Get the action label for the next transition */
export function getNextActionLabel(currentState: string, matchType?: string): string | null {
  if (matchType === "unilateral") {
    const labels: Record<string, string> = {
      discovery: "Generate POI - 1 credit",
      intent_declared: "Awaiting counterparty",
    };
    return labels[currentState] ?? null;
  }
  const labels: Record<string, string> = {
    discovery: "Generate POI - 1 credit",
    committed: "Complete Trade",
  };
  return labels[currentState] ?? null;
}

/** Get a description of what the next action does */
export function getNextActionDescription(currentState: string, matchType?: string): string | null {
  if (matchType === "unilateral") {
    const descriptions: Record<string, string> = {
      discovery: "Generates a Proof of Intent record for this trade. 1 credit ($1.00 USD) will be charged. Non-binding.",
      intent_declared: "This unilateral intent is awaiting a trading partner.",
    };
    return descriptions[currentState] ?? null;
  }
  const descriptions: Record<string, string> = {
    discovery: "Generates a Proof of Intent (POI) record for this trade. 1 credit ($1.00 USD) will be charged. Non-binding.",
    committed: "Marks this trade as completed and seals the evidence record. This action is irreversible.",
  };
  return descriptions[currentState] ?? null;
}

export function getAllowedActions(status: string): readonly MatchAction[] {
  return STATE_ALLOWED_ACTIONS[status] ?? ALLOWED_ACTIONS[status as MatchStatusValue] ?? [];
}

export function isTerminal(status: string): boolean {
  return status === "completed";
}

export function isSettled(status: string): boolean {
  return status === MATCH_STATUS.SETTLED;
}

export function isCompleted(state: string): boolean {
  return state === "completed";
}

/** Light/enhanced counterparty verification belongs only before POI generation. */
export function isPrePoi(stateOrStatus: string | null | undefined): boolean {
  return stateOrStatus === "discovery" || stateOrStatus === MATCH_STATUS.MATCHED;
}

/**
 * Canonical set of legacy status labels recognised by this renderer. Kept
 * alongside STATE_LABELS so `statusLabel` can detect a truly unknown /
 * future value rather than silently echoing the raw enum literal.
 * See Batch B Fix 6 — unknown enum display contract.
 */
const LEGACY_STATUS_LABELS: Record<string, string> = {
  matched: "Awaiting Confirmation",
  settled: "Intent Confirmed",
  confirmed: "Intent Confirmed",
  disputed: "Dispute Raised",
  cancelled: "Cancelled",
};

/** Human-readable label for a match state or status. */
export function statusLabel(statusOrState: string): string {
  if (STATE_LABELS[statusOrState]) return STATE_LABELS[statusOrState];
  if (LEGACY_STATUS_LABELS[statusOrState]) return LEGACY_STATUS_LABELS[statusOrState];
  // Batch B Fix 6 — unknown / future enum values must not render as the
  // raw literal. Surface them as an explicit "Unrecognised" badge so
  // operators and customers see "this is unknown" rather than a confusing
  // backend identifier masquerading as a friendly label.
  if (!statusOrState) return "Unrecognised status";
  return `Unrecognised status (${statusOrState})`;
}

/** Strict known-set check used by tests / badge fallbacks. */
export function isKnownStatusLabel(statusOrState: string): boolean {
  return Boolean(STATE_LABELS[statusOrState] || LEGACY_STATUS_LABELS[statusOrState]);
}

/** Short plain-English explanation */
export function statusDescription(statusOrState: string): string {
  if (STATE_DESCRIPTIONS[statusOrState]) return STATE_DESCRIPTIONS[statusOrState];
  const descriptions: Record<string, string> = {
    matched: "A trading partner has been matched. Review and confirm your intent to proceed.",
    settled: "Intent has been confirmed and recorded. An evidence record has been created.",
    confirmed: "Intent has been confirmed and recorded. An evidence record has been created.",
    disputed: "A dispute has been raised on this match. Settlement is paused until resolved.",
    cancelled: "This match has been cancelled and cannot be modified.",
  };
  return descriptions[statusOrState] ?? "";
}

/** Get the step index (0-based) for the simplified 3-step visual stepper */
export function getStateIndex(state: string): number {
  // Map all internal states to the 3-step visual: 0=Discovery, 1=POI Generated, 2=Completed
  if (state === "discovery") return 0;
  if (state === "completed") return 2;
  // intent_declared, counterparty_sighted, committed all map to step 1 (POI Generated)
  return 1;
}
