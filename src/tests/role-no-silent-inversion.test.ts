/**
 * role-no-silent-inversion — Phase 1 ownership-ambiguity guardrail.
 *
 * Pattern guarded against:
 *   A side value (`"buyer"` / `"seller"`) is silently inverted somewhere
 *   in the pipeline, so a buyer's intent is treated as a seller's (or
 *   vice versa) without an explicit, named function performing the flip.
 *
 * Tests #1, #2, #3 from the Phase 1 brief:
 *   1. buyer-never-becomes-seller-by-name-only
 *   2. seller-never-becomes-buyer-by-name-only
 *   3. missing-side-metadata-never-defaults-to-buyer
 *
 * These are pure-logic mirrors of the canonical helpers in:
 *   - src/lib/role-confirmation.ts (`inferUserSideFromParsedRole`)
 *   - src/components/match/EngagementTracker.tsx (`buildReuseSideParam`-equivalent)
 *   - src/components/desk/match/SealedEngagement.tsx (counterparty derivation)
 *   - src/hooks/use-user-org.ts (`getMatchRole`)
 *
 * The whole-file invariant: no helper in this test inverts buyer ↔ seller
 * unless its name says so explicitly (e.g. `deriveCounterpartySide`).
 */
import { describe, it, expect } from "vitest";
import {
  inferUserSideFromParsedRole,
  detectSideConflict,
  type TradeSide,
} from "@/lib/role-confirmation";
import { getMatchRole } from "@/hooks/use-user-org";

/* ------------------------------------------------------------------ */
/* Mirrors of the canonical "no silent default" reuse path            */
/* ------------------------------------------------------------------ */

function buildReuseInitiatorSide(
  match: { metadata?: Record<string, unknown> | null },
): TradeSide | null {
  // OWNERSHIP: returns the **initiator's** declared side from match
  // metadata, or null if none reliably present. NEVER returns the
  // counterparty side.
  const meta = match.metadata as Record<string, unknown> | undefined;
  const raw = (meta?.tradeSide ?? meta?.bidOfferSide) as unknown;
  return raw === "buyer" || raw === "seller" ? raw : null;
}

/**
 * The ONLY function in this test that intentionally inverts a side.
 * Its name says so. Any other inversion is a bug.
 */
function deriveCounterpartySide(viewerSide: TradeSide): TradeSide {
  return viewerSide === "buyer" ? "seller" : "buyer";
}

/* ------------------------------------------------------------------ */
/* #1. buyer-never-becomes-seller-by-name-only                         */
/* ------------------------------------------------------------------ */

describe("buyer-never-becomes-seller-by-name-only", () => {
  it("inferUserSideFromParsedRole preserves 'buyer' end-to-end", () => {
    expect(inferUserSideFromParsedRole("buyer")).toBe("buyer");
  });

  it("buildReuseInitiatorSide returns 'buyer' for a buyer initiator", () => {
    expect(
      buildReuseInitiatorSide({ metadata: { tradeSide: "buyer" } }),
    ).toBe("buyer");
    expect(
      buildReuseInitiatorSide({ metadata: { bidOfferSide: "buyer" } }),
    ).toBe("buyer");
  });

  it("getMatchRole returns 'buyer' when viewer org sits in the buyer slot", () => {
    expect(
      getMatchRole("org-A", {
        org_id: "org-A",
        buyer_org_id: "org-A",
        seller_org_id: "org-B",
      }),
    ).toBe("buyer");
  });

  it("only an explicitly-named helper (deriveCounterpartySide) ever flips buyer→seller", () => {
    // Sanity: the explicit helper IS allowed to flip. Nothing else is.
    expect(deriveCounterpartySide("buyer")).toBe("seller");
  });

  it("detectSideConflict does NOT silently invert: returns false when both agree", () => {
    expect(detectSideConflict("buyer", "buyer")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* #2. seller-never-becomes-buyer-by-name-only                         */
/* ------------------------------------------------------------------ */

describe("seller-never-becomes-buyer-by-name-only", () => {
  it("inferUserSideFromParsedRole preserves 'seller' end-to-end", () => {
    expect(inferUserSideFromParsedRole("seller")).toBe("seller");
  });

  it("buildReuseInitiatorSide returns 'seller' for a seller initiator", () => {
    expect(
      buildReuseInitiatorSide({ metadata: { tradeSide: "seller" } }),
    ).toBe("seller");
    expect(
      buildReuseInitiatorSide({ metadata: { bidOfferSide: "seller" } }),
    ).toBe("seller");
  });

  it("getMatchRole returns 'seller' when viewer org sits in the seller slot", () => {
    expect(
      getMatchRole("org-A", {
        org_id: "org-A",
        buyer_org_id: "org-B",
        seller_org_id: "org-A",
      }),
    ).toBe("seller");
  });

  it("seller initiator never silently becomes a buyer at any step", () => {
    const initiatorSide = buildReuseInitiatorSide({
      metadata: { tradeSide: "seller" },
    });
    expect(initiatorSide).toBe("seller");
    expect(initiatorSide).not.toBe("buyer");
    // An explicit derive call is the only legal flip.
    const targetCounterparty = initiatorSide
      ? deriveCounterpartySide(initiatorSide)
      : null;
    expect(targetCounterparty).toBe("buyer"); // by design — explicit helper
  });

  it("detectSideConflict does NOT silently invert: returns false when both agree", () => {
    expect(detectSideConflict("seller", "seller")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* #3. missing-side-metadata-never-defaults-to-buyer                   */
/* ------------------------------------------------------------------ */

describe("missing-side-metadata-never-defaults-to-buyer", () => {
  it("returns null when metadata is fully absent", () => {
    expect(buildReuseInitiatorSide({})).toBeNull();
    expect(buildReuseInitiatorSide({ metadata: null as any })).toBeNull();
  });

  it("returns null when metadata exists but no side keys are present", () => {
    expect(
      buildReuseInitiatorSide({
        metadata: { commodity: "copper", quantity: 100 },
      }),
    ).toBeNull();
  });

  it("returns null when tradeSide / bidOfferSide are present but invalid", () => {
    for (const bad of ["", "BUYER", "Sell", "both", null, undefined, 1, true]) {
      expect(
        buildReuseInitiatorSide({ metadata: { tradeSide: bad as any } }),
      ).toBeNull();
      expect(
        buildReuseInitiatorSide({ metadata: { bidOfferSide: bad as any } }),
      ).toBeNull();
    }
  });

  it("never falls back to 'buyer' for missing/invalid metadata", () => {
    const cases = [
      {},
      { metadata: {} },
      { metadata: null as any },
      { metadata: { tradeSide: "" } },
      { metadata: { tradeSide: "supplier" } },
      { metadata: { tradeSide: 42 as any } },
      { metadata: { bidOfferSide: "BUYER" } }, // wrong case is invalid
    ];
    for (const c of cases) {
      expect(buildReuseInitiatorSide(c)).not.toBe("buyer");
      expect(buildReuseInitiatorSide(c)).toBeNull();
    }
  });

  it("inferUserSideFromParsedRole returns null for any non-canonical input", () => {
    for (const bad of [null, undefined, "", "BUYER", "supplier", "both"]) {
      expect(inferUserSideFromParsedRole(bad as any)).toBeNull();
    }
  });
});
