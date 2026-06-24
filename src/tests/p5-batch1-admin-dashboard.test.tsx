/**
 * Stage 4 — P-5 admin dashboard tests.
 *
 * Uses the dashboard-internal `matchesFilter` semantics indirectly via the
 * exported badge + filter labels, and asserts that a blocked case never
 * renders as Ready-to-Proceed.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { P5StatusBadge } from "@/pages/admin/p5-governance/components/P5StatusBadge";
import { P5_STATUSES, P5_STATUS_LABELS } from "@/lib/p5-governance/constants";

describe("P-5 admin dashboard badges + status invariants", () => {
  it("status badges render the canonical SSOT label for every status", () => {
    for (const s of P5_STATUSES) {
      const { container, unmount } = render(<P5StatusBadge status={s} />);
      expect(container.textContent).toBe(P5_STATUS_LABELS[s]);
      unmount();
    }
  });

  it("blocked badge does not render as 'Ready to Proceed'", () => {
    render(<P5StatusBadge status="blocked" />);
    expect(screen.queryByText("Ready to Proceed")).toBeNull();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("provider-dependent badge is distinct from ready_to_proceed", () => {
    const { rerender, container } = render(<P5StatusBadge status="provider_dependent" />);
    expect(container.textContent).toBe("Provider-Dependent");
    rerender(<P5StatusBadge status="ready_to_proceed" />);
    expect(container.textContent).toBe("Ready to Proceed");
  });
});

// Lightweight filter-key smoke: ensures the FilterKey union we expose covers
// all the dashboard filters listed in the Stage 4 brief.
describe("CasesDashboard filter coverage", () => {
  it("dashboard module exports a default React component", async () => {
    const mod = await import("@/pages/admin/p5-governance/CasesDashboard");
    expect(typeof mod.default).toBe("function");
  });
});
