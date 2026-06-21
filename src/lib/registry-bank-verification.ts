/**
 * Batch 14 — Bank Detail Verification Decision Layer (browser SSOT).
 *
 * Mirror: supabase/functions/_shared/registry-bank-verification.ts
 * Pinned by scripts/check-registry-bank-verification-parity.mjs.
 *
 * IMPORTANT GUARANTEES (codified for guards & tests):
 *  - Manual verification is DISABLED by default.
 *  - `captured_unverified` is NOT verified.
 *  - `manual_verified` and `provider_matched` do NOT return API "verified"
 *    unless promoted through the decision gate.
 *  - Only `verified` (final, unexpired, non-disputed/revoked) returns API
 *    verified.
 *  - No raw bank details are ever exposed in any verification response.
 *  - No live provider integration is wired in Batch 14.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Verification modes
// ─────────────────────────────────────────────────────────────────────────────
export const REGISTRY_BANK_VERIFICATION_MODES = [
  "not_available",
  "manual_review_only",
  "manual_verification_allowed",
  "provider_pending",
  "provider_sandbox",
  "provider_live",
  "verification_disabled",
] as const;
export type RegistryBankVerificationMode =
  (typeof REGISTRY_BANK_VERIFICATION_MODES)[number];

export const REGISTRY_BANK_VERIFICATION_DEFAULT_MODE: RegistryBankVerificationMode =
  "not_available";

/** Manual verification is disabled by default. */
export const REGISTRY_BANK_MANUAL_VERIFICATION_DISABLED_BY_DEFAULT = true;

// ─────────────────────────────────────────────────────────────────────────────
// 2. Verification statuses
// ─────────────────────────────────────────────────────────────────────────────
export const REGISTRY_BANK_VERIFICATION_STATUSES = [
  "not_started",
  "not_available",
  "captured_unverified",
  "verification_requested",
  "manual_review_required",
  "provider_pending",
  "provider_check_in_progress",
  "provider_matched",
  "provider_mismatch",
  "provider_error",
  "provider_unavailable",
  "manual_verified",
  "verified",
  "failed",
  "expired",
  "revoked",
  "disputed",
  "cancelled",
] as const;
export type RegistryBankVerificationStatus =
  (typeof REGISTRY_BANK_VERIFICATION_STATUSES)[number];

/** The ONLY status that returns API "verified". */
export const REGISTRY_BANK_VERIFICATION_FINAL_VERIFIED: RegistryBankVerificationStatus =
  "verified";

/** Statuses that MUST be treated as NOT verified by every consumer. */
export const REGISTRY_BANK_VERIFICATION_NOT_VERIFIED_STATUSES: RegistryBankVerificationStatus[] = [
  "not_started",
  "not_available",
  "captured_unverified",
  "verification_requested",
  "manual_review_required",
  "provider_pending",
  "provider_check_in_progress",
  "provider_matched", // NOT verified unless promoted
  "provider_mismatch",
  "provider_error",
  "provider_unavailable",
  "manual_verified", // NOT verified unless promoted
  "failed",
  "expired",
  "revoked",
  "disputed",
  "cancelled",
];

export function isFinalVerified(s: RegistryBankVerificationStatus): boolean {
  return s === REGISTRY_BANK_VERIFICATION_FINAL_VERIFIED;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Decision gates
// ─────────────────────────────────────────────────────────────────────────────
export const REGISTRY_BANK_VERIFICATION_DECISION_GATES = [
  "submission_is_captured_unverified",
  "company_active",
  "authority_valid_or_admin_initiated",
  "consent_includes_required_scopes",
  "evidence_accepted",
  "risk_not_blocked",
  "duplicate_resolved",
  "account_holder_match_resolved",
  "country_supports_mode",
  "source_provenance_present",
  "business_decision_approved",
  "mode_is_eligible",
  "approval_role_satisfied",
] as const;
export type RegistryBankVerificationDecisionGate =
  (typeof REGISTRY_BANK_VERIFICATION_DECISION_GATES)[number];

/** Modes that are NOT eligible to reach `verified`. */
export const REGISTRY_BANK_VERIFICATION_MODES_INELIGIBLE_FOR_VERIFIED: RegistryBankVerificationMode[] = [
  "not_available",
  "manual_review_only",
  "provider_pending",
  "verification_disabled",
];

// ─────────────────────────────────────────────────────────────────────────────
// 4. Provider readiness
// ─────────────────────────────────────────────────────────────────────────────
export const REGISTRY_BANK_PROVIDER_CREDENTIAL_STATES = [
  "absent",
  "configured_sandbox",
  "configured_production",
  "revoked",
] as const;
export type RegistryBankProviderCredentialState =
  (typeof REGISTRY_BANK_PROVIDER_CREDENTIAL_STATES)[number];

export const REGISTRY_BANK_PROVIDER_RESULT_OUTCOMES = [
  "matched",
  "mismatch",
  "error",
  "unavailable",
  "timeout",
] as const;
export type RegistryBankProviderResultOutcome =
  (typeof REGISTRY_BANK_PROVIDER_RESULT_OUTCOMES)[number];

/** Mapping from provider outcome → verification status. NEVER returns `verified`. */
export const REGISTRY_BANK_PROVIDER_OUTCOME_TO_STATUS: Record<
  RegistryBankProviderResultOutcome,
  RegistryBankVerificationStatus
> = {
  matched: "provider_matched",
  mismatch: "provider_mismatch",
  error: "provider_error",
  unavailable: "provider_unavailable",
  timeout: "provider_error",
};

export const REGISTRY_BANK_PROVIDER_TEST_MODE_LABEL =
  "Provider simulation only. This does not verify bank details.";

// ─────────────────────────────────────────────────────────────────────────────
// 5. Manual verification
// ─────────────────────────────────────────────────────────────────────────────
export const REGISTRY_BANK_MANUAL_VERIFICATION_ACK_TEXT =
  "I understand that this manual decision marks the bank-detail status according to Izenzo's approved manual verification process. It is not a provider-confirmed bank verification unless the verification method says provider verified.";

export const REGISTRY_BANK_MANUAL_VERIFICATION_REQUIRED_ROLES = [
  "compliance_owner",
] as const;

export const REGISTRY_BANK_MANUAL_VERIFICATION_REQUIRED_FIELDS = [
  "acknowledgement_text",
  "verification_method",
  "verification_basis",
  "evidence_basis",
  "expires_at",
  "reason",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 6. Expiry defaults (days)
// ─────────────────────────────────────────────────────────────────────────────
export const REGISTRY_BANK_VERIFICATION_EXPIRY_DAYS = {
  provider_verified: 90,
  manual_verified: 30,
  high_risk_manual_verified: 14,
  provider_sandbox: 0, // never production-valid
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 7. API payment-status mapping (the canonical truth for /payment-status)
// ─────────────────────────────────────────────────────────────────────────────
export type RegistryBankApiPaymentFlag =
  | "verified"
  | "not_verified"
  | "expired"
  | "disputed"
  | "revoked"
  | "not_available";

export function mapVerificationStatusToApiFlag(
  s: RegistryBankVerificationStatus,
): RegistryBankApiPaymentFlag {
  switch (s) {
    case "verified":
      return "verified";
    case "expired":
      return "expired";
    case "disputed":
      return "disputed";
    case "revoked":
      return "revoked";
    case "not_started":
    case "not_available":
      return "not_available";
    default:
      // captured_unverified, verification_requested, manual_review_required,
      // provider_pending, provider_check_in_progress, provider_matched,
      // provider_mismatch, provider_error, provider_unavailable,
      // manual_verified, failed, cancelled
      return "not_verified";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Public / claimant safe labels
// ─────────────────────────────────────────────────────────────────────────────
export const REGISTRY_BANK_VERIFICATION_PUBLIC_LABELS: Record<
  RegistryBankVerificationStatus,
  string
> = {
  not_started: "No bank details available",
  not_available: "No bank details available",
  captured_unverified: "Bank details captured but not verified",
  verification_requested: "Verification requested",
  manual_review_required: "Verification in progress",
  provider_pending: "Verification unavailable",
  provider_check_in_progress: "Verification in progress",
  provider_matched: "Verification in progress",
  provider_mismatch: "Verification failed",
  provider_error: "Verification unavailable",
  provider_unavailable: "Verification unavailable",
  manual_verified: "Manually verified under Izenzo review process",
  verified: "Verified",
  failed: "Verification failed",
  expired: "Verification expired",
  revoked: "Bank details revoked",
  disputed: "Bank details disputed",
  cancelled: "Verification cancelled",
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. Audit events
// ─────────────────────────────────────────────────────────────────────────────
export const REGISTRY_BANK_VERIFICATION_AUDIT_EVENT_NAMES = [
  "registry_bank_verification_requested",
  "registry_bank_verification_request_blocked",
  "registry_bank_verification_manual_review_started",
  "registry_bank_verification_manual_decision_recorded",
  "registry_bank_verification_manual_verified",
  "registry_bank_verification_manual_failed",
  "registry_bank_verification_provider_config_created",
  "registry_bank_verification_provider_config_updated",
  "registry_bank_verification_provider_simulated",
  "registry_bank_verification_provider_result_recorded",
  "registry_bank_verification_promoted_to_verified",
  "registry_bank_verification_promotion_blocked",
  "registry_bank_verification_expired",
  "registry_bank_verification_reverification_requested",
  "registry_bank_verification_disputed",
  "registry_bank_verification_revoked",
  "registry_bank_verification_cancelled",
  "registry_bank_verification_api_status_checked",
  "registry_bank_verification_note_added",
] as const;
export type RegistryBankVerificationAuditEventName =
  (typeof REGISTRY_BANK_VERIFICATION_AUDIT_EVENT_NAMES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// 10. Forbidden wording (must NOT appear anywhere in API/UI verification copy)
// ─────────────────────────────────────────────────────────────────────────────
export const REGISTRY_BANK_VERIFICATION_FORBIDDEN_WORDING = [
  // "production verified by provider" type claims
  "provider verified by izenzo automatically",
  "auto-verified",
  "auto verified",
  "live provider check completed",
] as const;
