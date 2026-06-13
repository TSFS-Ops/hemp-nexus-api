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
] as const;

export type AiReviewAuditName = typeof AI_REVIEW_AUDIT_NAMES[number];
