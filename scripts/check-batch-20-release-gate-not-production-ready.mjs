#!/usr/bin/env node
/**
 * Batch 20 — defensive pin: the release-gate page default must never be
 * `production_ready`. This complements
 * `check-batch-18-no-production-ready-default.mjs` by also scanning the
 * release-gate admin component for any hard-coded "production_ready"
 * default-state assignment.
 */
import { readFileSync, existsSync } from "node:fs";

const candidates = [
  "src/pages/admin/registry/ReleaseGate.tsx",
  "src/lib/registry-release-gate.ts",
  "supabase/functions/_shared/registry-release-gate.ts",
];

const failures = [];
for (const file of candidates) {
  if (!existsSync(file)) continue;
  const src = readFileSync(file, "utf8");
  // Disallow patterns like:  state = "production_ready"  /  default: "production_ready"
  const RX = /(default(_state)?\s*[:=]\s*["'`]production_ready["'`])|(state\s*=\s*["'`]production_ready["'`])/i;
  if (RX.test(src)) failures.push(file);
}

if (failures.length) {
  console.error("❌ batch-20 release-gate default cannot be production_ready: " + failures.join(", "));
  process.exit(1);
}
console.log("✓ batch-20 release-gate default-not-production-ready ok");
