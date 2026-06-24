/**
 * P-5 Batch 3 — Stage 1 SSOT constants.
 *
 * Mirrors the Postgres enums declared in the Batch 3 Stage 1 migration.
 * The drift guard (src/tests/p5-batch3-stage1-enum-drift.test.ts) fails
 * the build if any value drifts between this file and the SQL enum body.
 *
 * Stage 1 scope: pure value declarations. No DB writes, no UI, no RPCs.
 */

export const P5B3_FUNDER_ROLES = [
  "funder_viewer",
  "funder_reviewer",
  "funder_approver",
  "funder_org_admin",
  "external_adviser",
] as const;
export type P5B3FunderRole = (typeof P5B3_FUNDER_ROLES)[number];

export const P5B3_FUNDER_ORG_STATUSES = ["active", "suspended", "closed"] as const;
export type P5B3FunderOrgStatus = (typeof P5B3_FUNDER_ORG_STATUSES)[number];

export const P5B3_FUNDER_USER_STATUSES = ["invited", "active", "deactivated"] as const;
export type P5B3FunderUserStatus = (typeof P5B3_FUNDER_USER_STATUSES)[number];

export const P5B3_ACCESS_GRANT_STATUSES = ["active", "revoked", "expired"] as const;
export type P5B3AccessGrantStatus = (typeof P5B3_ACCESS_GRANT_STATUSES)[number];

export const P5B3_FUNDER_STATUSES = [
  "awaiting_review",
  "in_progress",
  "interested",
  "declined",
  "credit_review_pending",
  "conditional_support",
  "term_sheet_requested",
  "term_sheet_provided",
  "funding_decision_submitted",
  "exited",
] as const;
export type P5B3FunderStatus = (typeof P5B3_FUNDER_STATUSES)[number];

export const P5B3_REQUEST_STATUSES = [
  "draft",
  "submitted",
  "admin_review",
  "approved_to_company",
  "assigned",
  "response_pending",
  "answered",
  "follow_up_requested",
  "rejected",
  "closed",
  "withdrawn",
] as const;
export type P5B3RequestStatus = (typeof P5B3_REQUEST_STATUSES)[number];

export const P5B3_REQUEST_CATEGORIES = [
  "commercial",
  "financial",
  "legal",
  "technical",
  "esg_impact",
  "kyc_kyb",
  "evidence",
  "governance_compliance",
  "project_readiness",
  "transaction_terms",
  "security_collateral",
  "other",
] as const;
export type P5B3RequestCategory = (typeof P5B3_REQUEST_CATEGORIES)[number];

export const P5B3_OUTCOME_TYPES = [
  "interested",
  "not_interested",
  "credit_review_pending",
  "conditional_support",
  "term_sheet_requested",
  "term_sheet_provided",
  "funding_approved_subject_to_admin",
  "declined",
] as const;
export type P5B3OutcomeType = (typeof P5B3_OUTCOME_TYPES)[number];

export const P5B3_EXIT_REASONS = [
  "funder_declined",
  "funder_completed_review",
  "transaction_closed",
  "funding_completed",
  "access_expired",
  "admin_revoked",
  "policy_concern",
  "duplicate_access",
  "no_response",
  "funder_withdrawn",
] as const;
export type P5B3ExitReason = (typeof P5B3_EXIT_REASONS)[number];

/** Canonical list of every Batch 3 table — used by isolation guards. */
export const P5B3_TABLES = [
  "p5_batch3_funder_organisations",
  "p5_batch3_funder_users",
  "p5_batch3_funder_access_grants",
  "p5_batch3_funder_requests",
  "p5_batch3_funder_outcomes",
  "p5_batch3_funder_audit_events",
  "p5_batch3_funder_downloads",
] as const;

/** Canonical list of every Batch 3 SECURITY DEFINER helper. */
export const P5B3_SECURITY_DEFINER_FUNCTIONS = [
  "p5b3_is_platform_admin",
  "p5b3_current_funder_org",
  "p5b3_has_active_grant",
] as const;
