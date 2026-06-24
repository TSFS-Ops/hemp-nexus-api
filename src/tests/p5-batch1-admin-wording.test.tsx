/**
 * Stage 4 — P-5 admin wording guard tests.
 *
 * Asserts that admin components emit only Stage 2 SSOT-approved wording and
 * never the forbidden terms from P5_FORBIDDEN_WORDS.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { P5StatusBadge } from "@/pages/admin/p5-governance/components/P5StatusBadge";
import { ProviderDependencyPanel } from "@/pages/admin/p5-governance/components/ProviderDependencyPanel";
import { P5AuditTimeline } from "@/pages/admin/p5-governance/components/P5AuditTimeline";
import {
  P5_FORBIDDEN_WORDS,
  P5_STATUSES,
  P5_STATUS_LABELS,
} from "@/lib/p5-governance/constants";

function assertNoForbidden(text: string) {
  for (const w of P5_FORBIDDEN_WORDS) {
    expect(text.toLowerCase()).not.toContain(w.toLowerCase());
  }
}

describe("P-5 admin wording guard", () => {
  it("P5StatusBadge renders only Stage 1 SSOT labels", () => {
    for (const status of P5_STATUSES) {
      const { container, unmount } = render(<P5StatusBadge status={status} />);
      expect(container.textContent ?? "").toBe(P5_STATUS_LABELS[status]);
      assertNoForbidden(container.textContent ?? "");
      unmount();
    }
  });

  it("ProviderDependencyPanel uses safe provider wording", () => {
    const statuses = [
      "not_live",
      "credentials_pending",
      "pending",
      "timeout",
      "inconclusive",
      "failed",
      "passed",
      "not_applicable",
    ] as const;
    for (const s of statuses) {
      const { container, unmount } = render(
        <ProviderDependencyPanel
          data={{
            provider_dependency: true,
            provider_dependency_type: "idv",
            provider_status: s,
            provider_last_checked_at: "2026-06-24T00:00:00Z",
            requires_human_review: s === "inconclusive",
          }}
        />,
      );
      const text = container.textContent ?? "";
      assertNoForbidden(text);
      // Must include explicit precise wording, not implicit "cleared"/"verified"
      expect(text).toMatch(
        /Provider (result received|failed|timeout|pending|inconclusive|not live)|Credentials pending|Not applicable|Provider status not yet/,
      );
      unmount();
    }
  });

  it("P5AuditTimeline renders events without forbidden wording", () => {
    const { container } = render(
      <P5AuditTimeline
        events={[
          {
            id: "1",
            created_at: "2026-06-24T00:00:00Z",
            event_type: "case_created",
            actor_type: "system",
            actor_user_id: null,
            previous_status: null,
            new_status: "submitted",
            reason_code: null,
            note: "Created by ingestion pipeline",
          },
        ]}
      />,
    );
    assertNoForbidden(container.textContent ?? "");
  });
});
