/**
 * P-5 Batch 4 — Stage 1 SSOT constants.
 *
 * Mirrors the Postgres enums declared in the Batch 4 Stage 1 migration.
 * The drift guard (src/tests/p5-batch4-stage1-enum-drift.test.ts) fails
 * the build if any value drifts between this file and the SQL enum body.
 *
 * Scope: pure value declarations. No DB writes, no UI, no RPCs.
 * Every controlled vocabulary used by Batch 4 UI / API / audit / reports
 * MUST be read from this module — never from inline string literals.
 */

export const P5B4_PROCESS_TYPES = [
  "company_onboarding",
  "transaction_case",
  "project_workstream",
  "funder_release",
] as const;
export type P5B4ProcessType = (typeof P5B4_PROCESS_TYPES)[number];

export const P5B4_EXECUTION_STATUSES = [
  "not_started",
  "opened",
  "in_progress",
  "waiting_for_evidence",
  "evidence_under_review",
  "waiting_for_internal_review",
  "provider_dependent",
  "more_information_requested",
  "blocked",
  "escalated",
  "funder_review",
  "approved_to_proceed",
  "final_approval_pending",
  "finality_recorded",
  "rejected",
  "withdrawn",
  "cancelled",
  "closed",
  "archived",
] as const;
export type P5B4ExecutionStatus = (typeof P5B4_EXECUTION_STATUSES)[number];

export const P5B4_READINESS_STATUSES = [
  "not_ready",
  "in_review",
  "internally_ready",
  "provider_dependent",
  "blocked",
  "ready_for_finality",
] as const;
export type P5B4ReadinessStatus = (typeof P5B4_READINESS_STATUSES)[number];

export const P5B4_MILESTONE_KEYS = [
  "case_opened",
  "scope_confirmed",
  "evidence_checklist_generated",
  "evidence_requested",
  "evidence_received",
  "evidence_review_complete",
  "governance_review_complete",
  "compliance_review_complete",
  "readiness_confirmed",
  "funder_release",
  "funder_review_complete",
  "execution_conditions_complete",
  "final_approval",
  "finality_recorded",
  "closed_archived",
] as const;
export type P5B4MilestoneKey = (typeof P5B4_MILESTONE_KEYS)[number];

export const P5B4_MILESTONE_STATUSES = [
  "not_started",
  "active",
  "complete",
  "waived",
  "not_applicable",
  "overdue",
  "escalated",
  "blocked",
] as const;
export type P5B4MilestoneStatus = (typeof P5B4_MILESTONE_STATUSES)[number];

export const P5B4_MANDATORY_TYPES = [
  "mandatory",
  "conditional",
  "optional",
] as const;
export type P5B4MandatoryType = (typeof P5B4_MANDATORY_TYPES)[number];

export const P5B4_EVIDENCE_STATUSES = [
  "missing",
  "requested",
  "uploaded",
  "under_review",
  "accepted",
  "rejected",
  "expired",
  "replaced",
  "waived",
  "provider_dependent",
] as const;
export type P5B4EvidenceStatus = (typeof P5B4_EVIDENCE_STATUSES)[number];

export const P5B4_EVIDENCE_TERMINAL_REVIEW_STATUSES = [
  "accepted",
  "rejected",
  "waived",
  "expired",
  "replaced",
  "provider_dependent",
] as const;
export type P5B4EvidenceTerminalReviewStatus =
  (typeof P5B4_EVIDENCE_TERMINAL_REVIEW_STATUSES)[number];

export const P5B4_BLOCKER_TYPES = ["hard", "soft_warning"] as const;
export type P5B4BlockerType = (typeof P5B4_BLOCKER_TYPES)[number];

export const P5B4_BLOCKER_STATUSES = [
  "open",
  "resolved",
  "overridden",
  "escalated",
] as const;
export type P5B4BlockerStatus = (typeof P5B4_BLOCKER_STATUSES)[number];

export const P5B4_BLOCKER_KEYS = [
  // Hard blockers
  "missing_authority_to_act",
  "missing_mandatory_kyc_kyb",
  "rejected_or_expired_mandatory_evidence",
  "unresolved_compliance_hold",
  "bank_account_holder_mismatch",
  "ubo_director_unresolved",
  "provider_failed_result",
  "provider_dependent_finality_item",
  "unauthorised_access",
  "final_approval_missing",
  // Soft warnings
  "optional_evidence_missing",
  "document_approaching_expiry",
  "name_address_variation",
  "provider_not_live_internal_review",
  "overdue_non_critical_task",
] as const;
export type P5B4BlockerKey = (typeof P5B4_BLOCKER_KEYS)[number];

export const P5B4_TASK_STATUSES = [
  "open",
  "in_progress",
  "completed",
  "cancelled",
  "escalated",
] as const;
export type P5B4TaskStatus = (typeof P5B4_TASK_STATUSES)[number];

export const P5B4_FUNDER_RELEASE_STATUSES = [
  "released",
  "viewed",
  "more_information_requested",
  "interested",
  "not_interested",
  "approved_internally",
  "declined",
  "exited",
  "revoked",
] as const;
export type P5B4FunderReleaseStatus =
  (typeof P5B4_FUNDER_RELEASE_STATUSES)[number];

export const P5B4_FINALITY_OUTCOMES = [
  "finality_recorded",
  "rejected",
  "withdrawn",
  "cancelled",
  "superseded",
  "archived",
] as const;
export type P5B4FinalityOutcome = (typeof P5B4_FINALITY_OUTCOMES)[number];

export const P5B4_RESPONSIBLE_PARTY_TYPES = [
  "platform_admin",
  "operator",
  "organisation_user",
  "counterparty",
  "funder_organisation",
  "system",
  "external_provider",
] as const;
export type P5B4ResponsiblePartyType =
  (typeof P5B4_RESPONSIBLE_PARTY_TYPES)[number];

export const P5B4_SOURCE_CHANNELS = [
  "ui",
  "api",
  "system",
  "webhook",
] as const;
export type P5B4SourceChannel = (typeof P5B4_SOURCE_CHANNELS)[number];

export const P5B4_ROLE_KEYS = [
  "platform_admin",
  "operator",
  "organisation_user",
  "counterparty",
  "funder_viewer",
  "funder_reviewer",
  "funder_approver",
  "api_user",
  "developer_system",
] as const;
export type P5B4RoleKey = (typeof P5B4_ROLE_KEYS)[number];

export const P5B4_OVERDUE_LABELS: Record<P5B4MilestoneKey, string> = {
  case_opened: "Missing Setup",
  scope_confirmed: "Scope Pending",
  evidence_checklist_generated: "Checklist Pending",
  evidence_requested: "Evidence Request Overdue",
  evidence_received: "Waiting for Evidence",
  evidence_review_complete: "Review Overdue",
  governance_review_complete: "Governance Review Overdue",
  compliance_review_complete: "Compliance Review Overdue",
  readiness_confirmed: "Readiness Pending",
  funder_release: "Release Pending",
  funder_review_complete: "Funder Review Overdue",
  execution_conditions_complete: "Execution Conditions Overdue",
  final_approval: "Final Approval Pending",
  finality_recorded: "Finality Pending",
  closed_archived: "Closure Pending",
};

/**
 * Wording the Batch 4 wording-guard forbids on provider-dependent records.
 * Re-used by the static consistency check in scripts/.
 */
export const P5B4_FORBIDDEN_PROVIDER_WORDS = [
  "verified",
  "compliant",
  "bankable",
  "live-provider verified",
  "live provider verified",
] as const;

/** Canonical list of every Batch 4 table — used by isolation guards. */
export const P5B4_TABLES = [
  "p5_batch4_execution_cases",
  "p5_batch4_execution_milestones",
  "p5_batch4_evidence_items",
  "p5_batch4_blockers",
  "p5_batch4_tasks",
  "p5_batch4_funder_releases",
  "p5_batch4_finality_records",
  "p5_batch4_audit_events",
] as const;

/** Canonical list of every Batch 4 SECURITY DEFINER helper introduced in Stage 1. */
export const P5B4_STAGE1_SECURITY_DEFINER_FUNCTIONS = [
  "p5b4_is_platform_admin",
  "p5b4_current_funder_org",
  "p5b4_set_updated_at",
  "p5b4_lock_finality",
  "p5b4_block_audit_mutation",
] as const;

/** Every controlled vocabulary, indexed by name — used by the SSOT parity check. */
export const P5B4_VOCABULARIES = {
  process_type: P5B4_PROCESS_TYPES,
  execution_status: P5B4_EXECUTION_STATUSES,
  readiness_status: P5B4_READINESS_STATUSES,
  milestone_key: P5B4_MILESTONE_KEYS,
  milestone_status: P5B4_MILESTONE_STATUSES,
  mandatory_type: P5B4_MANDATORY_TYPES,
  evidence_status: P5B4_EVIDENCE_STATUSES,
  blocker_type: P5B4_BLOCKER_TYPES,
  blocker_status: P5B4_BLOCKER_STATUSES,
  blocker_key: P5B4_BLOCKER_KEYS,
  task_status: P5B4_TASK_STATUSES,
  funder_release_status: P5B4_FUNDER_RELEASE_STATUSES,
  finality_outcome: P5B4_FINALITY_OUTCOMES,
  responsible_party_type: P5B4_RESPONSIBLE_PARTY_TYPES,
  source_channel: P5B4_SOURCE_CHANNELS,
  role_key: P5B4_ROLE_KEYS,
} as const;
