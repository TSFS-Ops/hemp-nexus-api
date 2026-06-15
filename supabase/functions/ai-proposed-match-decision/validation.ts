/**
 * Pure validation + payload-shape helpers for ai-proposed-match-decision.
 *
 * Extracted from index.ts so we can unit-test the Phase 3 server branches
 * (approve_for_client_view, edit_payload, set_feedback_reason, escalate)
 * without standing up the full Supabase stack.
 *
 * Runtime behaviour MUST mirror index.ts exactly; index.ts re-imports from here.
 */

export const ACTIONS = [
  "approve",
  "reject",
  "archive",
  "escalate",
  "needs_more_research",
  "under_review",
  "assign",
  "reviewer_note",
  "confidence_override",
  "set_due_date",
  "mark_duplicate",
  "mark_not_relevant",
  "set_feedback_reason",
  "request_rerun",
  "approve_for_client_view",
  "approve_for_outreach",
  "edit_payload",
] as const;
export type Action = (typeof ACTIONS)[number];

export const TERMINAL = new Set([
  "approved",
  "approved_internal",
  "approved_client_view",
  "rejected",
  "archived",
  "expired",
  "closed",
]);

export const CONFIDENCE = new Set(["low", "medium", "high"]);
export const ESCALATION_TARGETS = new Set(["verification", "wad", "kyb", "compliance"]);
export const FEEDBACK_REASONS = new Set([
  "wrong_company", "wrong_country", "wrong_product", "wrong_counterparty_role",
  "weak_source", "bad_contact", "dead_email", "duplicate",
  "possible_compliance_concern", "poor_outreach_draft",
  "not_commercially_relevant", "insufficient_evidence", "other",
]);

export const APPROVED_PRIOR_STATUSES = new Set([
  "approved",
  "approved_internal",
  "approved_client_view",
]);

export function isValidFeedbackReason(v: unknown): v is string {
  return typeof v === "string" && FEEDBACK_REASONS.has(v);
}

export function isValidEscalationTarget(v: unknown): v is string {
  return typeof v === "string" && ESCALATION_TARGETS.has(v);
}

export function canApproveForClientView(rowStatus: string): boolean {
  return APPROVED_PRIOR_STATUSES.has(rowStatus);
}

export function canApproveForOutreach(rowStatus: string): boolean {
  return APPROVED_PRIOR_STATUSES.has(rowStatus);
}

type Row = Record<string, unknown> & {
  suggested_counterparty_name?: unknown;
  counterparty_role?: unknown;
  jurisdiction?: unknown;
  sector_or_product_fit?: unknown;
  capacity_indicator?: unknown;
  prior_activity_summary?: unknown;
  source_summary?: unknown;
  match_rationale?: unknown;
  fit_label?: unknown;
  confidence_level?: unknown;
  confidence_override?: unknown;
  original_payload?: unknown;
};

export function buildApprovedPayload(row: Row, now: string, userId: string | null) {
  return {
    suggested_counterparty_name: row.suggested_counterparty_name,
    counterparty_role: row.counterparty_role,
    jurisdiction: row.jurisdiction,
    sector_or_product_fit: row.sector_or_product_fit,
    capacity_indicator: row.capacity_indicator,
    prior_activity_summary: row.prior_activity_summary,
    source_summary: row.source_summary,
    match_rationale: row.match_rationale,
    fit_label: row.fit_label,
    confidence_level: row.confidence_override ?? row.confidence_level,
    approved_at: now,
    approved_by: userId,
  };
}

export function buildOriginalPayloadSnapshot(row: Row, now: string) {
  return {
    suggested_counterparty_name: row.suggested_counterparty_name,
    counterparty_role: row.counterparty_role,
    jurisdiction: row.jurisdiction,
    sector_or_product_fit: row.sector_or_product_fit,
    capacity_indicator: row.capacity_indicator,
    prior_activity_summary: row.prior_activity_summary,
    source_summary: row.source_summary,
    match_rationale: row.match_rationale,
    fit_label: row.fit_label,
    confidence_level: row.confidence_level,
    snapshot_at: now,
  };
}

/**
 * Returns true iff the row has not yet had its original_payload captured.
 * Used by edit_payload to enforce "snapshot exactly once".
 */
export function shouldSnapshotOriginal(row: Row): boolean {
  return !row.original_payload;
}
