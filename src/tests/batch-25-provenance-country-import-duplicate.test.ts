/**
 * Batch 25 — Provenance, Country Coverage, Import Validation and
 * Duplicate Governance tests.
 *
 * Exercises the gates spelled out in the client's completed Business
 * Registry Operating Rules Questionnaire (sections 2–15). Pure tests,
 * no I/O.
 */
import { describe, it, expect } from "vitest";
import {
  REGISTRY_SOURCE_TYPES,
  REGISTRY_LICENSED_DATASET_WORDING,
  REGISTRY_SOURCE_PRIORITY_ORDER,
  REGISTRY_COUNTRY_CAPABILITIES,
  REGISTRY_COUNTRY_WORKFLOW_STATES,
  REGISTRY_SEARCHABLE_COUNTRY_MINIMUM_ITEMS,
  REGISTRY_PRE_IMPORT_CHECKLIST,
  REGISTRY_IMPORT_REQUIRED_FIELDS,
  REGISTRY_IMPORT_QUARANTINE_IF_MISSING_FIELDS,
  REGISTRY_IMPORT_EXCLUDED_FIELDS,
  REGISTRY_IMPORT_QUARANTINE_REASON_CODES,
  REGISTRY_BATCH_CRITICAL_FIELD_FAILURE_THRESHOLD_RATIO,
  REGISTRY_DUPLICATE_THRESHOLDS,
  REGISTRY_DUPLICATE_MERGE_RISK_TRIGGERS,
  REGISTRY_DUPLICATE_MERGE_AUDIT_REQUIREMENTS,
  REGISTRY_PROVENANCE_IMPORT_AUDIT_NAMES,
  REGISTRY_PROVENANCE_IMPORT_RULES_PARITY_FINGERPRINT,
  REGISTRY_PROVENANCE_READINESS_LABELS,
  missingSourceDescriptorField,
  isLicensedDatasetVerified,
  missingFieldProvenance,
  isFieldPublicAllowed,
  isPublicCoreFieldAllowed,
  compareSourcePriority,
  resolveSourceConflict,
  isCountryCapabilityReady,
  missingSearchableMinimum,
  missingPreImportChecklistItem,
  validateImportRow,
  evaluateBatchOutcome,
  classifyDuplicate,
  classifyMergeRisk,
  evaluateDuplicateMerge,
} from "@/lib/registry-provenance-import-rules";

describe("Batch 25 — source types and licensed datasets", () => {
  it("exposes all 10 client source types", () => {
    expect(REGISTRY_SOURCE_TYPES).toEqual([
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
    ]);
  });

  it("unknown / unlabelled source is quarantined", () => {
    expect(missingSourceDescriptorField({ source_type: "made_up_source" })).toBe(
      "unknown_source_type",
    );
  });

  it("complete descriptor passes", () => {
    expect(
      missingSourceDescriptorField({
        source_type: "official_public_registry",
        provider_name: "Companies House",
        licence_or_authority_basis: "public_registry",
        import_batch_id_or_evidence_id: "batch_001",
        country_jurisdiction: "GB",
        observed_date: "2026-06-01",
        imported_date: "2026-06-02",
        permitted_uses: "search_display_api",
        freshness_or_stale_date: "2027-06-01",
      }),
    ).toBeNull();
  });

  it("licensed dataset is sourced_only, not verified by default", () => {
    expect(isLicensedDatasetVerified("licensed_third_party_dataset", null)).toBe(false);
  });

  it("licensed dataset is verified once a verification method is recorded", () => {
    expect(
      isLicensedDatasetVerified(
        "licensed_third_party_dataset",
        "official_registry_confirmation",
      ),
    ).toBe(true);
  });

  it("required UI wording for licensed datasets is the client phrase", () => {
    expect(REGISTRY_LICENSED_DATASET_WORDING).toBe(
      "Sourced from licensed dataset - not independently verified by Izenzo.",
    );
  });
});

describe("Batch 25 — field provenance and manual review", () => {
  it("imported field requires every required provenance descriptor", () => {
    expect(missingFieldProvenance({ field_name: "company_name" })).toBe("source_type");
  });

  it("manual-review fields are not public by default", () => {
    expect(
      isFieldPublicAllowed({ field_group: "officers_directors_members" }),
    ).toBe(false);
  });

  it("manual-review fields become public once review is complete", () => {
    expect(
      isFieldPublicAllowed({
        field_group: "officers_directors_members",
        manual_review_completed: true,
      }),
    ).toBe(true);
  });

  it("core public fields require every gate", () => {
    expect(
      isPublicCoreFieldAllowed({
        source_or_licence_allows_public: true,
        no_dispute: true,
        no_conflict: true,
        no_privacy_hold: true,
        approved_public_search_decision: true,
      }),
    ).toBe(true);
    expect(
      isPublicCoreFieldAllowed({
        source_or_licence_allows_public: true,
        no_dispute: false,
        no_conflict: true,
        no_privacy_hold: true,
        approved_public_search_decision: true,
      }),
    ).toBe(false);
  });
});

describe("Batch 25 — source conflict priority", () => {
  it("priority order starts with official registry, ends with user correction", () => {
    expect(REGISTRY_SOURCE_PRIORITY_ORDER[0]).toBe("official_public_registry");
    expect(REGISTRY_SOURCE_PRIORITY_ORDER.at(-1)).toBe(
      "user_correction_dispute_submission",
    );
  });

  it("compareSourcePriority puts official registry above licensed dataset", () => {
    expect(
      compareSourcePriority("official_public_registry", "licensed_third_party_dataset"),
    ).toBeLessThan(0);
  });

  it("conflict resolution picks the highest-priority value and flags review", () => {
    const r = resolveSourceConflict<string>({
      values: [
        { value: "Old Co Ltd", source_type: "licensed_third_party_dataset" },
        { value: "Acme Co Ltd", source_type: "official_public_registry" },
      ],
    });
    expect(r.winning_value).toBe("Acme Co Ltd");
    expect(r.winning_source).toBe("official_public_registry");
    expect(r.conflict_under_review).toBe(true);
    expect(r.losers).toHaveLength(1);
  });
});

describe("Batch 25 — country coverage and search minimums", () => {
  it("country capabilities are split into 6 independent capabilities", () => {
    expect(REGISTRY_COUNTRY_CAPABILITIES).toHaveLength(6);
    expect(REGISTRY_COUNTRY_CAPABILITIES).toContain("search_coverage");
    expect(REGISTRY_COUNTRY_CAPABILITIES).toContain("bank_verification_coverage");
  });

  it("workflow states cover the full 12-state list", () => {
    expect(REGISTRY_COUNTRY_WORKFLOW_STATES).toHaveLength(12);
    expect(REGISTRY_COUNTRY_WORKFLOW_STATES).toContain("public_search_ready");
    expect(REGISTRY_COUNTRY_WORKFLOW_STATES).toContain("api_production_ready");
  });

  it("a country may be search-ready while bank verification is not", () => {
    expect(
      isCountryCapabilityReady({
        capability: "search_coverage",
        approved_states: ["public_search_ready"],
      }),
    ).toBe(true);
    expect(
      isCountryCapabilityReady({
        capability: "bank_verification_coverage",
        approved_states: ["public_search_ready"],
      }),
    ).toBe(false);
  });

  it("a country may be search-ready without claim coverage", () => {
    expect(
      isCountryCapabilityReady({
        capability: "claim_coverage",
        approved_states: ["public_search_ready"],
      }),
    ).toBe(false);
  });

  it("searchable country requires all 11 minimum items", () => {
    expect(REGISTRY_SEARCHABLE_COUNTRY_MINIMUM_ITEMS).toHaveLength(11);
    expect(missingSearchableMinimum({ company_legal_name: "Acme" })).not.toBeNull();
  });

  it("seed_only label is the exact client wording", () => {
    expect(REGISTRY_PROVENANCE_READINESS_LABELS.seed_only).toMatch(
      /Seed-only data - used for setup and testing\./,
    );
    expect(REGISTRY_PROVENANCE_READINESS_LABELS.sample_only).toMatch(
      /Sample-only data - limited demonstration record\./,
    );
  });
});

describe("Batch 25 — pre-import checklist and validation", () => {
  it("checklist exposes all 16 items", () => {
    expect(REGISTRY_PRE_IMPORT_CHECKLIST).toHaveLength(16);
  });

  it("production import is blocked when licence is missing", () => {
    const checklist = Object.fromEntries(
      REGISTRY_PRE_IMPORT_CHECKLIST.map((k) => [k, true]),
    );
    delete (checklist as Record<string, unknown>).legal_basis_licence_permitted_use;
    expect(
      missingPreImportChecklistItem(checklist, {
        production: true,
        production_extras: {
          import_batch_id: "b1",
          source_licence_record: "l1",
          approval_status: "approved",
        },
      }),
    ).toBe("legal_basis_licence_permitted_use");
  });

  it("import required fields list is exactly the client's 6 fields", () => {
    expect(REGISTRY_IMPORT_REQUIRED_FIELDS).toHaveLength(6);
  });

  it("quarantine-if-missing fields cover the client's 6 fields", () => {
    expect(REGISTRY_IMPORT_QUARANTINE_IF_MISSING_FIELDS).toHaveLength(6);
  });

  it("excluded fields cover the client's 6 sensitive groups", () => {
    expect(REGISTRY_IMPORT_EXCLUDED_FIELDS).toContain("raw_bank_details");
    expect(REGISTRY_IMPORT_EXCLUDED_FIELDS).toContain("passwords_or_secrets");
    expect(REGISTRY_IMPORT_EXCLUDED_FIELDS).toContain("identity_documents");
  });

  it("validateImportRow quarantines a row missing a quarantine-if field", () => {
    const row: Record<string, unknown> = {};
    for (const f of REGISTRY_IMPORT_REQUIRED_FIELDS) row[f] = `v_${f}`;
    // intentionally leave registration_number_or_local_identifier missing
    const r = validateImportRow({ row });
    expect(r.valid).toBe(false);
    expect(r.quarantined).toBe(true);
    expect(r.reason_codes).toContain("missing_quarantine_if_field");
  });

  it("validateImportRow rejects a row with an unknown source", () => {
    const row: Record<string, unknown> = {};
    for (const f of REGISTRY_IMPORT_REQUIRED_FIELDS) row[f] = `v_${f}`;
    for (const f of REGISTRY_IMPORT_QUARANTINE_IF_MISSING_FIELDS) row[f] = `v_${f}`;
    const r = validateImportRow({ row, has_unknown_source: true });
    expect(r.reason_codes).toContain("unknown_or_unlabelled_source");
  });

  it("quarantine reason codes contain the client's required taxonomy", () => {
    expect(REGISTRY_IMPORT_QUARANTINE_REASON_CODES).toContain("missing_required_field");
    expect(REGISTRY_IMPORT_QUARANTINE_REASON_CODES).toContain(
      "excluded_sensitive_field_present",
    );
  });
});

describe("Batch 25 — batch failure thresholds", () => {
  it("critical-field failure threshold ratio is the client's 5%", () => {
    expect(REGISTRY_BATCH_CRITICAL_FIELD_FAILURE_THRESHOLD_RATIO).toBeCloseTo(0.05);
  });

  it("systemic missing licence fails the whole batch", () => {
    const r = evaluateBatchOutcome({
      total_rows: 100,
      critical_field_failed_rows: 0,
      systemic_reasons: ["missing_licence"],
    });
    expect(r.outcome).toBe("fail_batch");
    expect(r.failure_reasons).toContain("missing_licence");
  });

  it("over 5% critical failure rate fails the whole batch", () => {
    const r = evaluateBatchOutcome({ total_rows: 100, critical_field_failed_rows: 6 });
    expect(r.outcome).toBe("fail_batch");
    expect(r.failure_reasons).toContain("critical_field_failure_rate_over_threshold");
  });

  it("under 5% critical failure rate stages valid rows", () => {
    const r = evaluateBatchOutcome({ total_rows: 100, critical_field_failed_rows: 4 });
    expect(r.outcome).toBe("stage_valid_rows");
  });
});

describe("Batch 25 — duplicate matching and merge governance", () => {
  it("name-only signal does not auto-match", () => {
    expect(
      classifyDuplicate({
        name_ratio: 0.99,
        same_country_industry_or_address_signal: false,
      }),
    ).toBe("none");
    expect(REGISTRY_DUPLICATE_THRESHOLDS.never_auto_match_signals).toContain(
      "company_name",
    );
  });

  it("same registration number in same country is an exact duplicate", () => {
    expect(
      classifyDuplicate({ same_country_and_registration_or_local_identifier: true }),
    ).toBe("exact");
  });

  it("name + address >= 95% is high confidence", () => {
    expect(classifyDuplicate({ name_plus_address_ratio: 0.95 })).toBe("high_confidence");
    expect(classifyDuplicate({ name_plus_address_ratio: 0.94 })).toBe("none");
  });

  it("name + officer/regdate >= 92% is high confidence", () => {
    expect(classifyDuplicate({ name_plus_officer_or_regdate_ratio: 0.92 })).toBe(
      "high_confidence",
    );
  });

  it("name >= 85% with country/industry/address signal is possible", () => {
    expect(
      classifyDuplicate({
        name_ratio: 0.86,
        same_country_industry_or_address_signal: true,
      }),
    ).toBe("possible");
  });

  it("classifyMergeRisk is high whenever any risk trigger is present", () => {
    expect(classifyMergeRisk([])).toBe("low");
    expect(classifyMergeRisk(["has_claims"])).toBe("high");
  });

  it("low-risk merge requires data_governance_owner", () => {
    const r = evaluateDuplicateMerge({
      duplicate_level: "exact",
      confidence: 0.99,
      risk_triggers: [],
      approvers: [],
    });
    expect(r.allowed).toBe(false);
    expect(r.tier).toBe("low_risk_data_governance_owner");
  });

  it("low-risk merge passes with data_governance_owner and confidence >= 0.95", () => {
    const r = evaluateDuplicateMerge({
      duplicate_level: "high_confidence",
      confidence: 0.96,
      risk_triggers: [],
      approvers: ["data_governance_owner"],
    });
    expect(r.allowed).toBe(true);
  });

  it("high-risk merge cannot auto-merge — requires platform_admin + compliance_owner", () => {
    const r = evaluateDuplicateMerge({
      duplicate_level: "exact",
      confidence: 1,
      risk_triggers: ["has_claims"],
      approvers: ["data_governance_owner"],
    });
    expect(r.allowed).toBe(false);
    expect(r.tier).toBe("high_risk_requires_platform_admin_plus_compliance_owner");
    expect((r as { missing_roles: string[] }).missing_roles).toEqual(
      expect.arrayContaining(["platform_admin", "compliance_owner"]),
    );
  });

  it("high-risk merge passes when both required roles are present", () => {
    const r = evaluateDuplicateMerge({
      duplicate_level: "exact",
      confidence: 1,
      risk_triggers: ["has_bank_details"],
      approvers: ["platform_admin", "compliance_owner"],
    });
    expect(r.allowed).toBe(true);
  });

  it("audit requirements pin old IDs, audit trail and rollback link", () => {
    expect(REGISTRY_DUPLICATE_MERGE_AUDIT_REQUIREMENTS).toEqual([
      "preserve_source_history",
      "preserve_old_ids",
      "preserve_audit_trail",
      "preserve_rollback_link",
    ]);
  });

  it("merge risk triggers cover the full client list", () => {
    expect(REGISTRY_DUPLICATE_MERGE_RISK_TRIGGERS).toEqual([
      "has_claims",
      "has_authority",
      "has_bank_details",
      "has_disputes",
      "has_api_exposure",
      "has_verified_fields",
    ]);
  });
});

describe("Batch 25 — audit names and parity fingerprint", () => {
  it("audit names cover the duplicate merge lifecycle", () => {
    expect(REGISTRY_PROVENANCE_IMPORT_AUDIT_NAMES).toContain(
      "registry.duplicate.merge_blocked_high_risk",
    );
    expect(REGISTRY_PROVENANCE_IMPORT_AUDIT_NAMES).toContain(
      "registry.duplicate.merge_rolled_back",
    );
  });

  it("parity fingerprint is a stable JSON string", () => {
    expect(typeof REGISTRY_PROVENANCE_IMPORT_RULES_PARITY_FINGERPRINT).toBe("string");
    expect(REGISTRY_PROVENANCE_IMPORT_RULES_PARITY_FINGERPRINT).toContain(
      "source_priority_order",
    );
  });
});
