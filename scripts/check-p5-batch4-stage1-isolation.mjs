#!/usr/bin/env node
/**
 * P-5 Batch 4 — Stage 1 isolation guard (static grep).
 *
 * Scans for:
 *   - Batch 4 source files that reference Batch 1 / 2 / 3 internal RPCs or
 *     business-row write paths.
 *   - Public funder API endpoints under Batch 4 (must not exist in Stage 1).
 *   - Funder/admin/user edge functions for Batch 4 (none allowed in Stage 1).
 *   - Any UI / hook / route registration for Batch 4 (none allowed in Stage 1).
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

// --- Rule 1: only the Stage 3 safe-summary edge function is allowed. ---
// Stage 1 declared "no Batch 4 edge functions"; once Stage 3 ships the
// internal-safe summary function, that single function is the only one
// permitted in this scope. Any additional Batch 4 edge function is a leak.
const ALLOWED_BATCH4_EDGE_FNS = new Set(["p5-batch4-execution-summary"]);
const fnDir = join(ROOT, "supabase/functions");
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (/^p5-?batch-?4/i.test(name) && !ALLOWED_BATCH4_EDGE_FNS.has(name)) {
      VIOLATIONS.push(`Stage 1 guard: unexpected Batch 4 edge function: ${name}`);
    }
  }
}


// --- Rule 2: no Batch 4 UI surfaces exist yet ---
const FORBIDDEN_UI_DIRS = [
  "src/pages/admin/p5-batch4",
  "src/pages/funder/p5-batch4",
  "src/pages/desk/p5-batch4",
  "src/pages/registry/p5-batch4",
];
for (const rel of FORBIDDEN_UI_DIRS) {
  if (existsSync(join(ROOT, rel))) {
    VIOLATIONS.push(`Stage 1 guard: forbidden surface present: ${rel}`);
  }
}

// --- Rule 3: Batch 4 source files must not reference Batch 1/2/3 internals ---
const FORBIDDEN_TOKENS = [
  /\bp5b2_[a-z_]+_v[0-9]+\b/,
  /\bp5b3_[a-z_]+_v[0-9]+\b/,
  /from\s+['"]@\/lib\/p5-batch2\/rpc['"]/,
  /from\s+['"]@\/lib\/p5-batch3\/rpc['"]/,
  /atomic_generate_poi/,
  /atomic_token_burn/,
];

const batch4Files = walk(join(ROOT, "src/lib/p5-batch4"))
  .concat(
    walk(join(ROOT, "src/tests")).filter(
      (p) =>
        /p5-batch4/.test(p) &&
        // The schema-isolation test legitimately enumerates forbidden tokens
        // to assert the migration does not reference them.
        !/p5-batch4-stage1-schema-isolation\.test\.ts$/.test(p),
    ),
  );

for (const f of batch4Files) {
  const text = readFileSync(f, "utf8");
  for (const tok of FORBIDDEN_TOKENS) {
    if (tok.test(text)) {
      VIOLATIONS.push(`Stage 1 leak: ${f} references forbidden token ${tok}`);
    }
  }
}

// --- Rule 4: no App.tsx route registrations for Batch 4 yet ---
const appTsx = join(ROOT, "src/App.tsx");
if (existsSync(appTsx)) {
  const text = readFileSync(appTsx, "utf8");
  if (/p5-batch4/i.test(text)) {
    VIOLATIONS.push("Stage 1 guard: src/App.tsx references p5-batch4 (no routes allowed yet)");
  }
}

if (VIOLATIONS.length > 0) {
  console.error("❌ P5_BATCH_4_STAGE_1_ISOLATION_FAILED");
  for (const v of VIOLATIONS) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_4_STAGE_1_ISOLATION_OK");
console.log(`   scanned ${batch4Files.length} Batch 4 files`);
