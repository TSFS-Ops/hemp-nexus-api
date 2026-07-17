/**
 * Compliance Workbench — SSOT constants derived from the approved client
 * questionnaire. UI-only; server-side enforcement lives elsewhere (Claude).
 */

export const CASE_TYPES_LAUNCH = [
  "organisation_onboarding",
  "individual_idv",
  "ubo_director",
  "sanctions",
  "evidence_remediation",
  "periodic_refresh",
  "transaction_compliance",
] as const;

export const CASE_TYPES_DEFERRED = [
  "authority_to_bind",
  "pep_adverse_media",
  "funder_required",
  "manual_override",
  "hold_release",
] as const;

export type LaunchCaseType = (typeof CASE_TYPES_LAUNCH)[number];
export type DeferredCaseType = (typeof CASE_TYPES_DEFERRED)[number];
export type CaseType = LaunchCaseType | DeferredCaseType;

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  organisation_onboarding: "Organisation Onboarding Review",
  individual_idv: "Individual / IDV Review",
  ubo_director: "UBO / Director Review",
  sanctions: "Sanctions Review",
  evidence_remediation: "Evidence Remediation",
  periodic_refresh: "Periodic Refresh",
  transaction_compliance: "Transaction Compliance Review",
  authority_to_bind: "Authority-to-Bind Review",
  pep_adverse_media: "PEP / Adverse-Media Review",
  funder_required: "Funder-Required Review",
  manual_override: "Manual Override Review",
  hold_release: "Hold-Release Review",
};

export const CASE_STATUSES = [
  "draft",
  "submitted",
  "assigned",
  "in_review",
  "awaiting_customer",
  "awaiting_provider",
  "awaiting_approval",
  "approved",
  "conditionally_approved",
  "rejected",
  "blocked",
  "suspended",
  "closed",
  "reopened",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  assigned: "Assigned",
  in_review: "In Review",
  awaiting_customer: "Awaiting Customer",
  awaiting_provider: "Awaiting Provider",
  awaiting_approval: "Awaiting Approval",
  approved: "Approved",
  conditionally_approved: "Conditionally Approved",
  rejected: "Rejected",
  blocked: "Blocked",
  suspended: "Suspended",
  closed: "Closed",
  reopened: "Reopened",
};

export const CASE_STATUS_TONE: Record<CaseStatus, "neutral" | "info" | "warn" | "success" | "danger"> = {
  draft: "neutral",
  submitted: "info",
  assigned: "info",
  in_review: "info",
  awaiting_customer: "warn",
  awaiting_provider: "warn",
  awaiting_approval: "warn",
  approved: "success",
  conditionally_approved: "success",
  rejected: "danger",
  blocked: "danger",
  suspended: "warn",
  closed: "neutral",
  reopened: "info",
};

export const RISK_BANDS = ["low", "medium", "high", "critical"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];
export const RISK_BAND_LABELS: Record<RiskBand, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};
export const RISK_BAND_TONE: Record<RiskBand, "success" | "info" | "warn" | "danger"> = {
  low: "success",
  medium: "info",
  high: "warn",
  critical: "danger",
};

export const PRIORITIES = ["normal", "high", "urgent", "immediate"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
  immediate: "Immediate",
};

export const EVIDENCE_STATES = [
  "required",
  "missing",
  "uploaded",
  "under_review",
  "accepted",
  "rejected",
  "replacement_requested",
  "expired",
  "waived",
  "superseded",
] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];
export const EVIDENCE_STATE_LABELS: Record<EvidenceState, string> = {
  required: "Required",
  missing: "Missing",
  uploaded: "Uploaded",
  under_review: "Under Review",
  accepted: "Accepted",
  rejected: "Rejected",
  replacement_requested: "Replacement Requested",
  expired: "Expired",
  waived: "Approved Exception",
  superseded: "Superseded",
};

export const PROVIDER_STATES = [
  "not_required",
  "required",
  "pending",
  "clear",
  "possible_match",
  "confirmed_match",
  "mismatch",
  "review_required",
  "provider_error",
  "expired",
  "refresh_required",
  "manually_resolved",
] as const;
export type ProviderState = (typeof PROVIDER_STATES)[number];
export const PROVIDER_STATE_LABELS: Record<ProviderState, string> = {
  not_required: "Not Required",
  required: "Required",
  pending: "Pending",
  clear: "Clear",
  possible_match: "Possible Match",
  confirmed_match: "Confirmed Match",
  mismatch: "Mismatch",
  review_required: "Review Required",
  provider_error: "Provider Error",
  expired: "Expired",
  refresh_required: "Refresh Required",
  manually_resolved: "Manually Resolved",
};

export const PROVIDER_KINDS = [
  "idv",
  "kyb",
  "sanctions",
  "pep",
  "adverse_media",
  "company_verification",
  "directors",
  "ubo",
  "authority",
  "bank_verification",
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  idv: "IDV",
  kyb: "KYB",
  sanctions: "Sanctions",
  pep: "PEP",
  adverse_media: "Adverse Media",
  company_verification: "Company Verification",
  directors: "Directors",
  ubo: "UBO",
  authority: "Authority",
  bank_verification: "Bank Verification",
};

export const HOLD_TYPES = [
  "sanctions",
  "critical_risk",
  "verification_refresh",
  "evidence_remediation",
  "provider_error",
  "legal_hold",
] as const;
export type HoldType = (typeof HOLD_TYPES)[number];
export const HOLD_TYPE_LABELS: Record<HoldType, string> = {
  sanctions: "Sanctions",
  critical_risk: "Critical Risk",
  verification_refresh: "Verification Refresh Required",
  evidence_remediation: "Evidence Remediation",
  provider_error: "Provider Error",
  legal_hold: "Legal Hold",
};

export const DECISION_OUTCOMES = [
  "approved",
  "conditionally_approved",
  "rejected",
  "blocked",
  "suspended",
  "more_information_required",
] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];
export const DECISION_OUTCOME_LABELS: Record<DecisionOutcome, string> = {
  approved: "Approved",
  conditionally_approved: "Conditionally Approved",
  rejected: "Rejected",
  blocked: "Blocked",
  suspended: "Suspended",
  more_information_required: "More Information Required",
};

export const RFI_ITEM_STATES = [
  "requested",
  "responded",
  "accepted",
  "rejected",
  "overdue",
  "extension_requested",
] as const;
export type RfiItemState = (typeof RFI_ITEM_STATES)[number];

/** Approved SLA policy — display only, matches questionnaire. */
export const SLA_POLICY = {
  rfi_response_business_days: 10,
  rfi_reminders_at_percent: [50, 80, 100] as const,
  rfi_max_standard_cycles: 3,
  rfi_final_notice_business_days: 5,
  conditional_approval_max_days: 90,
  reopen_window_days: 30,
  appeal_window_business_days: 10,
  suspension_max_days: 30,
  funder_summary_expiry_days: 30,
  evidence_max_replacement_attempts: 3,
  evidence_validity: {
    registration_months: 12,
    director_months: 12,
    ubo_months: 12,
    proof_of_address_months: 3,
    bank_confirmation_months: 3,
    idv_days: 365,
    sanctions_days: 30,
  },
} as const;

export const NOTE_TYPES = [
  "internal_analyst",
  "legal",
  "security",
  "audit_only",
  "customer_visible",
  "funder_visible",
  "decision_rationale",
  "approval_comment",
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  internal_analyst: "Internal Analyst Note",
  legal: "Legal Note",
  security: "Security Note",
  audit_only: "Audit-Only Event",
  customer_visible: "Customer-Visible Message",
  funder_visible: "Funder-Visible Summary",
  decision_rationale: "Decision Rationale",
  approval_comment: "Approval Comment",
};

export const EXPORT_AUDIENCES = ["internal", "customer", "funder"] as const;
export type ExportAudience = (typeof EXPORT_AUDIENCES)[number];
export const EXPORT_AUDIENCE_LABELS: Record<ExportAudience, string> = {
  internal: "Internal / Auditor Bundle",
  customer: "Customer Bundle",
  funder: "Funder Bundle",
};

export const COMPLIANCE_SENDER_NAME = "Izenzo Compliance";

export const REJECTION_REASONS = [
  "illegible",
  "incorrect_document_type",
  "expired",
  "does_not_match_subject",
  "insufficient_detail",
  "unverifiable_source",
  "material_conflict",
  "other",
] as const;
