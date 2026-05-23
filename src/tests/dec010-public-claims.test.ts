/**
 * DEC-010 — public-page forbidden-claim snapshot.
 *
 * Mirrors scripts/check-legal-claims.mjs but runs in vitest so failures
 * appear in the same report as the other test files.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { FORBIDDEN_PUBLIC_CLAIM_PHRASES } from "@/lib/legal/forbidden-terms";

const FILES = [
  "src/pages/products/TradeDesk.tsx",
  "src/pages/Pricing.tsx",
  "src/pages/Developers.tsx",
  "src/pages/Welcome.tsx",
  "src/pages/Auth.tsx",
  "src/pages/docs/Matches.tsx",
  "src/pages/docs/Webhooks.tsx",
  "src/pages/solutions/Traders.tsx",
  "src/pages/solutions/Sovereigns.tsx",
  "src/pages/solutions/Finance.tsx",
  "src/pages/products/ComplianceEngine.tsx",
  "src/pages/GovernanceEntities.tsx",
  "src/pages/WalkthroughReport.tsx",
  "src/pages/TradeDealWizard.tsx",
];

describe("DEC-010 — public pages must not contain forbidden claim phrases", () => {
  it.each(FILES)("%s", (rel) => {
    if (!existsSync(rel)) return;
    const src = readFileSync(rel, "utf8");
    for (const phrase of FORBIDDEN_PUBLIC_CLAIM_PHRASES) {
      // Allow lines explicitly marked as quoting a forbidden phrase.
      const lines = src.split("\n").filter((l) => !l.includes("LEGAL_ALLOW"));
      const joined = lines.join("\n").toLowerCase();
      expect(joined, `Forbidden phrase "${phrase}" appears in ${rel}`).not.toContain(
        phrase.toLowerCase(),
      );
    }
  });
});

describe("DEC-010 — Status page remains conservative", () => {
  it("does not claim public operational status", () => {
    const src = readFileSync("src/pages/Status.tsx", "utf8");
    expect(src).toContain("Status monitoring is being configured");
    expect(src).not.toMatch(/All systems operational/i);
    expect(src).not.toMatch(/99\.9\d%\s*uptime/i);
  });
});
