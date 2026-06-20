/**
 * Batch 4 — M005 Authority-to-Act SSOT (Deno mirror).
 * Mirror of src/lib/registry-authority.ts. Do not drift.
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

export const REGISTRY_AUTHORITY_APPROVAL_NON_VERIFICATION_COPY =
  "Approving authority confirms only that this person may act for the company within the recorded scope. It does not verify the company profile or any bank details.";

export function isAuthorityApproved(s: RegistryAuthorityState): boolean {
  return REGISTRY_AUTHORITY_APPROVED_STATES.includes(s);
}
