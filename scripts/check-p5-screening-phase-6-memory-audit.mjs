#!/usr/bin/env node
/**
 * P-5 Screening & IDV Phase 6 guard — Memory/audit rules + final QA aggregate.
 *
 * Verifies:
 *  - Phase 6 migration installs the two banned-payload guard triggers.
 *  - Both guard functions are SECURITY DEFINER with SET search_path = public
 *    and have EXECUTE revoked from PUBLIC.
 *  - Every SSOT Memory-banned payload kind appears in the link-kind guard.
 *  - Every SSOT API-forbidden field appears in the audit-payload key guard.
 *  - Phase 6 introduces NO new tables, NO new RLS policies, NO new RPC writes
 *    to existing tables, NO cron, NO edge functions, NO Batch 6/7/8 tokens.
 *  - All earlier phase artifacts (1–5 scripts/tests/migrations) still exist.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const errs = [];
const fail = (m) => errs.push(m);

// Locate the Phase 6 migration (the latest one after Phase 5).
const migDir = resolve(root, "supabase/migrations");
const phase6 = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql") && f >= "20260626182000")
  .sort()
  .pop();
if (!phase6) fail("Phase 6 migration not found");

const sql = phase6 ? readFileSync(resolve(migDir, phase6), "utf8") : "";

// Required objects.
for (const needle of [
  "FUNCTION public.p5scr_block_banned_memory_link_kind()",
  "FUNCTION public.p5scr_block_banned_audit_payload_keys()",
  "TRIGGER p5scr_memory_link_kind_guard",
  "TRIGGER p5scr_audit_payload_key_guard",
  "ON public.p5scr_memory_finality_links",
  "ON public.p5scr_audit_events",
  "SECURITY DEFINER",
  "SET search_path = public",
  "REVOKE ALL ON FUNCTION public.p5scr_block_banned_memory_link_kind() FROM PUBLIC",
  "REVOKE ALL ON FUNCTION public.p5scr_block_banned_audit_payload_keys() FROM PUBLIC",
]) {
  if (!sql.includes(needle)) fail(`Phase 6 migration missing: ${needle}`);
}

// Banned link kinds — must all appear in the link-kind guard literal.
for (const kind of [
  "raw_provider_payload",
  "id_image",
  "selfie",
  "biometric",
  "unresolved_possible_match",
  "provider_pending_state",
  "raw_adverse_media",
]) {
  if (!sql.includes(`'${kind}'`)) fail(`Phase 6 missing banned link kind: ${kind}`);
}

// Banned audit-payload keys — must all appear in the audit-key guard literal.
for (const key of [
  "raw_provider_payload",
  "provider_api_secret",
  "id_image",
  "selfie",
  "biometric_template",
  "match_score",
  "list_name",
  "raw_adverse_media",
]) {
  if (!sql.includes(`'${key}'`)) fail(`Phase 6 missing banned audit-payload key: ${key}`);
}

// Phase 6 must be additive only — no new tables, no new policies, no cron,
// no edge functions, no Batch 6/7/8 tokens, no Memory/finality writes.
const forbidden = [
  /CREATE\s+TABLE/i,
  /CREATE\s+POLICY/i,
  /cron\./i,
  /supabase_functions\./i,
  /\bp5b6_/i,
  /\bp5b7_/i,
  /\bp5b8_/i,
  /INSERT\s+INTO\s+public\.p5_batch4_finality_records/i,
  /INSERT\s+INTO\s+public\.p5_batch5_memory_records/i,
  /UPDATE\s+public\.p5_batch4_finality_records/i,
  /UPDATE\s+public\.p5_batch5_memory_records/i,
];
for (const re of forbidden) {
  if (re.test(sql)) fail(`Phase 6 migration must not contain: ${re}`);
}

// Final QA aggregate — every earlier phase artifact must still exist.
const required = [
  "src/lib/p5-screening/registry.ts",
  "src/lib/p5-screening/api.ts",
  "src/pages/admin/p5-screening/Workbench.tsx",
  "scripts/check-p5-screening-phase-1-registry.mjs",
  "scripts/check-p5-screening-phase-2-db.mjs",
  "scripts/check-p5-screening-phase-3-rpc.mjs",
  "scripts/check-p5-screening-phase-4-projection.mjs",
  "scripts/check-p5-screening-phase-5-ui.mjs",
  "src/tests/p5-screening-phase-1-registry.test.ts",
  "src/tests/p5-screening-phase-2-db.test.ts",
  "src/tests/p5-screening-phase-3-rpc.test.ts",
  "src/tests/p5-screening-phase-4-projection.test.ts",
  "src/tests/p5-screening-phase-5-ui.test.ts",
  "evidence/p5-screening-idv-provider-ready-flow/README.md",
];
for (const p of required) {
  if (!existsSync(resolve(root, p))) fail(`Missing required artifact: ${p}`);
}

// Final QA aggregate — README must carry every phase marker plus the final
// release marker.
const readme = readFileSync(
  resolve(root, "evidence/p5-screening-idv-provider-ready-flow/README.md"),
  "utf8",
);
for (const marker of [
  "P5_SCREENING_PHASE_1_DEPLOYED",
  "P5_SCREENING_PHASE_2_DEPLOYED",
  "P5_SCREENING_PHASE_3_DEPLOYED",
  "P5_SCREENING_PHASE_4_DEPLOYED",
  "P5_SCREENING_PHASE_5_DEPLOYED",
  "P5_SCREENING_PHASE_6_DEPLOYED",
  "P5_SCREENING_IDV_FINAL_QA_COMPLETE",
]) {
  if (!readme.includes(marker)) fail(`README missing marker: ${marker}`);
}

if (errs.length) {
  console.error("[p5-screening-phase-6-memory-audit] FAILED:");
  for (const e of errs) console.error(" -", e);
  process.exit(1);
}
console.log(
  "[p5-screening-phase-6-memory-audit] OK — Memory/audit guards installed and final QA aggregate satisfied.",
);
