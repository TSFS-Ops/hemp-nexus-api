/**
 * Batch V — IDV routing tests.
 *
 * Proves:
 *  - ZA + NG routes are live-enabled and resolve to VerifyNow.
 *  - GH/KE/UG/ZM/CI are present as placeholders and resolve to
 *    provider_not_available.
 *  - Unsupported country / document type → provider_not_available.
 *  - Nationality / residence / company country / transaction country
 *    do NOT influence provider routing.
 *  - Changing document country/type reroutes.
 *  - Browser SSOT and server mirror share identical route entries.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  IDV_ROUTE_TABLE,
  resolveIdvRoute,
  hasLiveFullIdvForCountry,
} from "@/lib/idv/route-table";

describe("Batch V — IDV route table", () => {
  it("routes South Africa Home Affairs Enhanced to VerifyNow (full IDV, unlocks)", () => {
    const r = resolveIdvRoute({
      document_country: "ZA",
      document_type: "za_home_affairs_enhanced",
    });
    expect(r.kind).toBe("route");
    if (r.kind !== "route") return;
    expect(r.entry.provider).toBe("verifynow");
    expect(r.entry.live_enabled).toBe(true);
    expect(r.entry.document_class).toBe("full_idv");
    expect(r.entry.can_unlock_controlled_actions).toBe(true);
  });

  it("routes Nigeria NIN to VerifyNow (full IDV, unlocks)", () => {
    const r = resolveIdvRoute({
      document_country: "NG",
      document_type: "ng_nin",
    });
    expect(r.kind).toBe("route");
    if (r.kind !== "route") return;
    expect(r.entry.provider).toBe("verifynow");
    expect(r.entry.can_unlock_controlled_actions).toBe(true);
  });

  it("routes Nigeria BVN as supporting-only (does NOT unlock)", () => {
    const r = resolveIdvRoute({
      document_country: "NG",
      document_type: "ng_bvn",
    });
    expect(r.kind).toBe("route");
    if (r.kind !== "route") return;
    expect(r.entry.document_class).toBe("supporting_only");
    expect(r.entry.can_unlock_controlled_actions).toBe(false);
  });

  it.each(["GH", "KE", "UG", "ZM", "CI"] as const)(
    "placeholder country %s resolves to provider_not_available",
    (cc) => {
      const r = resolveIdvRoute({
        document_country: cc,
        document_type: "national_id_placeholder",
      });
      expect(r.kind).toBe("provider_not_available");
    },
  );

  it.each(["GH", "KE", "UG", "ZM", "CI"] as const)(
    "placeholder %s has NO full-IDV live route",
    (cc) => {
      expect(hasLiveFullIdvForCountry(cc)).toBe(false);
    },
  );

  it("unsupported country → provider_not_available (unsupported_country)", () => {
    const r = resolveIdvRoute({ document_country: "XX", document_type: "anything" });
    expect(r).toEqual({ kind: "provider_not_available", reason: "unsupported_country" });
  });

  it("unsupported document type for supported country → provider_not_available", () => {
    const r = resolveIdvRoute({ document_country: "ZA", document_type: "za_bogus" });
    expect(r).toEqual({
      kind: "provider_not_available",
      reason: "unsupported_document_type",
    });
  });

  it("nationality / residence / company country / transaction country DO NOT change routing", () => {
    const base = resolveIdvRoute({
      document_country: "ZA",
      document_type: "za_home_affairs_enhanced",
    });
    const withNoise = resolveIdvRoute({
      document_country: "ZA",
      document_type: "za_home_affairs_enhanced",
      nationality: "NG",
      country_of_residence: "GB",
      company_country: "KE",
      transaction_country: "US",
    });
    expect(withNoise).toEqual(base);
  });

  it("changing document country reroutes", () => {
    const a = resolveIdvRoute({ document_country: "ZA", document_type: "za_home_affairs_enhanced" });
    const b = resolveIdvRoute({ document_country: "NG", document_type: "ng_nin" });
    expect(a.kind).toBe("route");
    expect(b.kind).toBe("route");
    if (a.kind === "route" && b.kind === "route") {
      expect(a.entry.document_country).toBe("ZA");
      expect(b.entry.document_country).toBe("NG");
    }
  });

  it("changing document type reroutes (full → supporting)", () => {
    const a = resolveIdvRoute({ document_country: "NG", document_type: "ng_nin" });
    const b = resolveIdvRoute({ document_country: "NG", document_type: "ng_bvn" });
    if (a.kind === "route" && b.kind === "route") {
      expect(a.entry.can_unlock_controlled_actions).toBe(true);
      expect(b.entry.can_unlock_controlled_actions).toBe(false);
    }
  });

  it("browser SSOT and server mirror share identical entry count and key doc types", () => {
    const server = readFileSync(
      "supabase/functions/_shared/idv-route-table.ts",
      "utf8",
    );
    // Non-placeholder document_types must appear verbatim in the server mirror.
    for (const e of IDV_ROUTE_TABLE) {
      if (e.document_type === "national_id_placeholder") continue;
      expect(server).toContain(`document_type: "${e.document_type}"`);
    }
    // Placeholder countries must appear as the array literal in the mirror.
    expect(server).toContain(`"GH", "KE", "UG", "ZM", "CI"`);
    // Sanity: mirror has the same non-placeholder entry count as the SSOT.
    const clientNonPlaceholder = IDV_ROUTE_TABLE.filter(
      (r) => r.document_type !== "national_id_placeholder",
    ).length;
    const serverNonPlaceholder = (
      server.match(/document_type:\s*"(?!national_id_placeholder)/g) || []
    ).length;
    expect(serverNonPlaceholder).toBe(clientNonPlaceholder);
  });
});
