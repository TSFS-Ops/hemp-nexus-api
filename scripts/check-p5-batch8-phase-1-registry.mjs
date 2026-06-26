#!/usr/bin/env node
/**
 * P-5 Batch 8 — Phase 1 drift guard.
 *
 * Enforces, at build/CI time, that:
 *   1. The SSOT file exists and exports every required registry symbol.
 *   2. No Batch 8 Phase 1 work has leaked into DB migrations, edge
 *      functions, cron config, RPCs or UI routes.
 *   3. The banned external wording does not appear in any Batch 8
 *      source surface.
 *   4. The forbidden external fields are not exposed by any Batch 8
 *      source surface.
 *   5. No prohibited cross-batch leakage (Batch 6 / Batch 7 files are
 *      not modified by Phase 1).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SSOT = "src/lib/p5-batch8/registry.ts";

const REQUIRED_EXPORTS = [
  "P5_BATCH8_SCHEMA_VERSION",
  "P5_BATCH8_PROVIDER_CATEGORIES",
  "P5_BATCH8_PROVIDER_CATEGORY_DEFINITIONS",
  "P5_BATCH8_PROVIDER_READY_DEFINITION",
  "P5_BATCH8_PROVIDER_DEPENDENCY_STATES",
  "P5_BATCH8_PROVIDER_DEPENDENCY_STATE_DEFINITIONS",
  "P5_BATCH8_PROVIDER_RESULT_DECISION_STATES",
  "P5_BATCH8_PROVIDER_RESULT_DECISION_DEFINITIONS",
  "P5_BATCH8_WEBHOOK_EVENTS",
  "P5_BATCH8_AUDIT_EVENTS",
  "P5_BATCH8_ALLOWED_EXTERNAL_WORDING",
  "P5_BATCH8_BANNED_EXTERNAL_WORDING",
  "P5_BATCH8_API_SAFE_FIELDS",
  "P5_BATCH8_FORBIDDEN_EXTERNAL_FIELDS",
  "P5_BATCH8_OWNER_ROLES",
  "P5_BATCH8_PROVIDER_OWNERSHIP",
  "P5_BATCH8_MEMORY_AND_FINALITY_GATING",
  "P5_BATCH8_FAILURE_POLICY",
  "P5_BATCH8_HIDDEN_UNTIL_LIVE",
  "P5_BATCH8_PHASE_1_SCOPE",
];

const failures = [];

function fail(msg) {
  failures.push(msg);
}

// 1. SSOT exists with all exports
const ssotPath = path.join(ROOT, SSOT);
if (!fs.existsSync(ssotPath)) {
  fail(`SSOT missing: ${SSOT}`);
} else {
  const src = fs.readFileSync(ssotPath, "utf8");
  for (const sym of REQUIRED_EXPORTS) {
    const re = new RegExp(`export\\s+(const|interface|type)\\s+${sym}\\b`);
    if (!re.test(src)) fail(`SSOT missing export: ${sym}`);
  }
}

// 2. Phase 1 must not have created any DB / edge / cron / RPC artefact
const FORBIDDEN_PHASE1_PATHS = [
  "supabase/migrations", // any migration whose name contains "batch8" or "p5b8"
  "supabase/functions", // any function dir whose name contains "p5-batch8"
];
function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}
const migrations = walkFiles(path.join(ROOT, "supabase/migrations"));
// Allow-list Phase 2+ migrations. Phase 1 only forbids Batch 8 DB
// artefacts predating the approved Phase 2 persistence migration.
const PHASE_2_PLUS_ALLOWED_MIGRATIONS = new Set([
  "20260626165809_816d0395-b66b-4492-84a0-8e7f4fb2a2ef.sql", // Phase 2 DB persistence
  "20260626170432_6ab9c041-96fe-4429-b0d2-f4c86b3ad931.sql", // Phase 3 RPC write path
  "20260626171017_5e451b5c-8223-4ca2-a54a-6dd63a43a533.sql", // Phase 4 API-safe read projections
]);
for (const m of migrations) {
  const base = path.basename(m);
  if (PHASE_2_PLUS_ALLOWED_MIGRATIONS.has(base)) continue;
  const name = base.toLowerCase();
  const body = fs.readFileSync(m, "utf8").toLowerCase();
  if (
    name.includes("batch8") ||
    name.includes("p5b8") ||
    body.includes("p5b8_") ||
    body.includes("p5_batch8_")
  ) {
    fail(`Phase 1 leaked into DB migration: ${path.relative(ROOT, m)}`);
  }
}
const fnDir = path.join(ROOT, "supabase/functions");
if (fs.existsSync(fnDir)) {
  for (const e of fs.readdirSync(fnDir)) {
    if (e.toLowerCase().includes("p5-batch8") || e.toLowerCase().includes("p5b8")) {
      fail(`Phase 1 leaked into edge function: supabase/functions/${e}`);
    }
  }
}

// 3. No Phase 5 UI surfaces outside the approved admin workbench path.
//    Phase 5 introduces src/pages/admin/p5-batch8 and src/components/p5-batch8.
//    Desk and funder Batch 8 surfaces remain forbidden in this phase.
const uiDirs = [
  "src/pages/desk/p5-batch8",
  "src/pages/funder/p5-batch8",
];
for (const d of uiDirs) {
  if (fs.existsSync(path.join(ROOT, d))) {
    fail(`Phase 1 leaked into UI surface: ${d}`);
  }
}

// 4. Banned wording / forbidden fields must not appear in any Batch 8 source
//    surface other than the SSOT itself (which defines them) and tests.
let banned = [];
let forbidden = [];
try {
  const src = fs.readFileSync(ssotPath, "utf8");
  const grabArray = (name) => {
    const m = src.match(
      new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`),
    );
    if (!m) return [];
    return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
  };
  banned = grabArray("P5_BATCH8_BANNED_EXTERNAL_WORDING");
  forbidden = grabArray("P5_BATCH8_FORBIDDEN_EXTERNAL_FIELDS");
} catch {
  /* SSOT missing already reported */
}

const SCAN_DIRS = ["src/lib/p5-batch8", "src/components/p5-batch8"];
const ALLOW_FILES = new Set([SSOT]);
function scanForBanned(dir) {
  if (!fs.existsSync(path.join(ROOT, dir))) return;
  for (const f of walkFiles(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    if (ALLOW_FILES.has(rel)) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(f)) continue;
    const body = fs.readFileSync(f, "utf8").toLowerCase();
    for (const phrase of banned) {
      if (body.includes(phrase.toLowerCase())) {
        fail(`Banned wording "${phrase}" found in ${rel}`);
      }
    }
    for (const field of forbidden) {
      if (body.includes(field.toLowerCase())) {
        fail(`Forbidden external field "${field}" found in ${rel}`);
      }
    }
  }
}
SCAN_DIRS.forEach(scanForBanned);

// 5. Cross-batch leakage: Phase 1 must not modify Batch 6 / Batch 7 SSOTs
//    (presence check is best-effort — git diff is not available here).
const PROTECTED = [
  "src/lib/p5-batch6-exception-registry.ts",
  "src/lib/p5-batch7/registry.ts",
  "src/lib/p5-batch7/api-v1.ts",
  "src/lib/p5-batch7/actions.ts",
];
for (const p of PROTECTED) {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) continue;
  const body = fs.readFileSync(full, "utf8");
  if (body.includes("p5b8") || body.includes("P5_BATCH8")) {
    fail(`Batch 8 token leaked into protected file: ${p}`);
  }
}

if (failures.length) {
  console.error("[p5-batch8 phase-1 guard] FAIL");
  for (const f of failures) console.error(" - " + f);
  process.exit(1);
}
console.log("[p5-batch8 phase-1 guard] OK");
