/**
 * Batch 5 — M008 / M009 / M016 Institutional API SSOT (browser mirror).
 *
 * Mirror: supabase/functions/_shared/registry-institutional-api.ts
 * Pinned by:
 *   - scripts/check-registry-api-scope-parity.mjs    (TS ↔ Deno + result-state parity)
 *   - scripts/check-registry-api-audit-names.mjs     (audit-name coverage)
 *   - scripts/check-registry-api-no-raw-bank.mjs     (no raw bank-detail fields)
 *   - scripts/check-registry-api-state-rules.mjs     (verified gate rules)
 *   - scripts/check-registry-batch5-no-provider.mjs  (no provider / no AI in batch 5)
 */

export const REGISTRY_API_ENVIRONMENTS = ["sandbox", "production"] as const;
export type RegistryApiEnvironment = (typeof REGISTRY_API_ENVIRONMENTS)[number];

export const REGISTRY_API_CLIENT_STATUSES = [
  "pending",
  "active",
  "suspended",
  "revoked",
] as const;
export type RegistryApiClientStatus = (typeof REGISTRY_API_CLIENT_STATUSES)[number];

export const REGISTRY_API_KEY_STATUSES = ["active", "revoked", "expired"] as const;
export type RegistryApiKeyStatus = (typeof REGISTRY_API_KEY_STATUSES)[number];

/**
 * Canonical scope set for the institutional registry API. Batch 5 intentionally
 * omits any raw bank-detail scope. A raw-detail scope would require its own
 * contract and Business Decision in a later batch.
 */
export const REGISTRY_API_SCOPES = [
  "registry.search",
  "registry.profile.read",
  "registry.profile.status.read",
  "registry.profile.verified.read",
  "registry.payment_status.read",
  "registry.claim.status.read",
  "registry.coverage.read",
] as const;
export type RegistryApiScope = (typeof REGISTRY_API_SCOPES)[number];

/**
 * Canonical API result states. Every institutional API response MUST set
 * exactly one of these. No response may imply final verification unless the
 * underlying state machine + Business Decision gates allow.
 */
export const REGISTRY_API_RESULT_STATES = [
  "usable",
  "not_usable",
  "not_found",
  "not_ready",
  "seed_only",
  "demo_only",
  "expired",
  "disputed",
  "revoked",
  "insufficient_authority",
  "insufficient_provenance",
  "business_decision_required",
  "disabled",
] as const;
export type RegistryApiResultState = (typeof REGISTRY_API_RESULT_STATES)[number];

/**
 * Canonical audit event names emitted by Batch 5 edge functions. Coverage
 * is enforced by check-registry-api-audit-names.mjs.
 */
export const REGISTRY_API_AUDIT_EVENT_NAMES = [
  "registry_api_client_created",
  "registry_api_client_updated",
  "registry_api_client_suspended",
  "registry_api_key_created",
  "registry_api_key_revoked",
  "registry_api_profile_status_requested",
  "registry_api_payment_status_requested",
  "registry_api_response_returned",
  "registry_api_request_blocked",
  "registry_api_scope_denied",
  "registry_api_rate_limit_hit",
] as const;
export type RegistryApiAuditEventName = (typeof REGISTRY_API_AUDIT_EVENT_NAMES)[number];

/**
 * Payment-status flag. `verified` is the ONLY value that may be returned
 * when the underlying bank-detail state is exactly `verified` AND has a
 * non-null verification method, verified-at, and expiry. All other states
 * (captured_unverified, verification_pending, failed, expired, revoked,
 * disputed, provider_unavailable, not_provided, cancelled) MUST map to
 * `not_verified` or the matching terminal flag (`expired` / `revoked` /
 * `disputed` / `unavailable`).
 */
export const REGISTRY_API_PAYMENT_STATUS_FLAGS = [
  "verified",
  "not_verified",
  "expired",
  "disputed",
  "unavailable",
] as const;
export type RegistryApiPaymentStatusFlag = (typeof REGISTRY_API_PAYMENT_STATUS_FLAGS)[number];

/** Bank-detail state → payment-status flag mapping (pinned by guards). */
export function mapBankStateToApiFlag(state: string): RegistryApiPaymentStatusFlag {
  switch (state) {
    case "verified":
      return "verified";
    case "expired":
      return "expired";
    case "disputed":
      return "disputed";
    case "revoked":
    case "provider_unavailable":
      return "unavailable";
    default:
      // captured_unverified, verification_pending, failed, not_provided,
      // cancelled — anything other than the four terminal flags is
      // explicitly NOT verified.
      return "not_verified";
  }
}

/** Safe explanation strings keyed by result state. Used in API responses. */
export const REGISTRY_API_RESULT_EXPLANATIONS: Record<RegistryApiResultState, string> = {
  usable: "Record is institutionally usable per the recorded state machine and Business Decision Register.",
  not_usable: "Record exists but is not currently approved for institutional use.",
  not_found: "No matching registry record was located.",
  not_ready: "Record is in a shell or pre-production state and is not ready for institutional consumption.",
  seed_only: "Country coverage is seed-only. Results are not production-ready and must not be presented as live data.",
  demo_only: "Record is marked for demo use only and must not be relied on for production decisions.",
  expired: "Record has expired and must be re-verified before institutional use.",
  disputed: "Record is under active dispute and is not safe to consume.",
  revoked: "Record has been revoked.",
  insufficient_authority: "Authority-to-act has not been approved for this record. Claim approval alone is not authority approval.",
  insufficient_provenance: "Underlying data provenance does not meet the institutional usability threshold.",
  business_decision_required: "A Business Decision must be recorded before this record can be returned as institutionally usable.",
  disabled: "This endpoint or surface is currently disabled.",
};

/** Hard-coded forbidden API response field names — raw bank details. */
export const REGISTRY_API_FORBIDDEN_RAW_BANK_FIELDS = [
  "account_number",
  "sort_code",
  "iban",
  "swift_bic",
  "routing_number",
  "bank_account",
  "account_holder",
] as const;

/**
 * Returns true if the (profile state, authority state, provenance present,
 * coverage state, business decision present) tuple authorises the API to
 * return `usable` for the verified-profile endpoint. Claim approval alone
 * is NOT enough; authority approval alone is NOT enough.
 */
export function isProfileInstitutionallyUsable(input: {
  profile_verified: boolean;
  authority_approved: boolean;
  has_sufficient_provenance: boolean;
  coverage_state: string;
  business_decision_approved: boolean;
}): boolean {
  if (!input.business_decision_approved) return false;
  if (!input.profile_verified) return false;
  if (!input.authority_approved) return false;
  if (!input.has_sufficient_provenance) return false;
  if (input.coverage_state === "seed_only" || input.coverage_state === "no_coverage") return false;
  return true;
}
