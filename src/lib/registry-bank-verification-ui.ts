/**
 * Batch 14B — UI copy SSOT for the bank-verification admin queue, admin
 * detail page, and claimant-safe status surfaces.
 *
 * This file ONLY adds UI strings and small helpers. It defers to the
 * accepted Batch 14 backend SSOT (`registry-bank-verification.ts`) for
 * every status, mode, gate, audit name and API mapping. Do not duplicate
 * or rewrite those constants here.
 *
 * Pinned by:
 *   - scripts/check-batch-14b-ui-no-verified.mjs
 *   - scripts/check-batch-14b-ui-no-raw-leak.mjs
 *
 * Hard rules codified here:
 *   - captured_unverified is NEVER labelled verified
 *   - manual_verified / provider_matched are NEVER labelled verified
 *   - expired / revoked / disputed / cancelled are NEVER labelled verified
 *   - Provider simulation is ALWAYS labelled test-only
 *   - Manual verification ALWAYS requires the canonical acknowledgement
 */
import {
  REGISTRY_BANK_VERIFICATION_PUBLIC_LABELS,
  REGISTRY_BANK_VERIFICATION_FINAL_VERIFIED,
  REGISTRY_BANK_PROVIDER_TEST_MODE_LABEL,
  REGISTRY_BANK_MANUAL_VERIFICATION_ACK_TEXT,
  mapVerificationStatusToApiFlag,
  isFinalVerified,
  type RegistryBankVerificationStatus,
  type RegistryBankVerificationMode,
  type RegistryBankVerificationDecisionGate,
} from "./registry-bank-verification";

/** Single "Not verified" badge used everywhere the UI must be conservative. */
export const REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE = "Not verified";

/** Single "Verified" badge — ONLY used when isFinalVerified(status) === true
 *  AND the verification is not expired/disputed/revoked. */
export const REGISTRY_BANK_VERIFICATION_UI_VERIFIED_BADGE = "Verified";

export const REGISTRY_BANK_VERIFICATION_UI_PROVIDER_SIMULATION_LABEL =
  REGISTRY_BANK_PROVIDER_TEST_MODE_LABEL;

export const REGISTRY_BANK_VERIFICATION_UI_MANUAL_ACK_TEXT =
  REGISTRY_BANK_MANUAL_VERIFICATION_ACK_TEXT;

export const REGISTRY_BANK_VERIFICATION_UI_RAW_BLOCKED_NOTICE =
  "Raw bank account details are never displayed on this page. Only masked summary fields are shown.";

export const REGISTRY_BANK_VERIFICATION_UI_NO_LIVE_PROVIDER_NOTICE =
  "No live provider verification is enabled in this environment.";

export const REGISTRY_BANK_VERIFICATION_UI_EXPIRED_PAYMENT_NOTICE =
  "Verification expired. Payment status must return not verified until reverification is completed.";

export const REGISTRY_BANK_VERIFICATION_UI_DISPUTED_PAYMENT_NOTICE =
  "Bank details are disputed. Payment status returns not verified.";

export const REGISTRY_BANK_VERIFICATION_UI_REVOKED_PAYMENT_NOTICE =
  "Bank details are revoked. Payment status returns not verified.";

/** Public-facing label table. Mirrors the backend SSOT one-for-one. */
export const REGISTRY_BANK_VERIFICATION_UI_PUBLIC_LABEL =
  REGISTRY_BANK_VERIFICATION_PUBLIC_LABELS;

/** Decision-gate display names for the admin detail page. */
export const REGISTRY_BANK_VERIFICATION_UI_GATE_LABELS: Record<
  RegistryBankVerificationDecisionGate,
  string
> = {
  submission_is_captured_unverified: "Submission status is captured but not verified",
  company_active: "Company is active",
  authority_valid_or_admin_initiated: "Authority is valid (or admin initiated)",
  consent_includes_required_scopes: "Consent includes required scopes",
  evidence_accepted: "Accepted evidence on file",
  risk_not_blocked: "Risk level is not blocked",
  duplicate_resolved: "Duplicate fingerprint resolved",
  account_holder_match_resolved: "Account-holder match resolved",
  country_supports_mode: "Country supports selected verification mode",
  source_provenance_present: "Source provenance present",
  business_decision_approved: "Approved business decision exists",
  mode_is_eligible: "Verification mode is eligible",
  approval_role_satisfied: "Required reviewer role present",
};

export type GateDisplayState = "passed" | "failed" | "warning" | "not_applicable";

export interface GateDisplayRow {
  gate: RegistryBankVerificationDecisionGate;
  label: string;
  state: GateDisplayState;
  reason?: string;
}

/** Mode badge labels for the admin queue. */
export const REGISTRY_BANK_VERIFICATION_UI_MODE_LABEL: Record<
  RegistryBankVerificationMode,
  string
> = {
  not_available: "Mode: not available",
  manual_review_only: "Mode: manual review only",
  manual_verification_allowed: "Mode: manual verification allowed",
  provider_pending: "Mode: provider pending",
  provider_sandbox: "Mode: provider sandbox (test)",
  provider_live: "Mode: provider live",
  verification_disabled: "Mode: verification disabled",
};

/**
 * Decide which badge to render for a verification status. Returns the
 * conservative "Not verified" badge unless the status is the final
 * `verified` value AND the record is not expired.
 */
export function verificationBadgeFor(
  status: RegistryBankVerificationStatus,
  opts: { expiresAt?: string | null; disputed?: boolean; revoked?: boolean } = {},
): { label: string; tone: "verified" | "not_verified" | "warning" } {
  if (opts.disputed) return { label: REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE, tone: "warning" };
  if (opts.revoked) return { label: REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE, tone: "warning" };
  if (opts.expiresAt && new Date(opts.expiresAt).getTime() < Date.now())
    return { label: REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE, tone: "warning" };
  if (isFinalVerified(status) && mapVerificationStatusToApiFlag(status) === "verified") {
    return { label: REGISTRY_BANK_VERIFICATION_UI_VERIFIED_BADGE, tone: "verified" };
  }
  return { label: REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE, tone: "not_verified" };
}

/** Public-safe label resolver. Never emits "Verified" for non-final or expired. */
export function publicLabelFor(
  status: RegistryBankVerificationStatus,
  opts: { expiresAt?: string | null } = {},
): string {
  if (opts.expiresAt && new Date(opts.expiresAt).getTime() < Date.now())
    return REGISTRY_BANK_VERIFICATION_UI_PUBLIC_LABEL.expired;
  return REGISTRY_BANK_VERIFICATION_UI_PUBLIC_LABEL[status] ?? "Not verified";
}

export { REGISTRY_BANK_VERIFICATION_FINAL_VERIFIED };
