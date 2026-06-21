/**
 * Batch 7 — Registry Search / Claim Rules Hardening SSOT (Deno mirror).
 * Mirror of src/lib/registry-claim-rules.ts. Do not drift.
 * Pinned by scripts/check-registry-claim-rules-parity.mjs.
 */

export const REGISTRY_CLAIMANT_ROLE_TYPES = [
  "listed_director",
  "listed_member",
  "listed_proprietor",
  "listed_officer",
  "company_secretary",
  "company_domain_email_holder",
  "employee_with_mandate",
  "professional_representative",
] as const;
export type RegistryClaimantRoleType =
  (typeof REGISTRY_CLAIMANT_ROLE_TYPES)[number];

export const REGISTRY_PROFESSIONAL_REPRESENTATIVE_ROLES: RegistryClaimantRoleType[] = [
  "professional_representative",
];
export const REGISTRY_PROFESSIONAL_REPRESENTATIVE_DEFAULT_AUTHORITY_DAYS = 90;

export const REGISTRY_CLAIM_APPROVAL_ROLES = [
  "platform_admin",
  "compliance_owner",
] as const;

export const REGISTRY_CLAIM_INTEREST_STATES = [
  "claim_interest_started",
  "account_required",
  "email_verification_required",
  "email_verified",
  "claim_started",
  "claim_submitted",
  "evidence_required",
  "under_review",
  "approved",
  "rejected",
  "expired",
  "cancelled",
] as const;
export type RegistryClaimInterestState =
  (typeof REGISTRY_CLAIM_INTEREST_STATES)[number];

export const REGISTRY_CLAIM_CONFLICT_STATES = [
  "first_claim_under_review",
  "second_claim_received",
  "claim_conflict_detected",
  "evidence_requested_from_claimants",
  "admin_review",
  "one_claim_approved",
  "multiple_claims_approved_with_scoped_access",
  "rejected",
  "escalated",
] as const;
export type RegistryClaimConflictState =
  (typeof REGISTRY_CLAIM_CONFLICT_STATES)[number];

export const REGISTRY_EVIDENCE_CATEGORIES = [
  "sole_proprietor",
  "private_company",
  "close_corporation",
  "corporate_shareholder_or_control_party",
  "third_party_representative",
] as const;
export type RegistryEvidenceCategory =
  (typeof REGISTRY_EVIDENCE_CATEGORIES)[number];

export const REGISTRY_EVIDENCE_REQUIREMENTS: Record<
  RegistryEvidenceCategory,
  readonly string[]
> = {
  sole_proprietor: [
    "proof_of_identity_for_proprietor",
    "registration_evidence_or_source_match",
    "claimant_declaration",
    "proof_of_contact_control_where_available",
    "mandate_letter_if_representing_proprietor",
  ],
  private_company: [
    "director_or_officer_match_where_available",
    "company_registration_evidence",
    "company_domain_email_proof_where_available",
    "mandate_or_board_authorisation_if_not_listed_director",
    "claimant_declaration",
  ],
  close_corporation: [
    "member_match_where_available",
    "registration_evidence",
    "member_declaration_or_mandate",
    "proof_of_contact_control_where_available",
  ],
  corporate_shareholder_or_control_party: [
    "company_mandate",
    "representative_authority_letter",
    "proof_signer_may_act_for_shareholder_or_control_party",
    "supporting_registration_evidence",
  ],
  third_party_representative: [
    "mandate_letter",
    "proof_of_representative_identity",
    "proof_of_relationship_to_company",
    "declaration_of_authority",
    "mandate_expiry_date_where_applicable",
  ],
};

export const REGISTRY_SEARCHABILITY_TIERS = [
  "public_searchable",
  "public_searchable_with_careful_display",
  "admin_only_searchable",
  "not_publicly_searchable",
] as const;

export const REGISTRY_SEARCH_FIELD_TIERS = {
  public_searchable: [
    "company_name",
    "registration_number",
    "local_number",
    "vat_tax_number",
    "legal_form",
    "country",
    "registered_address",
    "trading_name_where_available",
    "previous_company_name_where_available",
    "company_status",
  ],
  public_searchable_with_careful_display: [
    "officer_or_member_name_where_allowed",
    "activity_description",
    "filing_event_summary",
  ],
  admin_only_searchable: [
    "email_addresses",
    "phone_numbers",
    "personal_addresses",
    "officer_linked_companies",
    "raw_event_text",
    "raw_filing_text",
    "source_document_references",
    "internal_confidence_notes",
  ],
  not_publicly_searchable: [
    "raw_personal_contact_details",
    "personal_residential_addresses",
    "sensitive_evidence_metadata",
    "bank_details",
    "unmasked_account_references",
  ],
} as const;

export const REGISTRY_VISIBILITY_TIERS = [
  "public_visible",
  "masked_public",
  "admin_only",
  "hidden_from_public",
] as const;

export const REGISTRY_PROFILE_FIELD_TIERS = {
  public_visible: [
    "company_name",
    "country",
    "registration_number",
    "local_number_where_available",
    "legal_form",
    "company_status",
    "registered_address",
    "vat_tax_number_where_allowed",
    "source_summary",
    "source_generated_date",
    "readiness_label",
    "claim_status_label",
    "company_profile_verification_status_label",
    "bank_detail_status_label_only_no_raw",
  ],
  masked_public: [
    "officer_or_member_or_director_names_where_allowed",
    "partial_address_where_full_not_safe",
    "source_confidence_summary",
  ],
  admin_only: [
    "emails",
    "phone_numbers",
    "personal_addresses",
    "officer_linked_companies",
    "full_event_history",
    "full_filing_history",
    "raw_source_evidence",
    "internal_notes",
    "conflicting_data",
    "outreach_eligibility",
    "bank_detail_submission_metadata",
  ],
  hidden_from_public: [
    "raw_bank_details",
    "unmasked_bank_references",
    "personal_contact_details_unless_business_decision_allows",
    "sensitive_evidence_documents",
  ],
} as const;

export const REGISTRY_IMPORTED_RECORD_READINESS_STATES = [
  "imported_unverified",
  "claim_enabled",
  "authority_enabled",
  "client_demo_ready",
  "production_ready",
] as const;
export type RegistryImportedRecordReadinessState =
  (typeof REGISTRY_IMPORTED_RECORD_READINESS_STATES)[number];

export const REGISTRY_IMPORTED_RECORD_DEFAULT_STATE: RegistryImportedRecordReadinessState =
  "imported_unverified";

export const REGISTRY_NEW_COMPANY_REQUEST_STATES = [
  "no_result_found",
  "new_company_request_started",
  "basic_details_submitted",
  "source_evidence_required",
  "duplicate_check_pending",
  "admin_review",
  "provisional_record_created",
  "request_rejected",
  "claim_review_required",
] as const;
export type RegistryNewCompanyRequestState =
  (typeof REGISTRY_NEW_COMPANY_REQUEST_STATES)[number];

export const REGISTRY_CORRECTION_REQUEST_STATES = [
  "correction_requested",
  "evidence_required",
  "under_admin_review",
  "approved",
  "rejected",
  "profile_updated_with_new_provenance",
] as const;
export type RegistryCorrectionRequestState =
  (typeof REGISTRY_CORRECTION_REQUEST_STATES)[number];

export const REGISTRY_OUTREACH_CHANNEL_PERMISSIONS = [
  "email_allowed_after_permitted_use_approval",
  "phone_manual_only_logged",
  "sms_disabled_until_provider_and_consent_rules_approved",
  "whatsapp_disabled_until_provider_and_consent_rules_approved",
  "letter_allowed_if_approved_and_logged",
  "manual_research_allowed_for_admin_enrichment_only",
] as const;

export const REGISTRY_BATCH7_AUDIT_EVENT_NAMES = [
  "registry_claim_interest_started",
  "registry_claim_account_required",
  "registry_claim_email_verified",
  "registry_claim_evidence_required",
  "registry_claim_conflict_detected",
  "registry_claim_conflict_resolved",
  "registry_claim_scope_granted",
  "registry_new_company_request_started",
  "registry_new_company_request_submitted",
  "registry_new_company_duplicate_check_started",
  "registry_new_company_provisional_created",
  "registry_new_company_request_rejected",
  "registry_company_correction_requested",
  "registry_company_correction_evidence_added",
  "registry_company_correction_reviewed",
  "registry_company_correction_applied",
  "registry_public_search_sensitive_match_suppressed",
  "registry_outreach_blocked_pending_business_decision",
] as const;

export const REGISTRY_CLAIM_APPROVAL_SAFETY_COPY =
  "Claim approved. This confirms that the claim record has passed review. It does not verify authority-to-act, company profile accuracy or bank details.";

export const REGISTRY_PUBLIC_PROFILE_NON_VERIFICATION_COPY =
  "Source data has not been independently verified by Izenzo unless the profile status says verified.";

export const REGISTRY_IMPORTED_UNVERIFIED_DISPLAY_COPY =
  "Imported registry record. This data is source-backed but has not yet been independently verified by Izenzo.";

export const REGISTRY_PROVISIONAL_RECORD_DISPLAY_COPY =
  "Provisional unverified record. Not public unless approved.";

export const REGISTRY_OUTREACH_BLOCKED_COPY =
  "Outreach is blocked. Contact details may not be used for outbound outreach until a recorded business decision approves the permitted-use basis.";

export const REGISTRY_IMPORTED_UNVERIFIED_API_STATUS_RESPONSES = [
  "not_usable",
  "not_ready",
  "business_decision_required",
] as const;

export const REGISTRY_SEARCH_REQUIRED_FEATURES = [
  "partial_matches",
  "registration_number_without_prefix",
  "vat_tax_number_match",
  "punctuation_difference_tolerance",
  "legal_form_abbreviation_tolerance",
  "spelling_tolerance",
  "why_this_matched_labels",
] as const;

export const REGISTRY_NEW_COMPANY_REQUEST_REQUIRED_FIELDS = [
  "company_name",
  "country",
  "registration_number_if_available",
  "legal_form_if_known",
  "source_or_evidence",
  "claimant_name",
  "claimant_email",
  "reason_for_adding_the_company",
] as const;
