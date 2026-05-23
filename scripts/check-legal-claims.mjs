#!/usr/bin/env node
/**
 * DEC-005 / DEC-006 / DEC-010 — public-page claims lint.
 *
 * Fails the build if any forbidden phrase appears in the listed public
 * marketing / docs pages. Run from `prebuild`.
 *
 * Allowed exception: lines containing the literal token `LEGAL_ALLOW`
 * (used by tests / explanatory copy that must quote a forbidden phrase).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

const FILES = [
  "src/pages/products/TradeDesk.tsx",
  "src/pages/Pricing.tsx",
  "src/pages/Developers.tsx",
  "src/pages/Welcome.tsx",
  "src/pages/Auth.tsx",
  "src/pages/Docs.tsx",
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

const FORBIDDEN_PHRASES = [
  "binding POI",
  "sealed POI",
  "POI sealed",
  "tamper-proof Proof of Intent",
  "completed transaction",
  "final trade",
  "terms are now immutable",
  "automated compliance",
  "continuous sanctions screening",
  "real-time compliance",
  "fully automated end-to-end",
  "guarantees compliance",
  "prevents all fraud",
];

let failed = false;
const findings = [];

for (const rel of FILES) {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) continue;
  const src = readFileSync(abs, "utf8");
  const lines = src.split("\n");
  lines.forEach((line, idx) => {
    if (line.includes("LEGAL_ALLOW")) return;
    const lower = line.toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      if (lower.includes(phrase.toLowerCase())) {
        failed = true;
        findings.push(`${rel}:${idx + 1}  "${phrase}"  →  ${line.trim().slice(0, 140)}`);
      }
    }
  });
}

if (failed) {
  console.error("\n[check-legal-claims] DEC-010 forbidden phrases found on public pages:\n");
  for (const f of findings) console.error("  " + f);
  console.error(
    "\nReplace with DEC-010 safe wording (see src/lib/legal/claims-register.ts) or add a LEGAL_ALLOW marker if the page is explicitly quoting a forbidden phrase as an example.\n",
  );
  process.exit(1);
}

console.log("[check-legal-claims] OK — no DEC-010 forbidden phrases on listed public pages.");
