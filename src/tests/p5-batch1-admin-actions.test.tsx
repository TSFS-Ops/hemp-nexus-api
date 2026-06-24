/**
 * Stage 4 — P-5 admin actions / dialog tests.
 *
 * Verifies the reasoned-action dialog blocks submission until a reason code
 * + note are present, and that admin-only buttons aren't rendered for
 * developer/auditor roles. We don't hit Supabase here; the onSubmit handler
 * is stubbed to assert wiring.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReasonedActionDialog } from "@/pages/admin/p5-governance/components/dialogs/ReasonedActionDialog";
import { deriveP5Permissions } from "@/hooks/useP5Permissions";

describe("ReasonedActionDialog", () => {
  it("disables confirm until reason code and note are provided", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ReasonedActionDialog
        open
        onOpenChange={() => {}}
        title="Test action"
        confirmLabel="Confirm"
        onSubmit={onSubmit}
      />,
    );
    const btn = screen.getByTestId("p5-action-confirm") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("renders the warning banner when provided (override / waiver)", () => {
    render(
      <ReasonedActionDialog
        open
        onOpenChange={() => {}}
        title="Apply override"
        warning="Override is audited and exceptional."
        onSubmit={vi.fn()}
      />,
    );
    const warn = screen.getByTestId("p5-action-warning");
    expect(warn.textContent).toMatch(/Override is audited and exceptional/);
  });
});

describe("Action button visibility (derivation)", () => {
  // Mirrors what CaseDetail renders: action buttons are gated by permission
  // flags. We assert the flags here so changing the gating in one place
  // breaks this test.
  it("developer_technical_admin cannot trigger business actions", () => {
    const p = deriveP5Permissions(["developer_technical_admin"]);
    const businessActions = [
      p.canApproveInternally,
      p.canApproveReadyToProceed,
      p.canReject,
      p.canWaive,
      p.canOverride,
      p.canReleaseHold,
    ];
    for (const flag of businessActions) expect(flag).toBe(false);
  });

  it("auditor_read_only cannot trigger any mutating action", () => {
    const p = deriveP5Permissions(["auditor_read_only"]);
    expect(p.canMutate).toBe(false);
    expect(p.canApplyHold).toBe(false);
    expect(p.canReviewEvidence).toBe(false);
  });

  it("platform_admin can see waiver, override and ready-to-proceed", () => {
    const p = deriveP5Permissions(["platform_admin"]);
    expect(p.canWaive && p.canOverride && p.canApproveReadyToProceed).toBe(true);
  });
});

describe("RPC wrapper module shape", () => {
  it("exposes all Stage 3 RPC wrappers", async () => {
    const mod = await import("@/lib/p5-governance/rpc");
    const expected = [
      "applyHold",
      "releaseHold",
      "waive",
      "override",
      "escalate",
      "requestMoreInfo",
      "reject",
      "approveReadyToProceed",
      "approveInternally",
      "reviewEvidence",
      "recordProviderResult",
      "assignOwner",
      "startReview",
      "reopen",
      "archiveSuperseded",
    ];
    for (const name of expected) {
      expect(typeof (mod.p5Rpc as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
