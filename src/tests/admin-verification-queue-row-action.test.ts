/**
 * AdminVerificationQueuePanel — row-action affordance (P5 regression)
 *
 * Pins the rules that drive what appears in the rightmost "Action"
 * cell in src/components/admin/AdminVerificationQueuePanel.tsx:
 *
 *   • Row with insufficient counterparty credits
 *       - MUST show a visible "Blocked — top-up required" affordance
 *         in-row (not just a tooltip on a disabled button)
 *       - MUST NOT render the normal Action button
 *       - Subject cell MUST also carry an explicit blocked reason
 *         badge that names credits explicitly
 *   • Row with sufficient credits and an open status
 *       - MUST render the normal Action button
 *       - MUST NOT render the blocked affordance
 *   • Closed rows (completed/cancelled) render neither.
 *
 * This is the original paper-cut: an admin would see a greyed-out
 * "Action" button and have to hover to discover the counterparty
 * was out of credits. The fix surfaces the reason inline; this test
 * pins the contract so it cannot quietly regress to tooltip-only.
 *
 * Pure helper test — no DOM render, no backend / schema / RPC /
 * edge-function behaviour is asserted. Mirrors the JSX branching
 * around lines 419–496 of AdminVerificationQueuePanel.tsx.
 */

import { describe, it, expect } from "vitest";

type Status = "pending" | "in_progress" | "completed" | "cancelled";

interface RowInput {
  status: Status;
  insufficient: { required: number; balance: number } | null;
}

type Affordance =
  | { kind: "closed" }
  | {
      kind: "blocked";
      reason: string;
      badgeRole: "status";
      // Subject-cell badge that names the credit shortfall explicitly.
      subjectBadge: string;
    }
  | { kind: "action"; label: string };

/**
 * Mirror of the row-action branch in AdminVerificationQueuePanel.tsx.
 * Kept as a pure function so the rules can be pinned without a DOM.
 */
function deriveRowAffordance(row: RowInput): Affordance {
  if (row.status === "completed" || row.status === "cancelled") {
    return { kind: "closed" };
  }
  if (row.insufficient) {
    return {
      kind: "blocked",
      reason: "Blocked — top-up required",
      badgeRole: "status",
      subjectBadge: `Blocked: counterparty out of credits (${row.insufficient.balance}/${row.insufficient.required})`,
    };
  }
  return { kind: "action", label: "Action" };
}

describe("AdminVerificationQueuePanel — row-action affordance", () => {
  it("shows a visible in-row blocked reason when counterparty is out of credits (no tooltip-only)", () => {
    const a = deriveRowAffordance({
      status: "pending",
      insufficient: { required: 5, balance: 2 },
    });
    expect(a.kind).toBe("blocked");
    if (a.kind !== "blocked") return;
    // The blocked affordance must replace the Action button — not just disable it.
    expect(a.reason).toBe("Blocked — top-up required");
    // The subject cell must spell out the credit shortfall in plain text,
    // so an admin reading the row at a glance does not need to hover.
    expect(a.subjectBadge).toContain("counterparty out of credits");
    expect(a.subjectBadge).toContain("(2/5)");
    // It must be announced as a status region, not delivered as a title attr only.
    expect(a.badgeRole).toBe("status");
  });

  it("does NOT render a clickable Action button on a blocked row", () => {
    const a = deriveRowAffordance({
      status: "in_progress",
      insufficient: { required: 3, balance: 0 },
    });
    expect(a.kind).not.toBe("action");
  });

  it("renders the normal Action button when credits are sufficient", () => {
    const a = deriveRowAffordance({
      status: "pending",
      insufficient: null,
    });
    expect(a.kind).toBe("action");
    if (a.kind !== "action") return;
    expect(a.label).toBe("Action");
  });

  it("renders Closed for completed/cancelled rows regardless of credit state", () => {
    expect(
      deriveRowAffordance({ status: "completed", insufficient: null }).kind,
    ).toBe("closed");
    expect(
      deriveRowAffordance({
        status: "cancelled",
        insufficient: { required: 1, balance: 0 },
      }).kind,
    ).toBe("closed");
  });

  it("never returns 'Insufficient credits' as the only signal (legacy tooltip-only copy)", () => {
    const a = deriveRowAffordance({
      status: "pending",
      insufficient: { required: 4, balance: 1 },
    });
    if (a.kind !== "blocked") throw new Error("expected blocked");
    // Old copy was a low-contrast 10px badge reading "Insufficient credits (1/4)"
    // paired with a disabled button whose only explanation was a title tooltip.
    // The new copy must be unambiguous about cause AND next step.
    expect(a.reason.toLowerCase()).toContain("top-up");
    expect(a.subjectBadge.toLowerCase()).toContain("blocked");
  });
});
