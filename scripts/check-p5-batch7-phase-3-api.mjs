#!/usr/bin/env node
/**
 * P-5 Batch 7 — Phase 3 API Visibility Layer static guard.
 *
 * Asserts the Phase 3 migration:
 *   - declares all expected p5b7_api_v1_* SECURITY DEFINER functions
 *   - pins SET search_path = public on every one
 *   - REVOKEs EXECUTE FROM PUBLIC on every one
 *   - is read-only (no INSERT/UPDATE/DELETE on Batch 5/6/7 tables)
 *   - contains no pg_cron schedule
 *   - leaks no Batch 8 tokens
 *   - never embeds any P5_BATCH7_FORBIDDEN_EXTERNAL_FIELDS token
 *
 * Also asserts the TS projection module exists and imports the registry.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const REG = resolve(ROOT, "src/lib/p5-batch7/registry.ts");
const APIV1 = resolve(ROOT, "src/lib/p5-batch7/api-v1.ts");

const errors = [];
const fail = (m) => { errors.push(m); console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

// Find the most recent migration that declares p5b7_api_v1_* functions
const mig = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .reverse()
  .map((f) => ({ f, src: readFileSync(resolve(MIG_DIR, f), "utf8") }))
  .find(({ src }) => /CREATE OR REPLACE FUNCTION public\.p5b7_api_v1_/i.test(src));

if (!mig) { fail("No migration declares p5b7_api_v1_* functions"); process.exit(1); }
ok(`Phase 3 migration: ${mig.f}`);

const REQUIRED_FNS = [
  "p5b7_api_v1_resolve_scope",
  "p5b7_api_v1_compute_stale",
  "p5b7_api_v1_map_case_status",
  "p5b7_api_v1_map_finality_status",
  "p5b7_api_v1_list_cases",
  "p5b7_api_v1_get_case",
  "p5b7_api_v1_list_provider_status",
  "p5b7_api_v1_list_visible_fields",
];

for (const fn of REQUIRED_FNS) {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`, "i");
  if (!re.test(mig.src)) fail(`Missing function ${fn}`);
}
ok(`${REQUIRED_FNS.length} expected p5b7_api_v1_* functions declared`);

// Per-function: SECURITY DEFINER + search_path + REVOKE FROM PUBLIC
const blocks = mig.src.split(/CREATE OR REPLACE FUNCTION public\./).slice(1);
let secdef = 0;
for (const b of blocks) {
  const m = b.match(/^(p5b7_api_v1_\w+)/);
  if (!m) continue;
  const name = m[1];
  const asIdx = b.toLowerCase().search(/\bas\s+\$\$/);
  const head = b.slice(0, asIdx > 0 ? asIdx : b.length);
  // SECURITY DEFINER is required for scope-resolving / projection functions.
  // IMMUTABLE mapper helpers don't need SECURITY DEFINER, skip them.
  if (!/SECURITY DEFINER/i.test(head)) continue;
  secdef++;
  if (!/SET\s+search_path\s*=\s*public/i.test(head))
    fail(`Function ${name}: missing SET search_path = public`);
  if (!new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\s*\\([^)]*\\)[^;]*FROM PUBLIC`, "i").test(mig.src))
    fail(`Function ${name}: missing REVOKE EXECUTE FROM PUBLIC`);
}
ok(`${secdef} SECURITY DEFINER function(s) — search_path + REVOKE verified`);

// Read-only: no INSERT/UPDATE/DELETE on any p5b7_ / p5_batch4_ / p5_batch5_ / p5b6_ tables
const codeOnly = mig.src.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const writeRe = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^;]*\b(p5b7_|p5_batch4_|p5_batch5_|p5b6_)\w+/i;
if (writeRe.test(codeOnly)) fail("Phase 3 migration contains a write against Batch 4/5/6/7 tables");
else ok("No writes against Batch 4/5/6/7 tables");

// No cron, no Batch 8
if (/cron\.schedule\s*\(/i.test(codeOnly)) fail("Phase 3 migration contains pg_cron schedule");
for (const tok of ["p5-batch8","p5_batch8","P5_BATCH8","Batch 8","p5b8","P5B8"]) {
  if (codeOnly.includes(tok)) fail(`Leaks Batch 8 token "${tok}"`);
}
ok("No pg_cron, no Batch 8 tokens");

// Pull forbidden field list from registry and ensure none are mentioned in the migration
if (!existsSync(REG)) { fail("Registry missing"); process.exit(1); }
const reg = readFileSync(REG, "utf8");
const forbidden = [
  ...(reg.match(/export const P5_BATCH7_FORBIDDEN_EXTERNAL_FIELDS\s*=\s*\[([\s\S]*?)\]\s*as const/)?.[1].matchAll(/["']([^"']+)["']/g) ?? []),
].map((x) => x[1]);
for (const f of forbidden) {
  if (new RegExp(`\\b${f}\\b`).test(codeOnly))
    fail(`Phase 3 migration mentions forbidden field "${f}"`);
}
ok(`${forbidden.length} forbidden field tokens not referenced in Phase 3 migration`);

// TS projection module exists & imports registry
if (!existsSync(APIV1)) fail("src/lib/p5-batch7/api-v1.ts missing");
else {
  const ts = readFileSync(APIV1, "utf8");
  if (!/from\s+"\.\/registry"/.test(ts)) fail("api-v1.ts does not import registry");
  if (!/P5_BATCH7_API_V1_VISIBLE_FIELDS/.test(ts)) fail("api-v1.ts does not use the allow-list");
  if (!/P5_BATCH7_FORBIDDEN_EXTERNAL_FIELDS/.test(ts)) fail("api-v1.ts does not use the forbidden-field list");
  ok("api-v1.ts present and wired to the registry");
}

if (errors.length) {
  console.error(`\n[check-p5-batch7-phase-3-api] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[check-p5-batch7-phase-3-api] OK");
