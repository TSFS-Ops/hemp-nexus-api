/**
 * P-5 Batch 8 — Provider-Ready Structures & External Dependency Labelling
 * Phase 1: Single Source of Truth (SSOT) registry.
 *
 * Locks the approved provider categories, provider-ready definition,
 * provider dependency states, provider-result decision states,
 * webhook event vocabulary, audit event vocabulary, allowed/banned
 * external wording, API-safe field allow-list, forbidden external
 * fields, ownership roles and Memory/finality gating rules for the
 * provider/dependency surface.
 *
 * Source of truth: client's signed Batch 8 answers
 * ("Izenzo P-5 Batch 8 — Provider-Ready Structures & External
 *  Dependency Labelling — Client Input Questionnaire").
 *
 * This module is data-only — no runtime logic, no DB calls, no
 * side-effects. Every Batch 8 surface (DB / RPC / API / UI / edge /
 * test / drift guard) MUST import from this file.
 *
 * Cross-batch contracts:
 *   - Finality (Batch 5) and Memory (Batch 5) remain read-only from
 *     Batch 8. A provider result alone is never sufficient to drive
 *     finality or write Memory — see
 *     P5_BATCH8_MEMORY_AND_FINALITY_GATING.
 *   - Exceptions / review queues (Batch 6) and dashboards / API v1
 *     (Batch 7) remain unchanged. Batch 8 may FEED them but must not
 *     modify their SSOTs in Phase 1.
 *   - Phase 1 ships NO DB migrations, NO RPCs, NO UI, NO edge
 *     functions, NO cron, NO live provider calls and NO provider
 *     credentials.
 */

export const P5_BATCH8_SCHEMA_VERSION = "p5b8.v1" as const;

// ────────────────────────────────────────────────────────────────────────────
// 1. Provider categories (Q1)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH8_PROVIDER_CATEGORIES = [
  "sanctions_pep_adverse_media",
  "identity_verification",
  "company_registry_kyb",
  "director_ubo_verification",
  "bank_account_verification",
  "payment_confirmation",
  "document_signing_certification",
  "mrv_carbon_geospatial",
  "funder_institutional_dependency",
] as const;

export type P5Batch8ProviderCategory =
  (typeof P5_BATCH8_PROVIDER_CATEGORIES)[number];

export interface P5Batch8ProviderCategoryDefinition {
  readonly code: P5Batch8ProviderCategory;
  readonly label: string;
  readonly preferred_providers: ReadonlyArray<string>;
  readonly fallback: string;
  readonly required_result_type: string;
  /** Live now: per client answer — always false in Phase 1. */
  readonly live_now: false;
  readonly owner_role: P5Batch8OwnerRole;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Provider-ready definition (Q2)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH8_PROVIDER_READY_DEFINITION = {
  approved_definition:
    "Provider-ready means the platform has the correct fields, screens, statuses, audit logs, permission rules, webhook structure and API-safe response fields prepared for that provider category, but no live provider decision has been received unless the status separately says live result received.",
  includes: [
    "configured data structures",
    "provider status labels",
    "result placeholders",
    "decision-state handling",
    "retry/failure rules",
    "manual review routes",
    "provider-dependency dashboard cards",
    "audit logging",
    "API fields",
    "user-safe wording",
  ],
  excludes: [
    "claim that the provider is contracted",
    "claim that the provider is connected",
    "claim that the provider is live",
    "claim that the provider is regulator-approved",
    "claim that the provider is bank-verified",
    "claim that the provider is sanctions-cleared",
    "claim that the provider is identity-verified",
    "claim that the provider is account-verified",
    "claim that the provider is legally certified",
  ],
  visible_to: [
    "platform_admin",
    "operations_admin",
    "compliance_owner",
    "funder_user",
    "api_client",
  ],
  appears_on: [
    "provider_panel",
    "p5_readiness_dashboard",
    "evidence_detail_page",
    "exception_queue",
    "finality_summary",
    "audit_timeline",
    "api_field:provider_dependency_status",
  ],
} as const;

// ────────────────────────────────────────────────────────────────────────────
// 3. Provider dependency states (Q3)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH8_PROVIDER_DEPENDENCY_STATES = [
  "not_configured",
  "awaiting_credentials",
  "provider_ready",
  "test_mode",
  "activation_pending",
  "live_pending",
  "live_result_received",
  "provider_failed",
  "provider_unavailable",
  "manual_review_required",
] as const;

export type P5Batch8ProviderDependencyState =
  (typeof P5_BATCH8_PROVIDER_DEPENDENCY_STATES)[number];

export interface P5Batch8ProviderDependencyStateDefinition {
  readonly code: P5Batch8ProviderDependencyState;
  readonly display_label: string;
  readonly api_value: string;
  readonly visible_to: ReadonlyArray<P5Batch8OwnerRole | "user">;
  readonly meaning: string;
}

export const P5_BATCH8_PROVIDER_DEPENDENCY_STATE_DEFINITIONS: Readonly<
  Record<
    P5Batch8ProviderDependencyState,
    P5Batch8ProviderDependencyStateDefinition
  >
> = {
  not_configured: {
    code: "not_configured",
    display_label: "Not Configured",
    api_value: "not_configured",
    visible_to: ["platform_admin", "operations_admin"],
    meaning: "No provider category or account has been set for this check.",
  },
  awaiting_credentials: {
    code: "awaiting_credentials",
    display_label: "Awaiting Credentials",
    api_value: "provider_pending",
    visible_to: ["platform_admin", "operations_admin", "api_client"],
    meaning:
      "Commercial account may exist or be expected, but credentials, keys, tokens or access approvals have not been supplied.",
  },
  provider_ready: {
    code: "provider_ready",
    display_label: "Provider-Ready",
    api_value: "provider_ready",
    visible_to: [
      "platform_admin",
      "operations_admin",
      "compliance_owner",
      "funder_user",
      "api_client",
    ],
    meaning:
      "Izenzo infrastructure is ready to receive a provider result; no live decision exists yet.",
  },
  test_mode: {
    code: "test_mode",
    display_label: "Test Mode",
    api_value: "test_mode",
    visible_to: ["platform_admin", "operations_admin"],
    meaning:
      "Provider is exercised in test mode only; results never feed Memory, finality or external readiness.",
  },
  activation_pending: {
    code: "activation_pending",
    display_label: "Activation Pending",
    api_value: "activation_pending",
    visible_to: ["platform_admin", "operations_admin"],
    meaning:
      "Credentials exist but live activation sign-off, webhook verification or contract checks are incomplete.",
  },
  live_pending: {
    code: "live_pending",
    display_label: "Live Pending",
    api_value: "live_pending",
    visible_to: ["platform_admin", "operations_admin", "api_client"],
    meaning:
      "Live provider check has been requested and a response is expected.",
  },
  live_result_received: {
    code: "live_result_received",
    display_label: "Live Result Received",
    api_value: "live_result_received",
    visible_to: [
      "platform_admin",
      "operations_admin",
      "compliance_owner",
      "funder_user",
      "api_client",
      "user",
    ],
    meaning:
      "A real live provider result is stored and linked; decision state determines downstream effect.",
  },
  provider_failed: {
    code: "provider_failed",
    display_label: "Provider Failed",
    api_value: "provider_failed",
    visible_to: ["platform_admin", "operations_admin", "compliance_owner"],
    meaning:
      "Provider call failed after retries; never used as a verified or rejected decision.",
  },
  provider_unavailable: {
    code: "provider_unavailable",
    display_label: "Provider Unavailable",
    api_value: "provider_unavailable",
    visible_to: ["platform_admin", "operations_admin", "compliance_owner"],
    meaning:
      "Provider access is currently unavailable; case may route to fallback.",
  },
  manual_review_required: {
    code: "manual_review_required",
    display_label: "Manual Review Required",
    api_value: "manual_review_required",
    visible_to: ["platform_admin", "operations_admin", "compliance_owner"],
    meaning:
      "Provider result is partial, conflicting, sensitive or invalid; human review required.",
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 4. Provider-result decision states (Q6)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH8_PROVIDER_RESULT_DECISION_STATES = [
  "clear",
  "potential_match",
  "confirmed_match",
  "manual_review",
  "false_positive",
  "waived",
  "blocked",
  "incomplete",
  "provider_unavailable",
  "superseded",
] as const;

export type P5Batch8ProviderResultDecisionState =
  (typeof P5_BATCH8_PROVIDER_RESULT_DECISION_STATES)[number];

export interface P5Batch8ProviderResultDecisionDefinition {
  readonly code: P5Batch8ProviderResultDecisionState;
  readonly label: string;
  readonly set_by: ReadonlyArray<P5Batch8OwnerRole>;
  readonly requires_evidence_or_reason: boolean;
  readonly readiness_effect:
    | "supports_readiness"
    | "blocked"
    | "under_review"
    | "may_proceed"
    | "incomplete"
    | "use_latest";
  /** Whether this decision is itself eligible to feed Memory once final. */
  readonly memory_eligible_when_final: boolean;
}

export const P5_BATCH8_PROVIDER_RESULT_DECISION_DEFINITIONS: Readonly<
  Record<
    P5Batch8ProviderResultDecisionState,
    P5Batch8ProviderResultDecisionDefinition
  >
> = {
  clear: {
    code: "clear",
    label: "Clear",
    set_by: ["compliance_owner", "platform_admin"],
    requires_evidence_or_reason: true,
    readiness_effect: "supports_readiness",
    memory_eligible_when_final: true,
  },
  potential_match: {
    code: "potential_match",
    label: "Potential Match",
    set_by: ["compliance_owner", "reviewer", "platform_admin"],
    requires_evidence_or_reason: true,
    readiness_effect: "under_review",
    memory_eligible_when_final: false,
  },
  confirmed_match: {
    code: "confirmed_match",
    label: "Confirmed Match",
    set_by: ["compliance_owner", "platform_admin"],
    requires_evidence_or_reason: true,
    readiness_effect: "blocked",
    memory_eligible_when_final: true,
  },
  manual_review: {
    code: "manual_review",
    label: "Manual Review",
    set_by: ["compliance_owner", "reviewer", "platform_admin"],
    requires_evidence_or_reason: true,
    readiness_effect: "under_review",
    memory_eligible_when_final: false,
  },
  false_positive: {
    code: "false_positive",
    label: "False Positive",
    set_by: ["compliance_owner", "platform_admin"],
    requires_evidence_or_reason: true,
    readiness_effect: "may_proceed",
    memory_eligible_when_final: true,
  },
  waived: {
    code: "waived",
    label: "Waived",
    set_by: ["compliance_owner", "platform_admin"],
    requires_evidence_or_reason: true,
    readiness_effect: "may_proceed",
    memory_eligible_when_final: true,
  },
  blocked: {
    code: "blocked",
    label: "Blocked",
    set_by: ["compliance_owner", "platform_admin"],
    requires_evidence_or_reason: true,
    readiness_effect: "blocked",
    memory_eligible_when_final: true,
  },
  incomplete: {
    code: "incomplete",
    label: "Incomplete",
    set_by: ["reviewer", "compliance_owner", "platform_admin"],
    requires_evidence_or_reason: true,
    readiness_effect: "incomplete",
    memory_eligible_when_final: false,
  },
  provider_unavailable: {
    code: "provider_unavailable",
    label: "Provider Unavailable",
    set_by: ["operations_admin", "platform_admin"],
    requires_evidence_or_reason: false,
    readiness_effect: "incomplete",
    memory_eligible_when_final: false,
  },
  superseded: {
    code: "superseded",
    label: "Superseded",
    set_by: ["platform_admin"],
    requires_evidence_or_reason: false,
    readiness_effect: "use_latest",
    memory_eligible_when_final: false,
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 5. Webhook event vocabulary (Q8)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH8_WEBHOOK_EVENTS = [
  "verification.created",
  "verification.pending",
  "verification.completed",
  "verification.failed",
  "document.required",
  "match.potential",
  "match.cleared",
  "match.confirmed",
  "account.verified",
  "payment.succeeded",
  "payment.failed",
  "payment.cancelled",
  "payment.refunded",
  "chargeback.created",
  "provider.outage",
  "credentials.revoked",
  "webhook.test",
] as const;

export type P5Batch8WebhookEvent = (typeof P5_BATCH8_WEBHOOK_EVENTS)[number];

// ────────────────────────────────────────────────────────────────────────────
// 6. Audit event vocabulary (Q9) — all `p5b8.*`, append-only
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH8_AUDIT_EVENTS = [
  "p5b8.provider_category.enabled",
  "p5b8.provider_category.disabled",
  "p5b8.provider_category.configured",
  "p5b8.provider_credentials.added",
  "p5b8.provider_credentials.replaced",
  "p5b8.provider_credentials.revoked",
  "p5b8.provider_credentials.missing",
  "p5b8.provider_ready.status_created",
  "p5b8.provider_live.activation_signed_off",
  "p5b8.provider_request.initiated",
  "p5b8.provider_response.received",
  "p5b8.webhook.received",
  "p5b8.webhook.duplicate_ignored",
  "p5b8.webhook.signature_failed",
  "p5b8.webhook.test_received",
  "p5b8.provider.failure",
  "p5b8.provider.timeout",
  "p5b8.provider.retry_attempted",
  "p5b8.provider.retry_exhausted",
  "p5b8.provider_decision.manual_set",
  "p5b8.provider_decision.override",
  "p5b8.provider_decision.waiver",
  "p5b8.provider_decision.false_positive",
  "p5b8.provider_decision.blocked",
  "p5b8.provider_decision.fallback",
  "p5b8.provider_payload.viewed",
  "p5b8.provider_payload.exported",
  "p5b8.live_check.blocked_attempt",
  "p5b8.finality.provider_dependency_blocked",
  "p5b8.memory.provider_write_blocked",
] as const;

export type P5Batch8AuditEvent = (typeof P5_BATCH8_AUDIT_EVENTS)[number];

// ────────────────────────────────────────────────────────────────────────────
// 7. Allowed external wording (Q4, Q11)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH8_ALLOWED_EXTERNAL_WORDING = [
  "Provider-ready",
  "Provider access pending",
  "External check pending",
  "External check pending or unavailable",
  "External check in progress",
  "Provider-dependent",
  "Provider-dependent check pending",
  "Manual fallback decision",
  "Manual fallback decision recorded with evidence and audit trail",
  "No live provider result received",
  "External provider access is pending. This check is prepared in the platform, but no live provider result has been received yet.",
  "Please upload the requested evidence so the review can continue.",
  "Izenzo has provider-ready structures for [provider category], including data fields, screens, audit logging, decision states, exception handling, webhook readiness and API-safe status reporting.",
  "This area is provider-ready, not provider-verified. A live provider result will be recorded separately once provider access is active and a result is received.",
  "A screening/result was received from [provider name] on [date/time] under reference [reference ID], and Izenzo recorded the decision state as [decision state].",
  "Bank verification result received from [provider/bank] on [date]",
] as const;

// ────────────────────────────────────────────────────────────────────────────
// 8. Banned external wording (Q2, Q4, Q10, Q11) — drift-guard enforced
// ────────────────────────────────────────────────────────────────────────────

/**
 * Strings that MUST NOT appear in any external surface (UI render, API
 * response, dashboard label, export filename, marketing copy) unless
 * the underlying provider/live fact is true, evidenced and approved.
 * Drift guard greps case-insensitively.
 */
export const P5_BATCH8_BANNED_EXTERNAL_WORDING = [
  "guaranteed clean",
  "risk free",
  "regulator approved",
  "bank verified",
  "sanctions cleared",
  "sanctions clean",
  "KYC passed",
  "KYC complete",
  "provider certified",
  "provider verified",
  "legally final",
  "verified by Mastercard",
  "verified by DBSA",
  "verified by bank",
  "verified by provider",
  "live integrated",
  "live connected",
  "live provider result",
  "guaranteed",
  "cleared",
  "approved by provider",
] as const;

// ────────────────────────────────────────────────────────────────────────────
// 9. API-safe fields (Q4, Q5, Q10) — provider/dependency surface only
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH8_API_SAFE_FIELDS = [
  "provider_category",
  "provider_dependency_status",
  "provider_decision_state",
  "provider_environment",
  "check_type",
  "case_id",
  "subject_id",
  "request_reference",
  "provider_reference",
  "result_status",
  "result_received_at",
  "review_required",
  "fallback_status",
  "stale_as_of",
  "is_stale",
  "manual_fallback_decision",
  "next_action_required",
] as const;

export type P5Batch8ApiSafeField = (typeof P5_BATCH8_API_SAFE_FIELDS)[number];

// ────────────────────────────────────────────────────────────────────────────
// 10. Forbidden external fields (Q4, Q5, Q10) — drift-guard enforced
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH8_FORBIDDEN_EXTERNAL_FIELDS = [
  "raw_provider_payload",
  "raw_provider_response",
  "raw_webhook_payload",
  "raw_provider_error",
  "provider_api_key",
  "provider_api_secret",
  "provider_credential_value",
  "provider_credential_status",
  "provider_account_suspension_reason",
  "provider_commercial_account_status",
  "internal_risk_note",
  "internal_reviewer_note",
  "internal_false_positive_rationale",
  "internal_match_scoring_logic",
  "biometric_payload",
  "liveness_payload_raw",
  "idv_document_image",
  "bank_account_number_raw",
  "bank_account_holder_raw",
  "registry_raw_payload",
  "mrv_raw_gis_data",
  "private_field_notes",
  "webhook_signature_secret",
  "idempotency_key_internal",
] as const;

export type P5Batch8ForbiddenField =
  (typeof P5_BATCH8_FORBIDDEN_EXTERNAL_FIELDS)[number];

// ────────────────────────────────────────────────────────────────────────────
// 11. Ownership roles (Q12)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH8_OWNER_ROLES = [
  "izenzo_ceo",
  "izenzo_commercial_owner",
  "izenzo_compliance_owner",
  "izenzo_product_owner",
  "izenzo_finance_owner",
  "izenzo_data_owner",
  "izenzo_project_owner",
  "izenzo_platform_admin",
  "platform_admin",
  "operations_admin",
  "compliance_owner",
  "reviewer",
  "technical_integrator",
  "bank_counterpart",
  "funder_counterpart",
  "mrv_governance_owner",
  "funder_user",
  "api_client",
] as const;

export type P5Batch8OwnerRole = (typeof P5_BATCH8_OWNER_ROLES)[number];

export interface P5Batch8ProviderOwnershipDefinition {
  readonly category: P5Batch8ProviderCategory;
  readonly commercial_owner: P5Batch8OwnerRole;
  readonly technical_contact: P5Batch8OwnerRole;
  readonly credential_owner: P5Batch8OwnerRole;
  readonly approval_owner: P5Batch8OwnerRole;
  readonly activation_signoff_owner: P5Batch8OwnerRole;
}

export const P5_BATCH8_PROVIDER_OWNERSHIP: Readonly<
  Record<P5Batch8ProviderCategory, P5Batch8ProviderOwnershipDefinition>
> = {
  sanctions_pep_adverse_media: {
    category: "sanctions_pep_adverse_media",
    commercial_owner: "izenzo_ceo",
    technical_contact: "technical_integrator",
    credential_owner: "izenzo_platform_admin",
    approval_owner: "izenzo_compliance_owner",
    activation_signoff_owner: "izenzo_ceo",
  },
  identity_verification: {
    category: "identity_verification",
    commercial_owner: "izenzo_product_owner",
    technical_contact: "technical_integrator",
    credential_owner: "izenzo_platform_admin",
    approval_owner: "izenzo_compliance_owner",
    activation_signoff_owner: "izenzo_ceo",
  },
  company_registry_kyb: {
    category: "company_registry_kyb",
    commercial_owner: "izenzo_data_owner",
    technical_contact: "technical_integrator",
    credential_owner: "izenzo_data_owner",
    approval_owner: "izenzo_compliance_owner",
    activation_signoff_owner: "izenzo_ceo",
  },
  director_ubo_verification: {
    category: "director_ubo_verification",
    commercial_owner: "izenzo_compliance_owner",
    technical_contact: "technical_integrator",
    credential_owner: "izenzo_platform_admin",
    approval_owner: "izenzo_compliance_owner",
    activation_signoff_owner: "izenzo_compliance_owner",
  },
  bank_account_verification: {
    category: "bank_account_verification",
    commercial_owner: "izenzo_ceo",
    technical_contact: "bank_counterpart",
    credential_owner: "bank_counterpart",
    approval_owner: "izenzo_compliance_owner",
    activation_signoff_owner: "bank_counterpart",
  },
  payment_confirmation: {
    category: "payment_confirmation",
    commercial_owner: "izenzo_finance_owner",
    technical_contact: "technical_integrator",
    credential_owner: "izenzo_finance_owner",
    approval_owner: "izenzo_finance_owner",
    activation_signoff_owner: "izenzo_ceo",
  },
  document_signing_certification: {
    category: "document_signing_certification",
    commercial_owner: "izenzo_product_owner",
    technical_contact: "technical_integrator",
    credential_owner: "izenzo_platform_admin",
    approval_owner: "izenzo_compliance_owner",
    activation_signoff_owner: "izenzo_ceo",
  },
  mrv_carbon_geospatial: {
    category: "mrv_carbon_geospatial",
    commercial_owner: "izenzo_project_owner",
    technical_contact: "technical_integrator",
    credential_owner: "izenzo_platform_admin",
    approval_owner: "mrv_governance_owner",
    activation_signoff_owner: "izenzo_ceo",
  },
  funder_institutional_dependency: {
    category: "funder_institutional_dependency",
    commercial_owner: "izenzo_project_owner",
    technical_contact: "technical_integrator",
    credential_owner: "funder_counterpart",
    approval_owner: "funder_counterpart",
    activation_signoff_owner: "izenzo_project_owner",
  },
};

export const P5_BATCH8_PROVIDER_CATEGORY_DEFINITIONS: Readonly<
  Record<P5Batch8ProviderCategory, P5Batch8ProviderCategoryDefinition>
> = {
  sanctions_pep_adverse_media: {
    code: "sanctions_pep_adverse_media",
    label: "Sanctions / PEP / Adverse Media Screening",
    preferred_providers: ["Dilisense"],
    fallback: "Dow Jones, Refinitiv or ComplyAdvantage",
    required_result_type:
      "screening result, match status, risk band, list/source reference, date/time and decision state",
    live_now: false,
    owner_role: "izenzo_commercial_owner",
  },
  identity_verification: {
    code: "identity_verification",
    label: "Identity Verification / KYC",
    preferred_providers: ["Smile ID", "Onfido", "Sumsub"],
    fallback: "Trulioo or manual identity evidence review",
    required_result_type:
      "document verification, liveness/selfie result where used, identity match, reference ID and decision state",
    live_now: false,
    owner_role: "izenzo_compliance_owner",
  },
  company_registry_kyb: {
    code: "company_registry_kyb",
    label: "Company Registry / KYB",
    preferred_providers: [
      "CIPC",
      "Companies House",
      "B2BHint",
      "InfobelPro",
      "GlobalDatabase",
    ],
    fallback:
      "manual company documents, certificates, director registers and independently sourced registry extracts",
    required_result_type:
      "entity match, registration number, legal status, director/UBO signals, source date and confidence",
    live_now: false,
    owner_role: "izenzo_data_owner",
  },
  director_ubo_verification: {
    code: "director_ubo_verification",
    label: "Director / UBO Verification",
    preferred_providers: ["registry source", "IDV provider"],
    fallback:
      "manual board resolution, authority letter, shareholder register, certified ID and admin review",
    required_result_type:
      "authority confirmed, authority disputed, authority incomplete or manual review required",
    live_now: false,
    owner_role: "izenzo_compliance_owner",
  },
  bank_account_verification: {
    code: "bank_account_verification",
    label: "Bank Account / Beneficiary Verification",
    preferred_providers: [
      "bank-side verification where the bank controls consent",
    ],
    fallback:
      "approved AVS/bank-verification provider, proof of bank account, beneficiary confirmation and manual exception review",
    required_result_type:
      "account match status, beneficiary match confidence, bank reference, date/time and decision state",
    live_now: false,
    owner_role: "izenzo_commercial_owner",
  },
  payment_confirmation: {
    code: "payment_confirmation",
    label: "Payment Confirmation / Reconciliation",
    preferred_providers: ["Paystack", "PayFast"],
    fallback:
      "manual reconciliation, bank statement evidence and admin review",
    required_result_type:
      "transaction reference, amount, currency, payment status, webhook/ITN state, refund/chargeback state and final payment decision",
    live_now: false,
    owner_role: "izenzo_finance_owner",
  },
  document_signing_certification: {
    code: "document_signing_certification",
    label: "Document Signing / Notarisation / Certification",
    preferred_providers: ["Izenzo DNP/DCX structures"],
    fallback: "manual signed document upload and admin certification",
    required_result_type:
      "signed/notarised/certified status, signer identity, timestamp, hash, certificate/reference ID",
    live_now: false,
    owner_role: "izenzo_product_owner",
  },
  mrv_carbon_geospatial: {
    code: "mrv_carbon_geospatial",
    label: "MRV / Carbon / Geospatial Verification",
    preferred_providers: [
      "CarbonTrack MRV",
      "Verra-linked evidence processes",
      "approved satellite/geospatial data sources",
    ],
    fallback:
      "field evidence, GPS-tagged uploads, dated images and manual verifier review",
    required_result_type:
      "plot/farmer/project reference, MRV status, evidence timestamp, confidence and decision state",
    live_now: false,
    owner_role: "izenzo_project_owner",
  },
  funder_institutional_dependency: {
    code: "funder_institutional_dependency",
    label: "Funder / Institutional Review Dependency",
    preferred_providers: ["named funder or institution"],
    fallback: "Izenzo project owner manual escalation",
    required_result_type:
      "review requested, under review, clarification requested, approved, declined, waived or expired",
    live_now: false,
    owner_role: "izenzo_project_owner",
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 12. Memory / finality gating rules
// ────────────────────────────────────────────────────────────────────────────

/**
 * Provider-result Memory/finality gating SSOT.
 *
 * A provider result alone is NEVER sufficient to:
 *   - mark finality reached;
 *   - write a Memory record;
 *   - mutate any Batch 5 finality_records or memory_records row.
 *
 * Phase 1 ships rules only — no DB, no RPC. Later phases must read these
 * constants when wiring writes.
 */
export const P5_BATCH8_MEMORY_AND_FINALITY_GATING = {
  provider_alone_can_drive_finality: false,
  provider_alone_can_write_memory: false,
  test_mode_can_feed_memory: false,
  test_mode_can_feed_finality: false,
  test_webhook_can_update_readiness: false,
  required_for_finality: [
    "decision_state_in_final_set",
    "compliance_clearance_complete",
    "admin_review_complete",
  ],
  decision_states_eligible_for_memory_when_final:
    P5_BATCH8_PROVIDER_RESULT_DECISION_STATES.filter(
      (s) =>
        s === "clear" ||
        s === "confirmed_match" ||
        s === "false_positive" ||
        s === "waived" ||
        s === "blocked",
    ),
  decision_states_blocked_from_memory: [
    "potential_match",
    "manual_review",
    "incomplete",
    "provider_unavailable",
    "superseded",
  ],
  fallback_must_be_labelled_as: "manual fallback decision",
  fallback_must_not_be_labelled_as: "live provider verified",
} as const;

// ────────────────────────────────────────────────────────────────────────────
// 13. Retry / failure policy (Q7) — data-only
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH8_FAILURE_POLICY = {
  timeout: {
    retry_count: 2,
    backoff: "exponential",
    on_exhausted_state: "provider_failed",
    user_message: "External check pending or unavailable",
    never_imply: ["verified", "failed KYC", "rejected"],
  },
  provider_5xx: {
    retry_count: 2,
    backoff: "provider_policy",
    on_exhausted_state: "provider_unavailable",
    escalate_to: "operations_admin",
  },
  auth_failure: {
    retry_count: 0,
    on_state: "awaiting_credentials",
    alert: "platform_admin",
    block_live_check: true,
  },
  rate_limit: {
    behaviour: "hold_and_queue",
    alert_if_sla_breached: "platform_admin",
    user_message: "External check in progress",
  },
  malformed_response: {
    behaviour: "store_raw_admin_only",
    on_state: "manual_review_required",
  },
  inconclusive: {
    behaviour: "request_evidence_if_user_can_cure",
    on_state: "manual_review_required",
  },
  webhook_duplicate: {
    behaviour: "idempotency_key_dedupe",
    on_mismatch_state: "manual_review_required",
  },
} as const;

// ────────────────────────────────────────────────────────────────────────────
// 14. Hidden-until-live items (Q10)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH8_HIDDEN_UNTIL_LIVE = [
  "run_live_check_button",
  "pass_fail_result_badges",
  "verified_by_provider_wording",
  "provider_scores",
  "raw_result_panels",
  "match_details",
  "provider_references_external",
  "auto_finality_from_provider_fields",
  "memory_writes_from_provider_fields",
  "webhook_event_processing_user_facing",
  "commercial_dashboard_kyc_complete_claim",
  "commercial_dashboard_sanctions_cleared_claim",
  "commercial_dashboard_bank_verified_claim",
  "commercial_dashboard_provider_verified_claim",
] as const;

// ────────────────────────────────────────────────────────────────────────────
// 15. Phase-1 scope guards (data-only)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH8_PHASE_1_SCOPE = {
  ships: [
    "ssot_registry",
    "provider_categories",
    "provider_ready_definition",
    "provider_dependency_states",
    "provider_result_decision_states",
    "webhook_event_vocabulary",
    "audit_event_vocabulary",
    "allowed_wording",
    "banned_wording",
    "api_safe_fields",
    "forbidden_external_fields",
    "ownership_roles",
    "memory_finality_gating_rules",
    "evidence_readme",
    "registry_contract_tests",
    "drift_guard",
  ],
  does_not_ship: [
    "db_migrations",
    "rpcs",
    "ui",
    "edge_functions",
    "cron",
    "live_provider_calls",
    "provider_credentials",
    "payment_provider_changes",
    "memory_or_finality_mutations",
    "batch_6_changes",
    "batch_7_surfaces",
  ],
} as const;
