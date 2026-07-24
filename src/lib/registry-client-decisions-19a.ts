/**
 * Batch 19A — Client Claim/Search/Profile Decision Alignment SSOT.
 *
 * Source of truth: client-completed questionnaire
 *   docs/registry/client-decisions/Izenzo_Business_Registry_Claim_Rules_Client_Questionnaire_Completed.md
 *   (David Davies, signed). Where the client gave an exact rule it overrides
 *   prior generic defaults from Batches 1–18. Where the document is silent the
 *   conservative defaults from earlier batches still apply.
 *
 * Pinned by:
 *   - scripts/check-batch-19a-ssot-parity.mjs
 *   - scripts/check-batch-19a-forbidden-wording.mjs
 *   - scripts/check-batch-19a-sample-only-locked.mjs
 *   - scripts/check-batch-19a-no-auto-outreach.mjs
 *
 * NEVER hand-edit copy strings in components — import from here.
 */

/** Q1 — claim starter categories (client decision E). */
export const BATCH_19A_CLAIM_STARTER_CATEGORIES = [
  "listed_officer",
  "listed_director",
  "listed_member",
  "listed_proprietor",
  "person_with_significant_control",
  "verified_company_domain_email_holder",
  "third_party_adviser_with_mandate_evidence",
  "unlisted_person_enquiry",
] as const;
export type Batch19aClaimStarterCategory =
  (typeof BATCH_19A_CLAIM_STARTER_CATEGORIES)[number];

/** Categories that may immediately start a claim. Unlisted-person enquiries
 *  are accepted but remain claim_pending_review until reviewed. */
export const BATCH_19A_IMMEDIATE_CLAIM_CATEGORIES: readonly Batch19aClaimStarterCategory[] = [
  "listed_officer",
  "listed_director",
  "listed_member",
  "listed_proprietor",
  "person_with_significant_control",
  "verified_company_domain_email_holder",
];

/** Third-party advisers require mandate evidence before the claim is started. */
export const BATCH_19A_THIRD_PARTY_REQUIRES_MANDATE = true;

/** Q2 — unregistered-user state flow (client decision B). */
export const BATCH_19A_UNREGISTERED_USER_FLOW = [
  "enquiry_started",
  "account_required",
  "email_verified",
  "claim_started",
  "evidence_submitted",
  "under_review",
  "approved",
  "rejected",
  "more_information_required",
] as const;
export type Batch19aUnregisteredUserState =
  (typeof BATCH_19A_UNREGISTERED_USER_FLOW)[number];

/** Pre-account guardrails. */
export const BATCH_19A_PRE_ACCOUNT_BLOCKS = [
  "no_sensitive_documents_before_account_and_email_verification",
  "no_bank_details_before_account_and_email_verification",
  "no_authority_request_before_account_and_email_verification",
] as const;

/** Q3 — limited claim approval. */
export const BATCH_19A_CLAIM_APPROVED_LIMITED_STATE = "claim_approved_limited";

export const BATCH_19A_CLAIM_APPROVED_LIMITED_COPY =
  "Claim reviewed - claimant connection accepted. Authority, profile data and bank details are not verified by this claim approval.";

/** Things claim_approved_limited explicitly does NOT grant. */
export const BATCH_19A_CLAIM_APPROVED_LIMITED_NEGATIVE_GRANTS = [
  "does_not_verify_company_profile",
  "does_not_confirm_authority_to_act",
  "does_not_verify_bank_details",
  "does_not_approve_api_sharing",
  "does_not_clear_compliance",
  "does_not_guarantee_claimant_may_bind_company",
] as const;

/** Q4 — evidence matrix. */
export const BATCH_19A_EVIDENCE_MATRIX = {
  sole_proprietor: [
    "claimant_id_or_passport",
    "registration_or_business_name_evidence",
    "proof_linking_claimant_to_proprietor_or_trading_name",
    "declaration_of_accuracy",
    "proof_of_current_contact_details",
    "mandate_evidence_if_claimant_is_not_the_proprietor",
  ],
  private_company: [
    "registry_extract_or_company_registration_evidence",
    "claimant_id",
    "proof_of_role_as_director_officer_or_authorised_representative",
    "board_resolution_company_letter_or_mandate_if_not_listed",
    "declaration_of_authority_requested",
  ],
  close_corporation: [
    "company_registry_evidence",
    "claimant_id",
    "proof_of_member_status_or_member_mandate",
    "declaration",
    "written_mandate_from_member_if_representative_is_not_a_member",
  ],
  corporate_shareholder_or_control: [
    "corporate_resolution_or_authorised_signatory_mandate",
    "proof_signatory_may_act_for_controlling_entity",
    "id_of_signatory",
    "evidence_linking_controlling_entity_to_company_record",
  ],
  third_party_representative: [
    "signed_mandate_power_of_attorney_or_engagement_letter",
    "identity_of_representative",
    "company_instruction_from_authorised_person",
    "expiry_or_review_date",
    "scope_requested",
  ],
} as const;

/** Evidence freshness rule (Q4 fallback). */
export const BATCH_19A_EVIDENCE_MAX_AGE_MONTHS = 12;
export const BATCH_19A_EVIDENCE_EXCEPTION_AUDIT_EVENT =
  "registry_claim_evidence_age_exception_recorded";

/** Q5 — representative permissions (pre-authority). */
export const BATCH_19A_REPRESENTATIVE_PRE_AUTHORITY_ALLOWED = [
  "start_claim",
  "upload_mandate_evidence",
  "request_authority_review",
] as const;
export const BATCH_19A_REPRESENTATIVE_PRE_AUTHORITY_FORBIDDEN = [
  "edit_company_profile_fields",
  "submit_bank_details",
  "manage_users",
  "consent_to_api_sharing",
  "represent_company_as_verified",
] as const;

/** Q6 — competing claim conflict outcomes. */
export const BATCH_19A_CLAIM_CONFLICT_STATE = "claim_conflict_detected";
export const BATCH_19A_CLAIM_CONFLICT_OUTCOMES = [
  "primary_claim_approved",
  "additional_authority_approved",
  "claim_rejected",
  "duplicate_claim_closed",
  "dispute_opened",
] as const;

/** While a conflict is unresolved, no claimant gets any of these. */
export const BATCH_19A_CONFLICT_BLOCKED_ACTIONS = [
  "profile_changes",
  "bank_submission",
  "user_management",
  "api_sharing_consent",
] as const;

/** Q7 — search visibility tiers (overrides earlier defaults). */
export const BATCH_19A_PUBLIC_SEARCHABLE_FIELDS = [
  "company_name",
  "registration_number",
  "local_number",
  "vat_number_where_available_and_permitted",
  "legal_form",
  "country",
  "registered_address",
  "activity_or_industry_description_where_available",
] as const;

export const BATCH_19A_LOGGED_IN_SEARCHABLE_FIELDS = [
  "officer_member_or_director_name_only_where_sourced_from_official_or_licensed_records_and_public_display_approved",
] as const;

export const BATCH_19A_ADMIN_ONLY_SEARCHABLE_FIELDS = [
  "emails",
  "phone_numbers",
  "personal_addresses",
  "source_contact_person_details",
  "full_filing_or_event_text",
  "linked_companies",
  "birth_year",
  "internal_notes",
] as const;

export const BATCH_19A_NEVER_PUBLICLY_SEARCHABLE_FIELDS = [
  "raw_personal_addresses",
  "personal_emails",
  "personal_phones",
  "bank_details",
  "source_provider_internal_fields",
  "claim_evidence",
  "compliance_notes",
] as const;

export const BATCH_19A_SAFE_SEARCH_MATCH_REASONS = [
  "name_match",
  "registration_match",
  "vat_match",
  "address_match",
  "activity_match",
  "approved_officer_or_member_name_match",
] as const;

/** Q8 — public profile visibility. */
export const BATCH_19A_PROFILE_PUBLIC_VISIBLE = [
  "company_name",
  "country",
  "registration_or_local_number",
  "legal_form",
  "status",
  "registered_business_address",
  "vat_number_where_available_and_permitted",
  "source_label",
  "last_sourced_date",
  "readiness_label",
] as const;

export const BATCH_19A_PROFILE_REQUIRES_PUBLIC_DISPLAY_APPROVAL = [
  "officer_director_or_member_names",
  "officer_director_or_member_roles",
  "activity_or_industry",
  "filing_summary_by_type_and_date",
  "non_sensitive_event_summary",
] as const;

export const BATCH_19A_PROFILE_HIDDEN_FROM_PUBLIC_AND_API = [
  "bank_details",
  "claim_evidence",
  "compliance_notes",
  "dispute_notes",
  "do_not_contact_records",
  "provider_or_internal_risk_labels",
] as const;

export const BATCH_19A_REQUIRED_PUBLIC_PROFILE_LABEL =
  "Sourced company record - not independently verified by Izenzo unless specifically stated.";

/** Q9 — sample_only readiness (client decision). */
export const BATCH_19A_SAMPLE_ONLY_STATE = "sample_only";

export const BATCH_19A_REQUIRED_SAMPLE_RECORD_LABEL =
  "Sample record - sourced data for workflow testing. Not independently verified by Izenzo.";

/** The five attached records that are locked as sample_only. */
export const BATCH_19A_SAMPLE_ONLY_RECORDS = [
  "bullion_bathrooms_nigeria",
  "dangote_fertiliser_limited",
  "harith_holdings",
  "laurium_capital",
  "starfair_162",
] as const;
export type Batch19aSampleOnlyRecord =
  (typeof BATCH_19A_SAMPLE_ONLY_RECORDS)[number];

/** Sample_only API contract. */
export const BATCH_19A_SAMPLE_ONLY_API_RULES = {
  production_api: "excluded",
  sandbox_readiness_state: "sample_only",
  sandbox_verified_by_izenzo: false,
  payment_status_usable_verified: false,
} as const;

/** Q10 — missing-company state flow. */
export const BATCH_19A_NEW_COMPANY_FLOW = [
  "no_result",
  "new_company_request_submitted",
  "duplicate_check_required",
  "evidence_required",
  "provisional_record_created_admin_only",
  "claim_review",
  "approved_imported_unverified",
  "rejected",
  "duplicate_found",
] as const;

export const BATCH_19A_NEW_COMPANY_REQUEST_FIELDS = [
  "company_name",
  "country",
  "registration_number_if_known",
  "legal_form_if_known",
  "registered_address_if_known",
  "claimant_relationship",
  "evidence_upload",
  "declaration",
] as const;

/** Q11 — post-claim editing. */
export const BATCH_19A_CLAIMANT_NEVER_DIRECT_EDIT = [
  "company_name",
  "registration_number",
  "vat_number",
  "legal_form",
  "officers",
  "members",
  "registered_address",
  "bank_details",
] as const;
export const BATCH_19A_PROPOSED_CONTACT_UPDATE_STATE = "proposed_contact_update";
export const BATCH_19A_CORRECTION_REJECTED_STATE = "correction_rejected";

/** Q12 — outreach restrictions. */
export const BATCH_19A_OUTREACH_RULES = {
  email: "business_decision_and_permitted_use_required_with_approved_template_and_human_reviewer",
  phone: "admin_only_manual_logged_no_auto_dial",
  sms: "disabled_in_phase_1",
  whatsapp: "disabled_in_phase_1",
  letter_or_manual_research: "admin_only_lawful_permitted_logged",
  do_not_contact: "immediate_suppression_and_no_public_exposure",
} as const;

/** Audit event names added/aligned by Batch 19A. */
export const BATCH_19A_AUDIT_EVENT_NAMES = [
  "claim_enquiry_started",
  "claim_pending_review",
  "claim_rejected",
  "representative_claim_started",
  "mandate_uploaded",
  "authority_review_requested",
  "representative_authority_approved",
  "representative_authority_rejected",
  "claim_approved_limited",
  "claim_conflict_detected",
  "registry_claim_evidence_age_exception_recorded",
  "registry_sample_only_record_locked",
  "registry_proposed_contact_update_submitted",
  "registry_correction_rejected",
] as const;
export type Batch19aAuditEventName =
  (typeof BATCH_19A_AUDIT_EVENT_NAMES)[number];

/** Helpers. */
export function isImmediateClaimAllowed(
  category: Batch19aClaimStarterCategory,
  hasMandateEvidence: boolean,
): boolean {
  if (category === "third_party_adviser_with_mandate_evidence") {
    return hasMandateEvidence === true;
  }
  if (category === "unlisted_person_enquiry") return false;
  return (BATCH_19A_IMMEDIATE_CLAIM_CATEGORIES as readonly string[]).includes(
    category,
  );
}

export function isSampleOnlyRecord(slug: string): boolean {
  return (BATCH_19A_SAMPLE_ONLY_RECORDS as readonly string[]).includes(slug);
}

export function isEvidenceWithinFreshnessWindow(ageMonths: number): boolean {
  return ageMonths <= BATCH_19A_EVIDENCE_MAX_AGE_MONTHS;
}

export function isClaimantDirectEditForbidden(field: string): boolean {
  return (BATCH_19A_CLAIMANT_NEVER_DIRECT_EDIT as readonly string[]).includes(
    field,
  );
}
