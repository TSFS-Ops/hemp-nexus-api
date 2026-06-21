/**
 * Batch 7 — Claim lifecycle webhook event taxonomy (SSOT).
 * Pinned to scripts/check-claim-lifecycle-webhook-parity.mjs.
 *
 * These are the ONLY claim-lifecycle event types external systems may
 * subscribe to. Adding or renaming events here MUST be accompanied by
 * a docs update and a matching DB mapping in
 * public.batch7_event_name_to_webhook_event.
 */

export const CLAIM_LIFECYCLE_WEBHOOK_EVENTS = [
  "claim.evidence_required",
  "claim.under_review",
  "claim.status_changed",
  "claim.reviewed",
  "claim.evidence_added",
  "claim.approved",
  "claim.rejected",
  "claim.conflict_created",
  "claim.conflict_resolved",
  "claim.correction_requested",
  "claim.correction_reviewed",
  "claim.new_company_requested",
  "claim.new_company_reviewed",
  "claim.outreach_blocked",
] as const;
export type ClaimLifecycleWebhookEvent =
  (typeof CLAIM_LIFECYCLE_WEBHOOK_EVENTS)[number];

export const CLAIM_LIFECYCLE_MAX_ATTEMPTS = 6;

/** Schedule: 1m, 5m, 30m, 2h, 6h, 24h. */
export function nextRetryDelaySeconds(attempt: number): number {
  const ladder = [60, 300, 1800, 7200, 21600, 86400];
  return ladder[Math.min(attempt, ladder.length - 1)];
}
