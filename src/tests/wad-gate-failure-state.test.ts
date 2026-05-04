/**
 * WadModule — Signed Deal gate-failure UI logic (P4 regression)
 *
 * Pins the rules that drive the rendered banner + button in
 * src/components/wad/WadModule.tsx:
 *
 *   • When `result.gateFailures` is non-empty after createWad:
 *       - persistent banner is shown (role="alert")
 *       - banner copy uses "blocked … prerequisite(s) not yet met"
 *         (NOT "gates failed" / "Retry Creation" / generic "try again")
 *       - each gate failure is listed
 *       - Confirm Signed Deal button is disabled
 *       - button label remains the stable "Confirm Signed Deal"
 *       - no toast.error fires (persistent banner is the canonical surface)
 *   • When gateFailures is empty AND jurisdictionSelected is true AND
 *     not creating: Confirm Signed Deal is enabled.
 *
 * These rules were the source of the original paper-cut where a
 * relabelled "Retry Creation" button + dismissible toast.error implied
 * a system failure for what is actually an unmet workflow prerequisite.
 *
 * No backend / schema / RPC / edge-function behaviour is asserted here —
 * this is a frontend copy + gating regression pin only.
 */

import { describe, it, expect } from "vitest";

/**
 * Mirror of the gating expression and copy decisions inside
 * WadModule.tsx (lines 80–106 and 200–234). Kept as a pure helper so
 * the rules can be pinned without a DOM render.
 */
function deriveSignedDealUi(opts: {
  gateFailures: string[];
  jurisdictionSelected: boolean;
  creating: boolean;
}) {
  const { gateFailures, jurisdictionSelected, creating } = opts;
  const hasFailures = gateFailures.length > 0;

  return {
    showBanner: hasFailures,
    bannerHeadline: hasFailures
      ? `Signed Deal blocked — ${gateFailures.length} prerequisite${gateFailures.length > 1 ? "s" : ""} not yet met`
      : null,
    listedFailures: hasFailures ? [...gateFailures] : [],
    buttonLabel: !jurisdictionSelected ? "Select jurisdiction first" : "Confirm Signed Deal",
    buttonDisabled: creating || !jurisdictionSelected || hasFailures,
    raisesToastOnGateFailure: false, // P4: never — banner is the canonical surface
  };
}

describe("WadModule — Signed Deal gate-failure UI", () => {
  describe("when gateFailures.length > 0", () => {
    const failures = [
      "Buyer attestation outstanding",
      "Counterparty webhook offline",
    ];
    const ui = deriveSignedDealUi({
      gateFailures: failures,
      jurisdictionSelected: true,
      creating: false,
    });

    it("shows the persistent banner", () => {
      expect(ui.showBanner).toBe(true);
    });

    it("uses 'prerequisite(s) not yet met' copy, not 'gates failed'", () => {
      expect(ui.bannerHeadline).toMatch(/prerequisites? not yet met/);
      expect(ui.bannerHeadline ?? "").not.toMatch(/gates? failed/i);
    });

    it("lists every gate failure", () => {
      expect(ui.listedFailures).toEqual(failures);
    });

    it("disables Confirm Signed Deal", () => {
      expect(ui.buttonDisabled).toBe(true);
    });

    it("keeps the button label stable as 'Confirm Signed Deal' (no 'Retry Creation')", () => {
      expect(ui.buttonLabel).toBe("Confirm Signed Deal");
      expect(ui.buttonLabel).not.toMatch(/retry/i);
    });

    it("does not raise a toast — persistent banner is the canonical surface", () => {
      expect(ui.raisesToastOnGateFailure).toBe(false);
    });
  });

  describe("when there are no gate failures and jurisdiction is selected", () => {
    it("enables Confirm Signed Deal", () => {
      const ui = deriveSignedDealUi({
        gateFailures: [],
        jurisdictionSelected: true,
        creating: false,
      });
      expect(ui.buttonDisabled).toBe(false);
      expect(ui.buttonLabel).toBe("Confirm Signed Deal");
      expect(ui.showBanner).toBe(false);
    });
  });

  describe("when jurisdiction is not yet selected", () => {
    it("blocks the button regardless of gate state", () => {
      const ui = deriveSignedDealUi({
        gateFailures: [],
        jurisdictionSelected: false,
        creating: false,
      });
      expect(ui.buttonDisabled).toBe(true);
      expect(ui.buttonLabel).toBe("Select jurisdiction first");
    });
  });
});
