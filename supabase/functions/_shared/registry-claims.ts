/**
 * Batch 3 — M002 / M003 / M004 SSOT (Deno mirror).
 * Pinned to src/lib/registry-claims.ts by scripts/check-registry-claim-state-parity.mjs
 * and scripts/check-registry-search-labels-parity.mjs.
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

export const REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_COPY =
  "Approving this claim confirms only that the claim record has passed review. It does not verify authority-to-act, company profile accuracy or bank details.";

export function isTerminalClaimState(state: RegistryClaimState): boolean {
  return REGISTRY_CLAIM_TERMINAL_STATES.includes(state);
}
