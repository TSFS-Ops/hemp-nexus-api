/**
 * Batch 8 — Registry record / search SSOT (frontend mirror).
 * Pinned to supabase/functions/_shared/registry-record-model.ts by
 * scripts/check-registry-record-model-parity.mjs.
 */

export const REGISTRY_RECORD_READINESS_STATES = [
  "imported_unverified",
  "verified",
  "production_ready",
] as const;
export type RegistryRecordReadinessState =
  (typeof REGISTRY_RECORD_READINESS_STATES)[number];

export const PUBLIC_SEARCHABLE_FIELDS = [
  "company_name",
  "trading_name",
  "previous_name",
  "registration_number",
  "local_number",
  "vat_number",
  "tax_number",
  "country_code",
  "legal_form",
  "registered_address",
  "address",
  "activity",
  "person_display_name",
] as const;

export const ADMIN_ONLY_SEARCHABLE_FIELDS = [
  "person_full_name",
  "person_email",
  "person_phone",
  "person_address",
  "event_raw_text",
  "filing_raw_text",
  "filing_source_document",
  "internal_notes",
] as const;

export const FORBIDDEN_PUBLIC_FIELDS = [
  "raw_bank_details",
  "unmasked_bank_account",
  "sensitive_evidence_document",
  "personal_residential_address_unapproved",
  "raw_personal_contact",
] as const;

/**
 * Legal-form normalisation. Lower-case, punctuation-stripped tokens
 * mapped to a canonical token used by both indexer and query.
 */
export const LEGAL_FORM_ALIASES: Record<string, string> = {
  "ltd": "limited",
  "limited": "limited",
  "plc": "plc",
  "pty": "ptyltd",
  "ptyltd": "ptyltd",
  "ptylimited": "ptyltd",
  "cc": "cc",
  "closecorporation": "cc",
  "soleproprietor": "soleprop",
  "soleprop": "soleprop",
  "rc": "rc",
  "bn": "bn",
};

export const REGISTRY_RECORD_AUDIT_EVENT_NAMES = [
  "registry_company_record_created",
  "registry_company_record_updated",
  "registry_company_record_indexed",
  "registry_company_search_index_rebuilt",
  "registry_company_public_search_performed",
  "registry_company_admin_search_performed",
  "registry_company_public_profile_viewed",
  "registry_company_admin_profile_viewed",
  "registry_company_sensitive_match_suppressed",
  "registry_company_claim_availability_checked",
  "registry_company_no_result_new_request_prompted",
] as const;

export const IMPORTED_UNVERIFIED_NOTICE =
  "Source-backed record. Not independently verified by Izenzo.";

export function normaliseSearchValue(p: string | null | undefined): string {
  return (p ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normaliseLegalForm(p: string | null | undefined): string {
  const n = normaliseSearchValue(p);
  return LEGAL_FORM_ALIASES[n] ?? n;
}
