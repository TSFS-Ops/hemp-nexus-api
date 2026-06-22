/**
 * Batch 29 — Institutional API, Transparency, Limits & Logs Operating Rules SSOT.
 *
 * Mirrored byte-identically at
 *   supabase/functions/_shared/registry-api-operating-rules.ts
 * Parity pinned by:
 *   scripts/check-registry-api-operating-rules-parity.mjs
 *
 * Encodes the client's decisions from
 *   docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx
 * for:
 *   - first allowed institutional API client types;
 *   - sandbox-only default;
 *   - production API access gate (16 requirements);
 *   - sensitive-scope approval (compliance_owner);
 *   - profile-status API usability;
 *   - payment-status API usability;
 *   - raw-bank-detail default block + exception conditions;
 *   - API search keys (allowed / special-approval / hidden);
 *   - API request logging + transparency;
 *   - company-visible vs institution-visible logs;
 *   - rate limits (production / sandbox / sensitive endpoints);
 *   - quota / suspension / review triggers.
 *
 * Data + pure helpers only. No I/O, no React. Builds on Batches 1–28;
 * never weakens any accepted guardrail (Batch 5/15/15B API guarantees,
 * Batch 28 bank gates, Batch 27 authority gates).
 */

// ──────────────────── Allowed client types ────────────────────

export const REGISTRY_API_ALLOWED_CLIENT_TYPES = [
  "bank",
  "dfi",
  "insurer",
  "regulated_platform",
  "enterprise_client",
  "named_pilot_client",
] as const;
export type RegistryApiAllowedClientType =
  (typeof REGISTRY_API_ALLOWED_CLIENT_TYPES)[number];

export const REGISTRY_API_PUBLIC_SELF_SERVE_PRODUCTION_ENABLED = false;
export const REGISTRY_API_DEFAULT_ENVIRONMENT = "sandbox" as const;

// ──────────────────── Production access gate ────────────────────

export const REGISTRY_API_PRODUCTION_GATE_REQUIREMENTS = [
  "signed_contract_or_written_pilot_approval",
  "approved_client_organisation",
  "approved_use_case",
  "sandbox_testing_complete",
  "production_scope_approval",
  "api_key_with_expiry_and_scopes",
  "usage_and_quota_limits_set",
  "billing_or_token_rule_set",
  "data_use_decision_approved",
  "security_settings_complete",
  "audit_logging_enabled",
  "client_owner_assigned",
  "support_contact_assigned",
  "country_and_field_readiness",
  "platform_admin_approval",
  "compliance_owner_approval_for_sensitive_scopes",
] as const;
export type RegistryApiProductionGateRequirement =
  (typeof REGISTRY_API_PRODUCTION_GATE_REQUIREMENTS)[number];

export const REGISTRY_API_PRODUCTION_BLOCKING_DECISION_STATES = [
  "expired",
  "disputed",
  "licence_pending",
  "provider_pending",
] as const;
export type RegistryApiProductionBlockingDecisionState =
  (typeof REGISTRY_API_PRODUCTION_BLOCKING_DECISION_STATES)[number];

export interface ProductionGateInput {
  requirements_met: readonly RegistryApiProductionGateRequirement[];
  country_api_production_ready: boolean;
  field_scope_api_output_ready: boolean;
  business_decision_present_and_current: boolean;
  client_scope_covers_request: boolean;
  api_key_active: boolean;
  decision_state: string | null;
  quota_blocked: boolean;
  suspended: boolean;
  has_sensitive_scope: boolean;
  compliance_owner_approved_sensitive_scope: boolean;
}

export interface ProductionGateResult {
  allowed: boolean;
  blocking_reasons: string[];
}

export function evaluateProductionGate(input: ProductionGateInput): ProductionGateResult {
  const blocking: string[] = [];
  const met = new Set(input.requirements_met);
  for (const req of REGISTRY_API_PRODUCTION_GATE_REQUIREMENTS) {
    if (req === "compliance_owner_approval_for_sensitive_scopes" && !input.has_sensitive_scope) continue;
    if (!met.has(req)) blocking.push(`missing_requirement:${req}`);
  }
  if (input.has_sensitive_scope && !input.compliance_owner_approved_sensitive_scope) {
    blocking.push("missing_requirement:compliance_owner_approval_for_sensitive_scopes");
  }
  if (!input.country_api_production_ready) blocking.push("country_not_api_production_ready");
  if (!input.field_scope_api_output_ready) blocking.push("field_scope_not_api_output_ready");
  if (!input.business_decision_present_and_current) blocking.push("business_decision_missing_or_expired");
  if (!input.client_scope_covers_request) blocking.push("client_scope_does_not_cover_request");
  if (!input.api_key_active) blocking.push("api_key_expired_or_suspended");
  if (input.quota_blocked) blocking.push("quota_or_suspension_block");
  if (input.suspended) blocking.push("client_suspended");
  if (input.decision_state && (REGISTRY_API_PRODUCTION_BLOCKING_DECISION_STATES as readonly string[]).includes(input.decision_state)) {
    blocking.push(`blocking_decision_state:${input.decision_state}`);
  }
  return { allowed: blocking.length === 0, blocking_reasons: blocking };
}

// ──────────────────── Sensitive scopes ────────────────────

export const REGISTRY_API_SENSITIVE_SCOPES = [
  "registry.payment_status.read",
  "registry.profile.verified.read",
  "registry.bank.raw.read",
  "registry.officer.read",
  "registry.contact.read",
] as const;
export type RegistryApiSensitiveScope = (typeof REGISTRY_API_SENSITIVE_SCOPES)[number];

export function isSensitiveScope(scope: string): boolean {
  return (REGISTRY_API_SENSITIVE_SCOPES as readonly string[]).includes(scope);
}

// ──────────────────── Profile-status usability ────────────────────

export interface ProfileStatusUsabilityInput {
  country_search_ready_or_production: boolean;
  field_provenance_present: boolean;
  source_licence_permits_api: boolean;
  no_active_dispute: boolean;
  no_compliance_hold: boolean;
  business_decision_current: boolean;
  has_readiness_status: boolean;
  has_source_label: boolean;
  has_last_updated: boolean;
  has_stale_date: boolean;
}

export const REGISTRY_API_PROFILE_MISSING_FIELD_LABELS = [
  "not_available",
  "stale",
  "not_ready",
] as const;
export type RegistryApiProfileMissingFieldLabel =
  (typeof REGISTRY_API_PROFILE_MISSING_FIELD_LABELS)[number];

export function evaluateProfileStatusUsable(input: ProfileStatusUsabilityInput): {
  usable: boolean;
  blocking_reasons: string[];
} {
  const reasons: string[] = [];
  if (!input.country_search_ready_or_production) reasons.push("country_not_ready");
  if (!input.field_provenance_present) reasons.push("provenance_missing");
  if (!input.source_licence_permits_api) reasons.push("licence_does_not_permit_api");
  if (!input.no_active_dispute) reasons.push("active_dispute");
  if (!input.no_compliance_hold) reasons.push("compliance_hold");
  if (!input.business_decision_current) reasons.push("business_decision_missing_or_expired");
  if (!input.has_readiness_status) reasons.push("readiness_status_missing");
  if (!input.has_source_label) reasons.push("source_label_missing");
  if (!input.has_last_updated) reasons.push("last_updated_missing");
  if (!input.has_stale_date) reasons.push("stale_date_missing");
  return { usable: reasons.length === 0, blocking_reasons: reasons };
}

// ──────────────────── Payment-status usability ────────────────────

export const REGISTRY_API_PAYMENT_USABLE_BANK_STATES = [
  "provider_verified",
  "bank_confirmed",
  "institution_confirmed",
  "manual_bank_check_complete",
] as const;
export type RegistryApiPaymentUsableBankState =
  (typeof REGISTRY_API_PAYMENT_USABLE_BANK_STATES)[number];

export const REGISTRY_API_PAYMENT_NOT_USABLE_BANK_STATES = [
  "expired",
  "disputed",
  "revoked",
  "verification_pending",
  "pending",
  "captured_unverified",
  "failed",
  "not_provided",
  "cancelled",
] as const;

export interface PaymentStatusUsabilityInput {
  bank_status: string;
  manual_check_compliance_approved: boolean;
  evidence_present: boolean;
  authority_active_with_bank_consent: boolean;
  business_decision_allows_payment_status_api: boolean;
}

export function evaluatePaymentStatusUsable(
  input: PaymentStatusUsabilityInput,
): { usable: boolean; blocking_reasons: string[] } {
  const reasons: string[] = [];
  if (!(REGISTRY_API_PAYMENT_USABLE_BANK_STATES as readonly string[]).includes(input.bank_status)) {
    reasons.push(`bank_status_not_usable:${input.bank_status}`);
  }
  if (input.bank_status === "manual_bank_check_complete" && !input.manual_check_compliance_approved) {
    reasons.push("manual_check_not_compliance_approved");
  }
  if (!input.evidence_present) reasons.push("evidence_missing");
  if (!input.authority_active_with_bank_consent) reasons.push("authority_or_bank_consent_missing");
  if (!input.business_decision_allows_payment_status_api) reasons.push("business_decision_does_not_permit");
  return { usable: reasons.length === 0, blocking_reasons: reasons };
}

export const PAYMENT_STATUS_API_SAFE_RESPONSE_FIELDS = [
  "status",
  "verification_type",
  "last_verified",
  "expires_at",
  "dispute_state",
  "usable",
  "masked_account_identifier",
  "bank_country",
  "currency",
] as const;

// ──────────────────── Raw bank detail rule ────────────────────

export const REGISTRY_API_RAW_BANK_DEFAULT_BLOCKED = true;
export const REGISTRY_API_RAW_BANK_ENDPOINT_EXISTS = false;

export const REGISTRY_API_RAW_BANK_EXCEPTION_REQUIREMENTS = [
  "separate_written_contract",
  "explicit_company_authority_and_consent",
  "compliance_owner_approval",
  "platform_admin_approval",
  "aal2_admin_release",
  "per_request_audit",
  "restricted_ip_and_scope",
  "stated_purpose",
] as const;
export type RegistryApiRawBankExceptionRequirement =
  (typeof REGISTRY_API_RAW_BANK_EXCEPTION_REQUIREMENTS)[number];

export function evaluateRawBankException(input: {
  satisfied: readonly RegistryApiRawBankExceptionRequirement[];
}): { allowed: boolean; missing: string[] } {
  const set = new Set(input.satisfied);
  const missing = REGISTRY_API_RAW_BANK_EXCEPTION_REQUIREMENTS.filter((r) => !set.has(r));
  // Even if all conditions met, default build keeps endpoint disabled.
  if (!REGISTRY_API_RAW_BANK_ENDPOINT_EXISTS) {
    return { allowed: false, missing: [...missing, "raw_bank_endpoint_disabled_by_default"] };
  }
  return { allowed: missing.length === 0, missing };
}

// ──────────────────── API search keys ────────────────────

export const REGISTRY_API_SEARCH_KEYS_ALLOWED = [
  "legal_name",
  "trading_name",
  "registration_number",
  "local_identifier",
  "country",
  "jurisdiction",
  "approved_public_identifier",
  "approved_profile_id",
  "approved_industry_category",
] as const;
export type RegistryApiSearchKeyAllowed =
  (typeof REGISTRY_API_SEARCH_KEYS_ALLOWED)[number];

export const REGISTRY_API_SEARCH_KEYS_SPECIAL_APPROVAL = [
  "officer_name",
  "director_name",
  "member_name",
  "vat_number",
  "tax_number",
  "website",
  "address",
  "email",
  "phone",
  "claim_status",
  "authority_status",
  "bank_status_query",
] as const;
export type RegistryApiSearchKeySpecialApproval =
  (typeof REGISTRY_API_SEARCH_KEYS_SPECIAL_APPROVAL)[number];

export const REGISTRY_API_SEARCH_KEYS_HIDDEN = [
  "raw_bank_details",
  "identity_documents",
  "private_notes",
  "internal_comments",
  "dispute_notes",
  "unsupported_personal_data",
  "restricted_source_fields",
] as const;

export const REGISTRY_API_EXACT_MATCH_REQUIRED_KEYS = [
  "registration_number",
  "tax_number",
  "vat_number",
  "bank_status_query",
] as const;

export const REGISTRY_API_FUZZY_ALLOWED_KEYS = [
  "legal_name",
  "trading_name",
] as const;

export type ApiSearchKeyClassification =
  | "allowed"
  | "special_approval"
  | "hidden"
  | "unknown";

export function classifyApiSearchKey(key: string): ApiSearchKeyClassification {
  if ((REGISTRY_API_SEARCH_KEYS_ALLOWED as readonly string[]).includes(key)) return "allowed";
  if ((REGISTRY_API_SEARCH_KEYS_SPECIAL_APPROVAL as readonly string[]).includes(key)) return "special_approval";
  if ((REGISTRY_API_SEARCH_KEYS_HIDDEN as readonly string[]).includes(key)) return "hidden";
  return "unknown";
}

export function evaluateApiSearchKey(input: {
  key: string;
  fuzzy: boolean;
  special_approval_granted: boolean;
}): { allowed: boolean; reason: string | null } {
  const cls = classifyApiSearchKey(input.key);
  if (cls === "hidden") return { allowed: false, reason: "api_hidden_field" };
  if (cls === "unknown") return { allowed: false, reason: "unknown_key" };
  if (cls === "special_approval" && !input.special_approval_granted) {
    return { allowed: false, reason: "special_approval_required" };
  }
  if ((REGISTRY_API_EXACT_MATCH_REQUIRED_KEYS as readonly string[]).includes(input.key) && input.fuzzy) {
    return { allowed: false, reason: "exact_match_required" };
  }
  if (input.fuzzy && !(REGISTRY_API_FUZZY_ALLOWED_KEYS as readonly string[]).includes(input.key)) {
    return { allowed: false, reason: "fuzzy_not_allowed_for_key" };
  }
  return { allowed: true, reason: null };
}

// ──────────────────── API request logging ────────────────────

export const REGISTRY_API_REQUEST_LOG_REQUIRED_FIELDS = [
  "api_client_id",
  "endpoint",
  "company_or_profile_reference",
  "request_category",
  "purpose_label",
  "scope_used",
  "country",
  "response_status",
  "usable_result",
  "rate_quota_state",
  "timestamp",
  "request_id",
  "technical_error_category",
] as const;

export const REGISTRY_API_REQUEST_LOG_FORBIDDEN_FIELDS = [
  "full_api_key",
  "api_key_secret",
  "raw_ip",
  "request_body",
  "response_body",
  "provider_payload",
  "raw_bank_details",
  "internal_error_data",
] as const;

export const REGISTRY_API_COMPANY_VISIBLE_LOG_FIELDS = [
  "client_name_or_category",
  "date",
  "endpoint_category",
  "purpose_label",
] as const;

export const REGISTRY_API_COMPANY_HIDDEN_LOG_FIELDS = [
  "raw_requester_technical_data",
  "raw_ips",
  "api_keys",
  "internal_error_data",
  "provider_payloads",
  "raw_bank_details",
] as const;

export const REGISTRY_API_COMPANY_LOGS_REQUIRE_DASHBOARD_ENABLED = true;
export const REGISTRY_API_AUTO_COMPANY_NOTIFICATIONS_ENABLED = false;
export const REGISTRY_API_CLIENT_SEES_OWN_LOGS_ONLY = true;

export function buildCompanyVisibleLogSummary<T extends Record<string, unknown>>(
  raw: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of REGISTRY_API_COMPANY_VISIBLE_LOG_FIELDS) {
    if (key in raw) out[key] = raw[key];
  }
  return out;
}

// ──────────────────── Rate limits & quotas ────────────────────

export const REGISTRY_API_PRODUCTION_LIMITS = {
  per_minute: 60,
  per_day: 5_000,
  per_month: 100_000,
} as const;

export const REGISTRY_API_SANDBOX_LIMITS = {
  per_minute: 30,
  per_day: 1_000,
  per_month: 10_000,
} as const;

export const REGISTRY_API_SENSITIVE_ENDPOINT_LIMITS = {
  per_minute: 10,
  per_day: 1_000,
} as const;

export const REGISTRY_API_SENSITIVE_ENDPOINTS = [
  "payment_status",
  "profile_verified",
  "bank_raw",
] as const;

export const REGISTRY_API_QUOTA_OVERAGE_SUSPEND_THRESHOLD_PCT = 120;

export const REGISTRY_API_REQUIRED_CONTROLS = [
  "country_allowlist",
  "endpoint_scopes",
  "ip_allowlist_where_required",
  "monthly_allowance",
  "overage_rule",
  "key_expiry",
  "rate_limit_logging",
  "suspension_triggers",
] as const;

// ──────────────────── Suspension & review triggers ────────────────────

export const REGISTRY_API_SUSPENSION_TRIGGERS = [
  "repeated_failed_authentication",
  "scraping_pattern",
  "usage_above_120_percent_quota",
  "unusual_country_spike",
  "unusual_endpoint_spike",
  "policy_breach",
  "disputed_use",
  "payment_failure",
] as const;
export type RegistryApiSuspensionTrigger =
  (typeof REGISTRY_API_SUSPENSION_TRIGGERS)[number];

export interface SuspensionEvaluationInput {
  failed_auth_count: number;
  scraping_detected: boolean;
  quota_usage_pct: number;
  country_spike: boolean;
  endpoint_spike: boolean;
  policy_breach: boolean;
  disputed_use: boolean;
  payment_failure: boolean;
}

export function evaluateSuspension(
  input: SuspensionEvaluationInput,
): { suspend_or_review: boolean; triggers: RegistryApiSuspensionTrigger[] } {
  const triggers: RegistryApiSuspensionTrigger[] = [];
  if (input.failed_auth_count >= 5) triggers.push("repeated_failed_authentication");
  if (input.scraping_detected) triggers.push("scraping_pattern");
  if (input.quota_usage_pct >= REGISTRY_API_QUOTA_OVERAGE_SUSPEND_THRESHOLD_PCT) {
    triggers.push("usage_above_120_percent_quota");
  }
  if (input.country_spike) triggers.push("unusual_country_spike");
  if (input.endpoint_spike) triggers.push("unusual_endpoint_spike");
  if (input.policy_breach) triggers.push("policy_breach");
  if (input.disputed_use) triggers.push("disputed_use");
  if (input.payment_failure) triggers.push("payment_failure");
  return { suspend_or_review: triggers.length > 0, triggers };
}

// ──────────────────── Self-visibility ────────────────────

export const REGISTRY_API_CLIENT_SELF_VISIBLE_FIELDS = [
  "own_organisation",
  "own_api_keys_masked",
  "own_scopes",
  "own_quota_usage",
  "own_logs",
  "own_suspension_status",
  "own_contract_or_pilot_state",
] as const;

export const REGISTRY_API_CLIENT_HIDDEN_FIELDS = [
  "other_clients",
  "full_keys",
  "internal_risk_notes",
  "internal_reviewer_comments",
  "company_evidence",
  "raw_bank_details",
  "raw_provider_payloads",
  "internal_pricing_rules",
] as const;

// ──────────────────── Wording & audit ────────────────────

export const REGISTRY_API_OPERATING_WORDING = {
  sandbox_default:
    "API access defaults to sandbox. Production access requires contract or pilot approval and the full production gate.",
  production_blocked:
    "Production API access is blocked until all required gates are approved.",
  raw_bank_blocked:
    "Raw bank account details are not returned through the API.",
  payment_status_not_usable:
    "Payment status is not currently usable for this record.",
  profile_status_not_usable:
    "Profile status is not currently usable for this record.",
  client_logs_own_only:
    "API clients may view only their own request logs.",
  company_dashboard_disabled:
    "Company API transparency is not enabled.",
  key_masked: "Full API keys are never displayed after creation.",
} as const;

export const REGISTRY_API_OPERATING_AUDIT_EVENTS = [
  "registry_api_production_gate_evaluated",
  "registry_api_production_access_blocked",
  "registry_api_production_access_granted",
  "registry_api_profile_status_blocked",
  "registry_api_payment_status_blocked",
  "registry_api_raw_bank_blocked",
  "registry_api_raw_bank_exception_evaluated",
  "registry_api_search_key_blocked",
  "registry_api_request_logged",
  "registry_api_company_summary_returned",
  "registry_api_quota_threshold_hit",
  "registry_api_suspension_triggered",
  "registry_api_review_triggered",
  "registry_api_client_self_log_returned",
] as const;
export type RegistryApiOperatingAuditEvent =
  (typeof REGISTRY_API_OPERATING_AUDIT_EVENTS)[number];

// Parity fingerprint (bump when the SSOT structure changes).
export const REGISTRY_API_OPERATING_PARITY_FINGERPRINT = "batch-29-v1" as const;
