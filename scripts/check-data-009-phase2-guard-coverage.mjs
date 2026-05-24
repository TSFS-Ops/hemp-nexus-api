#!/usr/bin/env node
/**
 * DATA-009 Phase 2 — guard coverage.
 * Asserts the residency-claim guard is wired into each chokepoint
 * edge function so production artefacts / exports / progression are
 * blocked while a residency review hold is active.
 */
import { readFileSync } from "node:fs";

const REQUIRED_CHOKEPOINTS = [
  "supabase/functions/export-prepare/index.ts",
  "supabase/functions/export-download/index.ts",
  "supabase/functions/wad/index.ts",
  "supabase/functions/p3-wad/index.ts",
  "supabase/functions/collapse/index.ts",
  "supabase/functions/deal-certificate/index.ts",
  "supabase/functions/evidence-pack/index.ts",
];

const failures = [];
for (const path of REQUIRED_CHOKEPOINTS) {
  let txt = "";
  try { txt = readFileSync(path, "utf8"); }
  catch { failures.push(`${path}  ← MISSING file`); continue; }
  const hasImport =
    txt.includes("residency-claim-guard") || txt.includes("residency-entry");
  if (!hasImport) failures.push(`${path}  ← residency guard not imported`);
}

if (failures.length) {
  console.error("\n❌ DATA-009 Phase 2 guard-coverage FAILED:\n");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`✓ DATA-009 Phase 2 guard-coverage: ${REQUIRED_CHOKEPOINTS.length} chokepoints wired.`);
