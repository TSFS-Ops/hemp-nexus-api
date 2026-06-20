/**
 * Batch 3 — M002 / M003 / M004 SSOT (browser mirror).
 *
 * Pinned by:
 *   - scripts/check-registry-claim-state-parity.mjs    (TS ↔ Deno)
 *   - scripts/check-registry-claim-audit-names.mjs     (audit-name SSOT)
 *   - scripts/check-registry-search-labels-parity.mjs  (search label SSOT)
 *   - scripts/check-registry-claim-approval-wording.mjs (approval copy is non-verifying)
 *
 * Mirror: supabase/functions/_shared/registry-claims.ts
 */

export const REGISTRY_CLAIM_STATES = [
  "unclaimed",
  "claim_started",
  "claim_submitted",
  "evidence_required",
  "evidence_submitted",
  "under_review",
  "approved",
  "rejected",
  "revoked",
  "expired",
  "cancelled",
] as const;
export type RegistryClaimState = (typeof REGISTRY_CLAIM_STATES)[number];

export const REGISTRY_CLAIM_STATE_LABEL: Record<RegistryClaimState, string> = {
  unclaimed: "Unclaimed",
  claim_started: "Claim started",
  claim_submitted: "Claim submitted",
  evidence_required: "Evidence required",
  evidence_submitted: "Evidence submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  revoked: "Revoked",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const REGISTRY_CLAIM_TERMINAL_STATES: RegistryClaimState[] = [
  "approved",
  "rejected",
  "revoked",
  "expired",
  "cancelled",
];

export const REGISTRY_CLAIM_AUDIT_EVENT_NAMES = [
  "registry_company_search_performed",
  "registry_company_profile_viewed",
  "registry_company_claim_started",
  "registry_company_claim_submitted",
  "registry_company_claim_status_changed",
  "registry_company_claim_evidence_added",
  "registry_company_claim_reviewed",
] as const;
export type RegistryClaimAuditEventName =
  (typeof REGISTRY_CLAIM_AUDIT_EVENT_NAMES)[number];

/**
 * Public-facing labels for search & profile surfaces. Mirrors Batch 3 spec.
 * These labels are SAFE to render to anonymous users.
 */
export const REGISTRY_SEARCH_RESULT_LABELS = [
  "unclaimed",
  "claim_started",
  "claim_under_review",
  "claimed",
  "authority_pending",
  "authority_approved",
  "profile_not_verified",
  "profile_verified",
  "bank_details_not_provided",
  "bank_details_captured_unverified",
  "bank_details_verified",
  "seed_only",
  "sample_only",
  "client_demo_only",
  "disabled",
] as const;
export type RegistrySearchResultLabel =
  (typeof REGISTRY_SEARCH_RESULT_LABELS)[number];

/**
 * Mandatory non-verification approval copy. Pinned verbatim by
 * check-registry-claim-approval-wording.mjs. Do not rewrite without
 * compliance sign-off.
 */
export const REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_COPY =
  "Approving this claim confirms only that the claim record has passed review. It does not verify authority-to-act, company profile accuracy or bank details.";

export function isTerminalClaimState(state: RegistryClaimState): boolean {
  return REGISTRY_CLAIM_TERMINAL_STATES.includes(state);
}

/** Bank-detail label allow-list for public surfaces. Raw details never appear. */
export const REGISTRY_PUBLIC_BANK_DETAIL_LABELS = [
  "bank_details_not_provided",
  "bank_details_captured_unverified",
  "bank_details_verified",
] as const;
