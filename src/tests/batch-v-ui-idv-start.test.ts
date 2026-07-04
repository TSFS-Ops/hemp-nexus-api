/**
 * Batch V-UI — route table surfaces the required countries for the UI.
 * The country selector reads directly from IDV_ROUTE_TABLE, so this
 * asserts the source of truth stays correct.
 */

import { describe, it, expect } from "vitest";
import { IDV_ROUTE_TABLE, resolveIdvRoute } from "@/lib/idv/route-table";

describe("Batch V-UI — IDV start screen data", () => {
  it("exposes South Africa live route(s)", () => {
    const za = IDV_ROUTE_TABLE.filter((r) => r.document_country === "ZA" && r.live_enabled);
    expect(za.length).toBeGreaterThan(0);
  });

  it("exposes Nigeria live route(s)", () => {
    const ng = IDV_ROUTE_TABLE.filter((r) => r.document_country === "NG" && r.live_enabled);
    expect(ng.length).toBeGreaterThan(0);
  });

  it("placeholder countries route to provider_not_available", () => {
    for (const cc of ["GH", "KE", "UG", "ZM", "CI"]) {
      const r = resolveIdvRoute({ document_country: cc, document_type: "anything" });
      expect(r.kind).toBe("provider_not_available");
    }
  });

  it("unsupported country routes to provider_not_available", () => {
    const r = resolveIdvRoute({ document_country: "ZZ", document_type: "za_said_basic" });
    expect(r.kind).toBe("provider_not_available");
  });

  it("routing rejects mismatched document_type per country", () => {
    const r = resolveIdvRoute({ document_country: "ZA", document_type: "ng_nin" });
    expect(r.kind).toBe("provider_not_available");
  });
});
