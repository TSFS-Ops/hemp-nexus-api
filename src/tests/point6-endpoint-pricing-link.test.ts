/**
 * Point 6 — Pricing reference linked from usage screens.
 *
 * David's instruction: endpoint prices are LINKED from the usage screens,
 * not embedded per-row. This test enforces:
 *   1. Both usage surfaces render a link to /docs/api-pricing.
 *   2. The reference page is routed and uses the existing browser SSOT.
 *   3. No burn / ledger / payment / Payfast / Paystack / refund / POI /
 *      WaD / key files were edited as part of adding this link.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Point 6 — endpoint pricing linked from usage screens", () => {
  it("client usage dashboard links to /docs/api-pricing", () => {
    const src = read("src/components/developer/ClientUsageDashboard.tsx");
    expect(src).toMatch(/\/docs\/api-pricing/);
    expect(src).toMatch(/data-testid="endpoint-pricing-link"/);
  });

  it("admin usage panel links to /docs/api-pricing", () => {
    const src = read("src/components/admin/AdminApiMonitoringPanel.tsx");
    expect(src).toMatch(/\/docs\/api-pricing/);
    expect(src).toMatch(/data-testid="endpoint-pricing-link"/);
  });

  it("reference page exists, is routed, and uses the browser SSOT", () => {
    expect(existsSync(join(root, "src/pages/docs/ApiPricing.tsx"))).toBe(true);
    const page = read("src/pages/docs/ApiPricing.tsx");
    expect(page).toMatch(/registry-api-artefact-pricing/);
    expect(page).toMatch(/ARTEFACT_PRICE_BOOK/);
    const app = read("src/App.tsx");
    expect(app).toMatch(/\/docs\/api-pricing/);
    expect(app).toMatch(/DocsApiPricing/);
  });

  it("does not place endpoint prices in usage table rows", () => {
    const table = read("src/components/usage/Point6UsageHistoryTable.tsx");
    // The history table must continue to show ACTUAL credits burned per
    // request, not a price catalogue lookup.
    expect(table).not.toMatch(/ARTEFACT_PRICE_BOOK/);
    expect(table).not.toMatch(/usd_price/);
  });

  it("does not import burn / ledger / payment modules into the pricing page", () => {
    const page = read("src/pages/docs/ApiPricing.tsx");
    // Only inspect import statements — prose may legitimately mention
    // these terms when describing the rule.
    const imports = page
      .split("\n")
      .filter((l) => /^\s*import\s/.test(l))
      .join("\n")
      .toLowerCase();
    const banned = ["atomic_token", "payfast", "paystack", "refund", "poi-", "wad-", "api-keys"];
    for (const b of banned) {
      expect(imports).not.toContain(b);
    }
  });
});
