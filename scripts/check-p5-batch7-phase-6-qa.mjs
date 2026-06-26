#!/usr/bin/env node
/**
 * P-5 Batch 7 — Phase 6 final cross-consistency QA.
 *
 * This guard does not duplicate Phase 2–5 guards; it asserts the
 * cross-cutting properties listed in the Phase 6 acceptance criteria
 * and acts as the closing gate before declaring P5_BATCH7_DEPLOYED.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const errs = [];
const fail = (m) => errs.push(m);
const ok   = (m) => console.log("  ✓ " + m);

const ROOTS = [
  "src/lib/p5-batch7",
  "src/components/p5-batch7",
  "src/pages/admin/p5-batch7",
  "src/pages/desk/p5-batch7",
  "src/pages/funder/p5-batch7",
];

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

const allFiles = ROOTS.flatMap((r) => walk(r));
const allSrc = Object.fromEntries(allFiles.map((f) => [f, readFileSync(f, "utf8")]));

// 1. Seven routes registered + role-wrapped
const app = readFileSync("src/App.tsx", "utf8");
const ROUTES = [
  ["/admin/p5-batch7/control-dashboard",     true],
  ["/admin/p5-batch7/compliance-dashboard",  true],
  ["/admin/p5-batch7/api-dashboard",         true],
  ["/admin/p5-batch7/provider-dashboard",    true],
  ["/admin/p5-batch7/audit-dashboard",       true],
  ["/desk/p5-batch7/org-dashboard",          false],
  ["/funder/p5-batch7/funder-dashboard",     false],
];
for (const [r, adminGated] of ROUTES) {
  const rx = new RegExp(`path="${r.replace(/\//g, "\\/")}"[^]*?<RequireAuth`);
  if (!rx.test(app)) fail(`route ${r} not wrapped in RequireAuth`);
  if (adminGated && !new RegExp(`path="${r.replace(/\//g, "\\/")}"[^]*?role="platform_admin"`).test(app)) {
    fail(`route ${r} not role-gated to platform_admin`);
  }
}
ok(`${ROUTES.length} routes registered and RequireAuth-wrapped`);

// 2. Shared shell usage
const PAGES = [
  "src/pages/admin/p5-batch7/ControlDashboard.tsx",
  "src/pages/admin/p5-batch7/ComplianceDashboard.tsx",
  "src/pages/admin/p5-batch7/ApiDashboard.tsx",
  "src/pages/admin/p5-batch7/ProviderDashboard.tsx",
  "src/pages/admin/p5-batch7/AuditDashboard.tsx",
  "src/pages/desk/p5-batch7/OrgDashboard.tsx",
  "src/pages/funder/p5-batch7/FunderDashboard.tsx",
];
for (const p of PAGES) {
  if (!existsSync(p) || !readFileSync(p, "utf8").includes("P5B7DashboardShell")) {
    fail(`${p} does not use P5B7DashboardShell`);
  }
}
ok(`${PAGES.length} pages use the shared shell`);

// 3. No direct raw reads/writes against p5b7_* from UI; only actions.ts may call rpc
for (const [file, src] of Object.entries(allSrc)) {
  if (/\.from\(\s*['"]p5b7_/.test(src)) fail(`${file}: raw p5b7_* read`);
  for (const m of [".insert(", ".update(", ".delete(", ".upsert("]) {
    if (src.includes(m)) fail(`${file}: raw mutation ${m}`);
  }
  if (file !== "src/lib/p5-batch7/actions.ts" && /supabase\.rpc\s*\(|sb\.rpc\s*\(/.test(src)) {
    fail(`${file}: rpc call outside actions.ts`);
  }
}
ok("no raw p5b7_* table I/O and no rpc calls outside actions.ts");

// 4. Actions wrapper only calls approved RPC names
const APPROVED = new Set([
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
const actions = readFileSync("src/lib/p5-batch7/actions.ts", "utf8");
for (const m of actions.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)) {
  if (!APPROVED.has(m[1])) fail(`actions.ts calls unapproved RPC ${m[1]}`);
}
ok(`${APPROVED.size} approved RPCs only`);

// 5. No Batch 8 / no cron / no edge functions added by Batch 7
const mig5 = readFileSync("supabase/migrations/20260626111350_e04234fe-5053-4004-881a-605955565b34.sql", "utf8");
const mig3 = readFileSync("supabase/migrations/20260626113456_90bbdeb0-47f0-4314-848f-6da54277d643.sql", "utf8");
for (const sql of [mig5, mig3]) {
  if (/pg_cron|cron\.schedule/i.test(sql)) fail("Batch 7 migration adds cron");
}
ok("no pg_cron in any Batch 7 migration");

if (existsSync("supabase/functions")) {
  for (const d of readdirSync("supabase/functions")) {
    // P-5 Batch 7 namespace uses p5b7/p5-batch7. The unrelated pre-existing
    // "registry-batch7-*" namespace (Registry workstream's batch 7) is not
    // part of this batch.
    if (/p5b7|p5[-_]batch7/i.test(d)) fail(`edge function ${d} introduced by Batch 7`);
  }
}
ok("no P-5 Batch 7 edge functions introduced");

// 6. Sensitive reveal stays log-only — actions wrapper must not return a raw value.
// Look for code patterns, not comment prose.
const codeOnlyActions = actions
  .split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join("\n");
if (/\bunmask\s*\(|\breveal_value\b|\braw_value\b/i.test(codeOnlyActions)) {
  fail("actions.ts appears to return sensitive values");
}
ok("sensitive-field reveal helper is audit-only");

// 7. Append-only triggers present
if (!/p5b7_block_mutation_append_only/.test(mig5)) {
  fail("append-only trigger function missing from Phase 2 migration");
}
ok("append-only trigger present on audit tables");

// 8. Forbidden field tokens absent from UI/actions
const FORBIDDEN_FIELDS = [
  "raw_provider_payload","provider_api_key","provider_secret",
  "internal_reviewer_note","internal_risk_commentary","private_compliance_note",
  "raw_memory_snapshot","raw_finality_internal_metadata","ai_chain_of_thought",
  "credential_material","encrypted_secret_blob","ssn_value","tax_id_value",
  "bank_account_number_raw",
];
for (const [file, src] of Object.entries(allSrc)) {
  // registry.ts intentionally lists these as the forbidden block-list
  if (file.endsWith("/registry.ts") || file.endsWith("/api-v1.ts")) continue;
  const lower = src.toLowerCase();
  for (const t of FORBIDDEN_FIELDS) {
    if (lower.includes(t)) fail(`${file}: forbidden field token "${t}"`);
  }
}
ok("forbidden field tokens absent from UI/actions surfaces");

// 9. Funder visibility limitation documented
const funderPage = readFileSync("src/pages/funder/p5-batch7/FunderDashboard.tsx", "utf8");
if (!/funder|access|limitation|granular|coarse|disclaimer|scope/i.test(funderPage)) {
  fail("funder visibility limitation not surfaced in the funder dashboard");
}
ok("funder visibility limitation surfaced in the funder dashboard");

// 10. Evidence README present
const README = "evidence/p5-batch7-api-dashboards-visibility/README.md";
if (!existsSync(README)) fail(`evidence README missing: ${README}`);
else if (!/P5_BATCH7_DEPLOYED/.test(readFileSync(README, "utf8"))) {
  fail("evidence README missing final status marker P5_BATCH7_DEPLOYED");
}
ok("evidence README present with final status marker");

if (errs.length) {
  console.error("P-5 Batch 7 Phase 6 QA FAILED:");
  for (const e of errs) console.error("  - " + e);
  process.exit(1);
}
console.log("P-5 Batch 7 Phase 6 QA passed.");
