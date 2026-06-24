/**
 * P-5 Batch 2 — KYC/KYB Evidence & Artefacts SSOT.
 *
 * Single source of truth for record types, evidence statuses, ratings,
 * requirement levels, rejection reasons, provider statuses and replacement
 * reasons. The Postgres enums in the Stage 1 migration are the authoritative
 * server-side copy; `p5-batch2-enum-drift.test.ts` fails the build if either
 * side drifts from this file.
 *
 * Stage 1 deliverable. No customer/funder/API surfaces consume this file yet.
 */

export const P5B2_KYC_RECORD_TYPES = [
  "company",
  "director_officer",
  "ubo_controller",
  "authorised_rep",
  "counterparty",
  "funder_entity",
  "funder_contact",
  "api_customer",
  "transaction_party",
  "bank_account",
  "invited_evidence_owner",
] as const;
export type P5B2KycRecordType = (typeof P5B2_KYC_RECORD_TYPES)[number];

export const P5B2_EVIDENCE_STATUSES = [
  "missing",
  "requested",
  "uploaded",
  "under_review",
  "accepted",
  "accepted_with_warning",
  "rejected",
  "expired",
  "replaced",
  "waived",
  "provider_dependent",
  "suspended_hold",
  "revoked",
] as const;
export type P5B2EvidenceStatus = (typeof P5B2_EVIDENCE_STATUSES)[number];

export const P5B2_EVIDENCE_RATINGS = [
  "strong",
  "good",
  "acceptable",
  "weak",
  "unusable",
  "provider_dependent",
] as const;
export type P5B2EvidenceRating = (typeof P5B2_EVIDENCE_RATINGS)[number];

export const P5B2_REQUIREMENT_LEVELS = [
  "mandatory",
  "optional",
  "conditional",
  "not_required",
] as const;
export type P5B2RequirementLevel = (typeof P5B2_REQUIREMENT_LEVELS)[number];

export const P5B2_REJECTION_REASONS = [
  "illegible_document",
  "expired_document",
  "wrong_document_type",
  "missing_page_or_incomplete_file",
  "name_mismatch",
  "company_number_registration_mismatch",
  "address_mismatch",
  "not_signed_not_dated",
  "authority_insufficient",
  "ownership_unclear",
  "bank_account_holder_mismatch",
  "bank_evidence_stale_or_unofficial",
  "tax_vat_mismatch",
  "unsupported_jurisdiction_or_format",
  "translation_or_notarisation_required",
  "provider_check_required",
  "provider_failed_or_unavailable",
  "suspected_fraud_or_tampering",
  "duplicate_document",
  "other",
] as const;
export type P5B2RejectionReason = (typeof P5B2_REJECTION_REASONS)[number];

export const P5B2_PROVIDER_STATUSES = [
  "provider_ready_not_live_provider_verified",
  "provider_credentials_pending",
  "provider_result_pending",
  "provider_unavailable",
  "provider_failed",
  "manual_review_recorded_not_provider_verified",
] as const;
export type P5B2ProviderStatus = (typeof P5B2_PROVIDER_STATUSES)[number];

export const P5B2_REPLACEMENT_REASONS = [
  "expired",
  "rejected",
  "updated",
  "correction",
  "better_quality",
  "authority_changed",
  "bank_details_changed",
  "ownership_changed",
  "admin_correction",
  "other",
] as const;
export type P5B2ReplacementReason = (typeof P5B2_REPLACEMENT_REASONS)[number];

/**
 * Forbidden customer/funder/API wording for any evidence item whose
 * provider has not produced a real result. Enforced by the Stage 2
 * provider-wording guard and at render time on non-admin surfaces.
 *
 * Externally rendering "Suspected fraud / tampering" is also forbidden;
 * the safe externalised form is "Manual review required".
 */
export const P5B2_FORBIDDEN_PROVIDER_WORDING = [
  "verified",
  "passed",
  "cleared",
  "sanctions clear",
  "bank verified",
  "provider approved",
  "no adverse result",
] as const;
