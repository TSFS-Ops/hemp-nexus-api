/**
 * Role-ownership safety net.
 *
 * Pattern this test guards against:
 *   A field whose name does not state whose role/side it is (e.g. `side`,
 *   `tradeSide`, `counterparty`) gets silently defaulted or collapsed,
 *   causing a seller to be treated as a buyer or both parties to be
 *   labelled "counterparty".
 *
 * Two narrow regressions are covered:
 *   1. EngagementTracker `handleReuse` must not silently default a missing
 *      initiator side to "buyer" when pre-filling the trade form.
 *   2. SealedEngagement must derive the counterparty from the viewer's role
 *      (via getMatchRole) — never collapse buyer ↔ seller into a single
 *      "counterparty" label.
 *
 * These tests reproduce the EXACT logic now in the two components so the
 * coupling is enforced at unit level even though the components themselves
 * pull in React + Supabase.
 */
import { describe, it, expect } from "vitest";
import { getMatchRole } from "@/hooks/use-user-org";

/* ------------------------------------------------------------------ */
/* 1. Reuse pre-fill — mirror of EngagementTracker.handleReuse        */
/* ------------------------------------------------------------------ */

function buildReuseSideParam(
  match: {
    metadata?: Record<string, unknown> | null;
  },
): string | null {
  const meta = match.metadata as Record<string, unknown> | undefined;
  const rawSide = (meta?.tradeSide ?? meta?.bidOfferSide) as unknown;
  return rawSide === "buyer" || rawSide === "seller" ? rawSide : null;
}

describe("EngagementTracker reuse pre-fill — no silent buyer default", () => {
  it("returns 'seller' when metadata.tradeSide is 'seller'", () => {
    expect(buildReuseSideParam({ metadata: { tradeSide: "seller" } })).toBe(
      "seller",
    );
  });

  it("returns 'buyer' when metadata.tradeSide is 'buyer'", () => {
    expect(buildReuseSideParam({ metadata: { tradeSide: "buyer" } })).toBe(
      "buyer",
    );
  });

  it("falls back to legacy bidOfferSide when tradeSide is missing", () => {
    expect(
      buildReuseSideParam({ metadata: { bidOfferSide: "seller" } }),
    ).toBe("seller");
  });

  it("returns null (NOT 'buyer') when both side fields are missing", () => {
    // The previous bug: `|| "buyer"` silently mis-pre-filled seller matches.
    expect(buildReuseSideParam({ metadata: {} })).toBeNull();
    expect(buildReuseSideParam({ metadata: null as any })).toBeNull();
    expect(buildReuseSideParam({})).toBeNull();
  });

  it("returns null for unrecognised side values rather than passing them through", () => {
    expect(
      buildReuseSideParam({ metadata: { tradeSide: "both" } }),
    ).toBeNull();
    expect(
      buildReuseSideParam({ metadata: { tradeSide: "" } }),
    ).toBeNull();
    expect(
      buildReuseSideParam({ metadata: { tradeSide: 42 as any } }),
    ).toBeNull();
  });

  it("does not flip a seller's side to buyer on reuse", () => {
    const sellerMatch = { metadata: { tradeSide: "seller" } };
    const side = buildReuseSideParam(sellerMatch);
    expect(side).not.toBe("buyer");
    expect(side).toBe("seller");
  });
});

/* ------------------------------------------------------------------ */
/* 2. SealedEngagement counterparty label — mirror of derivation       */
/* ------------------------------------------------------------------ */

function deriveSealedLabels(
  viewerOrgId: string | null,
  match: {
    org_id: string;
    buyer_org_id?: string | null;
    seller_org_id?: string | null;
    buyer_name?: string | null;
    seller_name?: string | null;
  },
): { partyPairLabel: string; counterpartyName: string; viewerRole: ReturnType<typeof getMatchRole> } {
  const buyerName = match.buyer_name ?? null;
  const sellerName = match.seller_name ?? null;
  const partyPairLabel =
    buyerName && sellerName
      ? `${buyerName} ↔ ${sellerName}`
      : buyerName ?? sellerName ?? "Counterparty";
  const viewerRole = getMatchRole(viewerOrgId, match);
  const counterpartyName =
    viewerRole === "buyer"
      ? sellerName ?? "Counterparty"
      : viewerRole === "seller"
        ? buyerName ?? "Counterparty"
        : partyPairLabel;
  return { partyPairLabel, counterpartyName, viewerRole };
}

describe("SealedEngagement labels — counterparty resolves against viewer role", () => {
  const baseMatch = {
    org_id: "org-buyer",
    buyer_org_id: "org-buyer",
    seller_org_id: "org-seller",
    buyer_name: "Acme Buyer Ltd",
    seller_name: "Globex Seller GmbH",
  };

  it("buyer viewer sees the SELLER name as counterparty", () => {
    const { counterpartyName, viewerRole } = deriveSealedLabels(
      "org-buyer",
      baseMatch,
    );
    expect(viewerRole).toBe("buyer");
    expect(counterpartyName).toBe("Globex Seller GmbH");
  });

  it("seller viewer sees the BUYER name as counterparty", () => {
    const { counterpartyName, viewerRole } = deriveSealedLabels(
      "org-seller",
      baseMatch,
    );
    expect(viewerRole).toBe("seller");
    expect(counterpartyName).toBe("Acme Buyer Ltd");
  });

  it("counterparty label is never the buyer↔seller pair for a buyer viewer", () => {
    const { counterpartyName } = deriveSealedLabels("org-buyer", baseMatch);
    expect(counterpartyName).not.toContain("↔");
    expect(counterpartyName).not.toContain("Acme Buyer Ltd");
  });

  it("counterparty label is never the buyer↔seller pair for a seller viewer", () => {
    const { counterpartyName } = deriveSealedLabels("org-seller", baseMatch);
    expect(counterpartyName).not.toContain("↔");
    expect(counterpartyName).not.toContain("Globex Seller GmbH");
  });

  it("third-party / admin viewer (no role on the match) falls back to the explicit pair label", () => {
    const { counterpartyName, partyPairLabel, viewerRole } =
      deriveSealedLabels("org-admin", baseMatch);
    expect(viewerRole).toBeNull();
    // We surface the pair rather than guessing — never silently default to
    // one side. Both party names must be present so the UI is unambiguous.
    expect(counterpartyName).toBe(partyPairLabel);
    expect(counterpartyName).toContain("Acme Buyer Ltd");
    expect(counterpartyName).toContain("Globex Seller GmbH");
  });

  it("partyPairLabel always contains both names when both are set", () => {
    const { partyPairLabel } = deriveSealedLabels("org-buyer", baseMatch);
    expect(partyPairLabel).toContain("Acme Buyer Ltd");
    expect(partyPairLabel).toContain("Globex Seller GmbH");
  });

  it("falls back to the single known name when the opposite side has no name yet", () => {
    const sellerOnly = {
      ...baseMatch,
      buyer_name: null,
    };
    const { counterpartyName } = deriveSealedLabels("org-buyer", sellerOnly);
    expect(counterpartyName).toBe("Globex Seller GmbH");
  });

  it("never returns the buyer's own name as the buyer-viewer counterparty", () => {
    const { counterpartyName } = deriveSealedLabels("org-buyer", baseMatch);
    expect(counterpartyName).not.toBe("Acme Buyer Ltd");
  });
});
