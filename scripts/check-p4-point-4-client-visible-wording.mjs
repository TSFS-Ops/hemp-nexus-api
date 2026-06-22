#!/usr/bin/env node
// P-4 Point 4 — Client-visible wording guard.
// Blocks embarrassing wording drift on client-visible surfaces against
// David's confirmed rule:
//   "Production API calls burn credits only when they create, return,
//    update or confirm a governed commercial artefact."
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const FORBIDDEN_PHRASES = [
  // Wording that drops the artefact qualification.
  /every\s+api\s+call\s+burns/i,
  /all\s+api\s+calls\s+burn/i,
  /per\s+api\s+call\s+burn/i,
  /burns?\s+credits\s+per\s+api\s+call(?!\s+(that|where|when))/i,
  // Internal-implementation leakage to client-visible copy.
  /smallest[-_ ]units?\s+(of\s+)?credit/i,
];

// Client-visible surfaces only. Internal engineering docs under docs/ and
// evidence/ are intentionally excluded — they describe the implementation
// to developers and may reference internal symbols.
const SCAN_GLOBS = [
  "src/pages/docs",
  "src/components/desk/billing",
  "src/components/desk/settings/TokenBalanceTab.tsx",
  "src/pages/Billing.tsx",
];

const ALLOWLIST = new Set([
  "scripts/check-p4-point-4-client-visible-wording.mjs",
]);

function listFiles() {
  const out = execSync(
    `git ls-files ${SCAN_GLOBS.map((g) => `'${g}'`).join(" ")} 2>/dev/null || true`,
    { encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

let failed = 0;
for (const file of listFiles()) {
  if (ALLOWLIST.has(file)) continue;
  let body;
  try { body = readFileSync(file, "utf8"); } catch { continue; }
  for (const rx of FORBIDDEN_PHRASES) {
    if (rx.test(body)) {
      console.error(`✗ Forbidden wording ${rx} in ${file}`);
      failed++;
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} forbidden-wording hit(s).`);
  process.exit(1);
}
console.log("✓ No forbidden client-visible wording found.");
