/**
 * Batch 24 — Registry Operating Rules SSOT (Deno mirror).
 *
 * Source of truth for the client's completed Business Registry Operating
 * Rules Questionnaire (received 21 June 2026). This module is mirrored
 * verbatim at `supabase/functions/_shared/registry-operating-rules.ts`
 * for Deno edge functions, with a parity guard in
 * `scripts/check-registry-operating-rules-parity.mjs`.
 *
 * This file is data + pure helpers only. No I/O, no React. It cannot
 * change readiness on its own — it only encodes the gates so every
 * surface (UI, edge, docs, guards, tests) reasons from the same rules.
 *
 * The client decision source for every export below is:
 *   docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx
 */

// ───────────────────────────── Readiness states ────────────────────────────

export const REGISTRY_READINESS_STATES = [
  "public_search_ready",
  "demo_ready",
  "api_output_ready",
  "imported_sourced",
  "seed_only",
  "sample_only",
  "demo_only",
  "licence_pending",
  "provider_pending",
  "quarantined",
  "duplicate_unresolved",
  "disputed",
  "privacy_hold",
  "field_not_public",
  "production_live",
] as const;
export type RegistryReadinessState = (typeof REGISTRY_READINESS_STATES)[number];

/** Readiness states that MUST NOT appear in ordinary public search. */
export const REGISTRY_PUBLIC_SEARCH_BLOCKED_STATES: readonly RegistryReadinessState[] = [
  "imported_sourced",
  "seed_only",
  "sample_only",
  "demo_only",
  "licence_pending",
  "provider_pending",
  "quarantined",
  "duplicate_unresolved",
  "disputed",
  "privacy_hold",
  "field_not_public",
];

/** Readiness states that MUST NOT appear in production API output. */
export const REGISTRY_API_OUTPUT_BLOCKED_STATES: readonly RegistryReadinessState[] = [
  "seed_only",
  "sample_only",
  "demo_only",
  "provider_pending",
  "disputed",
  "duplicate_unresolved",
];

// ─────────────────────────── Field-group readiness ─────────────────────────

export const REGISTRY_FIELD_GROUPS = [
  "core_identity",
  "registration_identifiers",
  "jurisdiction_country",
  "registered_address",
  "trading_address",
  "officers_directors_members",
  "beneficial_ownership_ubo",
  "contact_details",
  "tax_vat",
  "filings_events",
  "claim_status",
  "authority_status",
  "bank_detail_status",
  "documents_evidence",
  "public_profile_display",
  "demo_display",
  "api_output",
] as const;
export type RegistryFieldGroup = (typeof REGISTRY_FIELD_GROUPS)[number];

// ──────────────────────────── Country capability ───────────────────────────

export const REGISTRY_COUNTRY_CAPABILITY_STATES = [
  "no_coverage",
  "seed_only",
  "sample_only",
  "dataset_acquired",
  "search_ready",
  "api_ready",
  "production_live",
] as const;
export type RegistryCountryCapabilityState =
  (typeof REGISTRY_COUNTRY_CAPABILITY_STATES)[number];

// ───────────────────────────── Approval roles ──────────────────────────────

export const REGISTRY_APPROVAL_ROLES = [
  "platform_admin",
  "data_governance_owner",
  "compliance_owner",
  "technical_admin",
] as const;
export type RegistryApprovalRole = (typeof REGISTRY_APPROVAL_ROLES)[number];

/**
 * Approval count required to change readiness for a given scope. Per
 * client rule: 1 approval for internal/admin-only; 2 approvals for
 * public display, API output, bank-status exposure, country readiness
 * and provider readiness.
 */
export type ReadinessScope =
  | "internal_admin_only"
  | "public_display"
  | "api_output"
  | "bank_status_exposure"
  | "country_readiness"
  | "provider_readiness";

export const REGISTRY_REQUIRED_APPROVAL_COUNT: Record<ReadinessScope, 1 | 2> = {
  internal_admin_only: 1,
  public_display: 2,
  api_output: 2,
  bank_status_exposure: 2,
  country_readiness: 2,
  provider_readiness: 2,
};

/** Required roles by scope (subset must be satisfied). */
export const REGISTRY_REQUIRED_APPROVAL_ROLES: Record<
  ReadinessScope,
  readonly RegistryApprovalRole[]
> = {
  internal_admin_only: ["platform_admin"],
  public_display: ["platform_admin", "data_governance_owner"],
  api_output: ["platform_admin", "data_governance_owner"],
  bank_status_exposure: ["platform_admin", "compliance_owner"],
  country_readiness: ["platform_admin", "data_governance_owner"],
  provider_readiness: ["platform_admin", "data_governance_owner"],
};

// ─────────────────────── Business decisions (gates) ────────────────────────

export const REGISTRY_BUSINESS_DECISION_TYPES = [
  "public_display",
  "api_output",
  "outreach",
  "demo_use",
  "commercial_use",
  "field_exposure",
  "country_search_activation",
  "provider_activation",
  "bank_status_exposure",
  "officer_or_contact_detail_exposure",
  "authority_to_act_approval",
  "production_api_access",
  "data_import",
  "correction_override",
  "duplicate_merge",
] as const;
export type RegistryBusinessDecisionType =
  (typeof REGISTRY_BUSINESS_DECISION_TYPES)[number];

/**
 * Default review periods (days). When a decision is older than this it
 * MUST be renewed or retired before the gated action runs again.
 */
export const REGISTRY_BUSINESS_DECISION_REVIEW_DAYS: Record<
  RegistryBusinessDecisionType,
  number
> = {
  public_display: 365,
  api_output: 365,
  outreach: 365,
  demo_use: 90,
  commercial_use: 365,
  field_exposure: 180,
  country_search_activation: 365,
  provider_activation: 365,
  bank_status_exposure: 180,
  officer_or_contact_detail_exposure: 180,
  authority_to_act_approval: 365,
  production_api_access: 365,
  data_import: 365,
  correction_override: 365,
  duplicate_merge: 365,
};

/** Triggers that force an immediate review regardless of expiry date. */
export const REGISTRY_BUSINESS_DECISION_IMMEDIATE_REVIEW_TRIGGERS = [
  "licence_change",
  "provider_change",
  "dispute",
  "data_breach",
  "material_complaint",
  "country_coverage_change",
] as const;
export type RegistryBusinessDecisionImmediateReviewTrigger =
  (typeof REGISTRY_BUSINESS_DECISION_IMMEDIATE_REVIEW_TRIGGERS)[number];

// ─────────────────────────── Protected wording ─────────────────────────────

/**
 * Words/phrases that may only appear in registry UI/API/docs when the
 * exact paired state below is approved and current. The guard at
 * `scripts/check-registry-operating-rules-parity.mjs` (and per-batch
 * wording guards) refuse the word when that state is not satisfied.
 */
export const REGISTRY_PROTECTED_WORDING: ReadonlyArray<{
  word: string;
  allowed_when: string;
}> = [
  { word: "Verified", allowed_when: "field_or_module:verification_complete" },
  { word: "Bank verified", allowed_when: "bank:bank_verification_complete_and_current" },
  { word: "API ready", allowed_when: "module:api_output_ready_and_current" },
  { word: "Live", allowed_when: "module:production_live_for_country_and_provider" },
  { word: "Claimed", allowed_when: "claim:claim_approved" },
  { word: "Authority approved", allowed_when: "authority:authority_active" },
];

/**
 * Words that are ALWAYS blocked in registry UI/API/docs unless a
 * separate compliance/legal wording decision has been recorded. There
 * is no implicit state that satisfies these.
 */
export const REGISTRY_ALWAYS_BLOCKED_WORDING: readonly string[] = [
  "Cleared",
  "Compliant",
  "Guaranteed",
  "Approved by bank",
  "Trusted",
  "Safe",
  "Risk-free",
];

/** Safe fallback wording for situations where protected words don't qualify. */
export const REGISTRY_FALLBACK_WORDING: readonly string[] = [
  "sourced",
  "submitted",
  "admin-reviewed",
  "not independently verified",
  "provider pending",
];

// ─────────────────────── Client-approved label strings ─────────────────────

export const REGISTRY_READINESS_LABELS: Record<string, string> = {
  seed_only:
    "Seed-only data - used for setup and testing. Not available for live client reliance.",
  sample_only:
    "Sample-only data - limited demonstration record. Not production coverage.",
  provider_pending:
    "Provider pending - data or verification provider not yet approved for live use.",
  licence_pending:
    "Licence pending - display or API use is not yet approved.",
  search_ready:
    "Search-ready - record may appear in search based on the approved sources shown.",
  api_pending:
    "API pending - not available for production API output.",
  not_independently_verified:
    "This information is sourced from the records shown and has not been independently verified by Izenzo.",
  demo_only:
    "Demo only - shown for controlled demonstration. Not production data or verification.",
  manual_evidence_reviewed:
    "Manual evidence reviewed - no live provider check is represented.",
  api_not_ready: "Not available for production API output.",
  demo_ready:
    "Demo-ready - controlled demonstration data. Not production verified.",
  demo_only_search_disclaimer:
    "Demo only - not public registry output",
  not_approved_admin_only: "Not approved for this use yet",
  built_data_pending: "Built - data/use approval pending",
  data_loaded_workflow_inactive: "Data loaded - workflow not active",
};

// ─────────────────────────────── Audit names ───────────────────────────────

export const REGISTRY_OPERATING_RULES_AUDIT_NAMES = [
  "registry.readiness_changed",
  "registry.readiness_change_blocked_missing_approval",
  "registry.business_decision_recorded",
  "registry.business_decision_expired",
  "registry.business_decision_renewed",
  "registry.public_display_blocked_no_decision",
  "registry.api_output_blocked_no_decision",
  "registry.demo_use_blocked_no_decision",
  "registry.protected_wording_blocked",
] as const;
export type RegistryOperatingRulesAuditName =
  (typeof REGISTRY_OPERATING_RULES_AUDIT_NAMES)[number];

// ────────────────────────── Build vs data readiness ────────────────────────

export const REGISTRY_READINESS_DASHBOARD_SECTIONS = [
  "platform_build_status",
  "country_coverage",
  "source_licence_readiness",
  "dataset_import_readiness",
  "public_search_readiness",
  "claim_workflow_readiness",
  "authority_workflow_readiness",
  "bank_capture_readiness",
  "bank_verification_readiness",
  "provider_integration_readiness",
  "api_sandbox_readiness",
  "api_production_readiness",
  "commercial_billing_readiness",
] as const;
export type RegistryReadinessDashboardSection =
  (typeof REGISTRY_READINESS_DASHBOARD_SECTIONS)[number];

// ──────────────────────────────── Helpers ──────────────────────────────────

export interface ReadinessGateInput {
  record_state: RegistryReadinessState;
  country_search_ready: boolean;
  provenance_recorded: boolean;
  licence_permits_public_search: boolean;
  minimum_searchable_fields_present: boolean;
  public_display_decision_current: boolean;
  has_unresolved_hold: boolean; // licence / dispute / privacy / duplicate / country
}

/**
 * Returns true ONLY when every public-search precondition required by
 * the client's operating rules is satisfied.
 */
export function isPublicSearchAllowed(i: ReadinessGateInput): boolean {
  if (i.record_state !== "public_search_ready") return false;
  if (!i.country_search_ready) return false;
  if (!i.provenance_recorded) return false;
  if (!i.licence_permits_public_search) return false;
  if (!i.minimum_searchable_fields_present) return false;
  if (!i.public_display_decision_current) return false;
  if (i.has_unresolved_hold) return false;
  if (REGISTRY_PUBLIC_SEARCH_BLOCKED_STATES.includes(i.record_state)) return false;
  return true;
}

export interface ApiOutputGateInput {
  record_state: RegistryReadinessState;
  field_group_state: RegistryReadinessState;
  country_api_ready: boolean;
  field_level_provenance_recorded: boolean;
  licence_permitted_use_recorded: boolean;
  api_output_decision_current: boolean;
  no_unresolved_dispute: boolean;
  no_privacy_or_compliance_hold: boolean;
  api_client_scope_approved: boolean;
  field_is_admin_only: boolean;
  field_is_not_api_ready: boolean;
}

export function isApiOutputAllowed(i: ApiOutputGateInput): boolean {
  if (i.field_is_admin_only) return false;
  if (i.field_is_not_api_ready) return false;
  if (REGISTRY_API_OUTPUT_BLOCKED_STATES.includes(i.record_state)) return false;
  if (REGISTRY_API_OUTPUT_BLOCKED_STATES.includes(i.field_group_state)) return false;
  if (i.field_group_state !== "api_output_ready") return false;
  if (!i.country_api_ready) return false;
  if (!i.field_level_provenance_recorded) return false;
  if (!i.licence_permitted_use_recorded) return false;
  if (!i.api_output_decision_current) return false;
  if (!i.no_unresolved_dispute) return false;
  if (!i.no_privacy_or_compliance_hold) return false;
  if (!i.api_client_scope_approved) return false;
  return true;
}

export interface DemoGateInput {
  record_state: RegistryReadinessState;
  is_uat_or_test_record: boolean;
  source_recorded: boolean;
  licence_evidence_recorded: boolean;
  demo_decision_current: boolean;
  compliance_owner_approval_if_sensitive: boolean;
  includes_sensitive_demo_content: boolean;
}

export function isDemoAllowed(i: DemoGateInput): boolean {
  const allowedState =
    i.is_uat_or_test_record ||
    i.record_state === "public_search_ready" ||
    i.record_state === "demo_ready";
  if (!allowedState) return false;
  if (!i.source_recorded) return false;
  if (!i.licence_evidence_recorded) return false;
  if (!i.demo_decision_current) return false;
  if (i.includes_sensitive_demo_content && !i.compliance_owner_approval_if_sensitive) {
    return false;
  }
  return true;
}

/**
 * True iff at least the required number of distinct approvers with the
 * required roles have signed off for this scope.
 */
export function hasSufficientApprovals(
  scope: ReadinessScope,
  approvers: ReadonlyArray<{ role: RegistryApprovalRole }>,
): boolean {
  const required = REGISTRY_REQUIRED_APPROVAL_COUNT[scope];
  const allowed = new Set(REGISTRY_REQUIRED_APPROVAL_ROLES[scope]);
  const distinctRoles = new Set(
    approvers.map((a) => a.role).filter((r) => allowed.has(r)),
  );
  return distinctRoles.size >= required;
}

export interface BusinessDecisionRecord {
  decision_type: RegistryBusinessDecisionType;
  decided_at: string | Date;
  retired_at?: string | Date | null;
  immediate_review_required?: boolean;
}

export function isBusinessDecisionCurrent(
  d: BusinessDecisionRecord,
  now: Date = new Date(),
): boolean {
  if (d.retired_at) return false;
  if (d.immediate_review_required) return false;
  const decided = new Date(d.decided_at);
  if (Number.isNaN(decided.getTime())) return false;
  const days = (now.getTime() - decided.getTime()) / (1000 * 60 * 60 * 24);
  return days < REGISTRY_BUSINESS_DECISION_REVIEW_DAYS[d.decision_type];
}

/**
 * True iff `word` may be used in registry UI/API/docs given the supplied
 * truthy state flags. Unknown words are NOT blocked here (this guard
 * only covers the protected vocabulary explicitly listed by the client).
 * Always-blocked words can never be approved by this helper — they
 * require a separately recorded compliance/legal wording decision and
 * are intentionally hard-blocked at the SSOT level.
 */
export function isWordingAllowed(
  word: string,
  states: Readonly<Record<string, boolean>>,
): boolean {
  const lower = word.toLowerCase();
  if (REGISTRY_ALWAYS_BLOCKED_WORDING.some((w) => w.toLowerCase() === lower)) {
    return false;
  }
  const protectedEntry = REGISTRY_PROTECTED_WORDING.find(
    (p) => p.word.toLowerCase() === lower,
  );
  if (!protectedEntry) return true; // word is not protected
  return states[protectedEntry.allowed_when] === true;
}

/** Readiness-change request envelope. Every field is mandatory. */
export interface ReadinessChangeRequest {
  reason_code: string;
  evidence_reference: string;
  actor_id: string;
  occurred_at: string | Date;
  expiry_or_review_at: string | Date;
}

/** Returns the first missing field name, or null when the request is complete. */
export function missingReadinessChangeField(
  r: Partial<ReadinessChangeRequest>,
): keyof ReadinessChangeRequest | null {
  const required: (keyof ReadinessChangeRequest)[] = [
    "reason_code",
    "evidence_reference",
    "actor_id",
    "occurred_at",
    "expiry_or_review_at",
  ];
  for (const k of required) {
    if (!r[k]) return k;
  }
  return null;
}

// ─────────────────────────── Parity fingerprint ────────────────────────────

/**
 * Stable string that encodes every state and rule above. The parity
 * guard hashes this against the Deno mirror to fail the build if either
 * side drifts.
 */
export const REGISTRY_OPERATING_RULES_PARITY_FINGERPRINT = JSON.stringify({
  readiness_states: REGISTRY_READINESS_STATES,
  public_search_blocked_states: REGISTRY_PUBLIC_SEARCH_BLOCKED_STATES,
  api_output_blocked_states: REGISTRY_API_OUTPUT_BLOCKED_STATES,
  field_groups: REGISTRY_FIELD_GROUPS,
  country_capability_states: REGISTRY_COUNTRY_CAPABILITY_STATES,
  approval_roles: REGISTRY_APPROVAL_ROLES,
  required_approval_count: REGISTRY_REQUIRED_APPROVAL_COUNT,
  required_approval_roles: REGISTRY_REQUIRED_APPROVAL_ROLES,
  business_decision_types: REGISTRY_BUSINESS_DECISION_TYPES,
  business_decision_review_days: REGISTRY_BUSINESS_DECISION_REVIEW_DAYS,
  business_decision_immediate_review_triggers:
    REGISTRY_BUSINESS_DECISION_IMMEDIATE_REVIEW_TRIGGERS,
  protected_wording: REGISTRY_PROTECTED_WORDING,
  always_blocked_wording: REGISTRY_ALWAYS_BLOCKED_WORDING,
  fallback_wording: REGISTRY_FALLBACK_WORDING,
  readiness_labels: REGISTRY_READINESS_LABELS,
  audit_names: REGISTRY_OPERATING_RULES_AUDIT_NAMES,
  dashboard_sections: REGISTRY_READINESS_DASHBOARD_SECTIONS,
});
