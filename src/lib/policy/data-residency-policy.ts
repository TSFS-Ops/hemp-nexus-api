/**
 * DATA-009 Phase 1 - Data residency policy SSOT.
 *
 * Source of truth: signed Client-Only Decision Form, DATA-009.
 *
 * This module is the single canonical statement of Izenzo's current data
 * residency posture. Public copy, admin copy, documentation, and any
 * future workflow MUST defer to the constants exported here rather than
 * coining bespoke residency wording inline.
 *
 * PHASE 1 SCOPE (THIS MODULE):
 *   - Declare the approved default storage policy.
 *   - Declare the canonical DATA-009 audit action names so they exist as
 *     drift-protected constants even before any emit point is wired.
 *   - Provide cautious, pre-approved copy strings the UI/docs can reuse.
 *
 * PHASE 2 (NOT IMPLEMENTED HERE - DO NOT FAKE):
 *   - A `residency_review_required` state on organisations/onboarding.
 *   - An `onboarding_hold_residency_review` onboarding stage.
 *   - Approval / decline workflow surfaces (UI, RPC, edge function).
 *   - Runtime emissions of the four canonical audit names.
 *
 * Until Phase 2 is signed off, no runtime emission of these audit names
 * is wired and no automatic data migration, duplication, region split,
 * backup change, export restriction, deletion, or re-hosting occurs as
 * a result of a residency request. Any such request must be reviewed
 * separately by Izenzo before any commitment is made.
 *
 * Lines in this file intentionally include the `DATA_009_ALLOW` marker
 * so the prebuild guard recognises this module as the sanctioned home
 * for residency policy strings.
 */

// DATA_009_ALLOW - sanctioned policy SSOT
export const DATA_RESIDENCY_POLICY = {
  /** Single approved production-region storage policy currently in effect. */
  default:
    "Izenzo currently uses a single approved production-region storage policy.", // DATA_009_ALLOW
  /** Per-org / jurisdiction-specific residency is NOT automatically applied. */
  perOrgUnsupported:
    "Per-organisation EU, South Africa, country-specific, local-only, sovereign, or per-org residency is not currently supported and is not automatically applied.", // DATA_009_ALLOW
  /** Residency requirements require separate Izenzo approval. */
  requiresSeparateApproval:
    "Any residency requirement must be reviewed separately by Izenzo before any commitment is made; per-organisation residency commitments require separate Izenzo approval.", // DATA_009_ALLOW
  /** No automatic data-handling side effects from a residency request. */
  noAutomaticSideEffects:
    "No automatic data migration, duplication, region split, backup change, export restriction, deletion, or re-hosting occurs as a result of a residency request.", // DATA_009_ALLOW
} as const;

/** Pre-approved cautious wording for UI / docs reuse. */
export const DATA_RESIDENCY_APPROVED_WORDING = {
  shortPolicy: "Single approved production-region policy", // DATA_009_ALLOW
  perOrgRequiresApproval:
    "Per-organisation residency commitments require separate Izenzo approval.", // DATA_009_ALLOW
  reviewNotAutomatic:
    "Residency requirements are recorded for review, not automatically applied.", // DATA_009_ALLOW
  noCommitmentUnlessApproved:
    "No jurisdiction-specific residency commitment is made unless formally approved.", // DATA_009_ALLOW
} as const;

/**
 * DATA-009 canonical audit action names.
 *
 * Phase 1: constants exist as SSOT. NO runtime emission is wired yet.
 * Phase 2 will wire `recordResidencyRequirementDetected` /
 * `recordUnapprovedResidencyClaimBlocked` /
 * `recordResidencyExceptionApproved` /
 * `recordResidencyExceptionDeclined` to real workflow surfaces.
 */
export const DATA_RESIDENCY_REQUIREMENT_DETECTED =
  "data.residency_requirement_detected" as const;
export const DATA_UNAPPROVED_RESIDENCY_CLAIM_BLOCKED =
  "data.unapproved_residency_claim_blocked" as const;
export const DATA_RESIDENCY_EXCEPTION_APPROVED =
  "data.residency_exception_approved" as const;
export const DATA_RESIDENCY_EXCEPTION_DECLINED =
  "data.residency_exception_declined" as const;

export const DATA_RESIDENCY_AUDIT_ACTIONS = [
  DATA_RESIDENCY_REQUIREMENT_DETECTED,
  DATA_UNAPPROVED_RESIDENCY_CLAIM_BLOCKED,
  DATA_RESIDENCY_EXCEPTION_APPROVED,
  DATA_RESIDENCY_EXCEPTION_DECLINED,
] as const;

export type DataResidencyAuditAction =
  (typeof DATA_RESIDENCY_AUDIT_ACTIONS)[number];

/**
 * Phase indicator - Phase 2 wires runtime emission via SECDEF RPCs
 * `request_residency_review`, `approve_residency_review`,
 * `decline_residency_review` and the edge functions
 * `residency-review-request`, `admin-residency-review-approve`,
 * `admin-residency-review-decline`. Approval records the policy
 * exception only; no automatic data migration, region split, backup
 * change, export restriction, deletion, or re-hosting occurs.
 */
export const DATA_RESIDENCY_POLICY_PHASE = 2 as const;

/** Minimum admin reason length for approve / decline of a residency review. */
export const RESIDENCY_ADMIN_REASON_MIN_LENGTH = 20 as const;

/** Approve/decline UI warning copy - exact wording mandated by DATA-009 Phase 2. */
export const RESIDENCY_DECISION_WARNING_COPY =
  "Approval records the policy exception only. It does NOT create any technical hosting control, region migration, backup restriction, export restriction, or deletion behaviour. Any technical change requires a separate engineering decision.";

