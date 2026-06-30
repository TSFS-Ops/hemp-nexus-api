/**
 * C8 — Client-facing status label SSOT.
 *
 * Frontend-only display maps so registry / claim / evidence surfaces never
 * render raw snake_case enum values to end users. Backend payloads and
 * field names are NOT changed by this file; it is presentation-only.
 *
 * Safety rules:
 *  - Never imply formal verification where the workflow only confirms a
 *    claim-side review has passed.
 *  - Never expose internal enum formatting (underscores, prefixes) to
 *    users. Unknown values fall back via `humanizeStatus` to a neutral
 *    title-cased label.
 *  - Do not use the words "verified" / "live" / "guaranteed" /
 *    "production-ready" in registry-surface render paths (see
 *    scripts/check-registry-readiness-forbidden-words.mjs). The labels
 *    here are imported into those surfaces.
 */

/** Title-case fallback for an unmapped status. Never returns snake_case. */
export function humanizeStatus(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "Status pending";
  const cleaned = raw.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "Status pending";
  return cleaned
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Claim workflow status (registry_company_claims.workflow_status)
// Source enum: REGISTRY_CLAIM_WORKFLOW_STATUSES in
// src/lib/registry-claim-workflow.ts. Labels here are deliberately weaker
// than "verified" — claim approval only confirms the claimant connection
// has passed review.
// ---------------------------------------------------------------------------
export const CLAIM_WORKFLOW_STATUS_DISPLAY_LABEL: Record<string, string> = {
  claim_interest_started: "Interest registered",
  account_required: "Account required",
  email_verification_required: "Email confirmation required",
  email_verified: "Email confirmed",
  claim_started: "Claim started",
  draft: "Draft",
  evidence_required: "More evidence needed",
  claim_submitted: "Submitted",
  under_review: "Under review",
  more_evidence_requested: "More evidence requested",
  evidence_resubmitted: "Evidence resubmitted",
  approved: "Claim reviewed",
  rejected: "Not approved",
  expired: "Expired",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
  claim_conflict_detected: "Conflict detected",
  claim_conflict_locked: "Conflict locked",
  escalated: "Escalated",
};

export function formatClaimWorkflowStatus(value: string | null | undefined): string {
  if (!value) return "Status pending";
  return CLAIM_WORKFLOW_STATUS_DISPLAY_LABEL[value] ?? humanizeStatus(value);
}

// ---------------------------------------------------------------------------
// Evidence state (registry_company_claim_evidence.evidence_state)
// Source enum: REGISTRY_EVIDENCE_STATES in src/lib/registry-claim-workflow.ts
// "accepted" is rendered as the gentle "Accepted" — never as "Approved" or
// "Verified" because evidence acceptance does not confirm anything about
// the underlying company.
// ---------------------------------------------------------------------------
export const EVIDENCE_STATE_DISPLAY_LABEL: Record<string, string> = {
  uploaded: "Uploaded",
  metadata_only: "Metadata only",
  pending_review: "Under review",
  accepted: "Accepted",
  rejected: "Not accepted",
  expired: "Expired",
  superseded: "Superseded",
  withdrawn: "Withdrawn",
  // Defensive aliases occasionally seen in legacy rows
  submitted: "Submitted",
  approved: "Accepted",
  pending: "Under review",
};

export function formatEvidenceState(value: string | null | undefined): string {
  if (!value) return "Submitted";
  return EVIDENCE_STATE_DISPLAY_LABEL[value] ?? humanizeStatus(value);
}

// ---------------------------------------------------------------------------
// Record readiness / lifecycle (registry_company_records.readiness_state)
// Source enum: REGISTRY_RECORD_LIFECYCLE_STATES in
// supabase/functions/_shared/registry-record-lifecycle.ts (plus the legacy
// readiness values such as `imported_unverified`).
// Labels intentionally hedged — none of these is a verification badge.
// ---------------------------------------------------------------------------
export const READINESS_LABEL_DISPLAY: Record<string, string> = {
  imported_unverified: "Imported, not independently confirmed",
  import_review_required: "Import review required",
  import_review_in_progress: "Import review in progress",
  claim_not_available: "Claim not available",
  claim_pending_business_decision: "Claim pending decision",
  claim_enabled: "Claim available",
  claim_suspended: "Claim suspended",
  claim_conflict_locked: "Claim conflict locked",
  correction_under_review: "Correction under review",
  source_refresh_required: "Source refresh required",
  stale_review_required: "Stale review required",
  disabled: "Disabled",
  archived: "Archived",
  // Module-level readiness aliases (registry-readiness.ts) — render with
  // the same safe display label vocabulary used by ReadinessBadge.
  not_started: "Not started",
  shell_ready: "Shell only",
  test_data_ready: "Test data only",
  provider_pending: "Provider pending",
  data_pending: "Data pending",
  licence_pending: "Licence pending",
  admin_only: "Admin only",
  client_demo_ready: "Client demo only",
  production_ready: "Operationally ready",
};

export function formatReadinessLabel(value: string | null | undefined): string {
  if (!value) return "Status pending";
  return READINESS_LABEL_DISPLAY[value] ?? humanizeStatus(value);
}

// ---------------------------------------------------------------------------
// Claim status on the public profile (registry_company_records.claim_status)
// ---------------------------------------------------------------------------
export const CLAIM_STATUS_DISPLAY_LABEL: Record<string, string> = {
  unclaimed: "Unclaimed",
  claim_started: "Claim started",
  claim_submitted: "Claim submitted",
  evidence_required: "More evidence needed",
  evidence_submitted: "Evidence submitted",
  under_review: "Under review",
  approved: "Claim reviewed",
  rejected: "Claim not approved",
  revoked: "Claim revoked",
  expired: "Claim expired",
  cancelled: "Claim cancelled",
  one_claim_approved: "Reviewed claim on file",
  multiple_claims_approved_with_scoped_access:
    "Multiple reviewed claims on file",
  all_claims_rejected: "All claims declined",
  escalated: "Escalated",
};

export function formatClaimStatus(value: string | null | undefined): string {
  if (!value) return "Status pending";
  return CLAIM_STATUS_DISPLAY_LABEL[value] ?? humanizeStatus(value);
}

// ---------------------------------------------------------------------------
// Authority-to-act status (registry_company_records.authority_status_label)
// ---------------------------------------------------------------------------
export const AUTHORITY_STATUS_DISPLAY_LABEL: Record<string, string> = {
  authority_pending: "Authority pending",
  authority_not_requested: "Authority not requested",
  authority_in_progress: "Authority in progress",
  authority_under_review: "Authority under review",
  authority_approved: "Authority approved",
  authority_rejected: "Authority not approved",
  authority_expired: "Authority expired",
  authority_revoked: "Authority revoked",
};

export function formatAuthorityStatus(value: string | null | undefined): string {
  if (!value) return "Status pending";
  return AUTHORITY_STATUS_DISPLAY_LABEL[value] ?? humanizeStatus(value);
}

// ---------------------------------------------------------------------------
// Profile review status (registry_company_records.profile_verification_status)
// Avoid the word "verified" on non-production-ready surfaces. The display
// uses "reviewed" / "not yet reviewed" wording instead.
// ---------------------------------------------------------------------------
export const PROFILE_VERIFICATION_STATUS_DISPLAY_LABEL: Record<string, string> = {
  profile_not_verified: "Profile not independently reviewed",
  profile_verified: "Profile reviewed",
  profile_under_review: "Profile under review",
  profile_pending: "Profile review pending",
};

export function formatProfileVerificationStatus(
  value: string | null | undefined,
): string {
  if (!value) return "Status pending";
  return (
    PROFILE_VERIFICATION_STATUS_DISPLAY_LABEL[value] ?? humanizeStatus(value)
  );
}
