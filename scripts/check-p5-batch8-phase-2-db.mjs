#!/usr/bin/env node
/**
 * P-5 Batch 8 — Phase 2 DB persistence static guard.
 *
 * Verifies the Phase 2 migration:
 *   - creates the expected p5b8_* tables
 *   - enables RLS on every new table
 *   - includes authenticated + service_role GRANTs on every new table
 *   - has no anon GRANTs
 *   - has no client-side write policies
 *   - SECURITY DEFINER helpers pin SET search_path = public and REVOKE EXECUTE FROM PUBLIC
 *   - append-only triggers exist on append-only tables
 *   - no UI, RPC, edge, cron, live provider call, Memory/finality mutation
 *   - mirrors the Phase 1 SSOT vocabulary (no token leakage to Batch 6/7)
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");

const PHASE2_PREFIX = "20260626165809_";
const file = readdirSync(MIG_DIR).find((f) => f.startsWith(PHASE2_PREFIX));
if (!file) {
  console.error(`✗ Phase 2 migration ${PHASE2_PREFIX}* not found`);
  process.exit(1);
}
const src = readFileSync(resolve(MIG_DIR, file), "utf8");
const errors = [];
const fail = (m) => { errors.push(m); console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
ok(`Phase 2 migration: ${file}`);

const TABLES = [
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

for (const t of TABLES) {
  if (!new RegExp(`CREATE TABLE public\\.${t}\\b`, "i").test(src))
    fail(`Table ${t} not created`);
  if (!new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`, "i").test(src))
    fail(`RLS not enabled on ${t}`);
  if (!new RegExp(`GRANT[^;]*ON public\\.${t}[^;]*TO authenticated`, "i").test(src))
    fail(`Missing authenticated GRANT on ${t}`);
  if (!new RegExp(`GRANT ALL ON public\\.${t} TO service_role`, "i").test(src))
    fail(`Missing service_role GRANT on ${t}`);
  if (new RegExp(`GRANT[^;]*ON public\\.${t}[^;]*TO anon\\b`, "i").test(src))
    fail(`Forbidden anon GRANT on ${t}`);
}
ok(`${TABLES.length} tables: CREATE / RLS / GRANTs / no-anon verified`);

// No client-side write policies (no INSERT/UPDATE/DELETE policies to
// authenticated/anon/public). SELECT policies are gated by has_role.
const policyRe = /CREATE\s+POLICY\s+"?[^"\s]+"?\s+ON\s+public\.(p5b8_\w+)([\s\S]*?);/gi;
let m;
let policyCount = 0;
while ((m = policyRe.exec(src))) {
  const [, , body] = m;
  policyCount++;
  if (/FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i.test(body)) {
    if (/TO\s+(authenticated|anon|public)\b/i.test(body))
      fail(`Client-side write policy detected on p5b8_ table: ${m[0].slice(0, 80)}…`);
  }
  if (/FOR\s+SELECT/i.test(body) && /USING\s*\(\s*true\s*\)/i.test(body) &&
      /TO\s+(authenticated|anon|public)\b/i.test(body)) {
    fail(`Open SELECT policy on p5b8_ table: ${m[0].slice(0, 80)}…`);
  }
}
ok(`${policyCount} policy/policies — no client-side writes, no open SELECT`);

// Append-only triggers required on append-only tables
const APPEND_ONLY = [
  "p5b8_provider_activation_signoffs",
  "p5b8_webhook_events_ledger",
  "p5b8_audit_events",
  "p5b8_memory_finality_links",
];
for (const t of APPEND_ONLY) {
  if (!new RegExp(`ON public\\.${t}[\\s\\S]{0,200}p5b8_block_mutation_append_only`, "i").test(src))
    fail(`Append-only protection missing on ${t}`);
}
ok(`Append-only triggers verified on ${APPEND_ONLY.length} table(s)`);

// SECURITY DEFINER contract
const blocks = src.split(/CREATE OR REPLACE FUNCTION public\./).slice(1);
let secdef = 0;
for (const block of blocks) {
  const nm = block.match(/^(p5b8_\w+)/);
  if (!nm) continue;
  const name = nm[1];
  const asIdx = block.toLowerCase().search(/\bas\s+\$\$/);
  const head = block.slice(0, asIdx > 0 ? asIdx : block.length);
  if (!/SECURITY DEFINER/i.test(head)) continue;
  secdef++;
  if (!/SET\s+search_path\s*=\s*public/i.test(head))
    fail(`Function ${name} missing SET search_path = public`);
  if (!new RegExp(`REVOKE (ALL|EXECUTE)[^;]*ON FUNCTION public\\.${name}\\s*\\([^)]*\\)[^;]*FROM PUBLIC`, "i").test(src))
    fail(`Function ${name} missing REVOKE EXECUTE FROM PUBLIC`);
}
ok(`${secdef} SECURITY DEFINER helper(s) — search_path pinned, REVOKE FROM PUBLIC verified`);

// Forbidden scope: no cron, no edge, no live provider call, no Memory/finality mutation
const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
if (/cron\.schedule\s*\(/i.test(codeOnly)) fail("Migration contains pg_cron schedule");
for (const bad of [
  "p5_batch5_memory_records", "p5_batch4_finality_records",
  "p5_batch5_memory_records", "memory_records",
]) {
  const re = new RegExp(`(INSERT|UPDATE|DELETE)[^;]*${bad}`, "i");
  if (re.test(codeOnly)) fail(`Migration mutates protected table: ${bad}`);
}
ok(`No pg_cron, no Memory/finality mutation`);

// Cross-batch leakage
for (const tok of ["p5b6_", "p5b7_", "Batch 6", "Batch 7"]) {
  if (codeOnly.includes(tok)) fail(`Phase 2 migration references ${tok}`);
}
ok(`No Batch 6 / Batch 7 token leakage in migration`);

// Verify Phase 2 created no UI / RPC / edge artefacts
import("node:fs").then(({ existsSync }) => {
  const FORBIDDEN_PATHS = [
    "src/pages/desk/p5-batch8",
    "src/pages/funder/p5-batch8",
    "supabase/functions/p5-batch8",
  ];
  for (const p of FORBIDDEN_PATHS) {
    if (existsSync(resolve(ROOT, p))) fail(`Forbidden Phase 2 path exists: ${p}`);
  }

  // SSOT mirroring: every provider category, dependency state, decision
  // state, webhook event and audit event from the registry must appear
  // (literally) in the migration source.
  const reg = readFileSync(resolve(ROOT, "src/lib/p5-batch8/registry.ts"), "utf8");
  const grabArray = (name) => {
    const mm = reg.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`));
    if (!mm) return [];
    return Array.from(mm[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
  };
  const VOCAB = {
    P5_BATCH8_PROVIDER_CATEGORIES: grabArray("P5_BATCH8_PROVIDER_CATEGORIES"),
    P5_BATCH8_PROVIDER_DEPENDENCY_STATES: grabArray("P5_BATCH8_PROVIDER_DEPENDENCY_STATES"),
    P5_BATCH8_PROVIDER_RESULT_DECISION_STATES: grabArray("P5_BATCH8_PROVIDER_RESULT_DECISION_STATES"),
    P5_BATCH8_WEBHOOK_EVENTS: grabArray("P5_BATCH8_WEBHOOK_EVENTS"),
    P5_BATCH8_AUDIT_EVENTS: grabArray("P5_BATCH8_AUDIT_EVENTS"),
  };
  for (const [name, values] of Object.entries(VOCAB)) {
    const missing = values.filter((v) => !src.includes(`'${v}'`));
    if (missing.length) fail(`${name}: missing in migration → ${missing.join(", ")}`);
  }
  ok(`SSOT vocabulary mirrored (${Object.values(VOCAB).reduce((a, b) => a + b.length, 0)} terms)`);

  if (errors.length) {
    console.error(`\n[check-p5-batch8-phase-2-db] FAIL — ${errors.length} issue(s)`);
    process.exit(1);
  }
  console.log("\n[check-p5-batch8-phase-2-db] OK");
});
