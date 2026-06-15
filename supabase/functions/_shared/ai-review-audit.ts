/**
 * AI Counterparty Intelligence & Match Review — canonical audit names.
 *
 * Single source of truth for `ai_review.*` audit action codes used by the
 * Batch 1 → Batch 5 feature set. Every edge function in the feature MUST
 * import names from this constant. The matching browser-side SSOT lives at
 * `src/lib/ai-review/audit-names.ts`. Both are pinned by
 * `scripts/check-ai-review-audit-names.mjs`.
 */
export const AI_REVIEW_AUDIT_NAMES = [
  "ai_review.trade_request_interpreted",
  "ai_review.counterparty_sourced",
  "ai_review.counterparty_ranked",
  "ai_review.proposed_match_created",
  "ai_review.proposed_match_reviewed",
  "ai_review.proposed_match_approved",
  "ai_review.proposed_match_rejected",
  "ai_review.proposed_match_archived",
  "ai_review.proposed_match_escalated",
  "ai_review.proposed_match_needs_more_research",
  "ai_review.confidence_overridden",
  "ai_review.outreach_draft_created",
  "ai_review.outreach_draft_edited",
  "ai_review.outreach_draft_approved",
  "ai_review.outreach_sent_by_human",
  "ai_review.outreach_draft_rejected",
  "ai_review.poi_intelligence_created",
  "ai_review.risk_flag_added",
  "ai_review.escalation_created",
  "ai_review.admin_override_applied",
  "ai_review.do_not_contact_rule_created",
  "ai_review.do_not_contact_rule_deactivated",
  // ── Phase 2 lifecycle additions ────────────────────────────────────
  "ai_review.auto_trigger_evaluated",
  "ai_review.usage_limit_exceeded",
  "ai_review.proposed_match_stale",
  "ai_review.proposed_match_expired",
  "ai_review.provider_failure_recorded",
  // ── Phase 3 review-queue completeness ──────────────────────────────
  "ai_review.proposed_match_approved_for_client_view",
  "ai_review.proposed_match_approved_for_outreach",
  "ai_review.proposed_match_edited",
  "ai_review.rerun_requested",
  // ── Phase 4 originator-visible summary actions ─────────────────────
  "ai_review.client_summary_flagged_incorrect",
  "ai_review.client_summary_requested_more_intel",
  "ai_review.client_summary_asked_to_proceed",
] as const;



export type AiReviewAuditName = typeof AI_REVIEW_AUDIT_NAMES[number];
