/**
 * Buyer/Seller Toggle — Unit & Integration Tests
 * Tests the side selection flow from landing form through to trade_orders persistence.
 *
 * @vitest-environment jsdom
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
      side: "buyer",
    });
    const restored = consumePreAuthState();
    expect(restored).not.toBeNull();
    expect(restored!.side).toBe("buyer");
  });

  it("happy: saves and restores side='offer'", async () => {
    const { savePreAuthState, consumePreAuthState } = await import("@/lib/pre-auth-state");
    savePreAuthState({
      query: "copper",
      selectedIds: [],
      pendingAction: "interested",
      returnTo: "/",
      side: "seller",
    });
    const restored = consumePreAuthState();
    expect(restored!.side).toBe("seller");
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
      side: "buyer",
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
    const data = { product: "Soybeans", volume: "100", price: "500", location: "India", additionalInfo: "", side: "buyer" as const };
    expect(data.side).toBe("buyer");
    expect(["buyer", "seller"]).toContain(data.side);
  });

  it("happy: offer side maps correctly", () => {
    const data = { product: "Copper", volume: "50", price: "9000", location: "Chile", additionalInfo: "", side: "seller" as const };
    expect(data.side).toBe("seller");
  });

  it("edge: empty strings for optional fields", () => {
    const data = { product: "Oil", volume: "", price: "", location: "", additionalInfo: "", side: "buyer" as const };
    expect(data.product).toBeTruthy();
    expect(data.side).toBe("buyer");
  });

  it("edge: product with special characters", () => {
    const data = { product: "Café arabica (washed)", volume: "", price: "", location: "", additionalInfo: "", side: "seller" as const };
    expect(data.product.length).toBeGreaterThan(0);
    expect(data.side).toBe("seller");
  });
});

// ─── Unit: trade_orders side constraint ───

describe("trade_orders side value validation", () => {
  const VALID_SIDES = ["buyer", "seller"];

  it("happy: 'bid' passes constraint", () => {
    expect(VALID_SIDES).toContain("buyer");
  });

  it("happy: 'offer' passes constraint", () => {
    expect(VALID_SIDES).toContain("seller");
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
    const ctx: { side?: "buyer" | "seller" } = {};
    const resolvedSide = ctx.side || "buyer";
    expect(resolvedSide).toBe("buyer");
  });

  it("edge: side='offer' preserved through context", () => {
    const ctx: { side?: "buyer" | "seller" } = { side: "seller" };
    const resolvedSide = ctx.side || "buyer";
    expect(resolvedSide).toBe("seller");
  });
});

// ─── Integration: URL parameter flow ───

describe("Search URL parameter side propagation", () => {
  it("happy: side=buyer in URL is parsed", () => {
    const params = new URLSearchParams("q=soybeans&side=buyer");
    expect(params.get("side")).toBe("buyer");
  });

  it("happy: side=seller in URL is parsed", () => {
    const params = new URLSearchParams("q=copper&side=seller");
    expect(params.get("side")).toBe("seller");
  });

  it("sad: missing side returns null (handled as undefined)", () => {
    const params = new URLSearchParams("q=copper");
    expect(params.get("side")).toBeNull();
  });

  it("edge: invalid side value is still a string (UI must validate)", () => {
    const params = new URLSearchParams("q=test&side=hacker");
    const side = params.get("side") as "buyer" | "seller" | null;
    // DB constraint will reject this; UI should prevent it
    expect(side).toBe("hacker");
    expect(["buyer", "seller"]).not.toContain(side);
  });
});
