#!/usr/bin/env node
/**
 * P-5 Batch 7 — Phase 5 guard.
 *
 * Verifies:
 *   1. The Phase 5 actions wrapper exists and is the only Batch 7
 *      module allowed to call `supabase.rpc('p5b7_*')`.
 *   2. The actions wrapper exposes every required action.
 *   3. Approved RPC names are well-formed and prefixed `p5b7_`.
 *   4. No finality / memory / waiver mutations are wired here.
 *   5. No Batch 8 tokens leak in.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const errors = [];
const fail = (m) => errors.push(m);

const ACTIONS_PATH = "src/lib/p5-batch7/actions.ts";
if (!existsSync(ACTIONS_PATH)) fail(`missing ${ACTIONS_PATH}`);
const actionsSrc = existsSync(ACTIONS_PATH) ? readFileSync(ACTIONS_PATH, "utf8") : "";

// 2. required wrappers
const REQUIRED_WRAPPERS = [
  "p5b7RecordDashboardAction",
  "p5b7ListSavedViews",
  "p5b7UpsertSavedView",
  "p5b7DeleteSavedView",
  "p5b7CreateExportJob",
  "p5b7ListMyExportJobs",
  "p5b7AcknowledgeStaleData",
  "p5b7LogSensitiveFieldReveal",
  "p5b7ListDashboardAudit",
  "p5b7CanRunExport",
  "p5b7ExportRequiresReason",
];
for (const w of REQUIRED_WRAPPERS) {
  if (!new RegExp(`export\\s+(async\\s+)?function\\s+${w}\\b`).test(actionsSrc)) {
    fail(`actions.ts missing wrapper export ${w}`);
  }
}

// 3. approved RPC names — every rpc call in actions.ts must hit one
const APPROVED_RPCS = new Set([
  "p5b7_record_dashboard_action",
  "p5b7_upsert_saved_view",
  "p5b7_delete_saved_view",
  "p5b7_list_saved_views",
  "p5b7_create_export_job",
  "p5b7_list_my_export_jobs",
  "p5b7_list_dashboard_audit",
  "p5b7_list_export_audit",
  "p5b7_acknowledge_stale_data",
  "p5b7_log_sensitive_field_reveal",
]);
const rpcCalls = [...actionsSrc.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
for (const name of rpcCalls) {
  if (!APPROVED_RPCS.has(name)) fail(`actions.ts calls unknown RPC "${name}"`);
}

// 4. forbidden domains inside actions wrapper
const FORBIDDEN_TOKENS = [
  "finality",        // no finality mutations
  "p5_batch4_",
  "p5_batch5_",
  "memory_record",
  "waiver",
  "override",
];
for (const tok of FORBIDDEN_TOKENS) {
  if (actionsSrc.toLowerCase().includes(tok)) {
    fail(`actions.ts references forbidden domain token "${tok}"`);
  }
}

// 5. Batch 8 tokens anywhere in Batch 7 surface
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (/\.(t|j)sx?$/.test(f)) out.push(full);
  }
  return out;
}

const ROOTS = [
  "src/lib/p5-batch7",
  "src/components/p5-batch7",
  "src/pages/admin/p5-batch7",
  "src/pages/desk/p5-batch7",
  "src/pages/funder/p5-batch7",
];

// 1. Only actions.ts may call supabase.rpc on a p5b7_* function.
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    if (/p5[_-]?batch8|p5b8|batch[\s_-]?8/i.test(src)) {
      fail(`${file}: Batch 8 token referenced (out of scope)`);
    }
    if (file === ACTIONS_PATH) continue;
    // forbid any supabase.rpc call (uses wrappers instead)
    if (/supabase\.rpc\s*\(|sb\.rpc\s*\(/.test(src)) {
      fail(`${file}: direct supabase.rpc call not permitted outside actions.ts`);
    }
    // forbid raw writes
    for (const m of [".insert(", ".update(", ".delete(", ".upsert("]) {
      if (src.includes(m)) fail(`${file}: raw mutation ${m} not permitted`);
    }
  }
}

if (errors.length) {
  console.error("P-5 Batch 7 Phase 5 guard FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("P-5 Batch 7 Phase 5 guard passed.");
