#!/usr/bin/env node
/**
 * P-5 Batch 7 — Phase 4 guard.
 *
 * Verifies:
 *   1. The 7 registered dashboard routes are mounted in src/App.tsx.
 *   2. Each Batch 7 page file exists and uses the shared shell.
 *   3. No Batch 7 UI imports raw p5b7_* tables via supabase.from(...).
 *   4. No Batch 7 UI references banned wording, forbidden fields, or Batch 8 tokens.
 *   5. No write mutations (.insert/.update/.delete or write RPC names) in Phase 4 UI.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const errors = [];
function fail(msg) { errors.push(msg); }

const ROUTES = [
  "/admin/p5-batch7/control-dashboard",
  "/admin/p5-batch7/compliance-dashboard",
  "/admin/p5-batch7/api-dashboard",
  "/admin/p5-batch7/provider-dashboard",
  "/desk/p5-batch7/org-dashboard",
  "/funder/p5-batch7/funder-dashboard",
  "/admin/p5-batch7/audit-dashboard",
];

const PAGE_FILES = [
  "src/pages/admin/p5-batch7/ControlDashboard.tsx",
  "src/pages/admin/p5-batch7/ComplianceDashboard.tsx",
  "src/pages/admin/p5-batch7/ApiDashboard.tsx",
  "src/pages/admin/p5-batch7/ProviderDashboard.tsx",
  "src/pages/admin/p5-batch7/AuditDashboard.tsx",
  "src/pages/desk/p5-batch7/OrgDashboard.tsx",
  "src/pages/funder/p5-batch7/FunderDashboard.tsx",
];

const BANNED_WORDING = [
  "fraud","fraudulent","suspicious","blacklist","blacklisted","shady",
  "money laundering","criminal","guilty","rejected by ai","ai says","gpt",
  "internal note","private comment","do not show","off the record",
  "confidential reviewer",
];

const FORBIDDEN_FIELDS = [
  "raw_provider_payload","raw_provider_response","provider_api_key",
  "provider_secret","internal_reviewer_note","internal_risk_commentary",
  "private_compliance_note","internal_dispute_commentary","hidden_audit_metadata",
  "raw_audit_payload","raw_memory_snapshot","raw_finality_internal_metadata",
  "ai_unreviewed_draft","ai_chain_of_thought","credential_material",
  "encrypted_secret_blob","ssn_value","tax_id_value","bank_account_number_raw",
  "report_scope_internals",
];

// 1. routes mounted
const app = readFileSync("src/App.tsx", "utf8");
for (const r of ROUTES) {
  if (!app.includes(`path="${r}"`)) fail(`App.tsx missing route ${r}`);
}

// 2. page files exist + use shared shell
for (const p of PAGE_FILES) {
  if (!existsSync(p)) { fail(`missing page ${p}`); continue; }
  const c = readFileSync(p, "utf8");
  if (!c.includes("P5B7DashboardShell")) fail(`${p} does not use P5B7DashboardShell`);
}

// 3 + 4 + 5. scan Batch 7 UI surface
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (/\.(t|j)sx?$/.test(f)) out.push(full);
  }
  return out;
}

const UI_ROOTS = [
  "src/pages/admin/p5-batch7",
  "src/pages/desk/p5-batch7",
  "src/pages/funder/p5-batch7",
  "src/components/p5-batch7",
];

for (const root of UI_ROOTS) {
  if (!existsSync(root)) continue;
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    const lower = src.toLowerCase();

    // raw table reads
    if (/\.from\(\s*['"]p5b7_/.test(src)) {
      fail(`${file}: direct raw p5b7_* table read (use Phase 3 RPC projection)`);
    }

    // write mutations
    for (const m of [".insert(", ".update(", ".delete(", ".upsert("]) {
      if (src.includes(m)) fail(`${file}: write mutation ${m} not permitted in Phase 4 UI`);
    }
    if (/rpc\(\s*['"]p5b7_(upsert|record_|create_|delete_|update_)/.test(src)) {
      fail(`${file}: write RPC call not permitted in Phase 4 UI`);
    }

    // banned wording (skip comments + the page that explicitly disclaims them)
    const codeOnly = src
      .split("\n")
      .filter((l) => !/^\s*\*/.test(l) && !/^\s*\/\//.test(l))
      .join("\n")
      .toLowerCase();
    for (const w of BANNED_WORDING) {
      if (codeOnly.includes(w)) fail(`${file}: banned external wording "${w}"`);
    }

    // forbidden fields
    for (const f of FORBIDDEN_FIELDS) {
      if (lower.includes(f)) fail(`${file}: forbidden field token "${f}"`);
    }

    // Batch 8 tokens
    if (/p5[_-]?batch8|p5b8|batch[\s_-]?8/i.test(src)) {
      fail(`${file}: Batch 8 token referenced (out of scope)`);
    }
  }
}

if (errors.length) {
  console.error("P-5 Batch 7 Phase 4 UI guard FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("P-5 Batch 7 Phase 4 UI guard passed.");
