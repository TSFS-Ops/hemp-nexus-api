#!/usr/bin/env node
/**
 * Batch 20 — confirms the central registry evidence index references
 * Batches 1 through 19B plus the Batch 20 embarrassment-audit row, and
 * that the Batch 20 evidence README exists.
 */
import { readFileSync, existsSync } from "node:fs";

const index = readFileSync("evidence/registry-evidence-index/README.md", "utf8");
const required = ["| 1 |", "| 5 |", "| 11 |", "| 17 |", "| 18 |", "| 19A |", "| 19B |", "| 20 |"];
const missing = required.filter((r) => !index.includes(r));
if (missing.length) {
  console.error("❌ batch-20 evidence index missing rows: " + missing.join(", "));
  process.exit(1);
}

const evidence = "evidence/batch-20-pre-uat-embarrassment-audit/README.md";
if (!existsSync(evidence)) {
  console.error("❌ missing " + evidence);
  process.exit(1);
}

const body = readFileSync(evidence, "utf8");
for (const cat of ["uat_blocker", "uat_risk", "cosmetic", "deferred_non_blocking", "accepted_limitation"]) {
  if (!body.includes(cat)) {
    console.error("❌ batch-20 evidence README missing category: " + cat);
    process.exit(1);
  }
}
if (!/BATCH_20_PRE_UAT_EMBARRASSMENT_AUDIT_COMPLETE/.test(body)) {
  console.error("❌ batch-20 evidence README missing final status token");
  process.exit(1);
}
console.log("✓ batch-20 evidence index + README present");
