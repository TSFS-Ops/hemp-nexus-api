/**
 * Batch 25 — Provenance, Country Coverage, Import Validation and
 * Duplicate Governance SSOT (browser).
 *
 * Source of truth for the client's completed Business Registry Operating
 * Rules Questionnaire (received 21 June 2026, sections 2–9). This module
 * is mirrored verbatim at
 * `supabase/functions/_shared/registry-provenance-import-rules.ts`
 * for Deno edge functions, with a parity guard in
 * `scripts/check-registry-provenance-import-rules-parity.mjs`.
 *
 * This file is data + pure helpers only. No I/O, no React. It cannot
 * mutate state on its own — it only encodes the gates so every surface
 * (UI, edge, docs, guards, tests) reasons from the same rules.
 *
 * The client decision source for every export below is:
 *   docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx
 */

// ─────────────────────────── §2. Source types ───────────────────────────────

export const REGISTRY_SOURCE_TYPES = [
  "official_public_registry",
  "licensed_third_party_dataset",
  "company_submitted_data",
  "authorised_representative_submitted_data",
  "verified_external_provider",
  "bank_institution_confirmed_data",
  "admin_reviewed_evidence",
  "user_correction_dispute_submission",
  "izenzo_workflow_audit_event",
  "system_generated_derived_status",
] as const;
export type RegistrySourceType = (typeof REGISTRY_SOURCE_TYPES)[number];

/** Required descriptors that MUST accompany every recorded source. */
export const REGISTRY_SOURCE_REQUIRED_FIELDS = [
  "source_type",
  "provider_name",
  "licence_or_authority_basis",
  "import_batch_id_or_evidence_id",
  "country_jurisdiction",
  "observed_date",
  "imported_date",
  "permitted_uses",
  "freshness_or_stale_date",
] as const;
export type RegistrySourceRequiredField =
  (typeof REGISTRY_SOURCE_REQUIRED_FIELDS)[number];

/**
 * Returns the first missing source-descriptor field, or null if every
 * required descriptor is present and non-empty. Unknown/unlabelled
 * sources MUST be quarantined.
 */
export function missingSourceDescriptorField(
  src: Partial<Record<RegistrySourceRequiredField, unknown>> & {
    source_type?: string | null;
  },
): RegistrySourceRequiredField | "unknown_source_type" | null {
  if (!src.source_type || !REGISTRY_SOURCE_TYPES.includes(src.source_type as RegistrySourceType)) {
    return "unknown_source_type";
  }
  for (const f of REGISTRY_SOURCE_REQUIRED_FIELDS) {
    const v = src[f];
    if (v === undefined || v === null || v === "") return f;
  }
  return null;
}

// ───────────────────────── §3. Licensed dataset rules ───────────────────────

/**
 * Required UI wording for any surface that displays licensed-dataset
 * values. The exact phrase the client signed off on.
 */
export const REGISTRY_LICENSED_DATASET_WORDING =
  "Sourced from licensed dataset - not independently verified by Izenzo.";

/** Source types that, on their own, only confer `sourced_only` standing. */
export const REGISTRY_SOURCED_ONLY_SOURCE_TYPES: readonly RegistrySourceType[] = [
  "licensed_third_party_dataset",
];

/** Methods that may lift a `sourced_only` field to verified standing. */
export const REGISTRY_FIELD_VERIFICATION_METHODS = [
  "approved_provider",
  "official_registry_confirmation",
  "company_or_authority_evidence_with_admin_review",
  "bank_or_institution_confirmation",
  "other_compliance_owner_approved_method",
] as const;
export type RegistryFieldVerificationMethod =
  (typeof REGISTRY_FIELD_VERIFICATION_METHODS)[number];

/** A licensed-dataset value is `sourced_only` until verification lands. */
export function isLicensedDatasetVerified(
  source_type: string | null | undefined,
  verification_method: string | null | undefined,
): boolean {
  if (source_type !== "licensed_third_party_dataset") return false;
  return (
    !!verification_method &&
    (REGISTRY_FIELD_VERIFICATION_METHODS as readonly string[]).includes(
      verification_method,
    )
  );
}

// ─────────────────────── §4. Field provenance metadata ──────────────────────

export const REGISTRY_FIELD_PROVENANCE_METADATA = [
  "field_name",
  "field_value",
  "source_type",
  "source_provider_name",
  "source_record_id",
  "import_batch_id",
  "source_observed_date",
  "import_datetime",
  "licence_permitted_use_reference",
  "confidence_score",
  "matching_method",
  "evidence_reference",
  "country_jurisdiction",
  "stale_date",
  "field_readiness_state",
  "review_approval_state",
  "last_reviewer",
] as const;
export type RegistryFieldProvenanceMetadata =
  (typeof REGISTRY_FIELD_PROVENANCE_METADATA)[number];

/** Required descriptors a field MUST have before any surface may use it. */
export const REGISTRY_FIELD_PROVENANCE_REQUIRED: readonly RegistryFieldProvenanceMetadata[] = [
  "field_name",
  "source_type",
  "source_provider_name",
  "import_batch_id",
  "source_observed_date",
  "import_datetime",
  "licence_permitted_use_reference",
  "country_jurisdiction",
  "field_readiness_state",
];

/** Per-field usage flags. None default to true — every flag is opt-in. */
export const REGISTRY_FIELD_USAGE_FLAGS = [
  "public_display",
  "logged_in_display",
  "admin_only_display",
  "api_output",
  "matching",
  "claim_support",
  "outreach",
] as const;
export type RegistryFieldUsageFlag = (typeof REGISTRY_FIELD_USAGE_FLAGS)[number];

export function missingFieldProvenance(
  meta: Partial<Record<RegistryFieldProvenanceMetadata, unknown>>,
): RegistryFieldProvenanceMetadata | null {
  for (const f of REGISTRY_FIELD_PROVENANCE_REQUIRED) {
    const v = meta[f];
    if (v === undefined || v === null || v === "") return f;
  }
  return null;
}

// ───────────────── §5. Manual-review-before-public-display fields ───────────

/**
 * Field groups the client requires manual review on before any value
 * may surface to the public. These MUST default to `field_not_public`
 * regardless of the record's readiness.
 */
export const REGISTRY_MANUAL_REVIEW_FIELD_GROUPS = [
  "officers_directors_members",
  "beneficial_ownership_ubo",
  "personal_emails",
  "phone_numbers",
  "individual_addresses",
  "vat_tax_fields",
  "adverse_events",
  "filings_implying_compliance_or_risk_status",
  "bank_status_labels",
  "company_submitted_corrections",
  "conflicting_values",
  "low_confidence_matched_values",
  "duplicate_linked_values",
  "fields_from_source_with_public_use_restrictions",
] as const;
export type RegistryManualReviewFieldGroup =
  (typeof REGISTRY_MANUAL_REVIEW_FIELD_GROUPS)[number];

/** Core fields that MAY be public once the gates below are satisfied. */
export const REGISTRY_PUBLIC_CORE_FIELDS = [
  "company_legal_name",
  "registration_number_or_local_identifier",
  "country_jurisdiction",
  "company_status",
] as const;
export type RegistryPublicCoreField = (typeof REGISTRY_PUBLIC_CORE_FIELDS)[number];

export interface ManualReviewGateInput {
  field_group: string;
  manual_review_completed?: boolean;
}

/**
 * Manual-review field groups MUST NOT appear in public output unless
 * review is explicitly recorded as complete.
 */
export function isFieldPublicAllowed(input: ManualReviewGateInput): boolean {
  const group = input.field_group as RegistryManualReviewFieldGroup;
  if ((REGISTRY_MANUAL_REVIEW_FIELD_GROUPS as readonly string[]).includes(group)) {
    return input.manual_review_completed === true;
  }
  return true;
}

export interface PublicCoreFieldGateInput {
  source_or_licence_allows_public: boolean;
  no_dispute: boolean;
  no_conflict: boolean;
  no_privacy_hold: boolean;
  approved_public_search_decision: boolean;
}

/** Even core fields require the gate to be fully satisfied. */
export function isPublicCoreFieldAllowed(g: PublicCoreFieldGateInput): boolean {
  return (
    g.source_or_licence_allows_public &&
    g.no_dispute &&
    g.no_conflict &&
    g.no_privacy_hold &&
    g.approved_public_search_decision
  );
}

// ───────────────────────── §6. Source conflict priority ─────────────────────

/**
 * Client-approved source priority order. Lower index = higher priority.
 */
export const REGISTRY_SOURCE_PRIORITY_ORDER: readonly RegistrySourceType[] = [
  "official_public_registry", // also covers bank/institution-confirmed for that field
  "bank_institution_confirmed_data",
  "verified_external_provider",
  "admin_reviewed_evidence", // company-submitted evidence approved by admin/compliance
  "licensed_third_party_dataset",
  "company_submitted_data", // public-source signal / company-submitted unverified
  "user_correction_dispute_submission",
];

export function compareSourcePriority(
  a: RegistrySourceType,
  b: RegistrySourceType,
): number {
  const ai = REGISTRY_SOURCE_PRIORITY_ORDER.indexOf(a);
  const bi = REGISTRY_SOURCE_PRIORITY_ORDER.indexOf(b);
  const ax = ai === -1 ? REGISTRY_SOURCE_PRIORITY_ORDER.length : ai;
  const bx = bi === -1 ? REGISTRY_SOURCE_PRIORITY_ORDER.length : bi;
  return ax - bx;
}

export interface ConflictResolutionInput<T = unknown> {
  values: { value: T; source_type: RegistrySourceType; observed_date?: string }[];
}
export interface ConflictResolutionResult<T = unknown> {
  winning_value: T | null;
  winning_source: RegistrySourceType | null;
  conflict_under_review: boolean;
  losers: { value: T; source_type: RegistrySourceType }[];
}

export function resolveSourceConflict<T>(
  input: ConflictResolutionInput<T>,
): ConflictResolutionResult<T> {
  const xs = input.values.slice().sort((a, b) =>
    compareSourcePriority(a.source_type, b.source_type),
  );
  if (xs.length === 0) {
    return {
      winning_value: null,
      winning_source: null,
      conflict_under_review: false,
      losers: [],
    };
  }
  const winner = xs[0];
  const losers = xs.slice(1).filter((x) => x.value !== winner.value);
  return {
    winning_value: winner.value,
    winning_source: winner.source_type,
    conflict_under_review: losers.length > 0,
    losers: losers.map((l) => ({ value: l.value, source_type: l.source_type })),
  };
}

/** Conflict detail surfaces are admin-only. Public users see the wording below. */
export const REGISTRY_CONFLICT_PUBLIC_WORDING = "Some details are under review";
export const REGISTRY_CONFLICT_API_STATUS = "conflict_under_review";

// ──────────────────────── §7–8. Country coverage model ──────────────────────

export const REGISTRY_COUNTRY_CAPABILITIES = [
  "search_coverage",
  "claim_coverage",
  "authority_coverage",
  "bank_capture_coverage",
  "bank_verification_coverage",
  "api_coverage",
] as const;
export type RegistryCountryCapability =
  (typeof REGISTRY_COUNTRY_CAPABILITIES)[number];

export const REGISTRY_COUNTRY_WORKFLOW_STATES = [
  "data_loaded",
  "public_search_ready",
  "demo_ready",
  "claim_ready",
  "authority_ready",
  "correction_ready",
  "outreach_ready",
  "bank_capture_ready",
  "bank_verification_ready",
  "api_sandbox_ready",
  "api_production_ready",
  "provider_pending",
] as const;
export type RegistryCountryWorkflowState =
  (typeof REGISTRY_COUNTRY_WORKFLOW_STATES)[number];

/**
 * Capabilities are independent. A country may be `search_coverage`-ready
 * while bank verification or API output remain disabled.
 */
export interface CountryCapabilityInput {
  capability: RegistryCountryCapability;
  approved_states: readonly RegistryCountryWorkflowState[];
}
export function isCountryCapabilityReady(g: CountryCapabilityInput): boolean {
  const requiredByCapability: Record<
    RegistryCountryCapability,
    readonly RegistryCountryWorkflowState[]
  > = {
    search_coverage: ["public_search_ready"],
    claim_coverage: ["claim_ready"],
    authority_coverage: ["authority_ready"],
    bank_capture_coverage: ["bank_capture_ready"],
    bank_verification_coverage: ["bank_verification_ready"],
    api_coverage: ["api_production_ready"],
  };
  const required = requiredByCapability[g.capability];
  return required.every((s) => g.approved_states.includes(s));
}

// ────────────────────── §9. Searchable-country minimums ─────────────────────

export const REGISTRY_SEARCHABLE_COUNTRY_MINIMUM_ITEMS = [
  "company_legal_name",
  "registration_or_local_identifier",
  "country_jurisdiction",
  "source_type",
  "source_or_licence_reference",
  "import_batch_id",
  "minimum_matching_key",
  "readiness_state_public_search_ready",
  "approved_public_search_business_decision",
  "no_unresolved_import_hold",
  "no_unresolved_licence_hold",
] as const;
export type RegistrySearchableMinimumItem =
  (typeof REGISTRY_SEARCHABLE_COUNTRY_MINIMUM_ITEMS)[number];

export const REGISTRY_RECOMMENDED_DISPLAY_FIELDS = [
  "company_name",
  "registration_number_or_local_identifier",
  "jurisdiction",
  "source_label",
  "status_wording",
] as const;

export function missingSearchableMinimum(
  input: Partial<Record<RegistrySearchableMinimumItem, unknown>>,
): RegistrySearchableMinimumItem | null {
  for (const f of REGISTRY_SEARCHABLE_COUNTRY_MINIMUM_ITEMS) {
    const v = input[f];
    if (v === undefined || v === null || v === false || v === "") return f;
  }
  return null;
}

// ─────────────────────────── §10. Readiness labels ──────────────────────────

export const REGISTRY_PROVENANCE_READINESS_LABELS = {
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
} as const;

// ───────────────────────── §11. Pre-import checklist ────────────────────────

export const REGISTRY_PRE_IMPORT_CHECKLIST = [
  "source_declaration",
  "provider_or_source_identity",
  "country_jurisdiction",
  "legal_basis_licence_permitted_use",
  "contract_or_proof_of_permission",
  "schema_map",
  "field_classification",
  "privacy_sensitive_field_review",
  "expected_record_count",
  "duplicate_strategy",
  "quarantine_rules",
  "import_owner",
  "technical_approver",
  "data_governance_owner_approval",
  "evidence_folder_reference",
  "rollback_plan",
] as const;
export type RegistryPreImportChecklistItem =
  (typeof REGISTRY_PRE_IMPORT_CHECKLIST)[number];

export const REGISTRY_PRODUCTION_IMPORT_EXTRA_ITEMS = [
  "import_batch_id",
  "source_licence_record",
  "approval_status",
] as const;
export type RegistryProductionImportExtraItem =
  (typeof REGISTRY_PRODUCTION_IMPORT_EXTRA_ITEMS)[number];

export function missingPreImportChecklistItem(
  checklist: Partial<Record<RegistryPreImportChecklistItem, unknown>>,
  opts: { production?: boolean; production_extras?: Partial<Record<RegistryProductionImportExtraItem, unknown>> } = {},
): string | null {
  for (const k of REGISTRY_PRE_IMPORT_CHECKLIST) {
    const v = checklist[k];
    if (v === undefined || v === null || v === false || v === "") return k;
  }
  if (opts.production) {
    const extras = opts.production_extras ?? {};
    for (const k of REGISTRY_PRODUCTION_IMPORT_EXTRA_ITEMS) {
      const v = extras[k];
      if (v === undefined || v === null || v === false || v === "") return k;
    }
  }
  return null;
}

// ─────────────────────── §12. Import validation rules ───────────────────────

export const REGISTRY_IMPORT_REQUIRED_FIELDS = [
  "company_legal_name",
  "country_jurisdiction",
  "source_provider_id",
  "import_batch_id",
  "source_observed_or_import_date",
  "stable_identifier_or_matching_key",
] as const;
export type RegistryImportRequiredField =
  (typeof REGISTRY_IMPORT_REQUIRED_FIELDS)[number];

export const REGISTRY_IMPORT_QUARANTINE_IF_MISSING_FIELDS = [
  "registration_number_or_local_identifier",
  "company_status",
  "registered_address",
  "source_licence_reference",
  "duplicate_score",
  "provenance_confidence",
] as const;
export type RegistryImportQuarantineIfMissingField =
  (typeof REGISTRY_IMPORT_QUARANTINE_IF_MISSING_FIELDS)[number];

export const REGISTRY_IMPORT_OPTIONAL_FIELDS = [
  "trading_name",
  "website",
  "industry",
  "vat_tax_number",
  "filings_events",
  "public_contact_fields",
] as const;

export const REGISTRY_IMPORT_EXCLUDED_FIELDS = [
  "raw_bank_details",
  "passwords_or_secrets",
  "identity_documents",
  "private_notes",
  "unlicensed_personal_contact_data",
  "unsupported_sensitive_attributes",
] as const;
export type RegistryImportExcludedField =
  (typeof REGISTRY_IMPORT_EXCLUDED_FIELDS)[number];

export const REGISTRY_IMPORT_QUARANTINE_REASON_CODES = [
  "missing_required_field",
  "missing_quarantine_if_field",
  "unknown_or_unlabelled_source",
  "schema_mismatch",
  "duplicate_unresolved",
  "low_provenance_confidence",
  "excluded_sensitive_field_present",
  "licence_not_recorded",
  "country_jurisdiction_unsupported",
] as const;
export type RegistryImportQuarantineReasonCode =
  (typeof REGISTRY_IMPORT_QUARANTINE_REASON_CODES)[number];

export interface ImportRowValidationInput {
  row: Partial<Record<string, unknown>>;
  has_unknown_source?: boolean;
  has_excluded_sensitive_field?: boolean;
}
export interface ImportRowValidationResult {
  valid: boolean;
  quarantined: boolean;
  reason_codes: RegistryImportQuarantineReasonCode[];
}
export function validateImportRow(
  input: ImportRowValidationInput,
): ImportRowValidationResult {
  const reasons: RegistryImportQuarantineReasonCode[] = [];
  if (input.has_unknown_source) reasons.push("unknown_or_unlabelled_source");
  if (input.has_excluded_sensitive_field) reasons.push("excluded_sensitive_field_present");
  for (const f of REGISTRY_IMPORT_REQUIRED_FIELDS) {
    const v = input.row[f];
    if (v === undefined || v === null || v === "") {
      reasons.push("missing_required_field");
      break;
    }
  }
  for (const f of REGISTRY_IMPORT_QUARANTINE_IF_MISSING_FIELDS) {
    const v = input.row[f];
    if (v === undefined || v === null || v === "") {
      reasons.push("missing_quarantine_if_field");
      break;
    }
  }
  const requiredMissing = reasons.includes("missing_required_field");
  return {
    valid: reasons.length === 0,
    // Required-missing rows fail validation outright; other reasons quarantine.
    quarantined: reasons.length > 0 && !requiredMissing
      ? true
      : reasons.length > 0,
    reason_codes: reasons,
  };
}

// ───────────────────── §13. Batch failure / quarantine rule ─────────────────

export const REGISTRY_BATCH_SYSTEMIC_FAILURE_REASONS = [
  "missing_licence",
  "wrong_country",
  "schema_mismatch",
  "corrupted_file",
  "invalid_source_identity",
  "critical_field_failure_rate_over_threshold",
] as const;
export type RegistryBatchSystemicFailureReason =
  (typeof REGISTRY_BATCH_SYSTEMIC_FAILURE_REASONS)[number];

/** Client rule: critical-field failure rate above 5% fails the whole batch. */
export const REGISTRY_BATCH_CRITICAL_FIELD_FAILURE_THRESHOLD_RATIO = 0.05;

export interface BatchOutcomeInput {
  total_rows: number;
  critical_field_failed_rows: number;
  systemic_reasons?: readonly RegistryBatchSystemicFailureReason[];
}
export interface BatchOutcomeResult {
  outcome: "fail_batch" | "stage_valid_rows";
  failure_reasons: RegistryBatchSystemicFailureReason[];
  critical_field_failure_ratio: number;
}
export function evaluateBatchOutcome(input: BatchOutcomeInput): BatchOutcomeResult {
  const ratio =
    input.total_rows > 0 ? input.critical_field_failed_rows / input.total_rows : 0;
  const reasons: RegistryBatchSystemicFailureReason[] = [
    ...(input.systemic_reasons ?? []),
  ];
  if (ratio > REGISTRY_BATCH_CRITICAL_FIELD_FAILURE_THRESHOLD_RATIO) {
    reasons.push("critical_field_failure_rate_over_threshold");
  }
  return {
    outcome: reasons.length > 0 ? "fail_batch" : "stage_valid_rows",
    failure_reasons: reasons,
    critical_field_failure_ratio: ratio,
  };
}

// ─────────────────────────── §14. Duplicate matching ────────────────────────

export const REGISTRY_DUPLICATE_THRESHOLDS = {
  /** Exact duplicate triggers (any one is enough). */
  exact_triggers: [
    "same_country_and_registration_or_local_identifier",
    "same_official_registry_id",
    "same_verified_tax_or_vat_number_where_approved",
  ],
  /** High-confidence numeric thresholds. */
  high_confidence_name_address_ratio: 0.95,
  high_confidence_name_officer_or_regdate_ratio: 0.92,
  /** Possible-duplicate threshold (combined with country/industry/address signal). */
  possible_name_ratio: 0.85,
  /** Signals that MUST NEVER auto-match on their own. */
  never_auto_match_signals: [
    "company_name",
    "phone",
    "email",
    "website",
    "fuzzy_text",
  ],
  required_candidate_metadata: ["match_keys", "confidence_score", "compared_fields"],
} as const;

export type RegistryDuplicateLevel = "exact" | "high_confidence" | "possible" | "none";

export interface DuplicateCandidateSignals {
  same_country_and_registration_or_local_identifier?: boolean;
  same_official_registry_id?: boolean;
  same_verified_tax_or_vat_number_where_approved?: boolean;
  /** Normalised legal name + registered address similarity (0–1). */
  name_plus_address_ratio?: number;
  /** Legal name + (officer / registration date / source record) similarity (0–1). */
  name_plus_officer_or_regdate_ratio?: number;
  /** Normalised legal/trading name similarity (0–1). */
  name_ratio?: number;
  same_country_industry_or_address_signal?: boolean;
}

export function classifyDuplicate(s: DuplicateCandidateSignals): RegistryDuplicateLevel {
  if (
    s.same_country_and_registration_or_local_identifier ||
    s.same_official_registry_id ||
    s.same_verified_tax_or_vat_number_where_approved
  ) {
    return "exact";
  }
  const hcA = (s.name_plus_address_ratio ?? 0) >=
    REGISTRY_DUPLICATE_THRESHOLDS.high_confidence_name_address_ratio;
  const hcB = (s.name_plus_officer_or_regdate_ratio ?? 0) >=
    REGISTRY_DUPLICATE_THRESHOLDS.high_confidence_name_officer_or_regdate_ratio;
  if (hcA || hcB) return "high_confidence";
  if (
    (s.name_ratio ?? 0) >= REGISTRY_DUPLICATE_THRESHOLDS.possible_name_ratio &&
    s.same_country_industry_or_address_signal === true
  ) {
    return "possible";
  }
  return "none";
}

// ───────────────────────── §15. Duplicate merge governance ──────────────────

export const REGISTRY_DUPLICATE_MERGE_RISK_TRIGGERS = [
  "has_claims",
  "has_authority",
  "has_bank_details",
  "has_disputes",
  "has_api_exposure",
  "has_verified_fields",
] as const;
export type RegistryDuplicateMergeRiskTrigger =
  (typeof REGISTRY_DUPLICATE_MERGE_RISK_TRIGGERS)[number];

export const REGISTRY_DUPLICATE_MERGE_AUDIT_REQUIREMENTS = [
  "preserve_source_history",
  "preserve_old_ids",
  "preserve_audit_trail",
  "preserve_rollback_link",
] as const;

export interface DuplicateMergeApprovalInput {
  duplicate_level: RegistryDuplicateLevel;
  confidence: number; // 0..1
  risk_triggers: readonly RegistryDuplicateMergeRiskTrigger[];
  approvers: readonly string[]; // role names already collected
}

export type RegistryDuplicateMergeDecision =
  | { allowed: true; tier: "low_risk_data_governance_owner" }
  | {
      allowed: false;
      tier: "high_risk_requires_platform_admin_plus_compliance_owner";
      missing_roles: string[];
    }
  | {
      allowed: true;
      tier: "high_risk_requires_platform_admin_plus_compliance_owner";
    }
  | { allowed: false; tier: "low_risk_data_governance_owner"; missing_roles: string[] }
  | { allowed: false; tier: "blocked_no_auto_merge_for_high_risk"; missing_roles?: string[] };

export function classifyMergeRisk(
  triggers: readonly RegistryDuplicateMergeRiskTrigger[],
): "low" | "high" {
  return triggers.length > 0 ? "high" : "low";
}

export function evaluateDuplicateMerge(
  g: DuplicateMergeApprovalInput,
): RegistryDuplicateMergeDecision {
  const risk = classifyMergeRisk(g.risk_triggers);
  if (risk === "low") {
    if (g.duplicate_level !== "exact" && g.confidence < 0.95) {
      return {
        allowed: false,
        tier: "low_risk_data_governance_owner",
        missing_roles: ["confidence_below_0.95"],
      };
    }
    if (!g.approvers.includes("data_governance_owner")) {
      return {
        allowed: false,
        tier: "low_risk_data_governance_owner",
        missing_roles: ["data_governance_owner"],
      };
    }
    return { allowed: true, tier: "low_risk_data_governance_owner" };
  }
  // High-risk path: NEVER auto-merge. Both roles required.
  const missing: string[] = [];
  if (!g.approvers.includes("platform_admin")) missing.push("platform_admin");
  if (!g.approvers.includes("compliance_owner")) missing.push("compliance_owner");
  if (missing.length > 0) {
    return {
      allowed: false,
      tier: "high_risk_requires_platform_admin_plus_compliance_owner",
      missing_roles: missing,
    };
  }
  return {
    allowed: true,
    tier: "high_risk_requires_platform_admin_plus_compliance_owner",
  };
}

// ───────────────────────────── Audit names (§17) ────────────────────────────

export const REGISTRY_PROVENANCE_IMPORT_AUDIT_NAMES = [
  "registry.provenance.field_status.read",
  "registry.country.capability_status.read",
  "registry.import.preflight_check.recorded",
  "registry.import.validation_summary.recorded",
  "registry.import.row_quarantined",
  "registry.import.batch_failed_systemic",
  "registry.duplicate.candidate_flagged",
  "registry.duplicate.merge_reviewed",
  "registry.duplicate.merge_approved",
  "registry.duplicate.merge_blocked_high_risk",
  "registry.duplicate.merge_rolled_back",
] as const;
export type RegistryProvenanceImportAuditName =
  (typeof REGISTRY_PROVENANCE_IMPORT_AUDIT_NAMES)[number];

// ─────────────────────────── Parity fingerprint ────────────────────────────

/**
 * Stable string that encodes every constant above. The parity guard
 * hashes this against the Deno mirror to fail the build on any drift.
 */
export const REGISTRY_PROVENANCE_IMPORT_RULES_PARITY_FINGERPRINT = JSON.stringify({
  source_types: REGISTRY_SOURCE_TYPES,
  source_required_fields: REGISTRY_SOURCE_REQUIRED_FIELDS,
  sourced_only_source_types: REGISTRY_SOURCED_ONLY_SOURCE_TYPES,
  field_verification_methods: REGISTRY_FIELD_VERIFICATION_METHODS,
  field_provenance_metadata: REGISTRY_FIELD_PROVENANCE_METADATA,
  field_provenance_required: REGISTRY_FIELD_PROVENANCE_REQUIRED,
  field_usage_flags: REGISTRY_FIELD_USAGE_FLAGS,
  manual_review_field_groups: REGISTRY_MANUAL_REVIEW_FIELD_GROUPS,
  public_core_fields: REGISTRY_PUBLIC_CORE_FIELDS,
  source_priority_order: REGISTRY_SOURCE_PRIORITY_ORDER,
  country_capabilities: REGISTRY_COUNTRY_CAPABILITIES,
  country_workflow_states: REGISTRY_COUNTRY_WORKFLOW_STATES,
  searchable_country_minimum_items: REGISTRY_SEARCHABLE_COUNTRY_MINIMUM_ITEMS,
  recommended_display_fields: REGISTRY_RECOMMENDED_DISPLAY_FIELDS,
  provenance_readiness_labels: REGISTRY_PROVENANCE_READINESS_LABELS,
  pre_import_checklist: REGISTRY_PRE_IMPORT_CHECKLIST,
  production_import_extra_items: REGISTRY_PRODUCTION_IMPORT_EXTRA_ITEMS,
  import_required_fields: REGISTRY_IMPORT_REQUIRED_FIELDS,
  import_quarantine_if_missing_fields:
    REGISTRY_IMPORT_QUARANTINE_IF_MISSING_FIELDS,
  import_optional_fields: REGISTRY_IMPORT_OPTIONAL_FIELDS,
  import_excluded_fields: REGISTRY_IMPORT_EXCLUDED_FIELDS,
  import_quarantine_reason_codes: REGISTRY_IMPORT_QUARANTINE_REASON_CODES,
  batch_systemic_failure_reasons: REGISTRY_BATCH_SYSTEMIC_FAILURE_REASONS,
  batch_critical_field_failure_threshold_ratio:
    REGISTRY_BATCH_CRITICAL_FIELD_FAILURE_THRESHOLD_RATIO,
  duplicate_thresholds: REGISTRY_DUPLICATE_THRESHOLDS,
  duplicate_merge_risk_triggers: REGISTRY_DUPLICATE_MERGE_RISK_TRIGGERS,
  duplicate_merge_audit_requirements:
    REGISTRY_DUPLICATE_MERGE_AUDIT_REQUIREMENTS,
  audit_names: REGISTRY_PROVENANCE_IMPORT_AUDIT_NAMES,
  licensed_dataset_wording: REGISTRY_LICENSED_DATASET_WORDING,
  conflict_public_wording: REGISTRY_CONFLICT_PUBLIC_WORDING,
  conflict_api_status: REGISTRY_CONFLICT_API_STATUS,
});
