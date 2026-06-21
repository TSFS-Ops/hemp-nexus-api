/**
 * Batch 19B — Client Decision UI / API / UAT Alignment SSOT.
 *
 * Extends Batch 19A (`registry-client-decisions-19a.ts`) with the
 * user-facing, admin-facing, API-facing and UAT/demo-facing rules required
 * by the client's signed questionnaire.
 *
 * NEVER hand-edit copy strings in components — import from here.
 *
 * Pinned by:
 *   - scripts/check-batch-19b-ssot-parity.mjs
 *   - scripts/check-batch-19b-forbidden-wording.mjs
 *   - scripts/check-batch-19b-sample-only-api.mjs
 *   - scripts/check-batch-19b-sms-whatsapp-disabled.mjs
 */

import {
  BATCH_19A_CLAIM_APPROVED_LIMITED_COPY,
  BATCH_19A_REQUIRED_PUBLIC_PROFILE_LABEL,
  BATCH_19A_REQUIRED_SAMPLE_RECORD_LABEL,
  BATCH_19A_SAMPLE_ONLY_RECORDS,
} from "./registry-client-decisions-19a";

// ---------- §1 Public search UI ---------------------------------------------

export const BATCH_19B_PUBLIC_SEARCH_SAFE_MATCH_REASONS = [
  "name_match",
  "registration_match",
  "vat_match",
  "address_match",
  "activity_match",
  "approved_officer_or_member_name_match",
] as const;

export const BATCH_19B_PUBLIC_SEARCH_FORBIDDEN_MATCH_REASONS = [
  "personal_email_match",
  "personal_phone_match",
  "personal_address_match",
  "bank_detail_match",
  "source_provider_internal_field_match",
  "claim_evidence_match",
  "compliance_note_match",
] as const;

export const BATCH_19B_OFFICER_NAME_SEARCH_RULES = {
  unrestricted_public: false,
  logged_in_only: true,
  requires_public_display_approval: true,
  requires_official_or_licensed_source: true,
  requires_safe_label: true,
} as const;

// ---------- §2 Public profile UI --------------------------------------------

export const BATCH_19B_REQUIRED_PUBLIC_PROFILE_LABEL =
  BATCH_19A_REQUIRED_PUBLIC_PROFILE_LABEL;
export const BATCH_19B_REQUIRED_SAMPLE_RECORD_LABEL =
  BATCH_19A_REQUIRED_SAMPLE_RECORD_LABEL;

// ---------- §3 Claim UI -----------------------------------------------------

export const BATCH_19B_CLAIM_APPROVED_LIMITED_COPY =
  BATCH_19A_CLAIM_APPROVED_LIMITED_COPY;

export const BATCH_19B_CLAIM_UI_STATES = [
  "enquiry_started",
  "account_required",
  "email_verification_required",
  "claim_started",
  "evidence_submitted",
  "under_review",
  "more_information_required",
  "approved_limited",
  "rejected",
] as const;
export type Batch19bClaimUiState = (typeof BATCH_19B_CLAIM_UI_STATES)[number];

export const BATCH_19B_CLAIM_APPROVAL_DOES_NOT_UNLOCK = [
  "authority_ui",
  "bank_detail_submission_ui",
  "api_sharing_ui",
  "company_verified_label",
  "right_to_bind_company",
] as const;

// ---------- §4 Evidence UI --------------------------------------------------

export const BATCH_19B_EVIDENCE_REFRESH_LABEL =
  "Evidence is older than 12 months. Refresh required unless a reviewer exception is recorded.";

export const BATCH_19B_EVIDENCE_EXCEPTION_REQUIRED_FIELDS = [
  "reason",
  "reviewer",
  "timestamp",
  "audit_event",
] as const;

// ---------- §5 Representative UI -------------------------------------------

export const BATCH_19B_REPRESENTATIVE_BLOCKED_UI_ACTIONS = [
  "profile_edits",
  "bank_detail_submission",
  "user_management",
  "api_sharing_consent",
  "verified_company_representation",
] as const;

export const BATCH_19B_REPRESENTATIVE_PRE_AUTHORITY_NOTICE =
  "Representative actions are limited until authority-to-act is approved.";

// ---------- §6 Competing claim UI -------------------------------------------

export const BATCH_19B_CLAIM_CONFLICT_NEUTRAL_COPY =
  "Another claim is being reviewed for this company. Admin or compliance review is required before further actions are available.";

export const BATCH_19B_CLAIM_CONFLICT_ADMIN_OUTCOMES = [
  "primary_claim_approved",
  "additional_authority_approved",
  "claim_rejected",
  "duplicate_claim_closed",
  "dispute_opened",
] as const;

// ---------- §7 Missing-company UI -------------------------------------------

export const BATCH_19B_MISSING_COMPANY_NO_AUTO_PUBLIC_PROFILE_COPY =
  "Submitting a new-company request does not create a public profile. The request is reviewed first.";

export const BATCH_19B_MISSING_COMPANY_INTAKE_FIELDS = [
  "company_name",
  "country",
  "registration_number_if_known",
  "legal_form_if_known",
  "registered_address_if_known",
  "claimant_relationship",
  "evidence_upload",
  "declaration",
] as const;

// ---------- §8 Correction UI ------------------------------------------------

export const BATCH_19B_CORRECTION_REVIEW_GATED_COPY =
  "Submitting a correction request does not immediately change the registry record. The request will be reviewed first.";

export const BATCH_19B_CORRECTION_PROTECTED_FIELDS = [
  "company_name",
  "registration_number",
  "vat_number",
  "legal_form",
  "officers",
  "members",
  "registered_address",
  "bank_details",
] as const;

// ---------- §9 Outreach UI --------------------------------------------------

export const BATCH_19B_OUTREACH_UI_RULES = {
  email: "blocked_unless_business_decision_and_template_and_reviewer_and_audit",
  phone: "admin_only_manual_no_auto_dial_outcome_logged",
  sms: "disabled_in_phase_1",
  whatsapp: "disabled_in_phase_1",
  letter_or_manual_research: "admin_only_lawful_logged",
} as const;

export const BATCH_19B_SMS_DISABLED_COPY =
  "SMS outreach is disabled in Phase 1.";
export const BATCH_19B_WHATSAPP_DISABLED_COPY =
  "WhatsApp outreach is disabled in Phase 1.";

export const BATCH_19B_DO_NOT_CONTACT_SUPPRESSION_COPY =
  "A do-not-contact record exists. Outreach is suppressed and contact details remain source data only.";

// ---------- §10 API alignment -----------------------------------------------

export const BATCH_19B_SAMPLE_ONLY_API_CONTRACT = {
  production_api: "excluded",
  sandbox_readiness_state: "sample_only",
  sandbox_verified_by_izenzo: false,
  payment_status_usable_verified: false,
} as const;

export const BATCH_19B_API_MUST_NOT_IMPLY = [
  "sourced_data_independently_verified",
  "claim_approval_verifies_company_profile",
  "authority_approval_verifies_company_profile",
  "bank_detail_capture_verifies_bank_details",
] as const;

export const BATCH_19B_API_CLAIM_APPROVED_LIMITED_COPY =
  BATCH_19A_CLAIM_APPROVED_LIMITED_COPY;

// ---------- §11 Company portal ---------------------------------------------

export const BATCH_19B_PORTAL_LIMITED_CONNECTION_COPY =
  "Limited connection accepted. This does not verify the company, grant authority, or unlock bank-detail submission.";

// ---------- §12 Admin operations -------------------------------------------

export const BATCH_19B_OPERATIONS_SURFACED_WORK_ITEMS = [
  "sample_only_records",
  "claim_conflict_detected_items",
  "more_information_required_evidence_items",
  "authority_review_required_items",
  "provisional_record_created_admin_only_items",
  "proposed_contact_update_items",
  "outreach_business_decision_required_items",
  "do_not_contact_suppressed_items",
] as const;

// ---------- §13 UAT / demo --------------------------------------------------

export const BATCH_19B_UAT_CLIENT_DECISION_SCENARIOS = [
  "five_attached_records_are_sample_only",
  "sample_only_production_api_exclusion",
  "sample_only_sandbox_response_verified_by_izenzo_false",
  "claim_approved_limited_safe_copy",
  "officer_name_public_search_blocked_unless_approved",
  "public_display_approval_required_for_officer_activity_event",
  "evidence_older_than_12_months_refresh_required",
  "representative_cannot_submit_bank_details_before_authority",
  "competing_claims_neutral_conflict_handling",
  "missing_company_request_does_not_create_public_profile",
  "proposed_contact_update_remains_pending",
  "sms_disabled_phase_1",
  "whatsapp_disabled_phase_1",
  "do_not_contact_suppresses_outreach",
] as const;

// ---------- Sample-only record helpers --------------------------------------

export { BATCH_19A_SAMPLE_ONLY_RECORDS as BATCH_19B_SAMPLE_ONLY_RECORDS };

export function batch19bIsSampleOnly(slug: string): boolean {
  return (BATCH_19A_SAMPLE_ONLY_RECORDS as readonly string[]).includes(slug);
}

export function batch19bSandboxSampleOnlyResponse(slug: string) {
  return {
    record_slug: slug,
    readiness_state: BATCH_19B_SAMPLE_ONLY_API_CONTRACT.sandbox_readiness_state,
    verified_by_izenzo:
      BATCH_19B_SAMPLE_ONLY_API_CONTRACT.sandbox_verified_by_izenzo,
    label: BATCH_19B_REQUIRED_SAMPLE_RECORD_LABEL,
  } as const;
}

export function batch19bIsForbiddenPublicMatchReason(reason: string): boolean {
  return (
    BATCH_19B_PUBLIC_SEARCH_FORBIDDEN_MATCH_REASONS as readonly string[]
  ).includes(reason);
}
