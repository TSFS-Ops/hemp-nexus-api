#!/usr/bin/env node
/**
 * P-5 Batch 8 — Phase 5 UI guard.
 *
 * Enforces:
 *   - UI never reads `p5b8_*` tables directly (must use Phase 4 projections).
 *   - UI never writes `p5b8_*` tables directly (must use Phase 3 RPCs).
 *   - Only the api wrapper (src/lib/p5-batch8/api.ts) calls supabase.rpc()
 *     and only with whitelisted Phase 3/4 function names.
 *   - No Phase 1 forbidden external fields rendered.
 *   - No Phase 1 banned external wording rendered.
 *   - "Provider-ready is not provider-verified" disclaimer is present.
 *   - Route registered under /admin/p5-batch8 with RequireAuth platform_admin.
 *   - No new edge functions, no cron, no Batch 6/7 surface leakage.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const errors = [];
const fail = (m) => { errors.push(m); console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

// Files expected to exist
const UI_PAGE = "src/pages/admin/p5-batch8/Workbench.tsx";
const UI_SHELL = "src/components/p5-batch8/WorkbenchShell.tsx";
const API = "src/lib/p5-batch8/api.ts";
for (const f of [UI_PAGE, UI_SHELL, API]) {
  if (!existsSync(resolve(ROOT, f))) fail(`Missing required file: ${f}`);
}
ok("Phase 5 required files present");

// Allowed RPC names callable from src/lib/p5-batch8/api.ts
const ALLOWED_RPCS = new Set([
  // Phase 4 reads
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
  // Phase 3 writes wired into UI actions (subset)
  "p5b8_rpc_record_activation_signoff",
  "p5b8_rpc_set_dependency_status",
]);

// Walk a directory collecting source files
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

const UI_SCAN_DIRS = [
  "src/pages/admin/p5-batch8",
  "src/components/p5-batch8",
];

const FORBIDDEN_COLS = [
  "raw_provider_payload_admin_only",
  "raw_webhook_payload_admin_only",
  "provider_api_key",
  "provider_api_secret",
  "webhook_signature_secret",
  "internal_risk_note",
  "internal_reviewer_note",
];

const BANNED_WORDING = [
  "guaranteed clean", "regulator approved", "bank verified",
  "sanctions cleared", "sanctions clean", "kyc passed", "kyc complete",
  "provider certified", "provider verified", "verified by provider",
  "verified by bank", "verified by mastercard", "verified by dbsa",
  "live integrated", "live connected", "approved by provider",
];

// 1. UI must NOT touch supabase.from('p5b8_...') or supabase.rpc directly.
for (const dir of UI_SCAN_DIRS) {
  for (const f of walk(resolve(ROOT, dir))) {
    const rel = f.slice(ROOT.length + 1);
    const body = readFileSync(f, "utf8");
    if (/supabase\s*\.\s*from\s*\(\s*['"`]p5b8_/.test(body))
      fail(`UI directly reads a p5b8_ table: ${rel}`);
    if (/supabase\s*\.\s*rpc\s*\(/.test(body))
      fail(`UI calls supabase.rpc() directly (must go through @/lib/p5-batch8/api): ${rel}`);
    const low = body.toLowerCase();
    for (const col of FORBIDDEN_COLS) {
      if (low.includes(col.toLowerCase()))
        fail(`UI references forbidden external field "${col}": ${rel}`);
    }
    for (const w of BANNED_WORDING) {
      if (low.includes(w))
        fail(`UI uses banned external wording "${w}": ${rel}`);
    }
  }
}
ok("UI does not touch p5b8_ tables directly or call supabase.rpc() directly");
ok("UI contains no forbidden external fields or banned wording");

// 2. API wrapper may call supabase.rpc — every name must be in the allowlist.
const apiSrc = readFileSync(resolve(ROOT, API), "utf8");
const calledRpcs = new Set();
// Match RPC names passed as the first string argument to any *(...) call —
// covers both supabase.rpc("name") and helper wrappers like callRead("name").
for (const m of apiSrc.matchAll(/["'](p5b8_(?:read|rpc)_[a-z0-9_]+)["']/gi)) {
  calledRpcs.add(m[1]);
}
for (const name of calledRpcs) {
  if (!ALLOWED_RPCS.has(name))
    fail(`API wrapper calls non-allowlisted RPC "${name}"`);
}
// API wrapper must include every Phase 4 read projection
for (const name of ALLOWED_RPCS) {
  if (name.startsWith("p5b8_read_") && !calledRpcs.has(name))
    fail(`API wrapper missing Phase 4 read projection: ${name}`);
}
// API wrapper must not query p5b8_ tables directly
if (/supabase\s*\.\s*from\s*\(\s*['"`]p5b8_/.test(apiSrc))
  fail(`API wrapper performs direct table read of p5b8_*`);
ok(`API wrapper uses ${calledRpcs.size} allowlisted RPCs, no direct table access`);

// 3. Disclaimer must be present in the shell
const shellSrc = readFileSync(resolve(ROOT, UI_SHELL), "utf8");
if (!/Provider-ready is not provider-verified/i.test(shellSrc))
  fail(`Mandatory "Provider-ready is not provider-verified" disclaimer missing from shell`);
ok(`"Provider-ready is not provider-verified" disclaimer present`);

// 4. Route registered under /admin/p5-batch8 with platform_admin guard
const appSrc = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");
if (!/path="\/admin\/p5-batch8"[\s\S]{0,400}RequireAuth\s+role="platform_admin"/.test(appSrc))
  fail(`Route /admin/p5-batch8 is not registered with RequireAuth role="platform_admin"`);
if (!/P5Batch8Workbench/.test(appSrc))
  fail(`P5Batch8Workbench not imported in App.tsx`);
ok(`Route /admin/p5-batch8 registered under platform_admin guard`);

// 5. No new edge functions / cron / Batch 6/7 leakage in Phase 5 surfaces
for (const dir of [
  "supabase/functions/p5-batch8",
  "src/pages/desk/p5-batch8",
  "src/pages/funder/p5-batch8",
]) {
  if (existsSync(resolve(ROOT, dir)))
    fail(`Phase 5 forbidden surface exists: ${dir}`);
}
for (const f of walk(resolve(ROOT, "src/pages/admin/p5-batch8"))
  .concat(walk(resolve(ROOT, "src/components/p5-batch8")))
  .concat([resolve(ROOT, API)])) {
  const body = readFileSync(f, "utf8");
  for (const tok of ["p5b6_", "p5b7_"]) {
    if (body.includes(tok))
      fail(`Phase 5 surface references ${tok}: ${f.slice(ROOT.length + 1)}`);
  }
}
ok(`No edge functions, no desk/funder Batch 8 surfaces, no Batch 6/7 leakage`);

if (errors.length) {
  console.error(`\n[check-p5-batch8-phase-5-ui] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[check-p5-batch8-phase-5-ui] OK");
