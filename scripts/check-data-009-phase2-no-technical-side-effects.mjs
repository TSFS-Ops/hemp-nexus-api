#!/usr/bin/env node
/**
 * DATA-009 Phase 2 — no-technical-side-effects guard.
 *
 * Approval records the POLICY EXCEPTION ONLY. The codebase must NOT
 * introduce any technical hosting / region migration / backup change /
 * storage relocation function or claim.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  "region_migrate",
  "region-migrate",
  "backup_policy",
  "backup-policy",
  "sovereign_host",
  "sovereign-host",
  "residency_migrate",
  "residency-migrate",
  "storage_relocate",
  "storage-relocate",
];

const ROOTS = [
  "src",
  "supabase/functions",
  "supabase/migrations",
  "scripts",
  "docs",
];

// Allowlist: this guard script itself and the deferred policy register.
const ALLOW_FILES = new Set([
  "scripts/check-data-009-phase2-no-technical-side-effects.mjs",
  "docs/deferred-policy-register.md",
]);

function walk(dir) {
  const out = [];
  try {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const s = statSync(p);
      if (s.isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
  } catch { /* missing */ }
  return out;
}

const failures = [];
for (const root of ROOTS) {
  for (const path of walk(root)) {
    if (ALLOW_FILES.has(path)) continue;
    if (!/\.(ts|tsx|sql|mjs|js|md)$/.test(path)) continue;
    const txt = readFileSync(path, "utf8");
    for (const f of FORBIDDEN) {
      if (txt.includes(f)) failures.push(`${path}  ← forbidden technical token "${f}"`);
    }
  }
}

if (failures.length) {
  console.error("\n❌ DATA-009 Phase 2 no-technical-side-effects guard FAILED:\n");
  for (const f of failures) console.error("  - " + f);
  console.error("\nApproval records the policy exception only. Remove technical hosting/region/backup/storage-relocate tokens.\n");
  process.exit(1);
}
console.log(`✓ DATA-009 Phase 2 no-technical-side-effects: ${FORBIDDEN.length} forbidden tokens not found.`);
