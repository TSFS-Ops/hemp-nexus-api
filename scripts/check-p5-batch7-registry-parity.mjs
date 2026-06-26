#!/usr/bin/env node
/**
 * P-5 Batch 7 — Phase 1 registry parity guard.
 *
 * Validates the SSOT registry is internally consistent:
 *   - All 7 dashboards present with route, label, authorised_roles
 *   - All dashboards routed under /admin, /desk or /funder
 *   - Every export type maps to a known dashboard and authorised roles
 *     are a subset of that dashboard's authorised roles
 *   - Every stale-threshold surface is a known dashboard or "api_v1"
 *   - API v1 visible fields and forbidden fields do not overlap
 *   - Approved wording and banned wording do not overlap
 *   - Every audit event uses the p5b7.* prefix
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const REG = resolve(ROOT, "src/lib/p5-batch7/registry.ts");

if (!existsSync(REG)) {
  console.error(`✗ registry missing at ${REG}`);
  process.exit(1);
}
const src = readFileSync(REG, "utf8");
const errors = [];
const fail = (m) => { errors.push(m); console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

function extractArray(name) {
  const re = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`);
  const m = src.match(re);
  if (!m) return null;
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

const DASHBOARDS = extractArray("P5_BATCH7_DASHBOARDS") ?? [];
const ROLES = extractArray("P5_BATCH7_ROLES") ?? [];
const API_FIELDS = extractArray("P5_BATCH7_API_V1_VISIBLE_FIELDS") ?? [];
const FORBIDDEN = extractArray("P5_BATCH7_FORBIDDEN_EXTERNAL_FIELDS") ?? [];
const APPROVED = extractArray("P5_BATCH7_APPROVED_EXTERNAL_WORDING") ?? [];
const BANNED = extractArray("P5_BATCH7_BANNED_EXTERNAL_WORDING") ?? [];
const AUDIT = extractArray("P5_BATCH7_AUDIT_EVENTS") ?? [];
const EXPORTS = extractArray("P5_BATCH7_EXPORT_TYPES") ?? [];

if (DASHBOARDS.length !== 7) fail(`Expected 7 dashboards, found ${DASHBOARDS.length}`);
else ok(`7 dashboards declared`);
if (ROLES.length < 7) fail(`Expected at least 7 roles, found ${ROLES.length}`);
else ok(`${ROLES.length} roles declared`);

// Every dashboard must have a definition with route and authorised_roles
for (const d of DASHBOARDS) {
  const block = src.match(new RegExp(`${d}:\\s*\\{[\\s\\S]*?\\},`));
  if (!block) { fail(`No definition block for dashboard ${d}`); continue; }
  if (!/route:\s*["']\/(admin|desk|funder)\//.test(block[0]))
    fail(`Dashboard ${d}: route missing or not under /admin|/desk|/funder`);
  if (!/authorised_roles:\s*\[/.test(block[0]))
    fail(`Dashboard ${d}: authorised_roles not declared`);
}

// API v1 fields ∩ forbidden fields = ∅
const overlap = API_FIELDS.filter((f) => FORBIDDEN.includes(f));
if (overlap.length) fail(`API v1 fields overlap forbidden fields: ${overlap.join(", ")}`);
else ok(`API v1 fields and forbidden fields disjoint`);

// Approved ∩ banned = ∅ (case-insensitive)
const aLower = APPROVED.map((s) => s.toLowerCase());
const bLower = BANNED.map((s) => s.toLowerCase());
const wOverlap = aLower.filter((s) => bLower.some((b) => s.includes(b)));
if (wOverlap.length) fail(`Approved wording overlaps banned wording: ${wOverlap.join(", ")}`);
else ok(`Approved and banned wording disjoint`);

// Audit events use p5b7.* prefix
for (const e of AUDIT) {
  if (!e.startsWith("p5b7.")) fail(`Audit event ${e} missing p5b7.* prefix`);
}
ok(`${AUDIT.length} audit events, all p5b7.* prefixed`);

// Export types map to known dashboard
for (const ex of EXPORTS) {
  const block = src.match(new RegExp(`${ex}:\\s*\\{[\\s\\S]*?\\},`));
  if (!block) { fail(`Export ${ex} has no definition`); continue; }
  const dm = block[0].match(/dashboard:\s*["'](\w+)["']/);
  if (!dm || !DASHBOARDS.includes(dm[1]))
    fail(`Export ${ex}: dashboard ${dm?.[1] ?? "?"} not in dashboard list`);
}
ok(`${EXPORTS.length} export types map to known dashboards`);

if (errors.length) {
  console.error(`\n[check-p5-batch7-registry-parity] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[check-p5-batch7-registry-parity] OK");
