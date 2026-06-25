#!/usr/bin/env node
/**
 * P-5 Batch 4 — Stage 3 isolation guard (static grep).
 *
 * Stage 3 introduces:
 *   - one additional Batch 4 migration (RPC wrappers + audit helper),
 *   - one edge function `p5-batch4-execution-summary`,
 *   - `src/lib/p5-batch4/rpc.ts` typed client wrappers,
 *   - an SQL proof script under scripts/.
 *
 * Stage 3 must NOT introduce any UI routes, pages, components or
 * App.tsx changes, must NOT mutate Batch 1/2/3 tables, must NOT touch
 * trade/payment/ledger code, and must NOT add additional Batch 4 edge
 * functions beyond the safe-summary one.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const VIOLATIONS = [];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (["node_modules", ".git", "dist"].includes(name)) continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

// ---- 1. Exactly two Batch 4 migrations (Stage 1 + Stage 3) ----
const migDir = join(ROOT, "supabase/migrations");
let stage1 = 0, stage3 = 0;
for (const f of readdirSync(migDir)) {
  if (!f.endsWith(".sql")) continue;
  const body = readFileSync(join(migDir, f), "utf8");
  if (/CREATE TYPE public\.p5_batch4_/.test(body)) stage1++;
  if (/CREATE OR REPLACE FUNCTION public\.p5b4_[a-z_]+_v1\b/.test(body)) stage3++;
}
if (stage1 !== 1) VIOLATIONS.push(`Stage 3 guard: expected 1 Stage 1 migration, got ${stage1}`);
if (stage3 !== 1) VIOLATIONS.push(`Stage 3 guard: expected 1 Stage 3 migration, got ${stage3}`);

// ---- 2. Exactly one Batch 4 edge function ----
const fnDir = join(ROOT, "supabase/functions");
const batch4Fns = existsSync(fnDir)
  ? readdirSync(fnDir).filter((n) => /^p5-?batch-?4/i.test(n))
  : [];
if (batch4Fns.length !== 1 || batch4Fns[0] !== "p5-batch4-execution-summary") {
  VIOLATIONS.push(`Stage 3 guard: expected single edge function p5-batch4-execution-summary, got ${JSON.stringify(batch4Fns)}`);
}

// ---- 3. No Batch 4 UI / routes ----
const FORBIDDEN_UI = [
  "src/pages/admin/p5-batch4",
  "src/pages/funder/p5-batch4",
  "src/pages/desk/p5-batch4",
  "src/pages/registry/p5-batch4",
  "src/components/p5-batch4",
];
for (const rel of FORBIDDEN_UI) {
  if (existsSync(join(ROOT, rel))) {
    VIOLATIONS.push(`Stage 3 guard: forbidden UI surface present: ${rel}`);
  }
}
const appTsx = join(ROOT, "src/App.tsx");
if (existsSync(appTsx) && /p5-batch4/i.test(readFileSync(appTsx, "utf8"))) {
  VIOLATIONS.push("Stage 3 guard: src/App.tsx references p5-batch4 (no routes allowed yet)");
}

// ---- 4. rpc.ts wrappers exist for every declared RPC ----
const rpcPath = join(ROOT, "src/lib/p5-batch4/rpc.ts");
if (!existsSync(rpcPath)) {
  VIOLATIONS.push("Stage 3 guard: src/lib/p5-batch4/rpc.ts missing");
} else {
  const rpcSrc = readFileSync(rpcPath, "utf8");
  for (const name of [
    "p5b4_open_case_v1", "p5b4_confirm_scope_v1", "p5b4_close_case_v1",
    "p5b4_reopen_case_v1", "p5b4_generate_checklist_v1",
    "p5b4_request_evidence_v1", "p5b4_submit_evidence_v1",
    "p5b4_review_evidence_v1", "p5b4_waive_evidence_v1",
    "p5b4_open_blocker_v1", "p5b4_resolve_blocker_v1",
    "p5b4_override_blocker_v1", "p5b4_complete_milestone_v1",
    "p5b4_record_governance_decision_v1", "p5b4_record_compliance_decision_v1",
    "p5b4_release_funder_pack_v1", "p5b4_revoke_funder_access_v1",
    "p5b4_record_funder_decision_v1", "p5b4_record_final_approval_v1",
    "p5b4_record_finality_v1", "p5b4_record_audit_event_v1",
  ]) {
    if (!rpcSrc.includes(`"${name}"`)) {
      VIOLATIONS.push(`Stage 3 guard: rpc.ts missing wrapper name "${name}"`);
    }
  }
}

// ---- 5. rpc.ts must NOT touch Batch 1/2/3 RPCs or trade/payment tables ----
if (existsSync(rpcPath)) {
  const src = readFileSync(rpcPath, "utf8");
  for (const tok of [
    /p5b2_[a-z_]+_v\d+/,
    /p5b3_[a-z_]+_v\d+/,
    /atomic_generate_poi/,
    /atomic_token_burn/,
    /trade_requests/,
    /token_ledger/,
    /token_wallets/,
  ]) {
    if (tok.test(src)) VIOLATIONS.push(`Stage 3 leak: rpc.ts contains forbidden token ${tok}`);
  }
}

// ---- 6. Stage 3 migration must not touch any non-Batch-4 table ----
const stage3Mig = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ f, body: readFileSync(join(migDir, f), "utf8") }))
  .find(({ body }) => /CREATE OR REPLACE FUNCTION public\.p5b4_[a-z_]+_v1/.test(body));
if (stage3Mig) {
  const body = stage3Mig.body;
  // Allow only references to p5_batch4_*, p5b4_*, and standard system functions.
  const forbiddenTablePatterns = [
    /public\.trade_requests/, /public\.token_ledger/, /public\.token_wallets/,
    /public\.matches\b/, /public\.pois\b/, /public\.profiles\b/,
    /public\.p5_batch2_/, /public\.p5_batch3_/, /public\.organizations\b/,
  ];
  for (const re of forbiddenTablePatterns) {
    if (re.test(body)) {
      VIOLATIONS.push(`Stage 3 leak: Stage 3 migration references forbidden table ${re}`);
    }
  }
}

// ---- 7. Edge function must enforce audience filtering ----
const fnIndex = join(ROOT, "supabase/functions/p5-batch4-execution-summary/index.ts");
if (existsSync(fnIndex)) {
  const body = readFileSync(fnIndex, "utf8");
  for (const required of [
    /ADMIN_SAFE_FIELDS/, /FUNDER_SAFE_FIELDS/,
    /invalid_audience/, /platform_admin_required/,
    /case_not_released_to_funder/, /p5b4_current_funder_org/,
  ]) {
    if (!required.test(body)) {
      VIOLATIONS.push(`Stage 3 guard: edge function missing required check ${required}`);
    }
  }
} else {
  VIOLATIONS.push("Stage 3 guard: edge function index.ts missing");
}

if (VIOLATIONS.length > 0) {
  console.error("❌ P5_BATCH_4_STAGE_3_ISOLATION_FAILED");
  for (const v of VIOLATIONS) console.error("  - " + v);
  process.exit(1);
}
console.log("✅ P5_BATCH_4_STAGE_3_ISOLATION_OK");
console.log(`   Batch 4 migrations: ${stage1 + stage3}`);
console.log(`   Batch 4 edge functions: ${batch4Fns.length} (${batch4Fns.join(", ")})`);
