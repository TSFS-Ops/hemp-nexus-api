import { describe, expect, it } from "vitest";
import { buildP5B2Checklist } from "@/lib/p5-batch2/checklist-engine";

const NOW = "2026-06-24T12:00:00.000Z";

describe("p5-batch2 checklist-engine", () => {
  it("segments mandatory vs conditional vs optional for a company with no evidence", () => {
    const r = buildP5B2Checklist({
      record_type: "company",
      jurisdiction: "ZA",
      entity_type: "PTY",
      transaction_type: null,
      finality_condition: "pre_finality",
      funder_rule: "none",
      api_rule: "none",
      provider_dependency: false,
      now: NOW,
    });
    expect(r.missing_mandatory.length).toBeGreaterThan(0);
    expect(r.missing_mandatory.find((x) => x.key === "company_registration")).toBeTruthy();
    expect(r.missing_conditional.find((x) => x.key === "sector_licence")).toBeTruthy();
    // No accepted evidence so nothing in uploaded_unreviewed.
    expect(r.uploaded_unreviewed.length).toBe(0);
  });

  it("promotes sector_licence to mandatory for regulated transaction types", () => {
    const r = buildP5B2Checklist({
      record_type: "company",
      jurisdiction: "ZA",
      entity_type: "PTY",
      transaction_type: "commodities",
      finality_condition: "at_finality",
      funder_rule: "none",
      api_rule: "none",
      provider_dependency: false,
      now: NOW,
    });
    expect(r.missing_mandatory.find((x) => x.key === "sector_licence")).toBeTruthy();
  });

  it("flags missing_mandatory_before_finality for finality-blockers only", () => {
    const r = buildP5B2Checklist({
      record_type: "company",
      jurisdiction: "ZA",
      entity_type: "PTY",
      transaction_type: null,
      finality_condition: "at_finality",
      funder_rule: "none",
      api_rule: "none",
      provider_dependency: false,
      now: NOW,
    });
    expect(r.missing_mandatory_before_finality.find((x) => x.key === "bank_confirmation")).toBeTruthy();
    // proof_of_address is mandatory but NOT a finality blocker.
    expect(r.missing_mandatory_before_finality.find((x) => x.key === "proof_of_address")).toBeFalsy();
    expect(r.missing_mandatory.find((x) => x.key === "proof_of_address")).toBeTruthy();
  });

  it("buckets uploaded-unreviewed, rejected, expired and provider-dependent separately", () => {
    const r = buildP5B2Checklist({
      record_type: "company",
      jurisdiction: "ZA",
      entity_type: "PTY",
      transaction_type: null,
      finality_condition: "pre_finality",
      funder_rule: "none",
      api_rule: "none",
      provider_dependency: false,
      now: NOW,
      existing_evidence: [
        { key: "company_registration", status: "uploaded", expiry_date: null, provider_dependency: false, provider_live: false, reviewed_at: null },
        { key: "proof_of_address", status: "rejected", expiry_date: null, provider_dependency: false, provider_live: false, reviewed_at: null },
        { key: "bank_confirmation", status: "accepted", expiry_date: "2025-01-01T00:00:00.000Z", provider_dependency: false, provider_live: false, reviewed_at: NOW },
        { key: "ubo_declaration", status: "provider_dependent", expiry_date: null, provider_dependency: true, provider_live: false, reviewed_at: null },
      ],
    });
    expect(r.uploaded_unreviewed.find((x) => x.key === "company_registration")).toBeTruthy();
    expect(r.rejected.find((x) => x.key === "proof_of_address")).toBeTruthy();
    expect(r.expired.find((x) => x.key === "bank_confirmation")).toBeTruthy();
    expect(r.provider_dependent.find((x) => x.key === "ubo_declaration")).toBeTruthy();
  });

  it("treats waived evidence as satisfied within bucket", () => {
    const r = buildP5B2Checklist({
      record_type: "company",
      jurisdiction: "ZA",
      entity_type: "PTY",
      transaction_type: null,
      finality_condition: "pre_finality",
      funder_rule: "none",
      api_rule: "none",
      provider_dependency: false,
      waivers: ["tax_or_vat_registration"],
      now: NOW,
    });
    expect(r.waived.find((x) => x.key === "tax_or_vat_registration")).toBeTruthy();
    expect(r.missing_mandatory.find((x) => x.key === "tax_or_vat_registration")).toBeFalsy();
  });
});
