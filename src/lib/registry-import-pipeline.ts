/**
 * Batch 9 — Registry source-file import pipeline SSOT (browser mirror).
 *
 * Mirror: supabase/functions/_shared/registry-import-pipeline.ts
 * Pinned by:
 *   - scripts/check-registry-import-pipeline-parity.mjs
 *   - scripts/check-registry-batch9-no-verified-default.mjs
 *
 * Encodes the import-pipeline rules required by Batch 9: source file
 * model, supported formats, target fields, visibility tiers, validation
 * outcomes, duplicate confidence bands, quarantine reason codes, audit
 * event names, and the conservative readiness default for any record
 * produced by this pipeline (`imported_unverified`).
 *
 * NEVER widen the default readiness here — every layer relies on it.
 */

export const IMPORTED_RECORD_DEFAULT_READINESS = "imported_unverified" as const;

export const SOURCE_FILE_TYPES = [
  "manual_records",
  "json_payload",
  "csv_payload",
  "text_extract",
  "pdf_text_paste",
] as const;
export type SourceFileType = (typeof SOURCE_FILE_TYPES)[number];

export const TARGET_FIELDS = [
  "company_name",
  "trading_names",
  "previous_names",
  "country_code",
  "registration_number",
  "local_number",
  "vat_number",
  "legal_form",
  "company_status",
  "registered_address",
  "postal_address",
  "source_summary",
  "source_generated_date",
  "activity_summary",
  "officer_name",
  "officer_role",
  "filing_label",
  "filing_summary",
  "event_label",
  "event_summary",
  "contact_email",
  "contact_phone",
  "source_confidence",
  "source_disclaimer",
  "provenance_reference",
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

export const FIELD_VISIBILITY_TIERS = [
  "public_searchable",
  "public_visible",
  "masked_public",
  "admin_only",
  "hidden",
  "excluded",
] as const;
export type FieldVisibilityTier = (typeof FIELD_VISIBILITY_TIERS)[number];

/** Fields that MUST never be mapped to a public tier (`public_*`). */
export const FORBIDDEN_PUBLIC_TARGET_FIELDS: TargetField[] = [
  "contact_email",
  "contact_phone",
];

/** Default tier suggested for each target field. Admins may override. */
export const DEFAULT_FIELD_TIER: Record<TargetField, FieldVisibilityTier> = {
  company_name: "public_searchable",
  trading_names: "public_searchable",
  previous_names: "public_searchable",
  country_code: "public_visible",
  registration_number: "public_searchable",
  local_number: "public_searchable",
  vat_number: "public_searchable",
  legal_form: "public_visible",
  company_status: "public_visible",
  registered_address: "public_searchable",
  postal_address: "public_visible",
  source_summary: "public_visible",
  source_generated_date: "public_visible",
  activity_summary: "public_visible",
  officer_name: "public_visible",
  officer_role: "public_visible",
  filing_label: "public_visible",
  filing_summary: "public_visible",
  event_label: "public_visible",
  event_summary: "public_visible",
  contact_email: "admin_only",
  contact_phone: "admin_only",
  source_confidence: "admin_only",
  source_disclaimer: "public_visible",
  provenance_reference: "admin_only",
};

export const VALIDATION_OUTCOMES = [
  "pending",
  "valid",
  "valid_with_warnings",
  "quarantined",
  "rejected",
  "duplicate_review_required",
  "business_decision_required",
] as const;
export type ValidationOutcome = (typeof VALIDATION_OUTCOMES)[number];

export const DUPLICATE_CONFIDENCE_LEVELS = [
  "low",
  "medium",
  "high",
  "exact_identifier_match",
] as const;
export type DuplicateConfidence = (typeof DUPLICATE_CONFIDENCE_LEVELS)[number];

export const QUARANTINE_REASON_CODES = [
  "missing_required_field",
  "raw_bank_detail_detected",
  "sensitive_personal_data_mapped_public",
  "duplicate_risk_high",
  "permitted_use_missing",
  "source_not_approved",
  "country_disabled",
  "legal_form_unmappable",
  "source_provenance_missing",
] as const;
export type QuarantineReasonCode = (typeof QUARANTINE_REASON_CODES)[number];

export const IMPORT_PIPELINE_AUDIT_EVENT_NAMES = [
  "registry_source_file_uploaded",
  "registry_source_file_parsed",
  "registry_import_field_mapping_created",
  "registry_import_validation_started",
  "registry_import_validation_completed",
  "registry_import_record_quarantined",
  "registry_import_duplicate_candidate_detected",
  "registry_import_duplicate_reviewed",
  "registry_import_publish_approved",
  "registry_import_publish_rejected",
  "registry_import_record_published",
  "registry_import_publish_completed",
  "registry_import_publish_failed",
  "registry_import_search_index_created",
] as const;
export type ImportPipelineAuditEventName =
  (typeof IMPORT_PIPELINE_AUDIT_EVENT_NAMES)[number];

/** Forbidden wording — Batch 9 records may NEVER be described as any of these. */
export const FORBIDDEN_IMPORT_RECORD_WORDING = [
  "verified",
  "production_ready",
  "production ready",
  "institutionally_usable",
  "institutionally usable",
] as const;
