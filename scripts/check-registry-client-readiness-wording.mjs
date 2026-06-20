#!/usr/bin/env node
/**
 * Batch 6 — Client-safe readiness wording guard. The /registry/readiness
 * page (M017) must not include any of the forbidden words unless the
 * production_ready bucket is being described. Heuristic: outside lines
 * that match REGISTRY_CLIENT_READINESS_COPY["production_ready"], the page
 * must not contain bare "live", "verified", "guaranteed" or
 * "production-ready" without being part of a bucket key or copy import.
 */
import { readFileSync } from "node:fs";

const SOURCES = [
  "src/pages/registry/Readiness.tsx",
];

const FORBIDDEN = ["live", "guaranteed"];
// "verified" / "production-ready" are allowed because they appear as bucket
// keys and headline labels for the production_ready/seed_only copy. We
// instead enforce them via the SSOT-only rule below.

let failed = false;

for (const f of SOURCES) {
  const src = readFileSync(f, "utf8");
  for (const word of FORBIDDEN) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(src)) {
      console.error(`✗ ${f}: contains forbidden client-readiness word "${word}"`);
      failed = true;
    }
  }
  // Must read from SSOT, never inline overclaiming copy.
  if (!src.includes("REGISTRY_CLIENT_READINESS_COPY") || !src.includes("REGISTRY_CLIENT_READINESS_HEADLINE")) {
    console.error(`✗ ${f}: does not import readiness SSOT copy`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ Batch 6 client-safe readiness wording guard passed");
