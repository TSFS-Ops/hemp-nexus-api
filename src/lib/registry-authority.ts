/**
 * Batch 4 — M005 Authority-to-Act SSOT (browser mirror).
 *
 * Mirror: supabase/functions/_shared/registry-authority.ts
 * Pinned by:
 *   - scripts/check-registry-authority-state-parity.mjs
 *   - scripts/check-registry-batch4-audit-names.mjs
 *   - scripts/check-registry-batch4-wording.mjs
 */

export const REGISTRY_AUTHORITY_STATES = [
  "not_started",
  "pending_evidence",
  "submitted",
  "under_review",
  "conditionally_approved",
  "approved",
  "rejected",
  "expired",
  "revoked",
  "disputed",
  "cancelled",
] as const;
export type RegistryAuthorityState = (typeof REGISTRY_AUTHORITY_STATES)[number];

export const REGISTRY_AUTHORITY_STATE_LABEL: Record<RegistryAuthorityState, string> = {
  not_started: "Not started",
  pending_evidence: "Pending evidence",
  submitted: "Submitted",
  under_review: "Under review",
  conditionally_approved: "Conditionally approved",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  revoked: "Revoked",
  disputed: "Disputed",
  cancelled: "Cancelled",
};

export const REGISTRY_AUTHORITY_APPROVED_STATES: RegistryAuthorityState[] = [
  "approved",
  "conditionally_approved",
];

export const REGISTRY_AUTHORITY_BASES = [
  "director_or_officer",
  "company_email_domain",
  "mandate_letter",
  "board_letter",
  "representative_declaration",
] as const;
export type RegistryAuthorityBasis = (typeof REGISTRY_AUTHORITY_BASES)[number];

export const REGISTRY_AUTHORITY_AUDIT_EVENT_NAMES = [
  "registry_authority_request_started",
  "registry_authority_request_submitted",
  "registry_authority_status_changed",
  "registry_authority_evidence_added",
  "registry_authority_reviewed",
  "registry_authority_revoked",
  "registry_authority_disputed",
] as const;
export type RegistryAuthorityAuditEventName =
  (typeof REGISTRY_AUTHORITY_AUDIT_EVENT_NAMES)[number];

/**
 * Mandatory non-verification copy rendered on admin approval surfaces.
 * Pinned verbatim by scripts/check-registry-batch4-wording.mjs.
 */
export const REGISTRY_AUTHORITY_APPROVAL_NON_VERIFICATION_COPY =
  "Approving authority confirms only that this person may act for the company within the recorded scope. It does not verify the company profile or any bank details.";

export function isAuthorityApproved(s: RegistryAuthorityState): boolean {
  return REGISTRY_AUTHORITY_APPROVED_STATES.includes(s);
}
