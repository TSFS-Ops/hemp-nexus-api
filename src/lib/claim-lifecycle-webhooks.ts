/**
 * Batch 7 — Claim lifecycle webhook event taxonomy (SSOT, frontend mirror).
 * Pinned to supabase/functions/_shared/claim-lifecycle-webhooks.ts by
 * scripts/check-claim-lifecycle-webhook-parity.mjs.
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
  "registry.search_performed",
  "registry.profile_viewed",
] as const;
export type ClaimLifecycleWebhookEvent =
  (typeof CLAIM_LIFECYCLE_WEBHOOK_EVENTS)[number];
