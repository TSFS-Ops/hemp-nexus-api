#!/usr/bin/env node
/**
 * P-5 Batch 8 — Phase 4 API-safe read/projection static guard.
 *
 * Verifies the Phase 4 migration:
 *   - declares the expected p5b8_read_* projection functions
 *   - every function is SECURITY DEFINER with pinned SET search_path = public
 *   - every function REVOKEs EXECUTE FROM PUBLIC and GRANTs EXECUTE TO authenticated
 *   - in-body role gating via p5b8_has_reader_role / p5b8_has_admin_reader_role
 *   - never selects forbidden external fields (raw payloads, credentials, internal notes)
 *   - never synthesises "verified/cleared/pass" wording
 *   - no Memory/finality mutation
 *   - no client-side write policies, no new tables, no cron, no UI, no edge functions
 *   - no Batch 6 / Batch 7 leakage
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");

const PHASE4_PREFIX = "20260626171017_";
const file = readdirSync(MIG_DIR).find((f) => f.startsWith(PHASE4_PREFIX));
if (!file) {
  console.error(`✗ Phase 4 migration ${PHASE4_PREFIX}* not found`);
  process.exit(1);
}
const src = readFileSync(resolve(MIG_DIR, file), "utf8");
const errors = [];
const fail = (m) => { errors.push(m); console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
ok(`Phase 4 migration: ${file}`);

const READ_FNS = [
  "p5b8_has_reader_role",
  "p5b8_has_admin_reader_role",
  "p5b8_read_provider_config_summary",
  "p5b8_read_provider_dependency_status_summary",
  "p5b8_read_provider_request_summary",
  "p5b8_read_provider_result_summary",
  "p5b8_read_provider_decision_summary",
  "p5b8_read_webhook_ledger_summary",
  "p5b8_read_audit_timeline_summary",
  "p5b8_read_retry_state_summary",
  "p5b8_read_memory_finality_link_summary",
  "p5b8_read_dashboard_queue_summary",
];
for (const fn of READ_FNS) {
  if (!new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`, "i").test(src))
    fail(`Function ${fn} not created`);
}
ok(`${READ_FNS.length} functions declared`);

// SECURITY DEFINER / search_path / REVOKE / GRANT on every p5b8_* function
const blocks = src.split(/CREATE OR REPLACE FUNCTION public\./).slice(1);
let count = 0;
for (const block of blocks) {
  const nm = block.match(/^(p5b8_\w+)/);
  if (!nm) continue;
  const name = nm[1];
  const asIdx = block.toLowerCase().search(/\bas\s+\$\$/);
  const head = block.slice(0, asIdx > 0 ? asIdx : block.length);
  if (!/SECURITY DEFINER/i.test(head)) fail(`Function ${name} not SECURITY DEFINER`);
  else count++;
  if (!/SET\s+search_path\s*=\s*public/i.test(head))
    fail(`Function ${name} missing SET search_path = public`);
  if (!new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\s*\\([^)]*\\)[^;]*FROM PUBLIC`, "i").test(src))
    fail(`Function ${name} missing REVOKE EXECUTE FROM PUBLIC`);
  if (!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\s*\\([^)]*\\) TO authenticated`, "i").test(src))
    fail(`Function ${name} missing GRANT EXECUTE TO authenticated`);
  // Read-projection bodies must call a reader-role gate
  if (name.startsWith("p5b8_read_")) {
    const body = block.slice(asIdx);
    if (!/p5b8_has_(admin_)?reader_role\s*\(\s*\)/i.test(body))
      fail(`Function ${name} body does not gate on reader-role helper`);
  }
}
ok(`${count} SECURITY DEFINER function(s) — search_path / REVOKE / GRANT / role-gate verified`);

// No forbidden external fields selected from projections
const FORBIDDEN_COLS = [
  "raw_provider_payload_admin_only",
  "raw_webhook_payload_admin_only",
  "provider_api_key",
  "provider_api_secret",
  "webhook_signature_secret",
  "internal_risk_note",
  "internal_reviewer_note",
];
const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
for (const col of FORBIDDEN_COLS) {
  if (codeOnly.includes(col))
    fail(`Phase 4 projection references forbidden column: ${col}`);
}
ok(`No forbidden external columns referenced`);

// No banned wording synthesised in projections
const BANNED_WORDING = [
  "guaranteed clean", "regulator approved", "bank verified", "sanctions cleared",
  "kyc passed", "kyc complete", "provider certified", "provider verified",
  "verified by provider", "verified by bank",
];
const lower = codeOnly.toLowerCase();
for (const w of BANNED_WORDING) {
  if (lower.includes(w)) fail(`Phase 4 contains banned external wording: "${w}"`);
}
ok(`No banned external wording in projections`);

// No Memory/finality mutation
for (const bad of ["p5_batch5_memory_records", "p5_batch4_finality_records"]) {
  if (new RegExp(`(INSERT|UPDATE|DELETE)[^;]*${bad}`, "i").test(codeOnly))
    fail(`Phase 4 mutates protected table: ${bad}`);
}
ok(`No Memory/finality mutation`);

// No new tables, no client-side write policies, no cron
if (/CREATE\s+TABLE\s+/i.test(codeOnly)) fail(`Phase 4 creates a table`);
if (/CREATE\s+POLICY/i.test(codeOnly)) fail(`Phase 4 adds an RLS policy`);
if (/cron\.schedule\s*\(/i.test(codeOnly)) fail(`Phase 4 contains pg_cron schedule`);
for (const tok of ["p5b6_", "p5b7_", "Batch 6", "Batch 7"]) {
  if (codeOnly.includes(tok)) fail(`Phase 4 references ${tok}`);
}
ok(`No new tables, no write policies, no cron, no Batch 6/7 leakage`);

// No UI / edge function created
for (const p of [
  "src/pages/admin/p5-batch8",
  "src/pages/desk/p5-batch8",
  "src/pages/funder/p5-batch8",
  "src/components/p5-batch8",
  "supabase/functions/p5-batch8",
]) {
  if (existsSync(resolve(ROOT, p))) fail(`Forbidden Phase 4 path exists: ${p}`);
}
ok(`No UI / edge function surfaces`);

if (errors.length) {
  console.error(`\n[check-p5-batch8-phase-4-read] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[check-p5-batch8-phase-4-read] OK");
