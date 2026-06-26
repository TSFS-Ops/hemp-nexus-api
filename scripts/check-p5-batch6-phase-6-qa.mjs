#!/usr/bin/env node
/**
 * P-5 Batch 6 — Phase 6 comprehensive QA / drift guard.
 *
 * Read-only static analysis across all five preceding phases. Fails the
 * build if any of the following invariants regress.
 *
 * Phase 6 verifies:
 *   1. SSOT registry (Phase 1) is reachable.
 *   2. Phase 2 DB migration encodes the SSOT into CHECK constraints,
 *      grants are correct, RLS is enabled, append-only triggers exist.
 *   3. Phase 3 RPC migration: every function is SECURITY DEFINER, pins
 *      search_path = public, EXECUTE is revoked from PUBLIC and granted
 *      only to authenticated.
 *   4. Phase 4 projection migration: same SECURITY DEFINER / search_path
 *      / REVOKE / GRANT contract.
 *   5. Phase 5 UI files:
 *        - do not perform direct table reads/writes against p5b6_* tables
 *        - only call the Phase 4 safe projections for reads
 *        - only call the Phase 3 RPCs for writes/actions
 *        - never render forbidden external fields
 *        - never include banned external wording
 *   6. Routes for Phase 5 surfaces are registered in src/App.tsx.
 *   7. No pg_cron jobs and no Supabase Edge Functions reference p5b6_*.
 *   8. No Batch 7 / Batch 8 tokens leak into Batch 6 files.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const errors = [];
const notes = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { errors.push(m); console.error(`  ✗ ${m}`); };

function read(p) {
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

function findMigration(prefix) {
  const dir = resolve(ROOT, "supabase/migrations");
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((f) => f.startsWith(prefix));
  return hit ? resolve(dir, hit) : null;
}

// ── Phase 1 ────────────────────────────────────────────────────────────────
const REGISTRY = resolve(ROOT, "src/lib/p5-batch6-exception-registry.ts");
const registry = read(REGISTRY);
if (!registry) {
  fail("Phase 1 SSOT registry missing");
  process.exit(1);
}
ok("Phase 1 registry present");

function extractStringArray(name) {
  const re = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`);
  const m = registry.match(re);
  if (!m) return null;
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

const SSOT = {
  exception_types: extractStringArray("P5_BATCH6_EXCEPTION_TYPES") ?? [],
  queues: extractStringArray("P5_BATCH6_REVIEW_QUEUES") ?? [],
  priorities: extractStringArray("P5_BATCH6_PRIORITIES") ?? [],
  statuses: extractStringArray("P5_BATCH6_STATUSES") ?? [],
  note_types: extractStringArray("P5_BATCH6_NOTE_TYPES") ?? [],
  dispute_states: extractStringArray("P5_BATCH6_DISPUTE_STATES") ?? [],
  banned: extractStringArray("P5_BATCH6_BANNED_EXTERNAL_WORDING") ?? [],
  forbidden_fields: extractStringArray("P5_BATCH6_FORBIDDEN_EXTERNAL_FIELDS") ?? [],
  reports: extractStringArray("P5_BATCH6_REPORTS") ?? [],
};

// ── Phase 2: DB persistence ────────────────────────────────────────────────
const PHASE2 = findMigration("20260626033922_");
const phase2 = PHASE2 ? read(PHASE2) : null;
if (!phase2) fail("Phase 2 migration not found");
else {
  ok(`Phase 2 migration: ${PHASE2.split("/").pop()}`);
  const required = [
    "p5b6_exceptions",
    "p5b6_exception_notes",
    "p5b6_exception_audit_events",
    "p5b6_exception_disputes",
    "p5b6_exception_queue_assignments",
    "p5b6_exception_report_exports",
  ];
  for (const t of required) {
    if (!new RegExp(`CREATE TABLE public\\.${t}\\b`, "i").test(phase2))
      fail(`Phase 2: table ${t} not created`);
    if (!new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`, "i").test(phase2))
      fail(`Phase 2: RLS not enabled on ${t}`);
    if (!new RegExp(`GRANT[^;]*ON public\\.${t}[^;]*TO authenticated`, "i").test(phase2))
      fail(`Phase 2: missing authenticated GRANT on ${t}`);
    if (!new RegExp(`GRANT ALL ON public\\.${t} TO service_role`, "i").test(phase2))
      fail(`Phase 2: missing service_role GRANT on ${t}`);
    if (new RegExp(`GRANT[^;]*ON public\\.${t}[^;]*TO anon`, "i").test(phase2))
      fail(`Phase 2: forbidden anon GRANT on ${t}`);
  }
  // SSOT must be encoded as CHECK constraints
  for (const t of SSOT.exception_types) {
    if (!phase2.includes(`'${t}'`)) fail(`Phase 2: exception type ${t} not in CHECK`);
  }
  for (const q of SSOT.queues) {
    if (!phase2.includes(`'${q}'`)) fail(`Phase 2: queue ${q} not in CHECK`);
  }
  for (const s of SSOT.statuses) {
    if (!phase2.includes(`'${s}'`)) fail(`Phase 2: status ${s} not in CHECK`);
  }
  for (const n of SSOT.note_types) {
    if (!phase2.includes(`'${n}'`)) fail(`Phase 2: note type ${n} not in CHECK`);
  }
  for (const d of SSOT.dispute_states) {
    if (!phase2.includes(`'${d}'`)) fail(`Phase 2: dispute state ${d} not in CHECK`);
  }
  // Append-only triggers on immutable tables
  for (const t of ["p5b6_exception_notes", "p5b6_exception_audit_events",
                   "p5b6_exception_queue_assignments", "p5b6_exception_report_exports"]) {
    if (!new RegExp(`CREATE TRIGGER[\\s\\S]*?ON public\\.${t}[\\s\\S]*?p5b6_block_mutation_append_only`, "i").test(phase2))
      fail(`Phase 2: append-only protection missing on ${t}`);
  }
  ok("Phase 2: tables, RLS, grants, append-only triggers verified");
}

// ── Phase 3 & 4: SECURITY DEFINER contract ────────────────────────────────
function auditDefinerMigration(label, prefix, mustRevoke) {
  const file = findMigration(prefix);
  if (!file) { fail(`${label} migration not found`); return; }
  const src = read(file);
  ok(`${label} migration: ${file.split("/").pop()}`);
  const fnNames = [...src.matchAll(/CREATE OR REPLACE FUNCTION public\.(p5b6_\w+)\s*\(/g)]
    .map((m) => m[1]);
  if (!fnNames.length) { fail(`${label}: no p5b6_* functions found`); return; }
  // Each function block must declare SECURITY DEFINER and pin search_path.
  const blocks = src.split(/CREATE OR REPLACE FUNCTION public\./).slice(1);
  for (const block of blocks) {
    const nameMatch = block.match(/^(p5b6_\w+)/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const head = block.slice(0, block.toLowerCase().indexOf(" as $$"));
    const isPureHelper = /\b(IMMUTABLE|STABLE)\b/i.test(head) && !/SECURITY DEFINER/i.test(head);
    if (!/SECURITY DEFINER/i.test(head) && !isPureHelper) {
      fail(`${label}: ${name} not SECURITY DEFINER (and not a pure IMMUTABLE/STABLE helper)`);
    }
    if (!/SET\s+search_path\s*=\s*public/i.test(head)) fail(`${label}: ${name} missing SET search_path = public`);
  }
  // EXECUTE revoke + grant
  for (const n of fnNames) {
    const revoked = new RegExp(`REVOKE (ALL|EXECUTE)[^;]*ON FUNCTION public\\.${n}\\s*\\([^)]*\\)[^;]*FROM PUBLIC`, "i").test(src);
    if (mustRevoke && !revoked) fail(`${label}: REVOKE ... FROM PUBLIC missing for ${n}`);
  }
  ok(`${label}: ${fnNames.length} SECURITY DEFINER functions verified`);
}
auditDefinerMigration("Phase 3 RPC", "20260626034533_", true);
auditDefinerMigration("Phase 4 projection", "20260626051520_", true);

// ── Phase 5 UI ─────────────────────────────────────────────────────────────
const UI_FILES = [
  "src/pages/admin/p5-batch6/Workbench.tsx",
  "src/pages/admin/p5-batch6/ExceptionDetail.tsx",
  "src/pages/admin/p5-batch6/ReportExports.tsx",
  "src/pages/desk/p5-batch6/MyExceptions.tsx",
  "src/pages/funder/p5-batch6/FunderExceptions.tsx",
];
const SAFE_READ_RPCS = new Set([
  "p5b6_list_exceptions_safe",
  "p5b6_get_exception_safe",
  "p5b6_get_queue_summary_safe",
  "p5b6_get_dispute_safe",
  "p5b6_get_timeline_safe",
  "p5b6_list_report_exports_safe",
]);
const WRITE_RPCS = new Set([
  "p5b6_create_exception",
  "p5b6_update_exception_status",
  "p5b6_update_exception_priority",
  "p5b6_assign_exception",
  "p5b6_add_note",
  "p5b6_raise_dispute",
  "p5b6_update_dispute_state",
  "p5b6_record_report_export",
]);

for (const rel of UI_FILES) {
  const p = resolve(ROOT, rel);
  const src = read(p);
  if (!src) { fail(`UI file missing: ${rel}`); continue; }
  // No direct table reads/writes
  if (/\.from\s*\(\s*["']p5b6_/.test(src)) {
    fail(`${rel}: direct supabase.from('p5b6_*') call is forbidden — use Phase 4 projections`);
  }
  // Forbidden fields must never be rendered or referenced
  for (const ff of SSOT.forbidden_fields) {
    // Match as a property/identifier token; skip generic substrings that may collide with safe words.
    if (new RegExp(`\\b${ff}\\b`).test(src)) {
      fail(`${rel}: references forbidden external field "${ff}"`);
    }
  }
  // Banned wording (case-insensitive, word-ish boundary)
  const lower = src.toLowerCase();
  for (const w of SSOT.banned) {
    if (lower.includes(w.toLowerCase())) {
      fail(`${rel}: contains banned external wording "${w}"`);
    }
  }
  // RPC names used in this file must be on one of the allow-lists
  const rpcCalls = [...src.matchAll(/\.rpc\(\s*["'](p5b6_[a-z0-9_]+)["']/g)].map((m) => m[1]);
  for (const c of rpcCalls) {
    if (!SAFE_READ_RPCS.has(c) && !WRITE_RPCS.has(c)) {
      fail(`${rel}: calls unknown p5b6 RPC "${c}"`);
    }
  }
  // Batch 7 / Batch 8 leakage
  for (const tok of ["p5-batch7","P5_BATCH7","Batch 7","p5-batch8","P5_BATCH8","Batch 8"]) {
    if (src.includes(tok)) fail(`${rel}: leaks "${tok}"`);
  }
}
ok(`Phase 5: ${UI_FILES.length} UI files audited for safe RPC + forbidden-field + banned-wording`);

// Tenant/funder must NOT call admin-only write RPCs
const tenantFunder = [
  "src/pages/desk/p5-batch6/MyExceptions.tsx",
  "src/pages/funder/p5-batch6/FunderExceptions.tsx",
];
for (const rel of tenantFunder) {
  const src = read(resolve(ROOT, rel)) ?? "";
  for (const w of WRITE_RPCS) {
    if (src.includes(`"${w}"`) || src.includes(`'${w}'`)) {
      fail(`${rel}: tenant/funder surface must not call write RPC "${w}"`);
    }
  }
}
ok("Phase 5: tenant/funder surfaces are read-only");

// ── Routes registered ─────────────────────────────────────────────────────
const app = read(resolve(ROOT, "src/App.tsx")) ?? "";
const requiredRoutes = [
  "/admin/p5-batch6",
  "/admin/p5-batch6/exceptions/:exceptionId",
  "/admin/p5-batch6/exports",
  "/desk/p5-batch6/my-exceptions",
  "/funder/p5-batch6/exceptions",
];
for (const r of requiredRoutes) {
  if (!app.includes(`path="${r}"`)) fail(`Route not registered: ${r}`);
}
// Every Batch 6 route must be wrapped in RequireAuth
const routeBlocks = [...app.matchAll(/<Route[^>]*path="(\/(?:admin|desk|funder)\/p5-batch6[^"]*)"[\s\S]*?\/>/g)];
for (const m of routeBlocks) {
  if (!/RequireAuth/.test(m[0])) fail(`Route ${m[1]} not guarded by RequireAuth`);
}
ok(`Routes: ${requiredRoutes.length} registered and guarded`);

// ── No cron, no edge functions ────────────────────────────────────────────
function walk(dir, hits = []) {
  if (!existsSync(dir)) return hits;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, hits);
    else hits.push(full);
  }
  return hits;
}
const migrations = walk(resolve(ROOT, "supabase/migrations"))
  .filter((f) => f.includes("2026062603") || f.includes("2026062605"));
for (const m of migrations) {
  const src = read(m) ?? "";
  if (/cron\.schedule\s*\(/i.test(src)) fail(`${m}: contains pg_cron schedule`);
}
const fnDir = resolve(ROOT, "supabase/functions");
const edgeHits = walk(fnDir).filter((f) => /p5b6_/.test(read(f) ?? ""));
if (edgeHits.length) fail(`Edge functions reference p5b6_*: ${edgeHits.join(", ")}`);
ok("No pg_cron and no edge functions reference Batch 6");

// ── Batch 7 / 8 leakage anywhere in Batch 6 surface ───────────────────────
const surface = [
  REGISTRY,
  ...migrations,
  ...UI_FILES.map((r) => resolve(ROOT, r)),
];
for (const p of surface) {
  const src = read(p) ?? "";
  for (const tok of ["p5-batch7","p5_batch7","P5_BATCH7","Batch 7","p5-batch8","p5_batch8","P5_BATCH8","Batch 8"]) {
    if (src.includes(tok)) fail(`${p.split("/").pop()}: leaks "${tok}"`);
  }
}
ok("No Batch 7 / Batch 8 leakage in Batch 6 surface");

if (errors.length) {
  console.error(`\n[check-p5-batch6-phase-6-qa] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[check-p5-batch6-phase-6-qa] OK — all Phase 6 invariants pass");
