#!/usr/bin/env node
// P-5 Batch 2 — aggregate cross-consistency guard. Runs every Stage 6 guard
// in sequence. Fails if any sub-guard fails. Emits the canonical success
// marker on full pass.
import { spawnSync } from "node:child_process";
const guards = [
  "scripts/check-p5-batch2-status-consistency.mjs",
  "scripts/check-p5-batch2-rating-consistency.mjs",
  "scripts/check-p5-batch2-provider-wording.mjs",
  "scripts/check-p5-batch2-api-exposure.mjs",
  "scripts/check-p5-batch2-masking.mjs",
  "scripts/check-p5-batch2-audit.mjs",
  "scripts/check-p5-batch2-readiness-bridge.mjs",
  "scripts/check-p5-batch2-finality.mjs",
  "scripts/check-p5-batch2-versioning.mjs",
  "scripts/check-p5-batch2-memory-safety.mjs",
  "scripts/check-p5-batch2-role-leak.mjs",
  "scripts/check-p5-batch2-route-surface.mjs",
];
let failed = [];
for (const g of guards) {
  const r = spawnSync("node", [g], { stdio: "inherit" });
  if (r.status !== 0) failed.push(g);
}
if (failed.length) {
  console.error(`\nP5_BATCH_2_FINAL_CONSISTENCY_FAIL — ${failed.length} guard(s) failed:\n` + failed.join("\n"));
  process.exit(1);
}
console.log("\nP5_BATCH_2_FINAL_CONSISTENCY_OK");
