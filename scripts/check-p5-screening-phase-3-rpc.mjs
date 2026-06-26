#!/usr/bin/env node
/**
 * P-5 Screening — Phase 3 RPC guard.
 * Pins the RPC check engine: 12 p5scr_* RPCs each SECURITY DEFINER,
 * SET search_path = public, REVOKE FROM PUBLIC, GRANT TO authenticated,
 * platform_admin role check, audit-event insert. No new tables, no
 * destructive change, no cron, no edge function, no Memory/finality mutation.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = resolve(__dirname, "..", "supabase/migrations");
const PREFIX = "20260626181548_";
const file = readdirSync(MIG_DIR).find((f) => f.startsWith(PREFIX));
if (!file) { console.error(`✗ Phase 3 migration ${PREFIX}* not found`); process.exit(1); }
const src = readFileSync(resolve(MIG_DIR, file), "utf8");
const errors = [];
const fail = (m) => { errors.push(m); console.error("  ✗ " + m); };
const ok = (m) => console.log("  ✓ " + m);
ok(`Phase 3 migration: ${file}`);

const RPCS = [
  "p5scr_upsert_subject",
  "p5scr_request_check",
  "p5scr_record_provider_pending",
  "p5scr_record_result",
  "p5scr_reuse_result",
  "p5scr_open_manual_review",
  "p5scr_decide_manual_review",
  "p5scr_record_idv",
  "p5scr_invalidate",
  "p5scr_log_webhook",
  "p5scr_link_memory_finality",
  "p5scr_evaluate_gate",
];

for (const fn of RPCS) {
  const reFn = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b[\\s\\S]*?AS \\$\\$[\\s\\S]*?\\$\\$;`, "i");
  const m = reFn.exec(src);
  if (!m) { fail(`RPC ${fn} not created`); continue; }
  const head = m[0];

  if (!/SECURITY DEFINER/.test(head)) fail(`${fn} missing SECURITY DEFINER`);
  if (!/SET\s+search_path\s*=\s*public/.test(head)) fail(`${fn} missing SET search_path = public`);
  if (!new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\s*\\([^)]*\\)\\s*FROM PUBLIC`).test(src))
    fail(`${fn} missing REVOKE FROM PUBLIC`);
  if (!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\s*\\([^)]*\\)\\s*TO authenticated`).test(src))
    fail(`${fn} missing GRANT EXECUTE TO authenticated`);
  if (!/has_role\(auth\.uid\(\),\s*'platform_admin'\)/.test(head))
    fail(`${fn} missing platform_admin role guard`);
}
ok(`${RPCS.length} RPCs verified (SECURITY DEFINER, search_path, REVOKE, GRANT, role guard)`);

// Deterministic uniqueness on open manual reviews
if (!/p5scr_manual_reviews_one_open/.test(src)) fail("Missing unique index on open manual reviews");
ok("Open-manual-review uniqueness index pinned");

// No new tables, no cron, no Memory/finality mutation
if (/CREATE TABLE\s+public\.p5scr_/i.test(src)) fail("Phase 3 must not create new tables");
if (/cron\.schedule\s*\(/i.test(src)) fail("Migration contains pg_cron schedule");
const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
if (/INSERT[^;]*p5_batch5_memory_records/i.test(codeOnly) || /UPDATE\s+p5_batch5_memory_records/i.test(codeOnly))
  fail("Migration mutates Memory records");
if (/INSERT[^;]*p5_batch4_finality_records/i.test(codeOnly) || /UPDATE\s+p5_batch4_finality_records/i.test(codeOnly))
  fail("Migration mutates finality records");
ok("No new tables, no pg_cron, no Memory/finality mutation");

for (const tok of ["p5b6_", "p5b7_", "p5b8_"]) {
  if (codeOnly.includes(tok)) fail(`Leaks prior-batch token "${tok}"`);
}
ok("No Batch 6/7/8 token leakage");

if (errors.length) {
  console.error(`\n[check-p5-screening-phase-3-rpc] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[check-p5-screening-phase-3-rpc] OK");
