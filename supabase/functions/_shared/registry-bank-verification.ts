/**
 * Batch 14 — Bank Detail Verification Decision Layer (Deno mirror).
 * Mirror of src/lib/registry-bank-verification.ts. Do not drift.
 */

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

export const REGISTRY_BANK_MANUAL_VERIFICATION_DISABLED_BY_DEFAULT = true;

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

export const REGISTRY_BANK_VERIFICATION_FINAL_VERIFIED: RegistryBankVerificationStatus =
  "verified";

export const REGISTRY_BANK_VERIFICATION_NOT_VERIFIED_STATUSES: RegistryBankVerificationStatus[] = [
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
  "failed",
  "expired",
  "revoked",
  "disputed",
  "cancelled",
];

export function isFinalVerified(s: RegistryBankVerificationStatus): boolean {
  return s === REGISTRY_BANK_VERIFICATION_FINAL_VERIFIED;
}

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

export const REGISTRY_BANK_VERIFICATION_MODES_INELIGIBLE_FOR_VERIFIED: RegistryBankVerificationMode[] = [
  "not_available",
  "manual_review_only",
  "provider_pending",
  "verification_disabled",
];

export const REGISTRY_BANK_PROVIDER_RESULT_OUTCOMES = [
  "matched",
  "mismatch",
  "error",
  "unavailable",
  "timeout",
] as const;
export type RegistryBankProviderResultOutcome =
  (typeof REGISTRY_BANK_PROVIDER_RESULT_OUTCOMES)[number];

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

export const REGISTRY_BANK_MANUAL_VERIFICATION_ACK_TEXT =
  "I understand that this manual decision marks the bank-detail status according to Izenzo's approved manual verification process. It is not a provider-confirmed bank verification unless the verification method says provider verified.";

export const REGISTRY_BANK_MANUAL_VERIFICATION_REQUIRED_ROLES = [
  "compliance_owner",
] as const;

export const REGISTRY_BANK_VERIFICATION_EXPIRY_DAYS = {
  provider_verified: 90,
  manual_verified: 30,
  high_risk_manual_verified: 14,
  provider_sandbox: 0,
} as const;

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
      return "not_verified";
  }
}

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

/**
 * Evaluate decision gates. Returns the list of failing gate names.
 * Empty array = all gates pass (promotion may proceed).
 */
export interface DecisionGateInput {
  submission_status: string;
  company_active: boolean;
  authority_valid: boolean;
  admin_initiated: boolean;
  consent_scopes: string[];
  evidence_accepted: boolean;
  risk_level: "none" | "low" | "medium" | "high" | "blocked";
  duplicate_resolved: boolean;
  holder_match_resolved: boolean;
  country_supports_mode: boolean;
  source_provenance_present: boolean;
  business_decision_approved: boolean;
  mode: RegistryBankVerificationMode;
  approval_role: string | null;
  required_role: string;
}
export function evaluateDecisionGates(i: DecisionGateInput): string[] {
  const failed: string[] = [];
  if (i.submission_status !== "captured_unverified")
    failed.push("submission_is_captured_unverified");
  if (!i.company_active) failed.push("company_active");
  if (!i.authority_valid && !i.admin_initiated)
    failed.push("authority_valid_or_admin_initiated");
  const required = [
    "internal_verification",
    "institutional_status_response",
    "re_verification",
    "audit_retention",
  ];
  if (!required.every((s) => i.consent_scopes.includes(s)))
    failed.push("consent_includes_required_scopes");
  if (!i.evidence_accepted) failed.push("evidence_accepted");
  if (i.risk_level === "blocked") failed.push("risk_not_blocked");
  if (!i.duplicate_resolved) failed.push("duplicate_resolved");
  if (!i.holder_match_resolved) failed.push("account_holder_match_resolved");
  if (!i.country_supports_mode) failed.push("country_supports_mode");
  if (!i.source_provenance_present) failed.push("source_provenance_present");
  if (!i.business_decision_approved) failed.push("business_decision_approved");
  if (REGISTRY_BANK_VERIFICATION_MODES_INELIGIBLE_FOR_VERIFIED.includes(i.mode))
    failed.push("mode_is_eligible");
  if (i.approval_role !== i.required_role) failed.push("approval_role_satisfied");
  return failed;
}
