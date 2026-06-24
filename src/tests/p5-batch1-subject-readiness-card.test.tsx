/**
 * Stage 5 — P5ReadinessCard subject-page tests.
 *
 * Asserts:
 *   - renders Stage 1 SSOT status labels
 *   - respects viewer scoping (customer/funder/api_client hide governance,
 *     compliance and admin-only refs)
 *   - never emits forbidden wording
 *   - provider-dependent block uses cautious wording
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { P5ReadinessCard } from "@/components/p5-governance";
import {
  P5_FORBIDDEN_WORDS,
  P5_STATUS_LABELS,
} from "@/lib/p5-governance/constants";
import type { P5ReadinessSummary } from "@/lib/p5-governance/summary-types";

function makeSummary(
  partial: Partial<P5ReadinessSummary> = {},
): P5ReadinessSummary {
  return {
    request_id: "req-1",
    correlation_id: null,
    entity_id: "ent-1",
    project_id: null,
    transaction_id: "match-1",
    organization_id: "org-1",
    readiness_status: "internally_ready",
    governance_status: "under_review",
    compliance_status: "under_review",
    evidence_status: "submitted",
    reason_codes: [],
    blocker_count: 0,
    warning_count: 1,
    provider_dependency: false,
    provider_dependency_type: null,
    provider_status: null,
    provider_last_checked_at: null,
    next_action: "Internally Ready — awaiting human approval",
    next_owner_type: "executive_approver",
    required_items_missing: 0,
    last_updated_at: "2026-06-24T00:00:00Z",
    status_changed_at: "2026-06-24T00:00:00Z",
    audit_reference: "AUD-123",
    decision_reference: null,
    evidence_pack_id: "PACK-9",
    evidence_summary_id: "SUM-9",
    version_hash_chain_reference: "hash-abc",
    is_on_hold: false,
    ...partial,
  };
}

function assertNoForbidden(text: string) {
  for (const w of P5_FORBIDDEN_WORDS) {
    expect(text.toLowerCase()).not.toContain(w.toLowerCase());
  }
}

describe("P5ReadinessCard — Stage 5 subject-page card", () => {
  it("renders the SSOT readiness label for every viewer", () => {
    for (const viewer of ["admin", "internal", "customer", "funder", "api_client"] as const) {
      const { container, unmount } = render(
        <P5ReadinessCard summary={makeSummary({ readiness_status: "ready_to_proceed", next_action: "Ready to Proceed" })} viewer={viewer} />,
      );
      expect(container.textContent).toContain(P5_STATUS_LABELS["ready_to_proceed"]);
      assertNoForbidden(container.textContent ?? "");
      unmount();
    }
  });

  it("hides governance + compliance lanes from customer/funder/api_client viewers", () => {
    for (const viewer of ["customer", "funder", "api_client"] as const) {
      const { queryByTestId, unmount } = render(
        <P5ReadinessCard summary={makeSummary()} viewer={viewer} />,
      );
      expect(queryByTestId("p5-readiness-lanes")).toBeNull();
      unmount();
    }
  });

  it("shows governance + compliance lanes to admin/internal", () => {
    for (const viewer of ["admin", "internal"] as const) {
      const { getByTestId, unmount } = render(
        <P5ReadinessCard summary={makeSummary()} viewer={viewer} />,
      );
      expect(getByTestId("p5-readiness-lanes")).toBeTruthy();
      unmount();
    }
  });

  it("hides hash-chain reference from everyone except admin", () => {
    const { queryByTestId, unmount } = render(
      <P5ReadinessCard summary={makeSummary()} viewer="customer" />,
    );
    // Customer never sees audit refs block
    expect(queryByTestId("p5-audit-refs")).toBeNull();
    unmount();

    const funder = render(
      <P5ReadinessCard summary={makeSummary()} viewer="funder" />,
    );
    // Funder sees audit ref + evidence pack but NOT the hash chain
    expect(funder.getByTestId("p5-audit-refs").textContent).toContain("AUD-123");
    expect(funder.getByTestId("p5-audit-refs").textContent).not.toContain("hash-abc");
    funder.unmount();

    const admin = render(
      <P5ReadinessCard summary={makeSummary()} viewer="admin" />,
    );
    expect(admin.getByTestId("p5-audit-refs").textContent).toContain("hash-abc");
    admin.unmount();
  });

  it("renders cautious provider wording for every provider status", () => {
    const statuses = [
      ["not_live", "Provider not live"],
      ["credentials_pending", "Credentials pending"],
      ["pending", "External confirmation pending"],
      ["timeout", "Provider timeout"],
      ["inconclusive", "Provider result inconclusive"],
      ["failed", "Provider result requires review"],
      ["passed", "Provider result received"],
      ["not_applicable", "Not applicable"],
    ] as const;
    for (const [s, label] of statuses) {
      const { container, unmount } = render(
        <P5ReadinessCard
          summary={makeSummary({
            provider_dependency: true,
            provider_dependency_type: "idv",
            provider_status: s,
            readiness_status: "provider_dependent",
            next_action: "Provider-Dependent",
          })}
          viewer="customer"
        />,
      );
      expect(container.textContent ?? "").toContain(label);
      assertNoForbidden(container.textContent ?? "");
      unmount();
    }
  });

  it("hides warning count from API client view", () => {
    const { container } = render(
      <P5ReadinessCard summary={makeSummary({ warning_count: 7 })} viewer="api_client" />,
    );
    expect(container.textContent ?? "").not.toContain("Warnings");
  });

  it("hides next-owner type from customer + funder", () => {
    for (const viewer of ["customer", "funder", "api_client"] as const) {
      const { container, unmount } = render(
        <P5ReadinessCard summary={makeSummary()} viewer={viewer} />,
      );
      expect(container.textContent ?? "").not.toContain("executive_approver");
      unmount();
    }
  });
});
