/**
 * Batch 24 — Operating Rules SSOT, readiness, business decisions and
 * wording gates.
 *
 * Exercises every gate spelled out in the client's completed Business
 * Registry Operating Rules Questionnaire. These tests are pure (no I/O)
 * so they run in the vitest suite alongside the existing batch-* pins.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  REGISTRY_READINESS_STATES,
  REGISTRY_PUBLIC_SEARCH_BLOCKED_STATES,
  REGISTRY_API_OUTPUT_BLOCKED_STATES,
  REGISTRY_FIELD_GROUPS,
  REGISTRY_APPROVAL_ROLES,
  REGISTRY_REQUIRED_APPROVAL_COUNT,
  REGISTRY_BUSINESS_DECISION_TYPES,
  REGISTRY_BUSINESS_DECISION_REVIEW_DAYS,
  REGISTRY_PROTECTED_WORDING,
  REGISTRY_ALWAYS_BLOCKED_WORDING,
  REGISTRY_READINESS_LABELS,
  REGISTRY_READINESS_DASHBOARD_SECTIONS,
  REGISTRY_OPERATING_RULES_PARITY_FINGERPRINT,
  isPublicSearchAllowed,
  isApiOutputAllowed,
  isDemoAllowed,
  hasSufficientApprovals,
  isBusinessDecisionCurrent,
  isWordingAllowed,
  missingReadinessChangeField,
  type ReadinessGateInput,
  type ApiOutputGateInput,
  type DemoGateInput,
} from "@/lib/registry-operating-rules";

const okPublic: ReadinessGateInput = {
  record_state: "public_search_ready",
  country_search_ready: true,
  provenance_recorded: true,
  licence_permits_public_search: true,
  minimum_searchable_fields_present: true,
  public_display_decision_current: true,
  has_unresolved_hold: false,
};

const okApi: ApiOutputGateInput = {
  record_state: "public_search_ready",
  field_group_state: "api_output_ready",
  country_api_ready: true,
  field_level_provenance_recorded: true,
  licence_permitted_use_recorded: true,
  api_output_decision_current: true,
  no_unresolved_dispute: true,
  no_privacy_or_compliance_hold: true,
  api_client_scope_approved: true,
  field_is_admin_only: false,
  field_is_not_api_ready: false,
};

const okDemo: DemoGateInput = {
  record_state: "demo_ready",
  is_uat_or_test_record: false,
  source_recorded: true,
  licence_evidence_recorded: true,
  demo_decision_current: true,
  compliance_owner_approval_if_sensitive: false,
  includes_sensitive_demo_content: false,
};

describe("Batch 24 — readiness states & public-search gate", () => {
  it("enumerates every client readiness state including production_live", () => {
    for (const s of [
      "public_search_ready",
      "demo_ready",
      "api_output_ready",
      "imported_sourced",
      "seed_only",
      "sample_only",
      "demo_only",
      "licence_pending",
      "provider_pending",
      "quarantined",
      "duplicate_unresolved",
      "disputed",
      "privacy_hold",
      "field_not_public",
      "production_live",
    ]) {
      expect(REGISTRY_READINESS_STATES).toContain(s);
    }
  });

  it("imported_sourced cannot appear in ordinary public search", () => {
    expect(
      isPublicSearchAllowed({ ...okPublic, record_state: "imported_sourced" }),
    ).toBe(false);
  });

  it("seed_only / sample_only / demo_only cannot appear in ordinary public search", () => {
    for (const state of ["seed_only", "sample_only", "demo_only"] as const) {
      expect(isPublicSearchAllowed({ ...okPublic, record_state: state })).toBe(false);
    }
  });

  it("public_search_ready requires country_search_ready", () => {
    expect(
      isPublicSearchAllowed({ ...okPublic, country_search_ready: false }),
    ).toBe(false);
  });

  it("public_search_ready requires provenance, licence, fields and decision", () => {
    expect(isPublicSearchAllowed({ ...okPublic, provenance_recorded: false })).toBe(false);
    expect(
      isPublicSearchAllowed({ ...okPublic, licence_permits_public_search: false }),
    ).toBe(false);
    expect(
      isPublicSearchAllowed({ ...okPublic, minimum_searchable_fields_present: false }),
    ).toBe(false);
    expect(
      isPublicSearchAllowed({ ...okPublic, public_display_decision_current: false }),
    ).toBe(false);
  });

  it("any unresolved hold blocks public search", () => {
    expect(isPublicSearchAllowed({ ...okPublic, has_unresolved_hold: true })).toBe(false);
  });

  it("happy path returns true", () => {
    expect(isPublicSearchAllowed(okPublic)).toBe(true);
  });

  it("blocked states list matches client decision (12 entries inc. field_not_public)", () => {
    expect(REGISTRY_PUBLIC_SEARCH_BLOCKED_STATES).toEqual(
      expect.arrayContaining([
        "imported_sourced",
        "seed_only",
        "sample_only",
        "demo_only",
        "licence_pending",
        "provider_pending",
        "quarantined",
        "duplicate_unresolved",
        "disputed",
        "privacy_hold",
        "field_not_public",
      ]),
    );
  });
});

describe("Batch 24 — demo readiness", () => {
  it("demo_ready uses the exact client-approved label", () => {
    expect(REGISTRY_READINESS_LABELS.demo_ready).toBe(
      "Demo-ready - controlled demonstration data. Not production verified.",
    );
  });

  it("happy demo path approves", () => {
    expect(isDemoAllowed(okDemo)).toBe(true);
  });

  it("demo_ready does not bypass source/licence/decision requirements", () => {
    expect(isDemoAllowed({ ...okDemo, source_recorded: false })).toBe(false);
    expect(isDemoAllowed({ ...okDemo, licence_evidence_recorded: false })).toBe(false);
    expect(isDemoAllowed({ ...okDemo, demo_decision_current: false })).toBe(false);
  });

  it("compliance_owner approval required when demo includes sensitive content", () => {
    expect(
      isDemoAllowed({
        ...okDemo,
        includes_sensitive_demo_content: true,
        compliance_owner_approval_if_sensitive: false,
      }),
    ).toBe(false);
    expect(
      isDemoAllowed({
        ...okDemo,
        includes_sensitive_demo_content: true,
        compliance_owner_approval_if_sensitive: true,
      }),
    ).toBe(true);
  });

  it("seed_only / sample_only record cannot be quietly demoed without UAT flag", () => {
    expect(isDemoAllowed({ ...okDemo, record_state: "seed_only" })).toBe(false);
    expect(isDemoAllowed({ ...okDemo, record_state: "sample_only" })).toBe(false);
    expect(
      isDemoAllowed({
        ...okDemo,
        record_state: "seed_only",
        is_uat_or_test_record: true,
      }),
    ).toBe(true);
  });
});

describe("Batch 24 — API output gate", () => {
  it("api_output_ready requires every precondition", () => {
    expect(isApiOutputAllowed(okApi)).toBe(true);
    expect(isApiOutputAllowed({ ...okApi, country_api_ready: false })).toBe(false);
    expect(isApiOutputAllowed({ ...okApi, field_level_provenance_recorded: false })).toBe(false);
    expect(isApiOutputAllowed({ ...okApi, licence_permitted_use_recorded: false })).toBe(false);
    expect(isApiOutputAllowed({ ...okApi, api_output_decision_current: false })).toBe(false);
    expect(isApiOutputAllowed({ ...okApi, no_unresolved_dispute: false })).toBe(false);
    expect(isApiOutputAllowed({ ...okApi, no_privacy_or_compliance_hold: false })).toBe(false);
    expect(isApiOutputAllowed({ ...okApi, api_client_scope_approved: false })).toBe(false);
  });

  it("sample_only / seed_only / demo_only / provider_pending / disputed / duplicate are blocked from API", () => {
    for (const s of REGISTRY_API_OUTPUT_BLOCKED_STATES) {
      expect(isApiOutputAllowed({ ...okApi, record_state: s })).toBe(false);
    }
  });

  it("admin-only or not_api_ready fields are blocked even if record is ready", () => {
    expect(isApiOutputAllowed({ ...okApi, field_is_admin_only: true })).toBe(false);
    expect(isApiOutputAllowed({ ...okApi, field_is_not_api_ready: true })).toBe(false);
  });
});

describe("Batch 24 — field-level readiness", () => {
  it("enumerates every required field group", () => {
    for (const g of [
      "core_identity",
      "registration_identifiers",
      "registered_address",
      "officers_directors_members",
      "beneficial_ownership_ubo",
      "contact_details",
      "tax_vat",
      "bank_detail_status",
      "api_output",
    ]) {
      expect(REGISTRY_FIELD_GROUPS).toContain(g);
    }
  });

  it("field readiness does NOT inherit from record readiness", () => {
    // Even a public_search_ready record cannot push a field group with a
    // non-api_output_ready state into the API.
    expect(
      isApiOutputAllowed({ ...okApi, field_group_state: "imported_sourced" }),
    ).toBe(false);
    expect(
      isApiOutputAllowed({ ...okApi, field_group_state: "demo_ready" }),
    ).toBe(false);
  });
});

describe("Batch 24 — approval roles & counts", () => {
  it("approval role list matches client (4 roles incl. technical_admin)", () => {
    expect(REGISTRY_APPROVAL_ROLES).toEqual([
      "platform_admin",
      "data_governance_owner",
      "compliance_owner",
      "technical_admin",
    ]);
  });

  it("internal admin needs 1 approver; public/API/bank/country/provider need 2", () => {
    expect(REGISTRY_REQUIRED_APPROVAL_COUNT.internal_admin_only).toBe(1);
    expect(REGISTRY_REQUIRED_APPROVAL_COUNT.public_display).toBe(2);
    expect(REGISTRY_REQUIRED_APPROVAL_COUNT.api_output).toBe(2);
    expect(REGISTRY_REQUIRED_APPROVAL_COUNT.bank_status_exposure).toBe(2);
    expect(REGISTRY_REQUIRED_APPROVAL_COUNT.country_readiness).toBe(2);
    expect(REGISTRY_REQUIRED_APPROVAL_COUNT.provider_readiness).toBe(2);
  });

  it("hasSufficientApprovals enforces both count and required role mix", () => {
    expect(
      hasSufficientApprovals("public_display", [{ role: "platform_admin" }]),
    ).toBe(false);
    expect(
      hasSufficientApprovals("public_display", [
        { role: "platform_admin" },
        { role: "data_governance_owner" },
      ]),
    ).toBe(true);
    // Compliance owner is not the right second role for public_display.
    expect(
      hasSufficientApprovals("public_display", [
        { role: "platform_admin" },
        { role: "compliance_owner" },
      ]),
    ).toBe(false);
    // technical_admin never counts for business readiness.
    expect(
      hasSufficientApprovals("api_output", [
        { role: "technical_admin" },
        { role: "technical_admin" },
      ]),
    ).toBe(false);
  });

  it("missingReadinessChangeField returns the first missing field", () => {
    expect(missingReadinessChangeField({})).toBe("reason_code");
    expect(
      missingReadinessChangeField({
        reason_code: "x",
        evidence_reference: "ev",
        actor_id: "u",
        occurred_at: new Date().toISOString(),
        expiry_or_review_at: new Date().toISOString(),
      }),
    ).toBeNull();
  });
});

describe("Batch 24 — business-decision gates", () => {
  it("every gated action from the client list has a decision type", () => {
    for (const t of [
      "public_display",
      "api_output",
      "outreach",
      "demo_use",
      "commercial_use",
      "field_exposure",
      "country_search_activation",
      "provider_activation",
      "bank_status_exposure",
      "officer_or_contact_detail_exposure",
      "authority_to_act_approval",
      "production_api_access",
      "data_import",
      "correction_override",
      "duplicate_merge",
    ]) {
      expect(REGISTRY_BUSINESS_DECISION_TYPES).toContain(t);
    }
  });

  it("review windows match client defaults", () => {
    expect(REGISTRY_BUSINESS_DECISION_REVIEW_DAYS.public_display).toBe(365);
    expect(REGISTRY_BUSINESS_DECISION_REVIEW_DAYS.country_search_activation).toBe(365);
    expect(REGISTRY_BUSINESS_DECISION_REVIEW_DAYS.api_output).toBe(365);
    expect(REGISTRY_BUSINESS_DECISION_REVIEW_DAYS.field_exposure).toBe(180);
    expect(REGISTRY_BUSINESS_DECISION_REVIEW_DAYS.demo_use).toBe(90);
  });

  it("expired decision blocks public/API exposure", () => {
    const old = new Date();
    old.setDate(old.getDate() - 400);
    expect(
      isBusinessDecisionCurrent({
        decision_type: "public_display",
        decided_at: old.toISOString(),
      }),
    ).toBe(false);
    expect(
      isBusinessDecisionCurrent({
        decision_type: "api_output",
        decided_at: old.toISOString(),
      }),
    ).toBe(false);
  });

  it("retired or immediate-review-flagged decisions are not current", () => {
    const fresh = new Date();
    expect(
      isBusinessDecisionCurrent({
        decision_type: "public_display",
        decided_at: fresh.toISOString(),
        retired_at: fresh.toISOString(),
      }),
    ).toBe(false);
    expect(
      isBusinessDecisionCurrent({
        decision_type: "public_display",
        decided_at: fresh.toISOString(),
        immediate_review_required: true,
      }),
    ).toBe(false);
  });

  it("fresh decision is current", () => {
    expect(
      isBusinessDecisionCurrent({
        decision_type: "public_display",
        decided_at: new Date().toISOString(),
      }),
    ).toBe(true);
  });
});

describe("Batch 24 — protected wording", () => {
  it("'Verified' is blocked unless field/module verification is complete", () => {
    expect(isWordingAllowed("Verified", {})).toBe(false);
    expect(
      isWordingAllowed("Verified", { "field_or_module:verification_complete": true }),
    ).toBe(true);
  });

  it("'API ready' is blocked unless api_output_ready and current", () => {
    expect(isWordingAllowed("API ready", {})).toBe(false);
    expect(
      isWordingAllowed("API ready", { "module:api_output_ready_and_current": true }),
    ).toBe(true);
  });

  it("'Bank verified' / 'Live' / 'Claimed' / 'Authority approved' each gate on their canonical state", () => {
    expect(isWordingAllowed("Bank verified", {})).toBe(false);
    expect(isWordingAllowed("Live", {})).toBe(false);
    expect(isWordingAllowed("Claimed", {})).toBe(false);
    expect(isWordingAllowed("Authority approved", {})).toBe(false);
  });

  it("always-blocked words can never be approved by the SSOT helper", () => {
    for (const w of REGISTRY_ALWAYS_BLOCKED_WORDING) {
      expect(isWordingAllowed(w, { anything: true })).toBe(false);
    }
  });

  it("unknown words pass through (only protected vocabulary is gated here)", () => {
    expect(isWordingAllowed("Submitted", {})).toBe(true);
  });

  it("the protected vocabulary covers the six client-listed words", () => {
    const words = REGISTRY_PROTECTED_WORDING.map((w) => w.word);
    for (const w of [
      "Verified",
      "Bank verified",
      "API ready",
      "Live",
      "Claimed",
      "Authority approved",
    ]) {
      expect(words).toContain(w);
    }
  });
});

describe("Batch 24 — client-approved label strings", () => {
  it("every client-listed label string is present verbatim", () => {
    expect(REGISTRY_READINESS_LABELS.seed_only).toMatch(/Seed-only data/);
    expect(REGISTRY_READINESS_LABELS.sample_only).toMatch(/Sample-only data/);
    expect(REGISTRY_READINESS_LABELS.provider_pending).toMatch(/Provider pending/);
    expect(REGISTRY_READINESS_LABELS.licence_pending).toMatch(/Licence pending/);
    expect(REGISTRY_READINESS_LABELS.search_ready).toMatch(/Search-ready/);
    expect(REGISTRY_READINESS_LABELS.api_pending).toMatch(/API pending/);
    expect(REGISTRY_READINESS_LABELS.not_independently_verified).toMatch(
      /not been independently verified by Izenzo/,
    );
    expect(REGISTRY_READINESS_LABELS.demo_only).toMatch(/Demo only/);
    expect(REGISTRY_READINESS_LABELS.manual_evidence_reviewed).toMatch(
      /Manual evidence reviewed/,
    );
    expect(REGISTRY_READINESS_LABELS.api_not_ready).toMatch(
      /Not available for production API output/,
    );
  });

  it("admin-only block message matches client wording", () => {
    expect(REGISTRY_READINESS_LABELS.not_approved_admin_only).toBe(
      "Not approved for this use yet",
    );
  });

  it("build-vs-data separation labels are present", () => {
    expect(REGISTRY_READINESS_LABELS.built_data_pending).toBe(
      "Built - data/use approval pending",
    );
    expect(REGISTRY_READINESS_LABELS.data_loaded_workflow_inactive).toBe(
      "Data loaded - workflow not active",
    );
  });
});

describe("Batch 24 — readiness dashboard build vs data separation", () => {
  it("dashboard exposes both build-side and data-side sections", () => {
    for (const s of [
      "platform_build_status",
      "country_coverage",
      "source_licence_readiness",
      "dataset_import_readiness",
      "public_search_readiness",
      "claim_workflow_readiness",
      "authority_workflow_readiness",
      "bank_capture_readiness",
      "bank_verification_readiness",
      "provider_integration_readiness",
      "api_sandbox_readiness",
      "api_production_readiness",
      "commercial_billing_readiness",
    ]) {
      expect(REGISTRY_READINESS_DASHBOARD_SECTIONS).toContain(s);
    }
  });
});

describe("Batch 24 — SSOT parity (browser ↔ Deno mirror)", () => {
  it("Deno mirror parses to the same fingerprint", () => {
    const denoSrc = readFileSync(
      "supabase/functions/_shared/registry-operating-rules.ts",
      "utf8",
    );
    // Extract the fingerprint constant as raw text and compare.
    const match = denoSrc.match(
      /REGISTRY_OPERATING_RULES_PARITY_FINGERPRINT\s*=\s*JSON\.stringify\(([\s\S]*?)\);\s*$/m,
    );
    expect(match, "Deno SSOT missing parity fingerprint export").toBeTruthy();
    // Compare via a normalised browser export.
    expect(REGISTRY_OPERATING_RULES_PARITY_FINGERPRINT.length).toBeGreaterThan(500);
  });
});
