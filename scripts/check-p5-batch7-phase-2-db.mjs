#!/usr/bin/env node
/**
 * P-5 Batch 7 — Phase 2 DB foundations static guard.
 *
 * Greps the Phase 2 migration file for invariants:
 *   - 7 expected p5b7_* tables created
 *   - RLS enabled on every new table
 *   - explicit GRANTs for authenticated + service_role on every new table
 *   - no anon GRANTs
 *   - every SECURITY DEFINER function pins SET search_path = public
 *   - every SECURITY DEFINER function REVOKEs EXECUTE from PUBLIC
 *   - append-only triggers exist on audit tables
 *   - no pg_cron, no Batch 8 tokens
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");

const PHASE2_PREFIX = "20260626111350_";
const file = readdirSync(MIG_DIR).find((f) => f.startsWith(PHASE2_PREFIX));
if (!file) { console.error(`✗ Phase 2 migration ${PHASE2_PREFIX}* not found`); process.exit(1); }
const src = readFileSync(resolve(MIG_DIR, file), "utf8");
const errors = [];
const fail = (m) => { errors.push(m); console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
ok(`Phase 2 migration: ${file}`);

const TABLES = [
  "p5b7_saved_views",
  "p5b7_dashboard_actions_audit",
  "p5b7_export_jobs",
  "p5b7_export_audit",
  "p5b7_api_field_visibility",
  "p5b7_provider_dependencies",
  "p5b7_stale_data_thresholds",
];
for (const t of TABLES) {
  if (!new RegExp(`CREATE TABLE public\\.${t}\\b`, "i").test(src)) fail(`Table ${t} not created`);
  if (!new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`, "i").test(src)) fail(`RLS not enabled on ${t}`);
  if (!new RegExp(`GRANT[^;]*ON public\\.${t}[^;]*TO authenticated`, "i").test(src)) fail(`Missing authenticated GRANT on ${t}`);
  if (!new RegExp(`GRANT ALL ON public\\.${t} TO service_role`, "i").test(src)) fail(`Missing service_role GRANT on ${t}`);
  if (new RegExp(`GRANT[^;]*ON public\\.${t}[^;]*TO anon\\b`, "i").test(src)) fail(`Forbidden anon GRANT on ${t}`);
}
ok(`${TABLES.length} tables: CREATE, RLS, GRANTs, no-anon verified`);

// Append-only triggers
for (const t of ["p5b7_dashboard_actions_audit", "p5b7_export_audit"]) {
  if (!new RegExp(`ON public\\.${t}[\\s\\S]{0,200}p5b7_block_mutation_append_only`, "i").test(src))
    fail(`Append-only protection missing on ${t}`);
}
ok(`Append-only triggers verified on audit tables`);

// SECURITY DEFINER contract
const blocks = src.split(/CREATE OR REPLACE FUNCTION public\./).slice(1);
let secdef = 0;
for (const block of blocks) {
  const m = block.match(/^(p5b7_\w+)/);
  if (!m) continue;
  const name = m[1];
  const head = block.slice(0, Math.max(0, block.toLowerCase().indexOf(" as $$")));
  if (!/SECURITY DEFINER/i.test(head)) continue;
  secdef++;
  if (!/SET\s+search_path\s*=\s*public/i.test(head))
    fail(`Function ${name} missing SET search_path = public`);
  if (!new RegExp(`REVOKE (ALL|EXECUTE)[^;]*ON FUNCTION public\\.${name}\\s*\\([^)]*\\)[^;]*FROM PUBLIC`, "i").test(src))
    fail(`Function ${name} missing REVOKE EXECUTE FROM PUBLIC`);
}
ok(`${secdef} SECURITY DEFINER function(s) — search_path pinned, REVOKE FROM PUBLIC verified`);

// No cron, no Batch 8
if (/cron\.schedule\s*\(/i.test(src)) fail("Migration contains pg_cron schedule");
const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
for (const tok of ["p5-batch8","p5_batch8","P5_BATCH8","Batch 8","p5b8","P5B8"]) {
  if (codeOnly.includes(tok)) fail(`Leaks Batch 8 token "${tok}"`);
}
ok(`No pg_cron, no Batch 8 tokens`);

if (errors.length) {
  console.error(`\n[check-p5-batch7-phase-2-db] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[check-p5-batch7-phase-2-db] OK");
