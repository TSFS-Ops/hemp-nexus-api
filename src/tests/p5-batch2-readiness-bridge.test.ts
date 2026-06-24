import { describe, expect, it } from "vitest";
import { buildP5B2Checklist } from "@/lib/p5-batch2/checklist-engine";
import { bridgeP5B2Readiness } from "@/lib/p5-batch2/readiness-bridge";

const NOW = "2026-06-24T12:00:00.000Z";

function emptyCompanyChecklist() {
  return buildP5B2Checklist({
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
}

describe("p5-batch2 readiness-bridge", () => {
  it("emits blockers for missing mandatory evidence", () => {
    const deltas = bridgeP5B2Readiness({ checklist: emptyCompanyChecklist() });
    expect(deltas.some((d) => d.severity === "blocker" && d.dimension === "kyb")).toBe(true);
    expect(deltas.some((d) => d.severity === "blocker" && d.dimension === "finality")).toBe(true);
  });

  it("emits review (not blocker) for uploaded-unreviewed mandatory evidence on compliance", () => {
    const checklist = buildP5B2Checklist({
      record_type: "company",
      jurisdiction: "ZA",
      entity_type: "PTY",
      transaction_type: null,
      finality_condition: "at_finality",
      funder_rule: "none",
      api_rule: "none",
      provider_dependency: false,
      now: NOW,
      existing_evidence: [
        { key: "company_registration", status: "uploaded", expiry_date: null, provider_dependency: false, provider_live: false, reviewed_at: null },
      ],
    });
    const deltas = bridgeP5B2Readiness({ checklist });
    expect(deltas.some((d) => d.dimension === "compliance" && d.severity === "review")).toBe(true);
    // uploaded-unreviewed still blocks finality.
    expect(deltas.some((d) => d.dimension === "finality" && d.severity === "blocker")).toBe(true);
  });

  it("provider-dependent evidence never supports live verification claims (warning, not pass)", () => {
    const checklist = buildP5B2Checklist({
      record_type: "company",
      jurisdiction: "ZA",
      entity_type: "PTY",
      transaction_type: null,
      finality_condition: "at_finality",
      funder_rule: "none",
      api_rule: "none",
      provider_dependency: true,
      now: NOW,
      existing_evidence: [
        { key: "bank_confirmation", status: "provider_dependent", expiry_date: null, provider_dependency: true, provider_live: false, reviewed_at: null },
      ],
    });
    const deltas = bridgeP5B2Readiness({ checklist });
    expect(deltas.some((d) => d.dimension === "compliance" && d.severity === "warning" && d.reason.startsWith("provider_dependent_not_live"))).toBe(true);
  });

  it("changed bank details block payment + finality", () => {
    const deltas = bridgeP5B2Readiness({
      checklist: emptyCompanyChecklist(),
      bank_details_changed_pending_approval: true,
    });
    expect(deltas.some((d) => d.dimension === "execution" && d.severity === "blocker" && d.reason === "bank_details_changed_pending_approval")).toBe(true);
    expect(deltas.some((d) => d.dimension === "finality" && d.severity === "blocker" && d.reason === "bank_details_changed_pending_approval")).toBe(true);
  });

  it("funder-pack relevance blocks funder_pack on missing-before-finality items", () => {
    const deltas = bridgeP5B2Readiness({
      checklist: emptyCompanyChecklist(),
      funder_pack_relevant: true,
    });
    expect(deltas.some((d) => d.dimension === "funder_pack" && d.severity === "blocker")).toBe(true);
  });

  it("api relevance blocks api on missing mandatory", () => {
    const deltas = bridgeP5B2Readiness({
      checklist: emptyCompanyChecklist(),
      api_relevant: true,
    });
    expect(deltas.some((d) => d.dimension === "api" && d.severity === "blocker")).toBe(true);
  });
});
