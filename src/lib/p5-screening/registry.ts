/**
 * P-5 Screening & IDV Provider-Ready Flow — Phase 1 SSOT
 *
 * Browser-safe mirror of the canonical screening & IDV vocabulary.
 * Pinned by scripts/check-p5-screening-phase-1-registry.mjs.
 *
 * This file is provider-ready only. It does not perform any live provider
 * call, does not contain credentials, and does not claim live verification.
 * Banned wording is listed for guard-pinning only and must never leak to
 * any external (user / funder / API / Memory) surface.
 */

// -- Check categories ---------------------------------------------------------

export const P5_SCR_CHECK_CATEGORIES = [
  "company_aml_sanctions",
  "pep",
  "watchlist_name",
  "idv_person",
  "adverse_media_admin_triggered",
] as const;
export type P5ScrCheckCategory = (typeof P5_SCR_CHECK_CATEGORIES)[number];

// -- Party roles --------------------------------------------------------------

export const P5_SCR_PARTY_ROLES = [
  "buyer_company",
  "seller_company",
  "buyer_authorised_representative",
  "seller_authorised_representative",
  "funder_representative",
  "admin_user",
  "agent_or_introducer",
  "required_counterparty",
  "director_if_relied",
  "ubo_if_acting",
] as const;
export type P5ScrPartyRole = (typeof P5_SCR_PARTY_ROLES)[number];

/** Roles that require live IDV by default. */
export const P5_SCR_IDV_REQUIRED_ROLES: ReadonlyArray<P5ScrPartyRole> = [
  "buyer_authorised_representative",
  "seller_authorised_representative",
  "funder_representative",
  "admin_user",
  "agent_or_introducer",
];

/** Roles that do NOT require IDV by default. */
export const P5_SCR_IDV_NOT_REQUIRED_BY_DEFAULT_ROLES: ReadonlyArray<P5ScrPartyRole> = [
  "director_if_relied",
  "ubo_if_acting",
];

// -- Check states -------------------------------------------------------------

export const P5_SCR_CHECK_STATES = [
  "not_required",
  "not_started",
  "screening_pending",
  "idv_pending",
  "provider_pending",
  "manual_review_required",
  "screening_expired",
  "cleared",
  "cleared_with_conditions",
  "failed",
  "rejected",
] as const;
export type P5ScrCheckState = (typeof P5_SCR_CHECK_STATES)[number];

/** States considered "clear" for downstream gates. */
export const P5_SCR_CLEAR_STATES: ReadonlyArray<P5ScrCheckState> = [
  "cleared",
  "cleared_with_conditions",
  "not_required",
];

/** Unresolved states that block hard gates (WaD seal / finality / funder-ready / API ready). */
export const P5_SCR_UNRESOLVED_STATES: ReadonlyArray<P5ScrCheckState> = [
  "not_started",
  "screening_pending",
  "idv_pending",
  "provider_pending",
  "manual_review_required",
  "screening_expired",
  "failed",
  "rejected",
];

// -- Reuse / freshness --------------------------------------------------------

export const P5_SCR_SCREENING_REUSE_MAX_AGE_DAYS = 90;
export const P5_SCR_SCREENING_REUSE_MAX_AGE_MS =
  P5_SCR_SCREENING_REUSE_MAX_AGE_DAYS * 86_400_000;

export const P5_SCR_REUSE_INVALIDATION_TRIGGERS = [
  "core_details_changed",
  "new_required_party_added",
  "unresolved_review_exists",
  "provider_invalidated_result",
  "admin_required_recheck",
] as const;
export type P5ScrReuseInvalidationTrigger =
  (typeof P5_SCR_REUSE_INVALIDATION_TRIGGERS)[number];

export function p5ScrIsReusable(args: {
  decided_at_ms: number;
  now_ms?: number;
  invalidation_triggers?: ReadonlyArray<P5ScrReuseInvalidationTrigger>;
}): boolean {
  const now = args.now_ms ?? Date.now();
  if ((args.invalidation_triggers?.length ?? 0) > 0) return false;
  return now - args.decided_at_ms <= P5_SCR_SCREENING_REUSE_MAX_AGE_MS;
}

// -- Gate matrix --------------------------------------------------------------

export const P5_SCR_GATES = [
  "poi_create",
  "poi_accept",
  "wad_create",
  "wad_seal",
  "trade_approval",
  "funder_visibility",
  "funder_ready",
  "finality",
  "api_ready_true",
] as const;
export type P5ScrGate = (typeof P5_SCR_GATES)[number];

/**
 * Which gates a given unresolved state blocks.
 *
 * POI create / POI accept / WaD create are commercially light and are NEVER
 * blocked by pending screening/IDV alone. They are only blocked by an admin
 * freeze or a confirmed-block state — represented here by `failed` / `rejected`.
 */
export const P5_SCR_GATE_BLOCK_MATRIX: Record<P5ScrCheckState, ReadonlyArray<P5ScrGate>> = {
  not_required: [],
  not_started: ["wad_seal", "trade_approval", "funder_visibility", "funder_ready", "finality", "api_ready_true"],
  screening_pending: ["wad_seal", "trade_approval", "funder_visibility", "funder_ready", "finality", "api_ready_true"],
  idv_pending: ["wad_seal", "trade_approval", "funder_visibility", "funder_ready", "finality", "api_ready_true"],
  provider_pending: ["wad_seal", "trade_approval", "funder_visibility", "funder_ready", "finality", "api_ready_true"],
  manual_review_required: ["wad_seal", "trade_approval", "funder_visibility", "funder_ready", "finality", "api_ready_true"],
  screening_expired: ["wad_seal", "trade_approval", "funder_visibility", "funder_ready", "finality", "api_ready_true"],
  failed: ["poi_create", "poi_accept", "wad_create", "wad_seal", "trade_approval", "funder_visibility", "funder_ready", "finality", "api_ready_true"],
  rejected: ["poi_create", "poi_accept", "wad_create", "wad_seal", "trade_approval", "funder_visibility", "funder_ready", "finality", "api_ready_true"],
  cleared: [],
  cleared_with_conditions: [],
};

// -- Wording ------------------------------------------------------------------

/** Allowed external wording (verbatim). */
export const P5_SCR_ALLOWED_EXTERNAL_WORDING = [
  "Screening pending",
  "Provider pending",
  "Manual review required",
  "Action required",
  "Identity verification required",
  "Transaction blocked pending review",
  "Screening expired",
  "Not ready - counterparty checks pending",
  "WaD blocked pending verification",
  "Finality blocked pending verification",
] as const;

/** Banned external wording. Must never appear in any external surface. */
export const P5_SCR_BANNED_EXTERNAL_WORDING = [
  "sanctions hit",
  "sanctioned",
  "pep hit",
  "blacklisted",
  "fraud",
  "criminal",
  "high risk",
  "match confirmed",
  "blocked permanently",
  "illegal",
  "suspicious",
  "guilty",
  "raw provider result",
  "match score",
  "list name",
] as const;

// -- Memory-banned payload kinds ---------------------------------------------

export const P5_SCR_MEMORY_BANNED_PAYLOAD_KINDS = [
  "raw_provider_payload",
  "id_image",
  "selfie",
  "biometric",
  "unresolved_possible_match",
  "provider_pending_state",
  "raw_adverse_media",
] as const;
export type P5ScrMemoryBannedPayloadKind =
  (typeof P5_SCR_MEMORY_BANNED_PAYLOAD_KINDS)[number];

// -- Audit vocabulary ---------------------------------------------------------

export const P5_SCR_AUDIT_EVENTS = [
  "p5_screening.check_requested",
  "p5_screening.provider_pending_recorded",
  "p5_screening.result_recorded",
  "p5_screening.result_reused",
  "p5_screening.result_expired",
  "p5_screening.manual_review_opened",
  "p5_screening.manual_review_decided",
  "p5_screening.possible_sanctions_match_opened",
  "p5_screening.pep_review_opened",
  "p5_screening.adverse_media_triggered_by_admin",
  "p5_screening.idv_required",
  "p5_screening.idv_completed",
  "p5_screening.idv_failed",
  "p5_screening.gate_blocked",
  "p5_screening.gate_cleared",
  "p5_screening.api_readiness_evaluated",
  "p5_screening.memory_link_recorded",
] as const;
export type P5ScrAuditEvent = (typeof P5_SCR_AUDIT_EVENTS)[number];

// -- Webhook vocabulary -------------------------------------------------------

export const P5_SCR_WEBHOOK_EVENTS = [
  "p5_screening.webhook.result_received",
  "p5_screening.webhook.provider_pending",
  "p5_screening.webhook.provider_invalidated",
  "p5_screening.webhook.idv_completed",
  "p5_screening.webhook.idv_failed",
] as const;
export type P5ScrWebhookEvent = (typeof P5_SCR_WEBHOOK_EVENTS)[number];

// -- API-safe field allowlist -------------------------------------------------

export const P5_SCR_API_SAFE_FIELDS = [
  "ready",
  "readiness_status",
  "blockers",
  "affected_party",
  "affected_check",
  "last_checked_at",
  "expires_at",
  "admin_review_required",
  "provider_pending",
  "retry_pending",
] as const;
export type P5ScrApiSafeField = (typeof P5_SCR_API_SAFE_FIELDS)[number];

/** Fields that must NEVER appear in API-safe projections. */
export const P5_SCR_API_FORBIDDEN_FIELDS = [
  "raw_provider_payload",
  "provider_api_secret",
  "id_image",
  "selfie",
  "biometric_template",
  "match_score",
  "list_name",
  "raw_adverse_media",
] as const;
