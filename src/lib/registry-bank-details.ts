/**
 * Batch 4 — M006 / M007 Bank Detail Capture & Verified Status Model (browser mirror).
 *
 * Mirror: supabase/functions/_shared/registry-bank-details.ts
 * Pinned by:
 *   - scripts/check-registry-bank-detail-state-parity.mjs
 *   - scripts/check-registry-batch4-audit-names.mjs
 *   - scripts/check-registry-batch4-wording.mjs
 *   - scripts/check-registry-public-bank-leakage.mjs (Batch 3 - extended)
 */

export const REGISTRY_BANK_DETAIL_STATES = [
  "not_provided",
  "captured_unverified",
  "verification_pending",
  "verified",
  "failed",
  "expired",
  "revoked",
  "disputed",
  "provider_unavailable",
  "cancelled",
] as const;
export type RegistryBankDetailState = (typeof REGISTRY_BANK_DETAIL_STATES)[number];

export const REGISTRY_BANK_DETAIL_STATE_LABEL: Record<RegistryBankDetailState, string> = {
  not_provided: "Not provided",
  captured_unverified: "Captured — not verified",
  verification_pending: "Verification pending",
  verified: "Verified",
  failed: "Verification failed",
  expired: "Expired",
  revoked: "Revoked",
  disputed: "Disputed",
  provider_unavailable: "Provider unavailable",
  cancelled: "Cancelled",
};

/** The only state that may be presented as "verified". All others are NOT verified. */
export const REGISTRY_BANK_DETAIL_VERIFIED_STATE: RegistryBankDetailState = "verified";

export const REGISTRY_BANK_DETAIL_NOT_VERIFIED_STATES: RegistryBankDetailState[] = [
  "not_provided",
  "captured_unverified",
  "verification_pending",
  "failed",
  "expired",
  "revoked",
  "disputed",
  "provider_unavailable",
  "cancelled",
];

export const REGISTRY_BANK_DETAIL_CONSENT_SCOPES = [
  "internal_verification",
  "institutional_status_response",
  "named_bank_confirmation_use",
  "audit_retention",
  "re_verification",
  "dispute_handling",
] as const;
export type RegistryBankDetailConsentScope =
  (typeof REGISTRY_BANK_DETAIL_CONSENT_SCOPES)[number];

export const REGISTRY_BANK_DETAIL_AUDIT_EVENT_NAMES = [
  "registry_bank_detail_capture_started",
  "registry_bank_detail_submitted",
  "registry_bank_detail_consent_recorded",
  "registry_bank_detail_status_changed",
  "registry_bank_detail_masked_viewed",
  "registry_bank_detail_unmasked_access_requested",
  "registry_bank_detail_unmasked_viewed",
  "registry_bank_detail_revoked",
  "registry_bank_detail_disputed",
] as const;
export type RegistryBankDetailAuditEventName =
  (typeof REGISTRY_BANK_DETAIL_AUDIT_EVENT_NAMES)[number];

/**
 * Mandatory user-facing copy. Pinned verbatim by
 * scripts/check-registry-batch4-wording.mjs.
 */
export const REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY =
  "Captured bank details are not verified bank details. They must not be treated as verified unless the status is explicitly marked verified with a valid audit trail and expiry.";

export function isBankDetailVerified(s: RegistryBankDetailState): boolean {
  return s === REGISTRY_BANK_DETAIL_VERIFIED_STATE;
}

/** Mask a free-form account/IBAN-like token for safe display. Returns "•••• 1234". */
export function maskAccountToken(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = String(raw).replace(/\s+/g, "");
  if (trimmed.length <= 4) return "•••• " + trimmed;
  return "•••• " + trimmed.slice(-4);
}
