#!/usr/bin/env node
/**
 * Batch 1 — Forbids "verified", "live", "guaranteed", "production-ready"
 * wording inside the registry shell components/pages (where the surface is
 * not yet production_ready). The SSOT file itself is exempt.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const EXEMPT = new Set([
  "src/lib/registry-readiness.ts",
  "src/lib/business-decisions.ts",
  "src/tests/batch-1-registry-foundation.test.ts",
  // Batch 4 — the bank-detail state machine legitimately uses "verified" as
  // an explicit status label (with "captured does not mean verified" copy).
  "src/pages/registry/BankDetails.tsx",
  "src/pages/admin/registry/BankDetails.tsx",
]);

const FORBIDDEN = ["verified", "live", "guaranteed", "production-ready"];

const TARGET_DIRS = [
  "src/components/registry",
  "src/pages/registry",
  "src/pages/admin/registry",
];

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const f of entries) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

const files = TARGET_DIRS.flatMap((d) => walk(d));
let failed = false;

for (const f of files) {
  if (EXEMPT.has(f)) continue;
  const src = readFileSync(f, "utf8");
  for (const w of FORBIDDEN) {
    const re = new RegExp(`\\b${w}\\b`, "i");
    if (re.test(src)) {
      console.error(`✗ ${f}: contains forbidden non-production wording "${w}"`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`✓ registry-readiness forbidden-words check passed (${files.length} files scanned)`);
