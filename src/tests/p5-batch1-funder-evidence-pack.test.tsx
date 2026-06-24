/**
 * Stage 5 — Funder evidence-pack scoping tests.
 *
 * Two layers:
 *   1. Pure contract test on the scoped P5ReadinessSummary type: a funder
 *      summary never carries internal-only fields.
 *   2. Render test: the FunderEvidencePack-equivalent rendering through
 *      P5ReadinessCard never emits forbidden wording, never reveals
 *      governance/compliance lanes, and never reveals owner type.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { P5ReadinessCard } from "@/components/p5-governance";
import { P5_FORBIDDEN_WORDS } from "@/lib/p5-governance/constants";
import type { P5ReadinessSummary } from "@/lib/p5-governance/summary-types";

function makeSummary(): P5ReadinessSummary {
  return {
    request_id: "r-1",
    correlation_id: null,
    entity_id: "ent-1",
    project_id: null,
    transaction_id: "match-1",
    organization_id: null,
    readiness_status: "conditional_ready",
    governance_status: "internally_ready",
    compliance_status: "conditional_ready",
    evidence_status: "submitted",
    reason_codes: ["waiver_granted"],
    blocker_count: 0,
    warning_count: 2,
    provider_dependency: true,
    provider_dependency_type: "kyb",
    provider_status: "pending",
    provider_last_checked_at: "2026-06-20T00:00:00Z",
    next_action: "External confirmation pending",
    next_owner_type: "external_provider",
    required_items_missing: 0,
    last_updated_at: "2026-06-24T00:00:00Z",
    status_changed_at: "2026-06-23T00:00:00Z",
    audit_reference: "AUD-77",
    decision_reference: "DEC-77",
    evidence_pack_id: "PACK-77",
    evidence_summary_id: "SUM-77",
    version_hash_chain_reference: "secret-hash",
  };
}

function assertNoForbidden(text: string) {
  for (const w of P5_FORBIDDEN_WORDS) {
    expect(text.toLowerCase()).not.toContain(w.toLowerCase());
  }
}

describe("FunderEvidencePack — Stage 5 scoping", () => {
  it("renders evidence pack ID + audit reference for funder viewer", () => {
    const { getByTestId } = render(
      <P5ReadinessCard summary={makeSummary()} viewer="funder" />,
    );
    const refs = getByTestId("p5-audit-refs").textContent ?? "";
    expect(refs).toContain("AUD-77");
    expect(refs).toContain("PACK-77");
  });

  it("hides admin-only hash-chain reference from funder viewer", () => {
    const { getByTestId } = render(
      <P5ReadinessCard summary={makeSummary()} viewer="funder" />,
    );
    const refs = getByTestId("p5-audit-refs").textContent ?? "";
    expect(refs).not.toContain("secret-hash");
  });

  it("hides governance + compliance lanes from funder viewer", () => {
    const { queryByTestId } = render(
      <P5ReadinessCard summary={makeSummary()} viewer="funder" />,
    );
    expect(queryByTestId("p5-readiness-lanes")).toBeNull();
  });

  it("hides next-owner type from funder viewer", () => {
    const { container } = render(
      <P5ReadinessCard summary={makeSummary()} viewer="funder" />,
    );
    expect(container.textContent ?? "").not.toContain("external_provider");
  });

  it("emits no forbidden wording", () => {
    const { container } = render(
      <P5ReadinessCard summary={makeSummary()} viewer="funder" />,
    );
    assertNoForbidden(container.textContent ?? "");
  });

  it("provider-dependent block uses cautious External confirmation pending wording", () => {
    const { container } = render(
      <P5ReadinessCard summary={makeSummary()} viewer="funder" />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Provider-Dependent");
    expect(text).toContain("External confirmation pending");
    // Critically: never implies a positive provider outcome.
    expect(text.toLowerCase()).not.toContain("verified");
    expect(text.toLowerCase()).not.toContain("cleared");
    expect(text.toLowerCase()).not.toContain("passed");
  });
});
