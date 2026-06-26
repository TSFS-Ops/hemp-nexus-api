#!/usr/bin/env node
/**
 * P-5 Screening — Phase 2 DB spine guard.
 * Pins the canonical screening spine: 9 p5scr_* tables, RLS, GRANTs,
 * append-only triggers on result/audit/webhook/invalidation/link tables,
 * live-now sign-off CHECK, no anon GRANTs, no pg_cron, no Memory/finality
 * mutation.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = resolve(__dirname, "..", "supabase/migrations");
const PREFIX = "20260626181220_";
const file = readdirSync(MIG_DIR).find((f) => f.startsWith(PREFIX));
if (!file) {
  console.error(`✗ Phase 2 migration ${PREFIX}* not found`);
  process.exit(1);
}
const src = readFileSync(resolve(MIG_DIR, file), "utf8");
const errors = [];
const fail = (m) => { errors.push(m); console.error("  ✗ " + m); };
const ok = (m) => console.log("  ✓ " + m);
ok(`Phase 2 migration: ${file}`);

const TABLES = [
  "p5scr_subjects",
  "p5scr_check_state",
  "p5scr_check_results",
  "p5scr_manual_reviews",
  "p5scr_idv_records",
  "p5scr_invalidations",
  "p5scr_audit_events",
  "p5scr_webhook_events_ledger",
  "p5scr_memory_finality_links",
];
const APPEND_ONLY = [
  "p5scr_check_results",
  "p5scr_idv_records",
  "p5scr_invalidations",
  "p5scr_audit_events",
  "p5scr_webhook_events_ledger",
  "p5scr_memory_finality_links",
];

for (const t of TABLES) {
  if (!new RegExp(`CREATE TABLE public\\.${t}\\b`).test(src)) fail(`Table ${t} not created`);
  if (!new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(src)) fail(`RLS not enabled on ${t}`);
  if (!new RegExp(`GRANT[^;]*ON public\\.${t}[^;]*TO authenticated`).test(src)) fail(`Missing authenticated GRANT on ${t}`);
  if (!new RegExp(`GRANT ALL ON public\\.${t} TO service_role`).test(src)) fail(`Missing service_role GRANT on ${t}`);
  if (new RegExp(`GRANT[^;]*ON public\\.${t}[^;]*TO anon\\b`).test(src)) fail(`Forbidden anon GRANT on ${t}`);
}
ok(`${TABLES.length} tables: CREATE, RLS, GRANTs, no-anon verified`);

for (const t of APPEND_ONLY) {
  if (!new RegExp(`ON public\\.${t}[\\s\\S]{0,200}p5scr_block_mutation_append_only`).test(src))
    fail(`Append-only protection missing on ${t}`);
}
ok(`${APPEND_ONLY.length} append-only tables protected`);

if (!/p5scr_cr_live_requires_signoff/.test(src)) fail("Missing live-now sign-off CHECK on p5scr_check_results");
if (!/p5scr_idv_live_requires_signoff/.test(src)) fail("Missing live-now sign-off CHECK on p5scr_idv_records");
ok("Live-now sign-off CHECK pinned");

// SECURITY DEFINER contract on the trigger function
if (!/CREATE OR REPLACE FUNCTION public\.p5scr_block_mutation_append_only[\s\S]*?SECURITY DEFINER[\s\S]*?SET\s+search_path\s*=\s*public/i.test(src))
  fail("p5scr_block_mutation_append_only missing SECURITY DEFINER + search_path");
if (!/REVOKE ALL ON FUNCTION public\.p5scr_block_mutation_append_only\(\) FROM PUBLIC/.test(src))
  fail("p5scr_block_mutation_append_only missing REVOKE FROM PUBLIC");
ok("Trigger function: SECURITY DEFINER, search_path pinned, REVOKE FROM PUBLIC");

if (/cron\.schedule\s*\(/i.test(src)) fail("Migration contains pg_cron schedule");
const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
if (/INSERT[^;]*p5_batch5_memory_records/i.test(codeOnly) || /UPDATE\s+p5_batch5_memory_records/i.test(codeOnly))
  fail("Migration mutates Memory records");
if (/INSERT[^;]*p5_batch4_finality_records/i.test(codeOnly) || /UPDATE\s+p5_batch4_finality_records/i.test(codeOnly))
  fail("Migration mutates finality records");
ok("No pg_cron, no Memory/finality mutation");

for (const tok of ["p5b6_", "p5b7_", "p5b8_"]) {
  if (codeOnly.includes(tok)) fail(`Leaks prior-batch token "${tok}"`);
}
ok("No Batch 6/7/8 token leakage");

if (errors.length) {
  console.error(`\n[check-p5-screening-phase-2-db] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[check-p5-screening-phase-2-db] OK");
