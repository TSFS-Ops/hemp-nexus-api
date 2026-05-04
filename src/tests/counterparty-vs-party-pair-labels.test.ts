/**
 * counterparty-vs-party-pair-labels — Phase 1 ownership-ambiguity guardrail.
 *
 * Pattern guarded against:
 *   A label called "Counterparty" actually contains BOTH parties (e.g.
 *   "Acme ↔ Globex"), collapsing two distinct concepts into one
 *   ambiguous noun. The dangerous outcome is that a buyer-viewer or
 *   seller-viewer reads the label and thinks the pair-string is the
 *   opposite party.
 *
 * Tests #4, #5 from the Phase 1 brief:
 *   4. counterparty-label-shows-opposite-party-only
 *   5. party-pair-labels-not-called-counterparty
 *
 * Mirrors the derivation in
 * src/components/desk/match/SealedEngagement.tsx (post-Phase 1 fix).
 */
import { describe, it, expect } from "vitest";
import { getMatchRole } from "@/hooks/use-user-org";

interface MatchShape {
  org_id: string;
  buyer_org_id?: string | null;
  seller_org_id?: string | null;
  buyer_name?: string | null;
  seller_name?: string | null;
}

/**
 * Render a viewer-addressed counterparty label.
 *
 * OWNERSHIP: returns the **opposite party from the viewer**. For viewers
 * with no role on the match (admin/auditor) it falls back to the explicit
 * party-pair label, which is then NOT presented as a counterparty.
 */
function renderLabels(
  viewerOrgId: string | null,
  match: MatchShape,
): { counterpartyName: string; partyPairLabel: string; counterpartyLabelKind: "single" | "pair-fallback" } {
  const buyerName = match.buyer_name ?? null;
  const sellerName = match.seller_name ?? null;
  const partyPairLabel =
    buyerName && sellerName
      ? `${buyerName} ↔ ${sellerName}`
      : buyerName ?? sellerName ?? "Counterparty";
  const viewerRole = getMatchRole(viewerOrgId, match);
  if (viewerRole === "buyer") {
    return {
      counterpartyName: sellerName ?? "Counterparty",
      partyPairLabel,
      counterpartyLabelKind: "single",
    };
  }
  if (viewerRole === "seller") {
    return {
      counterpartyName: buyerName ?? "Counterparty",
      partyPairLabel,
      counterpartyLabelKind: "single",
    };
  }
  // No viewer role → return the pair, but flag it so the caller knows
  // not to present it under a "Counterparty:" label.
  return {
    counterpartyName: partyPairLabel,
    partyPairLabel,
    counterpartyLabelKind: "pair-fallback",
  };
}

const baseMatch: MatchShape = {
  org_id: "org-buyer",
  buyer_org_id: "org-buyer",
  seller_org_id: "org-seller",
  buyer_name: "Acme Buyer Ltd",
  seller_name: "Globex Seller GmbH",
};

/* ------------------------------------------------------------------ */
/* #4. counterparty-label-shows-opposite-party-only                    */
/* ------------------------------------------------------------------ */

describe("counterparty-label-shows-opposite-party-only", () => {
  it("buyer viewer sees ONLY the seller name as counterparty (no pair)", () => {
    const { counterpartyName, counterpartyLabelKind } = renderLabels(
      "org-buyer",
      baseMatch,
    );
    expect(counterpartyName).toBe("Globex Seller GmbH");
    expect(counterpartyName).not.toContain("↔");
    expect(counterpartyName).not.toContain("Acme Buyer Ltd");
    expect(counterpartyLabelKind).toBe("single");
  });

  it("seller viewer sees ONLY the buyer name as counterparty (no pair)", () => {
    const { counterpartyName, counterpartyLabelKind } = renderLabels(
      "org-seller",
      baseMatch,
    );
    expect(counterpartyName).toBe("Acme Buyer Ltd");
    expect(counterpartyName).not.toContain("↔");
    expect(counterpartyName).not.toContain("Globex Seller GmbH");
    expect(counterpartyLabelKind).toBe("single");
  });

  it("a viewer with no role on the match must NOT receive a 'single' counterparty label", () => {
    const { counterpartyLabelKind } = renderLabels("org-admin", baseMatch);
    // Falls back to pair — but the kind is flagged so callers do not
    // mis-render it under a "Counterparty" heading.
    expect(counterpartyLabelKind).toBe("pair-fallback");
  });

  it("never returns the buyer's own name as the buyer-viewer counterparty", () => {
    const { counterpartyName } = renderLabels("org-buyer", baseMatch);
    expect(counterpartyName).not.toBe("Acme Buyer Ltd");
  });

  it("never returns the seller's own name as the seller-viewer counterparty", () => {
    const { counterpartyName } = renderLabels("org-seller", baseMatch);
    expect(counterpartyName).not.toBe("Globex Seller GmbH");
  });
});

/* ------------------------------------------------------------------ */
/* #5. party-pair-labels-not-called-counterparty                       */
/* ------------------------------------------------------------------ */

describe("party-pair-labels-not-called-counterparty", () => {
  it("partyPairLabel always uses the ↔ separator when both names are present", () => {
    const { partyPairLabel } = renderLabels("org-admin", baseMatch);
    expect(partyPairLabel).toContain("↔");
    expect(partyPairLabel).toContain("Acme Buyer Ltd");
    expect(partyPairLabel).toContain("Globex Seller GmbH");
  });

  it("a label containing both buyer and seller is NEVER returned as a 'single' counterparty kind", () => {
    // For every possible viewer position, if the returned label contains
    // BOTH names, its kind must NOT be "single" (i.e. it must not be
    // presented as "Counterparty: Acme ↔ Globex").
    for (const viewerOrgId of [
      "org-buyer",
      "org-seller",
      "org-admin",
      null,
    ]) {
      const { counterpartyName, counterpartyLabelKind } = renderLabels(
        viewerOrgId,
        baseMatch,
      );
      const containsBoth =
        counterpartyName.includes("Acme Buyer Ltd") &&
        counterpartyName.includes("Globex Seller GmbH");
      if (containsBoth) {
        expect(counterpartyLabelKind).not.toBe("single");
      }
    }
  });

  it("a single-name fallback (one side missing) is allowed under the counterparty label", () => {
    // When the opposite side has a name and the viewer's side is missing,
    // the single name is a legitimate counterparty label.
    const sellerOnly: MatchShape = { ...baseMatch, buyer_name: null };
    const { counterpartyName } = renderLabels("org-buyer", sellerOnly);
    expect(counterpartyName).toBe("Globex Seller GmbH");
    expect(counterpartyName).not.toContain("↔");
  });
});
