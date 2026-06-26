#!/usr/bin/env node
/**
 * P-5 Batch 8 — Phase 6 cross-phase QA guard.
 *
 * Final consistency/security/wording audit across Phases 1-5. Adds NO new
 * features; only verifies the existing surface.
 *
 * Invariants checked:
 *   - Phase 1 SSOT vocabulary counts are stable.
 *   - Every Phase 1 vocabulary value (categories, dependency states,
 *     decision states, webhook events, audit events) is mirrored as a
 *     literal CHECK constraint value in the Phase 2 migration.
 *   - Phase 2 still creates the 10 p5b8_* tables, enables RLS on each,
 *     and append-only tables still have a block-mutation trigger.
 *   - Phase 3 declares the expected 10 RPC write functions plus the role
 *     assert helper; every p5b8_ function is SECURITY DEFINER with pinned
 *     search_path and REVOKEs PUBLIC + GRANTs authenticated.
 *   - Phase 4 declares the expected 10 read projections plus 2 reader-role
 *     helpers; same SECURITY DEFINER hardening.
 *   - Phase 4 live-vs-fallback distinction preserved (dependency status
 *     returned verbatim; no synthesised "verified" flag).
 *   - Phase 3 enforces that live_now can only be set by activation sign-off
 *     with evidence, and live-environment requests blocked until activation.
 *   - Phase 3 records provider results into `raw_provider_payload_admin_only`
 *     and webhook payloads into `raw_webhook_payload_admin_only` — never
 *     into a publicly-projected column.
 *   - No phase mutates `p5_batch5_memory_records` or `p5_batch4_finality_records`.
 *   - UI never reads p5b8_* tables directly and never calls supabase.rpc
 *     outside the api wrapper.
 *   - API wrapper only calls allowlisted Phase 3/4 functions.
 *   - "Provider-ready is not provider-verified" disclaimer present in UI shell.
 *   - /admin/p5-batch8 route registered with RequireAuth platform_admin.
 *   - No Phase 1 forbidden external fields or banned wording appear in
 *     any Batch 8 source/migration outside the SSOT and the test/guard files.
 *   - No Batch 6 / Batch 7 token leakage in any Batch 8 surface.
 *   - No edge functions, no pg_cron schedules, no payment-provider changes
 *     introduced by Batch 8.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const errors = [];
const fail = (m) => { errors.push(m); console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

// ── Migration file map ────────────────────────────────────────────────────
const MIG = (prefix) => {
  const file = readdirSync(resolve(ROOT, "supabase/migrations"))
    .find((f) => f.startsWith(prefix));
  if (!file) {
    fail(`Migration not found: ${prefix}*`);
    return { file: null, src: "" };
  }
  return { file, src: readFileSync(resolve(ROOT, "supabase/migrations", file), "utf8") };
};
const P2 = MIG("20260626165809_");
const P3 = MIG("20260626170432_");
const P4 = MIG("20260626171017_");
ok(`Phase 2 migration: ${P2.file}`);
ok(`Phase 3 migration: ${P3.file}`);
ok(`Phase 4 migration: ${P4.file}`);

// ── Phase 1 SSOT load ─────────────────────────────────────────────────────
const SSOT_PATH = "src/lib/p5-batch8/registry.ts";
const SSOT = readFileSync(resolve(ROOT, SSOT_PATH), "utf8");
function grabArray(name) {
  const m = SSOT.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`));
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}
const CATEGORIES        = grabArray("P5_BATCH8_PROVIDER_CATEGORIES");
const DEPENDENCY_STATES = grabArray("P5_BATCH8_PROVIDER_DEPENDENCY_STATES");
const DECISION_STATES   = grabArray("P5_BATCH8_PROVIDER_RESULT_DECISION_STATES");
const WEBHOOK_EVENTS    = grabArray("P5_BATCH8_WEBHOOK_EVENTS");
const AUDIT_EVENTS      = grabArray("P5_BATCH8_AUDIT_EVENTS");
const ALLOWED_WORDING   = grabArray("P5_BATCH8_ALLOWED_EXTERNAL_WORDING");
const BANNED_WORDING    = grabArray("P5_BATCH8_BANNED_EXTERNAL_WORDING");
const API_SAFE_FIELDS   = grabArray("P5_BATCH8_API_SAFE_FIELDS");
const FORBIDDEN_FIELDS  = grabArray("P5_BATCH8_FORBIDDEN_EXTERNAL_FIELDS");
const OWNER_ROLES       = grabArray("P5_BATCH8_OWNER_ROLES");
const HIDDEN_UNTIL_LIVE = grabArray("P5_BATCH8_HIDDEN_UNTIL_LIVE");

const expectedCounts = {
  categories: 9,
  dependency_states: 10,
  decision_states: 10,
  webhook_events: 17,
  audit_events: 30,
  allowed_wording: 16,
  banned_wording: 20,
  api_safe_fields: 17,
  forbidden_fields: 24,
  owner_roles: 18,
  hidden_until_live: 14,
};
const actual = {
  categories: CATEGORIES.length,
  dependency_states: DEPENDENCY_STATES.length,
  decision_states: DECISION_STATES.length,
  webhook_events: WEBHOOK_EVENTS.length,
  audit_events: AUDIT_EVENTS.length,
  allowed_wording: ALLOWED_WORDING.length,
  banned_wording: BANNED_WORDING.length,
  api_safe_fields: API_SAFE_FIELDS.length,
  forbidden_fields: FORBIDDEN_FIELDS.length,
  owner_roles: OWNER_ROLES.length,
  hidden_until_live: HIDDEN_UNTIL_LIVE.length,
};
for (const [k, v] of Object.entries(expectedCounts)) {
  if (actual[k] !== v) fail(`SSOT vocabulary count drift on ${k}: expected ${v}, got ${actual[k]}`);
}
ok(`SSOT vocabulary counts stable (${JSON.stringify(actual)})`);

// ── Phase 1 vocabulary mirrored in Phase 2 CHECK constraints ─────────────
for (const v of CATEGORIES)        if (!P2.src.includes(`'${v}'`)) fail(`Phase 2 missing category literal: ${v}`);
for (const v of DEPENDENCY_STATES) if (!P2.src.includes(`'${v}'`)) fail(`Phase 2 missing dependency state literal: ${v}`);
for (const v of DECISION_STATES)   if (!P2.src.includes(`'${v}'`)) fail(`Phase 2 missing decision state literal: ${v}`);
for (const v of WEBHOOK_EVENTS)    if (!P2.src.includes(`'${v}'`)) fail(`Phase 2 missing webhook event literal: ${v}`);
for (const v of AUDIT_EVENTS)      if (!P2.src.includes(`'${v}'`)) fail(`Phase 2 missing audit event literal: ${v}`);
ok(`Every Phase 1 SSOT vocabulary value mirrored in Phase 2 CHECK constraints`);

// ── Phase 2 tables / RLS / append-only triggers ──────────────────────────
const P2_TABLES = [
  "p5b8_provider_configs",
  "p5b8_provider_activation_signoffs",
  "p5b8_provider_dependency_status",
  "p5b8_provider_requests",
  "p5b8_provider_results",
  "p5b8_provider_decisions",
  "p5b8_webhook_events_ledger",
  "p5b8_audit_events",
  "p5b8_provider_retry_state",
  "p5b8_memory_finality_links",
];
for (const t of P2_TABLES) {
  if (!new RegExp(`CREATE TABLE (IF NOT EXISTS )?public\\.${t}\\b`, "i").test(P2.src))
    fail(`Phase 2 missing CREATE TABLE public.${t}`);
  if (!new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`, "i").test(P2.src))
    fail(`Phase 2 missing RLS enable on ${t}`);
}
ok(`Phase 2 creates all 10 p5b8_ tables with RLS enabled`);

const APPEND_ONLY = [
  "p5b8_provider_activation_signoffs",
  "p5b8_webhook_events_ledger",
  "p5b8_audit_events",
  "p5b8_memory_finality_links",
];
for (const t of APPEND_ONLY) {
  if (!new RegExp(`CREATE TRIGGER [\\w_]+\\s+BEFORE\\s+(UPDATE|DELETE)[\\s\\S]{0,200}ON public\\.${t}[\\s\\S]{0,200}p5b8_block_mutation_append_only`, "i").test(P2.src))
    fail(`Append-only table ${t} missing block-mutation trigger`);
}
ok(`All 4 append-only tables retain block-mutation trigger`);

// ── Phase 3 RPCs declared & hardened ─────────────────────────────────────
const P3_FNS = [
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
for (const f of P3_FNS) {
  if (!new RegExp(`CREATE OR REPLACE FUNCTION public\\.${f}\\b`, "i").test(P3.src))
    fail(`Phase 3 missing function: ${f}`);
}
ok(`Phase 3 declares all 11 RPC functions`);

// ── Phase 4 read projections declared & hardened ─────────────────────────
const P4_FNS = [
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
for (const f of P4_FNS) {
  if (!new RegExp(`CREATE OR REPLACE FUNCTION public\\.${f}\\b`, "i").test(P4.src))
    fail(`Phase 4 missing function: ${f}`);
}
ok(`Phase 4 declares all 12 read projection / helper functions`);

// SECURITY DEFINER + REVOKE + GRANT hardening across Phase 3 + 4
function auditFnHardening(label, src) {
  const blocks = src.split(/CREATE OR REPLACE FUNCTION public\./).slice(1);
  for (const block of blocks) {
    const nm = block.match(/^(p5b8_\w+)/);
    if (!nm) continue;
    const name = nm[1];
    const head = block.slice(0, block.toLowerCase().search(/\bas\s+\$\$/));
    if (!/SECURITY DEFINER/i.test(head))
      fail(`${label}: ${name} not SECURITY DEFINER`);
    if (!/SET\s+search_path\s*=\s*public/i.test(head))
      fail(`${label}: ${name} missing SET search_path = public`);
    if (!new RegExp(`REVOKE (ALL|EXECUTE)[^;]*ON FUNCTION public\\.${name}\\s*\\([^)]*\\)[^;]*FROM PUBLIC`, "i").test(src))
      fail(`${label}: ${name} missing REVOKE FROM PUBLIC`);
    if (!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\s*\\([^)]*\\) TO authenticated`, "i").test(src))
      fail(`${label}: ${name} missing GRANT EXECUTE TO authenticated`);
  }
}
auditFnHardening("Phase 3", P3.src);
auditFnHardening("Phase 4", P4.src);
ok(`SECURITY DEFINER / search_path / REVOKE / GRANT verified on all Phase 3+4 functions`);

// ── Provider-ready vs provider-verified safety ───────────────────────────
// Phase 2 must enforce live_now requires activation sign-off.
if (!/p5b8_pc_live_requires_signoff/i.test(P2.src))
  fail(`Phase 2 missing live_now/activation sign-off CHECK constraint`);
ok(`Phase 2 enforces live_now requires activation sign-off`);

// Phase 3 upsert config must NOT set live_now = true.
const upsertBlock = (() => {
  const idx = P3.src.indexOf("p5b8_rpc_upsert_provider_config");
  if (idx < 0) return "";
  const end = P3.src.indexOf("$$", idx);
  return P3.src.slice(idx, end + 2);
})();
if (/live_now\s*=\s*true/i.test(upsertBlock))
  fail(`upsert_provider_config sets live_now = true (must only sign-off can)`);
ok(`upsert_provider_config never sets live_now = true`);

// Phase 3 sign-off must require non-empty evidence reference.
const signoffBlock = (() => {
  const idx = P3.src.indexOf("p5b8_rpc_record_activation_signoff");
  if (idx < 0) return "";
  const end = P3.src.indexOf("$$", P3.src.indexOf("$$", idx) + 2);
  return P3.src.slice(idx, end + 2);
})();
if (!/evidence/i.test(signoffBlock) || !/RAISE/i.test(signoffBlock))
  fail(`record_activation_signoff missing evidence validation`);
ok(`record_activation_signoff validates evidence reference`);

// Phase 3 live-environment requests must be blocked until activation.
if (!/live_check\.blocked_attempt/i.test(P3.src))
  fail(`Phase 3 missing live_check.blocked_attempt audit event emission`);
ok(`Phase 3 emits live_check.blocked_attempt when live environment requested without activation`);

// Phase 4 must alias raw state verbatim — not synthesise a "verified" boolean.
if (!/s\.state\s+AS\s+provider_dependency_status/i.test(P4.src))
  fail(`Phase 4 dependency projection does not alias raw state verbatim`);
if (!/d\.decision_state\s+AS\s+provider_decision_state/i.test(P4.src))
  fail(`Phase 4 decision projection does not alias raw decision verbatim`);
ok(`Phase 4 returns dependency/decision states verbatim (no synthesised verified flag)`);

// ── Raw payloads remain admin-only / never projected ─────────────────────
if (!/raw_provider_payload_admin_only/i.test(P2.src))
  fail(`Phase 2 missing raw_provider_payload_admin_only column`);
if (!/raw_webhook_payload_admin_only/i.test(P2.src))
  fail(`Phase 2 missing raw_webhook_payload_admin_only column`);
if (/raw_provider_payload_admin_only|raw_webhook_payload_admin_only|provider_api_secret|webhook_signature_secret|internal_risk_note|internal_reviewer_note/i.test(P4.src))
  fail(`Phase 4 projections expose a forbidden raw/admin-only column`);
ok(`Raw provider/webhook payloads remain admin-only; not projected publicly`);

// Phase 3 record_provider_result/webhook must route raw payload to admin-only column.
if (!/raw_provider_payload_admin_only/i.test(P3.src))
  fail(`Phase 3 does not route raw provider payload to admin-only column`);
if (!/raw_webhook_payload_admin_only/i.test(P3.src))
  fail(`Phase 3 does not route raw webhook payload to admin-only column`);
ok(`Phase 3 routes raw payloads to admin-only columns`);

// ── No Memory/finality mutation across Phase 2/3/4 ───────────────────────
function noMutation(label, src) {
  const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  for (const bad of ["p5_batch5_memory_records", "p5_batch4_finality_records"]) {
    if (new RegExp(`(INSERT|UPDATE|DELETE)[^;]*${bad}`, "i").test(codeOnly))
      fail(`${label} mutates protected table: ${bad}`);
  }
}
noMutation("Phase 2", P2.src);
noMutation("Phase 3", P3.src);
noMutation("Phase 4", P4.src);
ok(`No Memory/finality mutation in any Batch 8 migration`);

// ── UI never bypasses the api wrapper ────────────────────────────────────
function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const UI_FILES = [
  ...walk(resolve(ROOT, "src/pages/admin/p5-batch8")),
  ...walk(resolve(ROOT, "src/components/p5-batch8")),
];
for (const f of UI_FILES) {
  const body = readFileSync(f, "utf8");
  const rel = f.slice(ROOT.length + 1);
  if (/supabase\s*\.\s*from\s*\(\s*['"`]p5b8_/.test(body))
    fail(`UI directly reads p5b8_ table: ${rel}`);
  if (/supabase\s*\.\s*rpc\s*\(/.test(body))
    fail(`UI calls supabase.rpc() directly: ${rel}`);
}
ok(`UI files (${UI_FILES.length}) do not bypass the api wrapper`);

// API wrapper allowlist
const API_SRC = readFileSync(resolve(ROOT, "src/lib/p5-batch8/api.ts"), "utf8");
const ALLOWED_RPCS = new Set([
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
  "p5b8_rpc_record_activation_signoff",
  "p5b8_rpc_set_dependency_status",
]);
const called = new Set([...API_SRC.matchAll(/["'](p5b8_(?:read|rpc)_[a-z0-9_]+)["']/gi)].map((m) => m[1]));
for (const n of called) {
  if (!ALLOWED_RPCS.has(n)) fail(`API wrapper calls non-allowlisted function: ${n}`);
}
for (const n of ALLOWED_RPCS) {
  if (!called.has(n)) fail(`API wrapper missing allowlisted function: ${n}`);
}
if (/supabase\s*\.\s*from\s*\(\s*['"`]p5b8_/.test(API_SRC))
  fail(`API wrapper performs direct p5b8_ table read`);
ok(`API wrapper calls exactly the 12 allowlisted functions, no direct table reads`);

// ── Disclaimer + route ────────────────────────────────────────────────────
const SHELL = readFileSync(resolve(ROOT, "src/components/p5-batch8/WorkbenchShell.tsx"), "utf8");
if (!/Provider-ready is not provider-verified/i.test(SHELL))
  fail(`Mandatory "Provider-ready is not provider-verified" disclaimer missing`);
ok(`"Provider-ready is not provider-verified" disclaimer present`);

const APP = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");
if (!/path="\/admin\/p5-batch8"[\s\S]{0,400}RequireAuth\s+role="platform_admin"/.test(APP))
  fail(`/admin/p5-batch8 route not registered under RequireAuth platform_admin`);
if (!/P5Batch8Workbench/.test(APP))
  fail(`P5Batch8Workbench import missing from App.tsx`);
ok(`/admin/p5-batch8 route registered under RequireAuth role="platform_admin"`);

// ── Forbidden fields + banned wording across all Batch 8 source ──────────
const SCAN_TARGETS = [
  ...walk(resolve(ROOT, "src/lib/p5-batch8")),
  ...walk(resolve(ROOT, "src/components/p5-batch8")),
  ...walk(resolve(ROOT, "src/pages/admin/p5-batch8")),
];
const SSOT_ABS = resolve(ROOT, SSOT_PATH);
for (const f of SCAN_TARGETS) {
  if (f === SSOT_ABS) continue;
  const rel = f.slice(ROOT.length + 1);
  const body = readFileSync(f, "utf8").toLowerCase();
  for (const field of FORBIDDEN_FIELDS) {
    if (body.includes(field.toLowerCase()))
      fail(`Forbidden external field "${field}" appears in ${rel}`);
  }
  for (const word of BANNED_WORDING) {
    if (body.includes(word.toLowerCase()))
      fail(`Banned external wording "${word}" appears in ${rel}`);
  }
}
// Phase 4 migration must also stay clean of banned wording / forbidden fields.
const P4_LOWER = P4.src.toLowerCase();
for (const w of BANNED_WORDING) {
  if (P4_LOWER.includes(w.toLowerCase()))
    fail(`Banned wording "${w}" appears in Phase 4 migration`);
}
for (const f of FORBIDDEN_FIELDS) {
  // The Phase 4 migration explicitly excludes these — its source must not reference them by name.
  if (P4_LOWER.includes(f.toLowerCase()))
    fail(`Forbidden field "${f}" referenced in Phase 4 migration`);
}
ok(`No forbidden fields or banned wording in any Batch 8 source outside the SSOT`);

// ── No Batch 6 / Batch 7 leakage ─────────────────────────────────────────
const LEAK_TARGETS = SCAN_TARGETS.concat([P2.file, P3.file, P4.file].map((f) => resolve(ROOT, "supabase/migrations", f)));
for (const f of LEAK_TARGETS) {
  const body = readFileSync(f, "utf8");
  const rel = f.slice(ROOT.length + 1);
  for (const tok of ["p5b6_", "p5b7_"]) {
    if (body.includes(tok)) fail(`Batch 6/7 token "${tok}" leaked into ${rel}`);
  }
}
ok(`No Batch 6 / Batch 7 token leakage across Batch 8 surfaces`);

// ── No edge functions / no cron introduced by Batch 8 ────────────────────
if (existsSync(resolve(ROOT, "supabase/functions/p5-batch8")))
  fail(`Forbidden Batch 8 edge function directory exists`);
for (const f of [P2.file, P3.file, P4.file]) {
  const src = readFileSync(resolve(ROOT, "supabase/migrations", f), "utf8");
  if (/cron\.schedule\s*\(/i.test(src)) fail(`Batch 8 migration contains pg_cron schedule: ${f}`);
}
ok(`No edge functions, no pg_cron schedules introduced by Batch 8`);

// ── Desk / funder Batch 8 surfaces forbidden in this batch ───────────────
for (const p of ["src/pages/desk/p5-batch8", "src/pages/funder/p5-batch8"]) {
  if (existsSync(resolve(ROOT, p))) fail(`Forbidden tenant surface exists: ${p}`);
}
ok(`No tenant/funder Batch 8 surfaces`);

if (errors.length) {
  console.error(`\n[p5-batch8 phase-6 qa] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[p5-batch8 phase-6 qa] OK — all Phase 6 cross-phase invariants pass");
