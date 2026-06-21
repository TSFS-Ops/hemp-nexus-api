/**
 * Batch 9 — Registry Source Import / Validation pipeline tests.
 *
 * Unit-level tests against the SSOT and the visibility / forbidden
 * rules. The full end-to-end pipeline (edge functions + RPC) is
 * covered by the curl smoke tests under
 * `evidence/batch-9-registry-source-import-validation/README.md`.
 */
import { describe, it, expect } from "vitest";
import {
  IMPORTED_RECORD_DEFAULT_READINESS,
  SOURCE_FILE_TYPES,
  TARGET_FIELDS,
  FIELD_VISIBILITY_TIERS,
  FORBIDDEN_PUBLIC_TARGET_FIELDS,
  DEFAULT_FIELD_TIER,
  VALIDATION_OUTCOMES,
  DUPLICATE_CONFIDENCE_LEVELS,
  QUARANTINE_REASON_CODES,
  IMPORT_PIPELINE_AUDIT_EVENT_NAMES,
  FORBIDDEN_IMPORT_RECORD_WORDING,
} from "@/lib/registry-import-pipeline";

describe("Batch 9 — import pipeline SSOT", () => {
  it("default readiness is imported_unverified", () => {
    expect(IMPORTED_RECORD_DEFAULT_READINESS).toBe("imported_unverified");
  });

  it("only supports the approved source-file types", () => {
    expect(SOURCE_FILE_TYPES).toEqual([
      "manual_records","json_payload","csv_payload","text_extract","pdf_text_paste",
    ]);
  });

  it("target field list covers every Batch 9 required column", () => {
    for (const f of [
      "company_name","trading_names","previous_names","country_code",
      "registration_number","local_number","vat_number","legal_form",
      "company_status","registered_address","postal_address",
      "source_summary","source_generated_date","activity_summary",
      "officer_name","officer_role","filing_label","filing_summary",
      "event_label","event_summary","contact_email","contact_phone",
      "source_confidence","source_disclaimer","provenance_reference",
    ]) {
      expect(TARGET_FIELDS).toContain(f);
    }
  });

  it("declares all six visibility tiers", () => {
    expect(FIELD_VISIBILITY_TIERS).toEqual([
      "public_searchable","public_visible","masked_public","admin_only","hidden","excluded",
    ]);
  });

  it("personal contact target fields are forbidden on any public tier", () => {
    for (const f of FORBIDDEN_PUBLIC_TARGET_FIELDS) {
      expect(DEFAULT_FIELD_TIER[f]).toBe("admin_only");
    }
  });

  it("validation outcomes match the spec", () => {
    expect(VALIDATION_OUTCOMES).toEqual([
      "pending","valid","valid_with_warnings","quarantined","rejected",
      "duplicate_review_required","business_decision_required",
    ]);
  });

  it("duplicate confidence levels match the spec", () => {
    expect(DUPLICATE_CONFIDENCE_LEVELS).toEqual([
      "low","medium","high","exact_identifier_match",
    ]);
  });

  it("quarantine reason codes cover bank-detail and personal data leak cases", () => {
    expect(QUARANTINE_REASON_CODES).toContain("raw_bank_detail_detected");
    expect(QUARANTINE_REASON_CODES).toContain("sensitive_personal_data_mapped_public");
    expect(QUARANTINE_REASON_CODES).toContain("source_provenance_missing");
  });

  it("publishes the full canonical audit event list", () => {
    const expected = [
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
    ];
    for (const e of expected) expect(IMPORT_PIPELINE_AUDIT_EVENT_NAMES).toContain(e);
  });

  it("forbidden wording list blocks verified / production-ready / institutionally-usable copy", () => {
    expect(FORBIDDEN_IMPORT_RECORD_WORDING).toContain("verified");
    expect(FORBIDDEN_IMPORT_RECORD_WORDING).toContain("production_ready");
    expect(FORBIDDEN_IMPORT_RECORD_WORDING).toContain("institutionally_usable");
  });
});
