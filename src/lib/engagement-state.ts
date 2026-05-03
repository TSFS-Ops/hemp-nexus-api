/**
 * Canonical engagement-status state set for `poi_engagements`.
 *
 * Background: the database historically used the literal `'pending'` for
 * pre-acceptance engagements, but the live status set has since pivoted to
 * `notification_sent` (internal admin alert dispatched, awaiting outreach)
 * and `contacted` (outreach sent to counterparty, awaiting response). As of
 * 2026-05-03 the live `poi_engagements` table contains zero rows with
 * `engagement_status = 'pending'`; any UI branch that keys solely off
 * `'pending'` is dead code and produces empty admin views.
 *
 * Defect: D-05 (Pending Engagements enum drift) — Fix-First Remediation Plan.
 *
 * Rules for use:
 *   • All admin filters/counters/badges/empty-states for "needs admin action"
 *     MUST consume `ENGAGEMENT_PENDING_STATES` rather than hard-coding
 *     `'pending'` or any subset.
 *   • `'pending'` is retained in `LEGACY_PENDING_STATE` only so historical
 *     rows (should any exist) and the wider type union remain handled
 *     defensively. Do NOT add it back to canonical filter logic.
 *   • Terminal states are non-actionable for outreach.
 *
 * If the canonical set changes, update this constant and the associated
 * regression test (`src/tests/admin/engagement-enum-parity.test.ts`).
 */

export const ENGAGEMENT_PENDING_STATES = [
  "notification_sent",
  "contacted",
] as const;

export const ENGAGEMENT_TERMINAL_STATES = [
  "accepted",
  "declined",
  "expired",
] as const;

/**
 * Legacy-only. Kept for type compatibility with rows that may still carry
 * `'pending'` after historical migrations. New code MUST NOT branch on this
 * literal — use `isEngagementPending()` instead so legacy rows are still
 * surfaced in pending views without polluting the canonical set.
 */
export const LEGACY_PENDING_STATE = "pending" as const;

export type EngagementPendingState = (typeof ENGAGEMENT_PENDING_STATES)[number];
export type EngagementTerminalState = (typeof ENGAGEMENT_TERMINAL_STATES)[number];
export type EngagementStatus =
  | EngagementPendingState
  | EngagementTerminalState
  | typeof LEGACY_PENDING_STATE;

/**
 * Returns true for every engagement that needs admin attention pre-acceptance.
 * Includes the legacy `'pending'` literal defensively so a historical row
 * with that value is never silently hidden from operators.
 */
export function isEngagementPending(status: string | null | undefined): boolean {
  if (!status) return false;
  if (status === LEGACY_PENDING_STATE) return true;
  return (ENGAGEMENT_PENDING_STATES as readonly string[]).includes(status);
}

export function isEngagementTerminal(status: string | null | undefined): boolean {
  if (!status) return false;
  return (ENGAGEMENT_TERMINAL_STATES as readonly string[]).includes(status);
}
