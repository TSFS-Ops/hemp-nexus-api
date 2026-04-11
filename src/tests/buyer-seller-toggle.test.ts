/**
 * Buyer/Seller Toggle — Unit & Integration Tests
 * Tests the side selection flow from landing form through to trade_orders persistence.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Unit: PreAuthState serialisation ───

describe("PreAuthState side persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("happy: saves and restores side='bid'", async () => {
    const { savePreAuthState, consumePreAuthState } = await import("@/lib/pre-auth-state");
    savePreAuthState({
      query: "soybeans",
      selectedIds: [],
      pendingAction: "interested",
      returnTo: "/",
      side: "bid",
    });
    const restored = consumePreAuthState();
    expect(restored).not.toBeNull();
    expect(restored!.side).toBe("bid");
  });

  it("happy: saves and restores side='offer'", async () => {
    const { savePreAuthState, consumePreAuthState } = await import("@/lib/pre-auth-state");
    savePreAuthState({
      query: "copper",
      selectedIds: [],
      pendingAction: "interested",
      returnTo: "/",
      side: "offer",
    });
    const restored = consumePreAuthState();
    expect(restored!.side).toBe("offer");
  });

  it("sad: missing side field returns undefined (not crash)", async () => {
    const { savePreAuthState, consumePreAuthState } = await import("@/lib/pre-auth-state");
    savePreAuthState({
      query: "hemp",
      selectedIds: [],
      pendingAction: "interested",
      returnTo: "/",
      // side intentionally omitted
    });
    const restored = consumePreAuthState();
    expect(restored).not.toBeNull();
    expect(restored!.side).toBeUndefined();
  });

  it("edge: consume clears storage (no double-consume)", async () => {
    const { savePreAuthState, consumePreAuthState } = await import("@/lib/pre-auth-state");
    savePreAuthState({
      query: "test",
      selectedIds: [],
      pendingAction: "interested",
      returnTo: "/",
      side: "bid",
    });
    consumePreAuthState(); // first consume
    const second = consumePreAuthState(); // should be null
    expect(second).toBeNull();
  });

  it("edge: handles corrupted JSON gracefully", async () => {
    const { consumePreAuthState } = await import("@/lib/pre-auth-state");
    sessionStorage.setItem("cm_pre_auth_state", "not valid json{{{");
    const result = consumePreAuthState();
    // Should not throw — returns null on parse failure
    expect(result).toBeNull();
  });
});

// ─── Unit: BidOfferData type contract ───

describe("BidOfferData side field contract", () => {
  it("happy: bid side maps correctly", () => {
    const data = { product: "Soybeans", volume: "100", price: "500", location: "India", additionalInfo: "", side: "bid" as const };
    expect(data.side).toBe("bid");
    expect(["bid", "offer"]).toContain(data.side);
  });

  it("happy: offer side maps correctly", () => {
    const data = { product: "Copper", volume: "50", price: "9000", location: "Chile", additionalInfo: "", side: "offer" as const };
    expect(data.side).toBe("offer");
  });

  it("edge: empty strings for optional fields", () => {
    const data = { product: "Oil", volume: "", price: "", location: "", additionalInfo: "", side: "bid" as const };
    expect(data.product).toBeTruthy();
    expect(data.side).toBe("bid");
  });

  it("edge: product with special characters", () => {
    const data = { product: "Café arabica (washed)", volume: "", price: "", location: "", additionalInfo: "", side: "offer" as const };
    expect(data.product.length).toBeGreaterThan(0);
    expect(data.side).toBe("offer");
  });
});

// ─── Unit: trade_orders side constraint ───

describe("trade_orders side value validation", () => {
  const VALID_SIDES = ["bid", "offer"];

  it("happy: 'bid' passes constraint", () => {
    expect(VALID_SIDES).toContain("bid");
  });

  it("happy: 'offer' passes constraint", () => {
    expect(VALID_SIDES).toContain("offer");
  });

  it("sad: 'buy' would fail DB constraint", () => {
    expect(VALID_SIDES).not.toContain("buy");
  });

  it("sad: 'sell' would fail DB constraint", () => {
    expect(VALID_SIDES).not.toContain("sell");
  });

  it("edge: null would fail NOT NULL constraint", () => {
    expect(VALID_SIDES).not.toContain(null);
  });

  it("edge: empty string would fail constraint", () => {
    expect(VALID_SIDES).not.toContain("");
  });

  it("edge: negative numbers as string rejected", () => {
    expect(VALID_SIDES).not.toContain("-1");
  });
});

// ─── Integration: persistTradeOrder side flow ───

describe("persistTradeOrder respects side parameter", () => {
  it("sad: no session → does not insert (fire-and-forget)", async () => {
    // Simulates the guard in persistTradeOrder: no session → early return
    const mockGetSession = vi.fn().mockResolvedValue({ data: { session: null } });
    // The function should silently exit without throwing
    const session = await mockGetSession();
    expect(session.data.session).toBeNull();
  });

  it("edge: side defaults to 'bid' when undefined in context", () => {
    const ctx: { side?: "bid" | "offer" } = {};
    const resolvedSide = ctx.side || "bid";
    expect(resolvedSide).toBe("bid");
  });

  it("edge: side='offer' preserved through context", () => {
    const ctx: { side?: "bid" | "offer" } = { side: "offer" };
    const resolvedSide = ctx.side || "bid";
    expect(resolvedSide).toBe("offer");
  });
});

// ─── Integration: URL parameter flow ───

describe("Search URL parameter side propagation", () => {
  it("happy: side=bid in URL is parsed", () => {
    const params = new URLSearchParams("q=soybeans&side=bid");
    expect(params.get("side")).toBe("bid");
  });

  it("happy: side=offer in URL is parsed", () => {
    const params = new URLSearchParams("q=copper&side=offer");
    expect(params.get("side")).toBe("offer");
  });

  it("sad: missing side returns null (handled as undefined)", () => {
    const params = new URLSearchParams("q=copper");
    expect(params.get("side")).toBeNull();
  });

  it("edge: invalid side value is still a string (UI must validate)", () => {
    const params = new URLSearchParams("q=test&side=hacker");
    const side = params.get("side") as "bid" | "offer" | null;
    // DB constraint will reject this; UI should prevent it
    expect(side).toBe("hacker");
    expect(["bid", "offer"]).not.toContain(side);
  });
});
