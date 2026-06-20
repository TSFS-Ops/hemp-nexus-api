#!/usr/bin/env node
/**
 * Batch 2 — Forbids "verified", "live", "guaranteed", "production-ready"
 * wording in the country-coverage / provenance / import-batch admin UI
 * surfaces. Asserts that seed-only countries are never presented as
 * production-ready by string inspection.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = ["verified", "live", "guaranteed", "production-ready"];

const TARGETS = [
  "src/components/registry/ProvenanceSourceList.tsx",
  "src/components/registry/CountryCoverageMatrix.tsx",
  "src/components/registry/ImportBatchList.tsx",
  "src/pages/admin/registry/Provenance.tsx",
  "src/pages/admin/registry/Coverage.tsx",
  "src/pages/admin/registry/Imports.tsx",
];

let failed = false;
for (const f of TARGETS) {
  const src = readFileSync(f, "utf8");
  for (const w of FORBIDDEN) {
    const re = new RegExp(`\\b${w}\\b`, "i");
    if (re.test(src)) {
      console.error(`✗ ${f}: contains forbidden non-production wording "${w}"`);
      failed = true;
    }
  }
  // Seed-only must not be string-equated with production_ready in the UI.
  if (/seed_only[\s\S]{0,60}production_ready/.test(src) && !/!==|never|must not|blocked/i.test(src)) {
    console.error(`✗ ${f}: seed_only shown adjacent to production_ready without explicit negation`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`✓ registry-country-coverage forbidden-words check passed (${TARGETS.length} files)`);
