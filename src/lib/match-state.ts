/**
 * Match State Machine — Single Source of Truth
 *
 * Defines all match statuses, valid transitions, and UI action guards.
 * Components MUST use these guards instead of inline `match.status === "settled"` checks.
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

export function canDo(status: string, action: MatchAction): boolean {
  const allowed = ALLOWED_ACTIONS[status as MatchStatusValue];
  if (!allowed) return false;
  return allowed.includes(action);
}

export function getAllowedActions(status: string): readonly MatchAction[] {
  return ALLOWED_ACTIONS[status as MatchStatusValue] ?? [];
}

export function isTerminal(status: string): boolean {
  return status === "cancelled";
}

export function isSettled(status: string): boolean {
  return status === MATCH_STATUS.SETTLED;
}

/**
 * Human-readable label for a match status.
 * Uses plain English — no internal jargon.
 */
export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    matched: "Awaiting Confirmation",
    settled: "Intent Confirmed",
    confirmed: "Intent Confirmed",
    disputed: "Dispute Raised",
    cancelled: "Cancelled",
  };
  return labels[status] ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Short plain-English explanation of what a status means.
 */
export function statusDescription(status: string): string {
  const descriptions: Record<string, string> = {
    matched: "A counterparty has been matched. Review and confirm your intent to proceed.",
    settled: "Intent has been confirmed and recorded. An evidence record has been created.",
    confirmed: "Intent has been confirmed and recorded. An evidence record has been created.",
    disputed: "A dispute has been raised on this match. Settlement is paused until resolved.",
    cancelled: "This match has been cancelled and cannot be modified.",
  };
  return descriptions[status] ?? "";
}
