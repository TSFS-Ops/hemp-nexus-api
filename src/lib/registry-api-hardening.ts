/**
 * Batch 15 — Institutional API Hardening SSOT (browser mirror).
 *
 * Mirror: supabase/functions/_shared/registry-api-hardening.ts
 * Pinned by:
 *   - scripts/check-batch-15-ssot-parity.mjs              (TS ↔ Deno)
 *   - scripts/check-batch-15-no-raw-bank.mjs              (no raw / masked bank fields)
 *   - scripts/check-batch-15-no-personal-contact.mjs      (no personal contact fields)
 *   - scripts/check-batch-15-forbidden-scopes.mjs         (forbidden scopes blocked everywhere)
 *   - scripts/check-batch-15-audit-names.mjs              (every audit name emitted)
 *
 * BATCH 15 GUARANTEES (codified):
 *   - Default API mode is `disabled`. Production access requires approval + ack.
 *   - Sandbox and production keys are separate.
 *   - Suspended/revoked/expired/disabled clients are blocked.
 *   - captured_unverified, manual_verified, provider_matched, expired, revoked,
 *     disputed, failed, provider_* states never return API verified.
 *   - Only final unexpired Batch 14 `verified` may map to API `usable`/verified.
 *   - No raw bank details. No masked bank details (no current approved scope).
 *   - No raw personal contact details.
 *   - All blocked requests and allowed requests are logged with safe reason.
 */

// 1. API operating modes
export const REGISTRY_API_MODES = [
  "disabled",
  "sandbox",
  "demo",
  "limited_production",
  "production",
] as const;
export type RegistryApiMode = (typeof REGISTRY_API_MODES)[number];
export const REGISTRY_API_DEFAULT_MODE: RegistryApiMode = "disabled";

// 2. API client lifecycle statuses (richer than Batch 5 four-state model)
export const REGISTRY_API_CLIENT_LIFECYCLE_STATUSES = [
  "draft",
  "pending_approval",
  "sandbox_active",
  "demo_active",
  "production_pending",
  "production_active",
  "suspended",
  "revoked",
  "expired",
  "disabled",
] as const;
export type RegistryApiClientLifecycleStatus =
  (typeof REGISTRY_API_CLIENT_LIFECYCLE_STATUSES)[number];

/** Lifecycle states that ARE allowed to call the API. */
export const REGISTRY_API_CALLABLE_LIFECYCLE_STATUSES: ReadonlyArray<RegistryApiClientLifecycleStatus> = [
  "sandbox_active",
  "demo_active",
  "production_pending", // pre-prod testing only, sandbox mode
  "production_active",
];

// 3. API key types — sandbox / production separation is hard
export const REGISTRY_API_KEY_TYPES = ["sandbox", "production"] as const;
export type RegistryApiKeyType = (typeof REGISTRY_API_KEY_TYPES)[number];

// 4. Canonical scopes (Batch 15 superset; back-compatible with Batch 5)
export const REGISTRY_API_HARDENED_SCOPES = [
  "registry.search",
  "registry.profile.status.read",
  "registry.profile.summary.read",
  "registry.claim.status.read",
  "registry.authority.status.read",
  "registry.bank.status.read",
  "registry.payment_status.read",
  "registry.coverage.read",
  "registry.readiness.read",
  "registry.usage.read",
] as const;
export type RegistryApiHardenedScope =
  (typeof REGISTRY_API_HARDENED_SCOPES)[number];

/**
 * Scopes that are explicitly forbidden in Batch 15 (until/unless an explicit
 * future contract decision approves them). The DB CHECK constraint on
 * `registry_api_client_scopes.scope_key` enforces this at the row level.
 */
export const REGISTRY_API_FORBIDDEN_SCOPES = [
  "registry.bank.raw.read",
  "registry.bank.unmasked.read",
  "registry.personal_contact.raw.read",
  "registry.evidence.raw.read",
] as const;
export type RegistryApiForbiddenScope =
  (typeof REGISTRY_API_FORBIDDEN_SCOPES)[number];

export function isForbiddenApiScope(scope: string): boolean {
  return (REGISTRY_API_FORBIDDEN_SCOPES as readonly string[]).includes(scope);
}

// 5. Canonical API response result states
export const REGISTRY_API_HARDENED_RESULT_STATES = [
  "usable",
  "not_usable",
  "not_found",
  "not_ready",
  "seed_only",
  "sample_only",
  "demo_only",
  "imported_unverified",
  "business_decision_required",
  "country_not_ready",
  "source_not_approved",
  "insufficient_provenance",
  "claim_not_enabled",
  "authority_not_approved",
  "bank_details_not_submitted",
  "bank_details_captured_unverified",
  "bank_verification_pending",
  "bank_verification_failed",
  "bank_verification_expired",
  "bank_verification_revoked",
  "bank_verification_disputed",
  "bank_verification_unavailable",
  "api_client_not_allowed",
  "scope_not_allowed",
  "rate_limited",
  "client_suspended",
  "disabled",
] as const;
export type RegistryApiHardenedResultState =
  (typeof REGISTRY_API_HARDENED_RESULT_STATES)[number];

// 6. Safe explanations
export const REGISTRY_API_HARDENED_RESULT_EXPLANATIONS: Record<
  RegistryApiHardenedResultState,
  string
> = {
  usable: "Record is institutionally usable per the recorded state machine and Business Decision Register.",
  not_usable: "Record exists but is not currently approved for institutional use.",
  not_found: "No matching registry record was located.",
  not_ready: "Record is in a pre-production state and is not ready for institutional consumption.",
  seed_only: "Country coverage is seed-only and must not be presented as production data.",
  sample_only: "Sandbox sample response only.",
  demo_only: "Record is for demo use only.",
  imported_unverified: "Record was imported but has not been independently verified.",
  business_decision_required: "A Business Decision must be recorded before this record can be returned as usable.",
  country_not_ready: "Country coverage is not ready for institutional use.",
  source_not_approved: "Underlying source is not approved for institutional reliance.",
  insufficient_provenance: "Provenance does not meet the institutional usability threshold.",
  claim_not_enabled: "Company claim has not been enabled for this record.",
  authority_not_approved: "Authority-to-act has not been approved for this record.",
  bank_details_not_submitted: "No bank-detail submission exists for this company.",
  bank_details_captured_unverified: "Bank details are captured but not verified.",
  bank_verification_pending: "Bank verification is pending and not yet complete.",
  bank_verification_failed: "Bank verification failed.",
  bank_verification_expired: "Bank verification has expired and must be renewed.",
  bank_verification_revoked: "Bank verification was revoked.",
  bank_verification_disputed: "Bank verification is under dispute.",
  bank_verification_unavailable: "Bank verification result is currently unavailable.",
  api_client_not_allowed: "API client is not allowed to make this request.",
  scope_not_allowed: "The requested scope is not granted to this API client.",
  rate_limited: "Rate limit exceeded for this client.",
  client_suspended: "API client is suspended.",
  disabled: "This endpoint or surface is currently disabled.",
};

// 7. Rate-limit profile keys (must align with seeded rows)
export const REGISTRY_API_RATE_LIMIT_PROFILE_KEYS = [
  "conservative_sandbox",
  "conservative_demo",
  "conservative_production",
] as const;
export type RegistryApiRateLimitProfileKey =
  (typeof REGISTRY_API_RATE_LIMIT_PROFILE_KEYS)[number];

// 8. Audit event names (additive; coexists with Batch 5 names)
export const REGISTRY_API_HARDENED_AUDIT_EVENT_NAMES = [
  "registry_api_client_created",
  "registry_api_client_updated",
  "registry_api_client_sandbox_approved",
  "registry_api_client_demo_approved",
  "registry_api_client_production_approved",
  "registry_api_client_suspended",
  "registry_api_client_revoked",
  "registry_api_client_expired",
  "registry_api_key_created",
  "registry_api_key_revoked",
  "registry_api_scope_added",
  "registry_api_scope_removed",
  "registry_api_country_added",
  "registry_api_country_removed",
  "registry_api_use_case_added",
  "registry_api_use_case_removed",
  "registry_api_request_received",
  "registry_api_request_allowed",
  "registry_api_request_blocked",
  "registry_api_rate_limited",
  "registry_api_profile_status_checked",
  "registry_api_payment_status_checked",
  "registry_api_test_console_used",
  "registry_api_usage_exported",
] as const;
export type RegistryApiHardenedAuditEventName =
  (typeof REGISTRY_API_HARDENED_AUDIT_EVENT_NAMES)[number];

// 9. Production-approval acknowledgement (canonical text)
export const REGISTRY_API_PRODUCTION_ACKNOWLEDGEMENT_TEXT =
  "I understand that production API access may allow an institutional client to rely on registry status responses. This does not permit raw bank-detail access unless a separate approved scope exists.";

// 10. Forbidden response field tokens — raw bank, masked bank (no current scope), personal contact
export const REGISTRY_API_FORBIDDEN_RESPONSE_FIELDS = [
  // raw bank
  "account_number",
  "sort_code",
  "iban",
  "swift_bic",
  "routing_number",
  "bank_account",
  "account_holder",
  "branch_code",
  "bank_code",
  // masked bank — disallowed in Batch 15 (no approved scope yet)
  "account_number_masked",
  "iban_masked",
  // personal contact
  "personal_email",
  "personal_phone",
  "personal_mobile",
  "personal_address",
] as const;

// 11. Bank verification → API mapping (uses Batch 14 truth)
export const REGISTRY_API_NOT_VERIFIED_BANK_STATES = [
  "captured_unverified",
  "verification_requested",
  "manual_review_required",
  "provider_pending",
  "provider_check_in_progress",
  "provider_matched",
  "manual_verified",
  "provider_mismatch",
  "provider_error",
  "provider_unavailable",
  "failed",
  "expired",
  "revoked",
  "disputed",
  "cancelled",
  "not_started",
  "not_available",
] as const;

export function mapVerificationStateToHardenedResult(
  verificationStatus: string | null | undefined,
  expiresAt: string | null | undefined,
): RegistryApiHardenedResultState {
  if (!verificationStatus) return "bank_details_not_submitted";
  if (verificationStatus === "verified") {
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      return "bank_verification_expired";
    }
    return "usable";
  }
  switch (verificationStatus) {
    case "captured_unverified":
      return "bank_details_captured_unverified";
    case "verification_requested":
    case "manual_review_required":
    case "provider_pending":
    case "provider_check_in_progress":
    case "provider_matched":
    case "manual_verified":
      return "bank_verification_pending";
    case "failed":
    case "provider_mismatch":
    case "provider_error":
      return "bank_verification_failed";
    case "expired":
      return "bank_verification_expired";
    case "revoked":
      return "bank_verification_revoked";
    case "disputed":
      return "bank_verification_disputed";
    case "provider_unavailable":
      return "bank_verification_unavailable";
    case "cancelled":
      return "bank_verification_revoked";
    default:
      return "bank_verification_pending";
  }
}

// 12. Canonical response envelope shape
export interface RegistryApiResponseEnvelope {
  request_id: string;
  timestamp: string;
  client_id: string | null;
  mode: RegistryApiMode;
  scope: string;
  endpoint: string;
  result_state: RegistryApiHardenedResultState;
  usable: boolean;
  safe_status: string;
  safe_reason: string;
  country: string | null;
  company_reference: string | null;
  source_summary: string | null;
  readiness_summary: string | null;
  expires_at: string | null;
  audit_reference: string;
}

export function buildResponseEnvelope(input: {
  request_id: string;
  client_id: string | null;
  mode: RegistryApiMode;
  scope: string;
  endpoint: string;
  result_state: RegistryApiHardenedResultState;
  country?: string | null;
  company_reference?: string | null;
  source_summary?: string | null;
  readiness_summary?: string | null;
  expires_at?: string | null;
  audit_reference?: string;
}): RegistryApiResponseEnvelope {
  const usable = input.result_state === "usable";
  return {
    request_id: input.request_id,
    timestamp: new Date().toISOString(),
    client_id: input.client_id,
    mode: input.mode,
    scope: input.scope,
    endpoint: input.endpoint,
    result_state: input.result_state,
    usable,
    safe_status: usable ? "usable" : "not_usable",
    safe_reason: REGISTRY_API_HARDENED_RESULT_EXPLANATIONS[input.result_state],
    country: input.country ?? null,
    company_reference: input.company_reference ?? null,
    source_summary: input.source_summary ?? null,
    readiness_summary: input.readiness_summary ?? null,
    expires_at: input.expires_at ?? null,
    audit_reference: input.audit_reference ?? input.request_id,
  };
}

// 13. Gate evaluation — used by both edge functions and the test console
export interface RegistryApiGateInput {
  client_lifecycle_status: RegistryApiClientLifecycleStatus | null;
  client_mode: RegistryApiMode;
  requested_mode: RegistryApiMode;
  key_type: RegistryApiKeyType | null;
  key_status: "active" | "revoked" | "expired" | null;
  granted_scopes: ReadonlyArray<string>;
  requested_scope: string;
  allowed_countries: ReadonlyArray<string>;
  requested_country: string | null;
  allowed_use_cases: ReadonlyArray<string>;
  requested_use_case: string | null;
  rate_limited: boolean;
}

export type RegistryApiGateName =
  | "client_callable"
  | "client_not_suspended"
  | "key_valid"
  | "mode_compatible"
  | "scope_not_forbidden"
  | "scope_granted"
  | "country_allowed"
  | "use_case_allowed"
  | "rate_limit_ok";

export interface RegistryApiGateDecision {
  gate: RegistryApiGateName;
  passed: boolean;
  reason: string;
}

export function evaluateApiGates(
  input: RegistryApiGateInput,
): RegistryApiGateDecision[] {
  const out: RegistryApiGateDecision[] = [];

  out.push({
    gate: "client_callable",
    passed:
      !!input.client_lifecycle_status &&
      (REGISTRY_API_CALLABLE_LIFECYCLE_STATUSES as readonly string[]).includes(
        input.client_lifecycle_status,
      ),
    reason:
      input.client_lifecycle_status === null
        ? "Client lifecycle unknown."
        : `Client lifecycle is ${input.client_lifecycle_status}.`,
  });

  out.push({
    gate: "client_not_suspended",
    passed:
      input.client_lifecycle_status !== "suspended" &&
      input.client_lifecycle_status !== "revoked" &&
      input.client_lifecycle_status !== "expired" &&
      input.client_lifecycle_status !== "disabled",
    reason: "Suspended, revoked, expired or disabled clients cannot call the API.",
  });

  out.push({
    gate: "key_valid",
    passed: input.key_status === "active",
    reason:
      input.key_status === "active"
        ? "Key is active."
        : `Key status is ${input.key_status ?? "missing"}.`,
  });

  // Mode compatibility: production mode requires production-active lifecycle
  // and a production key. Sandbox/demo allowed in pre-production lifecycles.
  let modeOk = true;
  if (input.requested_mode === "production" || input.requested_mode === "limited_production") {
    modeOk =
      input.client_lifecycle_status === "production_active" &&
      input.key_type === "production";
  } else if (input.requested_mode === "sandbox" || input.requested_mode === "demo") {
    modeOk = input.key_type === "sandbox";
  } else {
    modeOk = false;
  }
  out.push({
    gate: "mode_compatible",
    passed: modeOk,
    reason: `Requested mode ${input.requested_mode} requires matching lifecycle and key type.`,
  });

  out.push({
    gate: "scope_not_forbidden",
    passed: !isForbiddenApiScope(input.requested_scope),
    reason: "Requested scope must not be on the forbidden list.",
  });

  out.push({
    gate: "scope_granted",
    passed: input.granted_scopes.includes(input.requested_scope),
    reason: "Requested scope must be explicitly granted to the client.",
  });

  out.push({
    gate: "country_allowed",
    passed:
      input.requested_country === null ||
      input.allowed_countries.includes(input.requested_country),
    reason:
      "Requested country must be on the client's approved country list (when supplied).",
  });

  out.push({
    gate: "use_case_allowed",
    passed:
      input.requested_use_case === null ||
      input.allowed_use_cases.includes(input.requested_use_case),
    reason:
      "Requested use case must be on the client's approved list (when supplied).",
  });

  out.push({
    gate: "rate_limit_ok",
    passed: !input.rate_limited,
    reason: input.rate_limited ? "Rate limit exceeded." : "Within rate limit.",
  });

  return out;
}

export function gatesToBlockedReason(
  decisions: ReadonlyArray<RegistryApiGateDecision>,
): { result_state: RegistryApiHardenedResultState; reason: string } | null {
  for (const d of decisions) {
    if (d.passed) continue;
    switch (d.gate) {
      case "client_callable":
      case "client_not_suspended":
        return { result_state: "client_suspended", reason: d.reason };
      case "key_valid":
      case "mode_compatible":
        return { result_state: "api_client_not_allowed", reason: d.reason };
      case "scope_not_forbidden":
      case "scope_granted":
        return { result_state: "scope_not_allowed", reason: d.reason };
      case "country_allowed":
        return { result_state: "country_not_ready", reason: d.reason };
      case "use_case_allowed":
        return { result_state: "api_client_not_allowed", reason: d.reason };
      case "rate_limit_ok":
        return { result_state: "rate_limited", reason: d.reason };
    }
  }
  return null;
}
