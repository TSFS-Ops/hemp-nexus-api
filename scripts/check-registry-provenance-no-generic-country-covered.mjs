#!/usr/bin/env node
/**
 * Batch 25 — Guard: the generic phrase "country covered" MUST NOT
 * appear inside any registry UI surface. The client requires
 * capability-specific wording (search / claim / authority / bank
 * capture / bank verification / API coverage). The SSOT file itself
 * is exempt because it documents the rule.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const EXEMPT = new Set([
  "src/lib/registry-provenance-import-rules.ts",
  "docs/registry/provenance-country-import-duplicate-rules.md",
]);

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

const FORBIDDEN = /\bcountry\s+covered\b/i;
const files = TARGET_DIRS.flatMap((d) => walk(d));
const failures = [];
for (const f of files) {
  if (EXEMPT.has(f)) continue;
  const src = readFileSync(f, "utf8");
  if (FORBIDDEN.test(src)) failures.push(f);
}

if (failures.length > 0) {
  console.error("✗ Batch 25 generic 'country covered' wording found in:");
  for (const f of failures) console.error("  - " + f);
  console.error("  Use a capability-specific phrase (search / claim / authority / bank / API coverage).");
  process.exit(1);
}
console.log("✓ Batch 25 no generic 'country covered' wording — clean.");
