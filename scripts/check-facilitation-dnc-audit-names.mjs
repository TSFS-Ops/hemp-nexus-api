#!/usr/bin/env node
/**
 * Phase 2 Step 5 — Facilitation DNC audit-name guard.
 *
 * Pins the canonical `facilitation.dnc.*` audit names emitted by the
 * Step 5 DNC add/revoke edge functions.
 *
 * Asserts:
 *   1. `facilitation-outreach-dnc-add` emits ONLY "facilitation.dnc.rule_added"
 *   2. `facilitation-outreach-dnc-revoke` emits ONLY "facilitation.dnc.rule_revoked"
 *   3. No `facilitation.dnc.*` literal exists outside these two dirs,
 *      this script, and the dedicated tests.
 *   4. Neither function mutates POI / WaD / matches / token_ledger /
 *      token_purchases / payments / poi_engagements / compliance_cases.
 *   5. Neither function imports the Resend send path.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const FN_DIRS = [
  "supabase/functions/facilitation-outreach-dnc-add",
  "supabase/functions/facilitation-outreach-dnc-revoke",
];
const REQUIRED_BY_DIR = {
  "supabase/functions/facilitation-outreach-dnc-add": "facilitation.dnc.rule_added",
  "supabase/functions/facilitation-outreach-dnc-revoke": "facilitation.dnc.rule_revoked",
};

const BANNED_MUTATION_PATTERNS = [
  /atomic_generate_poi/i,
  /atomic_token_burn/i,
  /atomic_accept_bind/i,
  /atomic_engagement_transition/i,
  /\.from\(\s*["']pois["']\s*\)\s*\.[a-z]+\([^)]*\)\s*\.(?:insert|update|upsert|delete)/i,
  /\.from\(\s*["']wads["']\s*\)\s*\.[a-z]*\(?.*?(?:insert|update|upsert|delete)/i,
  /\.from\(\s*["']matches["']\s*\)\s*\.[a-z]*\(?.*?(?:insert|update|upsert|delete)/i,
  /\.from\(\s*["']token_ledger["']\s*\)\s*\.[a-z]*\(?.*?(?:insert|update|upsert|delete)/i,
  /\.from\(\s*["']token_purchases["']\s*\)\s*\.[a-z]*\(?.*?(?:insert|update|upsert|delete)/i,
  /\.from\(\s*["']poi_engagements["']\s*\)\s*\.[a-z]*\(?.*?(?:insert|update|upsert|delete)/i,
  /\.from\(\s*["']compliance_cases["']\s*\)\s*\.[a-z]*\(?.*?(?:insert|update|upsert|delete)/i,
];

const RESEND_PATTERNS = [/api\.resend\.com/i, /resend\.emails\.send/i];
const DNC_LITERAL_RE = /"facilitation\.dnc\.[a-z_.]+"/g;

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(full);
  }
  return out;
}

const errors = [];

for (const dir of FN_DIRS) {
  const full = resolve(ROOT, dir);
  if (!existsSync(full)) { errors.push(`Missing Step 5 function dir: ${dir}`); continue; }
  const expected = REQUIRED_BY_DIR[dir];
  let foundExpected = false;
  for (const file of walk(full)) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(ROOT.length + 1);
    for (const m of src.match(DNC_LITERAL_RE) ?? []) {
      if (m !== `"${expected}"`) errors.push(`${rel}: non-canonical DNC audit name ${m} (expected only "${expected}")`);
      else foundExpected = true;
    }
    for (const re of BANNED_MUTATION_PATTERNS) {
      if (re.test(src)) errors.push(`${rel}: banned mutation pattern detected: ${re}`);
    }
    for (const re of RESEND_PATTERNS) {
      if (re.test(src)) errors.push(`${rel}: send path detected in Step 5 DNC function (forbidden)`);
    }
  }
  if (!foundExpected) errors.push(`${dir}: canonical "${expected}" not emitted`);
}

// No facilitation.dnc.* literal outside the two function dirs, this guard,
// or dedicated tests.
const ALLOWED_HOSTS = new Set([
  "scripts/check-facilitation-dnc-audit-names.mjs",
  ...FN_DIRS,
]);
function isUnderAllowed(rel) {
  for (const a of ALLOWED_HOSTS) if (rel === a || rel.startsWith(a + "/") || rel.startsWith(a + "\\")) return true;
  if (rel.startsWith("src/tests/facilitation-dnc")) return true;
  return false;
}
for (const root of ["supabase/functions", "src", "scripts"]) {
  for (const file of walk(resolve(ROOT, root))) {
    const rel = file.slice(ROOT.length + 1);
    if (isUnderAllowed(rel)) continue;
    const src = readFileSync(file, "utf8");
    const m = src.match(DNC_LITERAL_RE);
    if (m && m.length > 0) {
      errors.push(`${rel}: facilitation.dnc.* literal outside allowed hosts: ${m[0]}`);
    }
  }
}

if (errors.length) {
  console.error("[check-facilitation-dnc-audit-names] FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("[check-facilitation-dnc-audit-names] OK");
