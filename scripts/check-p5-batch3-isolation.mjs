#!/usr/bin/env node
/**
 * P-5 Batch 3 — Stage 1 isolation guard (static grep).
 *
 * Scans for:
 *   - Batch 3 files that reference Batch 1 / Batch 2 internal write paths
 *     (RPCs, summary clients allowed only when listed below).
 *   - Public funder API endpoints (must not exist in Stage 1).
 *   - Funder edge functions (must not exist in Stage 1).
 *   - Any UI / hook / route registration for Batch 3 (must not exist yet).
 *
 * Exits non-zero on violation.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const VIOLATIONS = [];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === "node_modules" || name === ".git" || name === "dist") continue;
      walk(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

// --- Rule 1: funder edge functions are restricted to the allow-list ------
// Stage 3 introduces the safe summary edge function. Stages 4–6 must add
// nothing else under this prefix without explicit sign-off.
const ALLOWED_BATCH3_FNS = new Set(["p5-batch3-funder-summary"]);
const fnDir = join(ROOT, "supabase/functions");
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (/^p5-?batch-?3/i.test(name) || /funder/i.test(name)) {
      if (!ALLOWED_BATCH3_FNS.has(name)) {
        VIOLATIONS.push(`Stage 1 guard: unexpected funder/batch3 edge function: ${name}`);
      }
    }
  }
}

// --- Rule 2: Stage 4+ surfaces must not exist yet -------------------------
const FORBIDDEN_UI_DIRS = [
  "src/pages/admin/p5-batch3",
  "src/pages/funder/p5-batch3",
  "src/pages/registry/p5-batch3",
  "src/hooks/useP5Batch3Permissions.ts",
  "src/lib/p5-batch3/summary-client.ts",
  "src/lib/p5-batch3/notifications.ts",
  "src/lib/p5-batch3/sla-rules.ts",
];
for (const rel of FORBIDDEN_UI_DIRS) {
  if (existsSync(join(ROOT, rel))) {
    VIOLATIONS.push(`Stage 1 guard: forbidden Stage 4+ file/dir already present: ${rel}`);
  }
}

// --- Rule 3: Batch 3 source files must not reference Batch 1/2 internals --
const ALLOWED_BATCH3_DIRS = [
  "src/lib/p5-batch3",
  "src/tests",
  "supabase/migrations",
  "scripts",
  "evidence/p5-batch3-funder-workflow",
];
const FORBIDDEN_TOKENS = [
  /\bp5b2_[a-z_]+_v[0-9]+\b/, // batch 2 RPC names
  /from\s+['"]@\/lib\/p5-batch2\/rpc['"]/, // batch 2 RPC client
  /atomic_generate_poi/,
  /atomic_token_burn/,
];

const batch3Files = walk(join(ROOT, "src/lib/p5-batch3"))
  .concat(
    walk(join(ROOT, "src/tests")).filter(
      (p) =>
        /p5-batch3/.test(p) &&
        // Isolation tests legitimately enumerate the forbidden tokens to
        // assert that the *migration* does not reference them.
        !/p5-batch3-stage1-schema-isolation\.test\.ts$/.test(p),
    ),
  );

for (const f of batch3Files) {
  const text = readFileSync(f, "utf8");
  for (const tok of FORBIDDEN_TOKENS) {
    if (tok.test(text)) {
      VIOLATIONS.push(`Stage 1 leak: ${f} references forbidden token ${tok}`);
    }
  }
}

// --- Rule 4: routes/pages must not register Batch 3 surfaces yet ---------
const appTsx = join(ROOT, "src/App.tsx");
if (existsSync(appTsx)) {
  const text = readFileSync(appTsx, "utf8");
  if (/p5-?batch-?3/i.test(text) || /\/funder\/p5-batch3/.test(text)) {
    VIOLATIONS.push("Stage 1: src/App.tsx references Batch 3 routes (should be Stage 4+)");
  }
}

if (VIOLATIONS.length > 0) {
  console.error("❌ P5_BATCH_3_STAGE_1_ISOLATION_FAILED");
  for (const v of VIOLATIONS) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_3_STAGE_1_ISOLATION_OK");
console.log(`   scanned ${batch3Files.length} Batch 3 files`);
console.log(`   allowed dirs: ${ALLOWED_BATCH3_DIRS.join(", ")}`);
