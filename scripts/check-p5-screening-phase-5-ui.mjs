#!/usr/bin/env node
/**
 * P-5 Screening — Phase 5 UI guard.
 * Pins:
 *   - Route /admin/p5-screening registered under RequireAuth role="platform_admin"
 *   - Lazy-loaded Workbench page
 *   - UI talks to backend ONLY through src/lib/p5-screening/api.ts
 *   - No direct supabase.from('p5scr_*') access in pages/components
 *   - No SSOT banned wording in any screening UI surface
 *   - No SSOT forbidden field references in any screening UI surface
 *   - No edge function or cron usage from UI
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const errors = [];
const fail = (m) => { errors.push(m); console.error("  ✗ " + m); };
const ok = (m) => console.log("  ✓ " + m);

const APP = readFileSync("src/App.tsx", "utf8");
if (!/const P5ScreeningWorkbench = lazy\(\(\) => import\("@\/pages\/admin\/p5-screening\/Workbench"\)\)/.test(APP))
  fail("App.tsx: P5ScreeningWorkbench not lazy-imported");
if (!/path="\/admin\/p5-screening"[^>]*RequireAuth role="platform_admin"/.test(APP))
  fail("App.tsx: /admin/p5-screening route not registered with platform_admin guard");
ok("Route /admin/p5-screening registered under platform_admin guard");

const PAGE = "src/pages/admin/p5-screening/Workbench.tsx";
const API = "src/lib/p5-screening/api.ts";
if (!existsSync(PAGE)) fail(`Missing page: ${PAGE}`);
if (!existsSync(API)) fail(`Missing API wrapper: ${API}`);
ok("Workbench page + API wrapper present");

// Walk UI dirs and enforce constraints
const UI_DIRS = ["src/pages/admin/p5-screening", "src/components/p5-screening"];
function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const uiFiles = [...walk(UI_DIRS[0]), ...walk(UI_DIRS[1])];

const BANNED = [
  "sanctions hit","sanctioned","pep hit","blacklisted","fraud","criminal",
  "high risk","match confirmed","blocked permanently","illegal","suspicious",
  "guilty","raw provider result","match score","list name",
];
const FORBIDDEN_FIELDS = [
  "raw_provider_payload","provider_api_secret","id_image","selfie",
  "biometric_template","match_score","list_name","raw_adverse_media",
];

for (const f of uiFiles) {
  const src = readFileSync(f, "utf8");
  if (/supabase\.from\(\s*['"]p5scr_/.test(src))
    fail(`${f}: direct supabase.from('p5scr_*') access is forbidden — use api.ts`);
  if (/supabase\.functions\.invoke/.test(src))
    fail(`${f}: edge function invocation not allowed in screening UI`);
  for (const phrase of BANNED) {
    if (src.toLowerCase().includes(phrase.toLowerCase()))
      fail(`${f}: SSOT banned wording leaks: "${phrase}"`);
  }
  for (const field of FORBIDDEN_FIELDS) {
    if (src.includes(field))
      fail(`${f}: SSOT forbidden field referenced: "${field}"`);
  }
}
ok(`Scanned ${uiFiles.length} UI file(s) — no banned wording, no forbidden fields, no direct table/edge access`);

// API wrapper itself must only call the 2 Phase 4 read RPCs
const apiSrc = readFileSync(API, "utf8");
if (/supabase\.from\(/.test(apiSrc))
  fail(`${API}: must not use supabase.from() — Phase 5 reads via Phase 4 projections only`);
const rpcCalls = [...apiSrc.matchAll(/supabase\.rpc[^)]*\)\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
const allowedRpcs = new Set(["p5scr_api_subject_status","p5scr_api_gate_readiness"]);
for (const r of rpcCalls) {
  if (!allowedRpcs.has(r)) fail(`${API}: disallowed RPC call "${r}"`);
}
ok(`API wrapper only calls Phase 4 projections (${rpcCalls.length} RPC call(s))`);

if (errors.length) {
  console.error(`\n[check-p5-screening-phase-5-ui] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[check-p5-screening-phase-5-ui] OK");
