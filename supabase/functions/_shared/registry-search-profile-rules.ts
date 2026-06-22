/**
 * Batch 26 — Search, Typeahead, Public Profile and Corrections SSOT (browser).
 *
 * Encodes the client's decisions from the completed Business Registry
 * Operating Rules Questionnaire for: search field classification,
 * officer/email/phone restrictions, partial/typo/abbreviation matching
 * rules, safe match reasons, no-result workflow, public profile field
 * visibility and correction/report-data workflow.
 *
 * Mirrored verbatim at
 *   supabase/functions/_shared/registry-search-profile-rules.ts
 * with parity enforced by
 *   scripts/check-registry-search-profile-rules-parity.mjs
 *
 * Data + pure helpers only. No I/O, no React. This module never
 * relaxes Batches 1–25 — it only catalogues the gates so every
 * surface reasons from the same rules.
 *
 * Client decision source:
 *   docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx
 */

// ───────────────────────────── Field classification ─────────────────────────

export const REGISTRY_SEARCH_FIELD_CLASSES = [
  "public_searchable",
  "logged_in_searchable",
  "admin_only",
  "api_only_with_approved_scope",
  "excluded",
] as const;
export type RegistrySearchFieldClass =
  (typeof REGISTRY_SEARCH_FIELD_CLASSES)[number];

export const REGISTRY_SEARCH_FIELD_CLASSIFICATION: Record<
  string,
  RegistrySearchFieldClass
> = {
  // Public-searchable
  company_legal_name: "public_searchable",
  trading_name: "public_searchable",
  registration_number: "public_searchable",
  local_identifier: "public_searchable",
  country_code: "public_searchable",
  jurisdiction: "public_searchable",
  city_province_where_permitted: "public_searchable",
  industry_category: "public_searchable",
  source_approved_public_status: "public_searchable",

  // Logged-in searchable (broader, consent/licence permitting)
  broader_address: "logged_in_searchable",
  website: "logged_in_searchable",
  claimed_profile_name: "logged_in_searchable",
  approved_public_contacts: "logged_in_searchable",

  // Admin-only
  officers_directors: "admin_only",
  members: "admin_only",
  ubo: "admin_only",
  personal_email: "admin_only",
  personal_phone: "admin_only",
  correction_notes: "admin_only",
  dispute_notes: "admin_only",
  import_batch: "admin_only",
  confidence_scores: "admin_only",
  internal_status: "admin_only",
  provider_payload: "admin_only",

  // API-only with approved scope
  api_registration_number: "api_only_with_approved_scope",
  api_country: "api_only_with_approved_scope",
  api_profile_status: "api_only_with_approved_scope",
  api_approved_identifiers: "api_only_with_approved_scope",
  api_readiness_label: "api_only_with_approved_scope",

  // Excluded (never searchable anywhere)
  raw_bank_details: "excluded",
  identity_documents: "excluded",
  passwords_secrets: "excluded",
  private_notes: "excluded",
  restricted_personal_data: "excluded",
};

export function classifyField(field: string): RegistrySearchFieldClass {
  return REGISTRY_SEARCH_FIELD_CLASSIFICATION[field] ?? "admin_only";
}

export function isFieldSearchableByAudience(
  field: string,
  audience: "public" | "logged_in" | "admin" | "api",
): boolean {
  const c = classifyField(field);
  if (c === "excluded") return false;
  if (c === "admin_only") return audience === "admin";
  if (c === "api_only_with_approved_scope") return audience === "api" || audience === "admin";
  if (c === "logged_in_searchable") return audience !== "public";
  // public_searchable
  return true;
}

// ───────────────────────────── Officer / email / phone gates ────────────────

export const OFFICER_PUBLIC_SEARCH_ENABLED = false;
export const EMAIL_PUBLIC_SEARCH_ENABLED = false;
export const PHONE_PUBLIC_SEARCH_ENABLED = false;

export interface OfficerSearchGate {
  source_licence_permits: boolean;
  field_group_manually_reviewed: boolean;
  field_group_approved_for_logged_in: boolean;
  privacy_or_compliance_hold_present: boolean;
}

export function isOfficerLoggedInSearchAllowed(g: OfficerSearchGate): boolean {
  return (
    g.source_licence_permits &&
    g.field_group_manually_reviewed &&
    g.field_group_approved_for_logged_in &&
    !g.privacy_or_compliance_hold_present
  );
}

export interface OfficerApiSearchGate {
  special_approval: boolean;
  lawful_permitted_use_basis: boolean;
  client_contract_scope: boolean;
  compliance_owner_approved: boolean;
}

export function isOfficerApiSearchAllowed(g: OfficerApiSearchGate): boolean {
  return (
    g.special_approval &&
    g.lawful_permitted_use_basis &&
    g.client_contract_scope &&
    g.compliance_owner_approved
  );
}

export const OFFICER_MATCH_CAUTION =
  "Person relationship may be incomplete or stale - check source and date.";

// ───────────────────────────── Match thresholds ─────────────────────────────

export const PARTIAL_MATCH_MIN_CHARS = 3;
export const TYPO_MIN_CONFIDENCE = 0.85;
export const PUBLIC_MIN_CONFIDENCE = 0.75;

export const PARTIAL_MATCH_ALLOWED_FIELDS: readonly string[] = [
  "company_legal_name",
  "trading_name",
];
export const PARTIAL_MATCH_FORBIDDEN_FIELDS: readonly string[] = [
  "raw_bank_details",
  "tax_vat",
  "identity_documents",
  "personal_email",
  "personal_phone",
];
export const TYPO_TOLERANT_FIELDS: readonly string[] = [
  "company_legal_name",
  "trading_name",
];
export const APPROVED_LEGAL_SUFFIX_ABBREVIATIONS: readonly string[] = [
  "Pty", "Ltd", "PLC", "CC", "SARL", "LLC", "Limited", "Incorporated", "Inc",
];

export function isPartialMatchAllowed(field: string, query: string): boolean {
  if (PARTIAL_MATCH_FORBIDDEN_FIELDS.includes(field)) return false;
  if (!PARTIAL_MATCH_ALLOWED_FIELDS.includes(field)) return false;
  return query.trim().length >= PARTIAL_MATCH_MIN_CHARS;
}

export function shouldShowFuzzyToPublic(confidence: number): boolean {
  return confidence >= PUBLIC_MIN_CONFIDENCE;
}

export function shouldShowTypoMatch(confidence: number): boolean {
  return confidence >= TYPO_MIN_CONFIDENCE;
}

/** Exact identifier matches must outrank fuzzy company-name matches. */
export function rankMatch(kind: "exact_identifier" | "fuzzy_name"): number {
  return kind === "exact_identifier" ? 0 : 1;
}

// ───────────────────────────── Safe match reasons ───────────────────────────

export const PUBLIC_SAFE_MATCH_REASONS: readonly string[] = [
  "Matched company name",
  "Matched trading name",
  "Matched registration number",
  "Matched jurisdiction",
  "Matched approved alias",
  "Similar name - check details",
  "Matched approved public identifier",
];

export const ADMIN_ONLY_MATCH_REASONS: readonly string[] = [
  "Source confidence",
  "Duplicate score",
  "Officer / person match",
  "Phone match",
  "Email match",
  "Import batch",
  "Provider score",
  "Internal matching note",
];

export function isPublicSafeMatchReason(label: string): boolean {
  return PUBLIC_SAFE_MATCH_REASONS.includes(label);
}

// ───────────────────────────── No-result workflow ───────────────────────────

export const NO_RESULT_WORDING =
  "No matching company found in the currently searchable registry.";

export const NO_RESULT_REQUEST_FIELDS = [
  "company_name",
  "country",
  "registration_number_if_known",
  "website_or_source_link",
  "requester_reason",
  "optional_evidence",
] as const;

export const NO_RESULT_QUEUE_EVENT = "company_addition_requested" as const;

export const NO_RESULT_FORBIDDEN_SIDE_EFFECTS: readonly string[] = [
  "create_public_company_record",
  "create_claim",
  "create_poi",
  "create_api_ready_record",
];

export function noResultRequestRequiresLogin(): boolean {
  return true;
}

// ───────────────────────────── Public profile visibility ────────────────────

export const PUBLIC_PROFILE_FIELDS: readonly string[] = [
  "legal_name",
  "trading_name_if_approved",
  "registration_or_local_identifier",
  "country_jurisdiction",
  "company_status_if_source_approved",
  "registered_city_province_if_permitted",
  "industry_category",
  "source_label",
  "last_updated_date",
  "readiness_label",
  "claim_status_label",
  "report_correction_link",
];

export const MASKED_OR_LOGGED_IN_PROFILE_FIELDS: readonly string[] = [
  "approved_contact_email",
  "approved_contact_phone",
  "partial_address",
  "website_if_source_approved",
];

export const ADMIN_ONLY_PROFILE_FIELDS: readonly string[] = [
  "full_provenance",
  "officers",
  "ubo",
  "disputes",
  "corrections",
  "confidence_scores",
  "import_batch",
  "evidence",
  "internal_notes",
  "claim_authority_review_notes",
];

export const API_ONLY_PROFILE_FIELDS: readonly string[] = [
  "api_profile_status_fields_under_scope",
];

export const EXCLUDED_PROFILE_FIELDS: readonly string[] = [
  "raw_bank_details",
  "identity_documents",
  "private_notes",
  "secrets",
];

export function profileFieldAudience(
  field: string,
): "public" | "logged_in" | "admin" | "api" | "excluded" {
  if (EXCLUDED_PROFILE_FIELDS.includes(field)) return "excluded";
  if (PUBLIC_PROFILE_FIELDS.includes(field)) return "public";
  if (MASKED_OR_LOGGED_IN_PROFILE_FIELDS.includes(field)) return "logged_in";
  if (ADMIN_ONLY_PROFILE_FIELDS.includes(field)) return "admin";
  if (API_ONLY_PROFILE_FIELDS.includes(field)) return "api";
  return "admin";
}

// ───────────────────────────── Profile UI wording ───────────────────────────

export const PROFILE_WORDING = {
  not_independently_verified:
    "This information is sourced from the records shown and has not been independently verified by Izenzo.",
  demo_only:
    "Demo only - shown for controlled demonstration. Not production data or verification.",
  provider_pending:
    "Provider pending - the external provider check is not live or not approved for this record.",
  manual_evidence_reviewed:
    "Manual evidence reviewed - no live provider check is represented.",
  api_not_ready: "Not available for production API output.",
} as const;

// ───────────────────────────── Corrections workflow ─────────────────────────

export const CORRECTION_SUBMITTER_TYPES = [
  "logged_in_user_public_fields",
  "claimed_company_user",
  "authorised_company_user",
  "api_client_support_route",
  "public_limited_report_if_enabled",
] as const;
export type CorrectionSubmitterType =
  (typeof CORRECTION_SUBMITTER_TYPES)[number];

export const CORRECTION_REQUIRED_FIELDS = [
  "affected_field",
  "correction_reason",
  "source_link_or_document",
  "submitter_contact",
  "optional_evidence",
] as const;

export const CORRECTION_REVIEWER_ROLES = {
  ordinary_data: "data_governance_owner",
  sensitive_data: "compliance_owner",
} as const;

export const SENSITIVE_CORRECTION_FIELDS: readonly string[] = [
  "officers",
  "directors",
  "members",
  "ubo",
  "authority",
  "bank_details",
  "dispute_status",
  "personal_email",
  "personal_phone",
  "identity_documents",
];

export function correctionReviewerRoleFor(field: string): string {
  return SENSITIVE_CORRECTION_FIELDS.includes(field)
    ? CORRECTION_REVIEWER_ROLES.sensitive_data
    : CORRECTION_REVIEWER_ROLES.ordinary_data;
}

export const CORRECTION_STATES = [
  "submitted",
  "under_review",
  "more_info_requested",
  "approved",
  "rejected",
  "disputed_under_review",
] as const;
export type CorrectionState = (typeof CORRECTION_STATES)[number];

export const CORRECTION_NEVER_AUTO_PUBLISHES = true;
export const CORRECTION_USES_VERSIONED_HISTORY = true;
export const CORRECTION_OLD_VALUES_ADMIN_ONLY_BY_DEFAULT = true;

export interface CorrectionVersion {
  field: string;
  old_value: string | null;
  proposed_value: string | null;
  source_link_or_document: string | null;
  evidence_ref: string | null;
  reviewer_role: string;
  decision: CorrectionState;
  decided_at: string | null;
  submitted_at: string;
}

export function correctionBlocksPublicWhileDisputed(state: CorrectionState): boolean {
  return state === "disputed_under_review";
}

// ───────────────────────────── Audit event names ────────────────────────────

export const REGISTRY_SEARCH_PROFILE_AUDIT_EVENTS = [
  "registry_search_field_classification_evaluated",
  "registry_officer_public_search_blocked",
  "registry_email_phone_public_search_blocked",
  "registry_typeahead_unsafe_match_reason_suppressed",
  "registry_no_result_request_submitted",
  "registry_no_result_request_queued_admin_only",
  "registry_profile_admin_field_suppressed_public",
  "registry_profile_excluded_field_suppressed",
  "registry_correction_submitted",
  "registry_correction_review_decision",
  "registry_correction_version_history_appended",
  "registry_correction_marked_disputed_under_review",
] as const;
