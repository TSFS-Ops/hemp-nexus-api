/**
 * Match State Machine — Single Source of Truth
 *
 * Defines all match statuses, valid transitions, and UI action guards.
 * Components MUST use these guards instead of inline `match.status === "settled"` checks.
 *
 * The backend (edge function) remains the primary authority;
 * these guards keep the client from offering impossible actions.
 */

import { MATCH_STATUS } from "@/lib/constants";

// ─── Statuses ───────────────────────────────────────────────────────

export const MATCH_STATUSES = ["matched", "settled", "disputed", "cancelled"] as const;
export type MatchStatusValue = (typeof MATCH_STATUSES)[number];

// ─── Actions ────────────────────────────────────────────────────────

export const MATCH_ACTIONS = [
  "confirm_intent",
  "raise_dispute",
  "upload_document",
  "add_note",
  "edit_terms",
  "create_wad",
  "generate_evidence_pack",
  "select_for_bulk",
] as const;

export type MatchAction = (typeof MATCH_ACTIONS)[number];

// ─── Action guard map ───────────────────────────────────────────────

/**
 * For each status, lists the actions that are permitted.
 * Any action NOT listed is blocked in the UI.
 */
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
    "raise_dispute",
    "upload_document",
    "add_note",
    "create_wad",
    "generate_evidence_pack",
  ],
  disputed: [
    "upload_document",
    "add_note",
  ],
  cancelled: [],
};

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Check whether a specific action is allowed for a match in the given status.
 */
export function canDo(status: string, action: MatchAction): boolean {
  const allowed = ALLOWED_ACTIONS[status as MatchStatusValue];
  if (!allowed) return false;
  return allowed.includes(action);
}

/**
 * Get all actions permitted for the given status.
 */
export function getAllowedActions(status: string): readonly MatchAction[] {
  return ALLOWED_ACTIONS[status as MatchStatusValue] ?? [];
}

/**
 * Convenience: is the match in a terminal/immutable state?
 */
export function isTerminal(status: string): boolean {
  return status === "cancelled";
}

/**
 * Convenience: is the match settled (intent confirmed)?
 */
export function isSettled(status: string): boolean {
  return status === MATCH_STATUS.SETTLED;
}

/**
 * Human-readable label for a match status.
 */
export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    matched: "Matched",
    settled: "Confirmed",
    confirmed: "Confirmed",
    disputed: "Disputed",
    cancelled: "Cancelled",
  };
  return labels[status] ?? status;
}
