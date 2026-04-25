/**
 * Routes generated module — contract test.
 *
 * Locks in the invariants that prevent the "/desk/settings/identity" defect
 * class from recurring:
 *   1. routeTo() narrows literal strings to RoutePath (compile-time only;
 *      we just exercise the runtime behaviour here).
 *   2. routeTo() correctly substitutes :params and ?query.
 *   3. assertRoutePath() throws for unknown paths.
 *   4. The KYB redirect target the original bug pointed at IS in the
 *      generated union, and the typo'd one is NOT.
 *   5. Spurious flat-scan duplicates (e.g. "/desk/company") never appear in
 *      the generated union — only the true nested form does.
 */

import { describe, it, expect } from "vitest";
import {
  ROUTE_PATHS,
  routeTo,
  assertRoutePath,
  isRoutePath,
} from "@/lib/routes.generated";

describe("routes.generated", () => {
  it("includes the real KYB redirect target", () => {
    expect(ROUTE_PATHS).toContain("/desk/settings/company");
  });

  it("does NOT include the typo from the original bug", () => {
    expect(ROUTE_PATHS).not.toContain("/desk/settings/identity");
  });

  it("does NOT include orphan flat-scan duplicates of nested settings tabs", () => {
    // The Desk shell's nested <Route path="settings"><Route path="company" />
    // would otherwise leak through as "/desk/company", which is a 404.
    expect(ROUTE_PATHS).not.toContain("/desk/company");
    expect(ROUTE_PATHS).not.toContain("/desk/balance");
    expect(ROUTE_PATHS).not.toContain("/desk/notifications");
  });

  it("does NOT include shell catch-alls (they're not navigable destinations)", () => {
    expect(ROUTE_PATHS).not.toContain("/desk/*");
    expect(ROUTE_PATHS).not.toContain("*");
  });

  it("routeTo() returns the literal path when no opts are passed", () => {
    expect(routeTo("/desk/settings/company")).toBe("/desk/settings/company");
  });

  it("routeTo() substitutes :params", () => {
    expect(
      routeTo("/desk/match/:matchId", { params: { matchId: "abc-123" } }),
    ).toBe("/desk/match/abc-123");
  });

  it("routeTo() URL-encodes param values to defend against injection", () => {
    expect(
      routeTo("/desk/match/:matchId", { params: { matchId: "a/b?c" } }),
    ).toBe("/desk/match/a%2Fb%3Fc");
  });

  it("routeTo() appends a querystring and skips empty values", () => {
    expect(
      routeTo("/desk/settings/company", {
        query: { step: "entity", note: undefined, tab: "" },
      }),
    ).toBe("/desk/settings/company?step=entity");
  });

  it("isRoutePath() ignores query/hash when matching", () => {
    expect(isRoutePath("/desk/settings/company?step=entity")).toBe(true);
    expect(isRoutePath("/desk/settings/identity")).toBe(false);
  });

  it("assertRoutePath() throws on unknown routes (the safety net for data-sourced strings)", () => {
    expect(() => assertRoutePath("/desk/settings/identity")).toThrow();
    expect(assertRoutePath("/desk/settings/company")).toBe(
      "/desk/settings/company",
    );
  });
});
