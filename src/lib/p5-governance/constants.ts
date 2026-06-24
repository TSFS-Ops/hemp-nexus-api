/**
 * P-5 Batch 1 — Governance, Compliance & Readiness SSOT.
 *
 * Single source of truth for status names, reason codes, provider statuses,
 * and forbidden customer/funder/API wording. The database enums in
 * `supabase/migrations/*p5_batch1*` are the authoritative server-side copy;
 * the `p5-batch1-enum-drift.test.ts` guard fails the build if they ever
 * fall out of sync with the constants in this file.
 *
 * Stage 1 deliverable. Do not import this module from customer-safe surfaces
 * without also using {@link assertCustomerSafeWording} (added in Stage 2).
 */

export const P5_STATUSES = [
  "not_started",
  "incomplete",
  "submitted",
  "under_review",
  "more_information_required",
  "internally_ready",
  "provider_dependent",
  "conditional_ready",
  "ready_to_proceed",
  "on_hold",
  "blocked",
  "escalated",
  "rejected",
  "waived",
  "override_approved",
  "reopened",
  "archived_superseded",
] as const;

export type P5Status = (typeof P5_STATUSES)[number];

export const P5_STATUS_LABELS: Record<P5Status, string> = {
  not_started: "Not Started",
  incomplete: "Incomplete",
  submitted: "Submitted",
  under_review: "Under Review",
  more_information_required: "More Information Required",
  internally_ready: "Internally Ready",
  provider_dependent: "Provider-Dependent",
  conditional_ready: "Conditional Ready",
  ready_to_proceed: "Ready to Proceed",
  on_hold: "On Hold",
  blocked: "Blocked",
  escalated: "Escalated",
  rejected: "Rejected",
  waived: "Waived",
  override_approved: "Override Approved",
  reopened: "Reopened",
  archived_superseded: "Archived/Superseded",
};

export const P5_PROVIDER_STATUSES = [
  "not_live",
  "credentials_pending",
  "pending",
  "timeout",
  "inconclusive",
  "failed",
  "passed",
  "not_applicable",
] as const;
export type P5ProviderStatus = (typeof P5_PROVIDER_STATUSES)[number];

export const P5_RULE_SEVERITIES = ["hard_blocker", "warning"] as const;
export type P5RuleSeverity = (typeof P5_RULE_SEVERITIES)[number];

export const P5_ACTOR_TYPES = ["user", "system", "api", "provider"] as const;
export type P5ActorType = (typeof P5_ACTOR_TYPES)[number];

export const P5_REASON_CODES = [
  "missing_evidence",
  "incomplete_evidence",
  "illegible_evidence",
  "wrong_document",
  "expired_evidence",
  "evidence_expiring_soon",
  "does_not_match_entity",
  "does_not_match_director_ubo",
  "does_not_match_transaction_project",
  "missing_signature",
  "missing_authority_to_act",
  "missing_mandate",
  "missing_consent",
  "terms_nda_not_accepted",
  "manual_review_required",
  "approved_by_reviewer",
  "approved_by_admin",
  "rejected_by_reviewer",
  "compliance_hold_applied",
  "compliance_hold_released",
  "governance_hold_applied",
  "provider_not_live",
  "provider_credentials_pending",
  "provider_pending",
  "provider_timeout",
  "provider_inconclusive",
  "provider_failed",
  "provider_result_received",
  "provider_result_conflict",
  "risk_flag",
  "high_risk_escalation",
  "sanctions_pep_adverse_result_review",
  "identity_verification_issue",
  "company_verification_issue",
  "bank_detail_verification_issue",
  "payment_confirmation_issue",
  "amount_currency_mismatch",
  "duplicate_notification",
  "refund_finality_pending",
  "audit_trail_issue",
  "tamper_evidence_issue",
  "data_mismatch",
  "counterparty_changed",
  "project_scope_changed",
  "waiver_granted",
  "override_approved",
  "overdue_sla",
  "disputed_decision",
  "archived_superseded",
] as const;
export type P5ReasonCode = (typeof P5_REASON_CODES)[number];

/** Actions that require a reason code plus a free-text note. */
export const P5_ACTIONS_REQUIRING_REASON = [
  "reject",
  "apply_hold",
  "release_hold",
  "waive",
  "override",
  "escalate",
  "request_more_information",
] as const;
export type P5ActionRequiringReason = (typeof P5_ACTIONS_REQUIRING_REASON)[number];

/** The seven new P-5 roles added to the `app_role` enum in Stage 1. */
export const P5_NEW_ROLES = [
  "executive_approver",
  "governance_reviewer",
  "operator_case_manager",
  "developer_technical_admin",
  "customer_entity_owner",
  "funder_external_reviewer",
  "auditor_read_only",
] as const;
export type P5NewRole = (typeof P5_NEW_ROLES)[number];

/**
 * Forbidden wording for customer / funder / API output unless a real provider
 * result, evidence pack and required human approval explicitly support the
 * claim. Enforced by `assertCustomerSafeWording` (Stage 2).
 *
 * Case-insensitive substring match.
 */
export const P5_FORBIDDEN_WORDS = [
  "Verified",
  "Certified",
  "Compliant",
  "Sanctions Cleared",
  "PEP Clear",
  "AML Cleared",
  "KYC Complete",
  "Bankable",
  "Guaranteed Bankable",
  "Guaranteed",
  "Risk-free",
  "No risk",
  "Approved by bank",
  "Approved by funder",
  "Legally valid",
  "Audit-proof",
  "Final settlement",
  "Payment confirmed",
  "Refund complete",
  "Without a Doubt",
  "WaD finality",
] as const;

/** Allowed wording for customer / funder / API output. */
export const P5_ALLOWED_WORDS = [
  "Internally Ready",
  "Ready to Proceed",
  "Conditional Ready",
  "Provider-Dependent",
  "External confirmation pending",
  "Provider not live",
  "Credentials pending",
  "Under Review",
  "More Information Required",
  "On Hold",
  "Blocked",
  "Escalated",
  "Evidence received",
  "Evidence approved internally",
  "Manual review required",
  "Consent required",
  "Authority required",
  "Approved evidence pack",
  "Audit reference available",
  "Evidence-rated readiness",
] as const;
