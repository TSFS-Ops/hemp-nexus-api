#!/usr/bin/env node
/**
 * P-5 Batch 8 — Phase 3 RPC write-path static guard.
 *
 * Verifies the Phase 3 migration:
 *   - declares the expected p5b8_rpc_* functions
 *   - every function is SECURITY DEFINER with pinned SET search_path = public
 *   - every function REVOKEs EXECUTE FROM PUBLIC and GRANTs EXECUTE TO authenticated
 *   - in-body role check via p5b8_assert_writer_role
 *   - no Memory/finality mutation (INSERT/UPDATE/DELETE)
 *   - no client-side write policies added
 *   - no UI, no edge function, no cron, no Batch 6/7 token leakage
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");

const PHASE3_PREFIX = "20260626170432_";
const file = readdirSync(MIG_DIR).find((f) => f.startsWith(PHASE3_PREFIX));
if (!file) { console.error(`✗ Phase 3 migration ${PHASE3_PREFIX}* not found`); process.exit(1); }
const src = readFileSync(resolve(MIG_DIR, file), "utf8");
const errors = [];
const fail = (m) => { errors.push(m); console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
ok(`Phase 3 migration: ${file}`);

const RPCS = [
  "p5b8_assert_writer_role",
  "p5b8_rpc_upsert_provider_config",
  "p5b8_rpc_record_activation_signoff",
  "p5b8_rpc_set_dependency_status",
  "p5b8_rpc_create_provider_request",
  "p5b8_rpc_record_provider_result",
  "p5b8_rpc_record_provider_decision",
  "p5b8_rpc_record_webhook_event",
  "p5b8_rpc_append_audit_event",
  "p5b8_rpc_record_retry_state",
  "p5b8_rpc_create_memory_finality_link",
];
for (const fn of RPCS) {
  if (!new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`, "i").test(src))
    fail(`Function ${fn} not created`);
}
ok(`${RPCS.length} functions declared`);

// SECURITY DEFINER contract on every p5b8_* function
const blocks = src.split(/CREATE OR REPLACE FUNCTION public\./).slice(1);
let secdef = 0;
for (const block of blocks) {
  const nm = block.match(/^(p5b8_\w+)/);
  if (!nm) continue;
  const name = nm[1];
  const asIdx = block.toLowerCase().search(/\bas\s+\$\$/);
  const head = block.slice(0, asIdx > 0 ? asIdx : block.length);
  if (!/SECURITY DEFINER/i.test(head)) fail(`Function ${name} not SECURITY DEFINER`);
  else secdef++;
  if (!/SET\s+search_path\s*=\s*public/i.test(head))
    fail(`Function ${name} missing SET search_path = public`);
  if (!new RegExp(`REVOKE (ALL|EXECUTE)[^;]*ON FUNCTION public\\.${name}\\s*\\([^)]*\\)[^;]*FROM PUBLIC`, "i").test(src))
    fail(`Function ${name} missing REVOKE EXECUTE FROM PUBLIC`);
  if (!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\s*\\([^)]*\\) TO authenticated`, "i").test(src))
    fail(`Function ${name} missing GRANT EXECUTE TO authenticated`);
  // RPC bodies (skip assert helper itself) must call the role check
  if (name.startsWith("p5b8_rpc_")) {
    const body = block.slice(asIdx);
    if (!/PERFORM\s+public\.p5b8_assert_writer_role\s*\(\s*\)/i.test(body))
      fail(`Function ${name} body does not call p5b8_assert_writer_role()`);
  }
}
ok(`${secdef} SECURITY DEFINER function(s) — search_path / REVOKE / GRANT / role-check verified`);

// No Memory/finality mutation
const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
for (const bad of ["p5_batch5_memory_records", "p5_batch4_finality_records", "memory_records"]) {
  if (new RegExp(`(INSERT|UPDATE|DELETE)[^;]*${bad}`, "i").test(codeOnly))
    fail(`Phase 3 mutates protected table: ${bad}`);
}
ok(`No Memory/finality mutation`);

// No client-side write policies, no cron, no Batch 6/7 leakage
if (/CREATE\s+POLICY[\s\S]*?FOR\s+(INSERT|UPDATE|DELETE|ALL)/i.test(codeOnly))
  fail(`Phase 3 adds a client-side write policy`);
if (/cron\.schedule\s*\(/i.test(codeOnly)) fail(`Phase 3 contains pg_cron schedule`);
for (const tok of ["p5b6_", "p5b7_", "Batch 6", "Batch 7"]) {
  if (codeOnly.includes(tok)) fail(`Phase 3 references ${tok}`);
}
ok(`No client-side write policies, no cron, no Batch 6/7 leakage`);

// No UI / edge function created
for (const p of [
  "src/pages/desk/p5-batch8",
  "src/pages/funder/p5-batch8",
  "supabase/functions/p5-batch8",
]) {
  if (existsSync(resolve(ROOT, p))) fail(`Forbidden Phase 3 path exists: ${p}`);
}
ok(`No UI / edge function surfaces`);

if (errors.length) {
  console.error(`\n[check-p5-batch8-phase-3-rpc] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[check-p5-batch8-phase-3-rpc] OK");
