#!/usr/bin/env node
/**
 * check-tenant-boundary-audit-names.mjs
 *
 * Build-time guard for Batch 5 · Stage 1 (Tenant-Boundary Evidence Pack).
 * Ensures the canonical audit action `governance.tenant_boundary.probe_completed`
 * is emitted exactly by `supabase/functions/tenant-boundary-probe/index.ts` and
 * is not referenced under any drifted spelling elsewhere.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const CANONICAL = "governance.tenant_boundary.probe_completed";
const PROBE_FILE = resolve(ROOT, "supabase/functions/tenant-boundary-probe/index.ts");

const errors = [];

if (!existsSync(PROBE_FILE)) {
  errors.push(`Expected probe edge function missing: ${PROBE_FILE}`);
} else {
  const src = readFileSync(PROBE_FILE, "utf8");
  if (!src.includes(`"${CANONICAL}"`)) {
    errors.push(`tenant-boundary-probe must emit canonical audit "${CANONICAL}"`);
  }
}

// Forbid drifted spellings
const DRIFT = [
  "tenant_boundary.completed",
  "tenant-boundary.probe_completed",
  "tenant_boundary_probe_completed",
];
for (const file of [PROBE_FILE]) {
  if (!existsSync(file)) continue;
  const src = readFileSync(file, "utf8");
  for (const d of DRIFT) {
    if (src.includes(d)) errors.push(`Drifted audit spelling "${d}" found in ${file}`);
  }
}

if (errors.length) {
  console.error("[check-tenant-boundary-audit-names] FAILED:");
  for (const e of errors) console.error("  •", e);
  process.exit(1);
}
console.log("[check-tenant-boundary-audit-names] ok");
