/**
 * Batch 5 — M008 / M009 / M016 Institutional API SSOT (Deno mirror).
 * Mirror of src/lib/registry-institutional-api.ts. Keep byte-aligned.
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

export const REGISTRY_API_PAYMENT_STATUS_FLAGS = [
  "verified",
  "not_verified",
  "expired",
  "disputed",
  "unavailable",
] as const;
export type RegistryApiPaymentStatusFlag = (typeof REGISTRY_API_PAYMENT_STATUS_FLAGS)[number];

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
      return "not_verified";
  }
}

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

export const REGISTRY_API_FORBIDDEN_RAW_BANK_FIELDS = [
  "account_number",
  "sort_code",
  "iban",
  "swift_bic",
  "routing_number",
  "bank_account",
  "account_holder",
] as const;

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

/** Hash a key string with SHA-256, hex-encoded. */
export async function hashApiKey(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a new random key string. Prefix is non-secret and stored alongside. */
export function generateApiKey(env: RegistryApiEnvironment): { full: string; prefix: string } {
  const tag = env === "production" ? "prod" : "sbx";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const prefix = `rk_${tag}_${body.slice(0, 8)}`;
  return { full: `${prefix}_${body.slice(8)}`, prefix };
}
