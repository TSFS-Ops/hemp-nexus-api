#!/usr/bin/env node
/**
 * Phase 2 Step 3 — Outreach audit-name guard.
 *
 * Pins canonical facilitation_outreach.* audit names. The list lives in
 *   supabase/functions/_shared/facilitation-outreach-context.ts
 * (export `FACILITATION_OUTREACH_AUDIT_NAMES`).
 *
 * Asserts:
 *   1. The SSOT list contains every required canonical name.
 *   2. Each of the 5 Phase 2 outreach edge functions emits ONLY canonical
 *      names from this list (no stray `facilitation_outreach.<x>` literals).
 *   3. The `send.dispatched` / `send.suppressed` / `send.blocked` audits
 *      may only appear in `facilitation-outreach-send/`.
 *   4. The `escalation.resolved` / `escalation.reopened` audits may only
 *      appear in `facilitation-outreach-escalation-resolve/`.
 *   5. No facilitation_outreach.* literal exists outside the 5 Phase 2
 *      functions, the shared module, the SSOT, and this guard.
 *
 * Also acts as a banned-mutation guard: the 5 Phase 2 functions must NOT
 * touch POI / WaD / match / token_ledger / token_purchases / payment /
 * poi_engagements / compliance_cases via insert/update RPCs.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const REQUIRED = [
  "facilitation_outreach.template.approved",
  "facilitation_outreach.template.archived",
  "facilitation_outreach.candidate.added",
  "facilitation_outreach.gate.evaluated",
  "facilitation_outreach.send.dispatched",
  "facilitation_outreach.send.suppressed",
  "facilitation_outreach.send.blocked",
  "facilitation_outreach.escalation.opened",
  "facilitation_outreach.escalation.resolved",
  "facilitation_outreach.escalation.reopened",
];

const SSOT = "supabase/functions/_shared/facilitation-outreach-context.ts";
const FN_DIRS = [
  "supabase/functions/facilitation-outreach-template-status",
  "supabase/functions/facilitation-outreach-candidate-add",
  "supabase/functions/facilitation-outreach-send",
  "supabase/functions/facilitation-outreach-escalate",
  "supabase/functions/facilitation-outreach-escalation-resolve",
];

const SEND_ONLY = [
  "facilitation_outreach.send.dispatched",
  "facilitation_outreach.send.suppressed",
  "facilitation_outreach.send.blocked",
];
const RESOLVE_ONLY = [
  "facilitation_outreach.escalation.resolved",
  "facilitation_outreach.escalation.reopened",
];

const BANNED_MUTATION_PATTERNS = [
  /atomic_generate_poi/i,
  /atomic_token_burn/i,
  /atomic_token_credit/i,
  /atomic_accept_bind/i,
  /atomic_engagement_transition/i,
  /\.from\(\s*["']pois["']\s*\)\s*\.[a-z]+\([^)]*\)\s*\.(?:insert|update|upsert|delete)/i,
  /\.from\(\s*["']wads["']\s*\)\s*\.[a-z]*\(?.*?(?:insert|update|upsert|delete)/i,
  /\.from\(\s*["']matches["']\s*\)\s*\.[a-z]*\(?.*?(?:insert|update|upsert|delete)/i,
  /\.from\(\s*["']token_ledger["']\s*\)\s*\.[a-z]*\(?.*?(?:insert|update|upsert|delete)/i,
  /\.from\(\s*["']token_purchases["']\s*\)\s*\.[a-z]*\(?.*?(?:insert|update|upsert|delete)/i,
  /\.from\(\s*["']payment_disputes["']\s*\)\s*\.[a-z]*\(?.*?(?:insert|update|upsert|delete)/i,
  /\.from\(\s*["']poi_engagements["']\s*\)\s*\.[a-z]*\(?.*?(?:insert|update|upsert|delete)/i,
  /\.from\(\s*["']compliance_cases["']\s*\)\s*\.[a-z]*\(?.*?(?:insert|update|upsert|delete)/i,
];

const errors = [];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

// 1. SSOT list completeness.
if (!existsSync(resolve(ROOT, SSOT))) {
  errors.push(`Missing SSOT file: ${SSOT}`);
} else {
  const src = readFileSync(resolve(ROOT, SSOT), "utf8");
  for (const name of REQUIRED) {
    if (!src.includes(`"${name}"`)) errors.push(`${SSOT} missing canonical audit name "${name}"`);
  }
}

// 2-4. Per-function file scans.
const literalRe = /"facilitation_outreach\.[a-z_.]+"/g;
const allowed = new Set(REQUIRED.map((n) => `"${n}"`));

for (const dir of FN_DIRS) {
  const fullDir = resolve(ROOT, dir);
  if (!existsSync(fullDir)) {
    errors.push(`Phase 2 Step 3 edge function dir missing: ${dir}`);
    continue;
  }
  for (const file of walk(fullDir)) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(ROOT.length + 1);
    // 2. Only canonical names appear.
    for (const m of src.match(literalRe) ?? []) {
      if (!allowed.has(m)) errors.push(`${rel}: non-canonical audit name ${m}`);
    }
    // 3. send-only names appear only in send dir.
    if (!dir.endsWith("facilitation-outreach-send")) {
      for (const name of SEND_ONLY) {
        if (src.includes(`"${name}"`)) errors.push(`${rel}: send-only audit "${name}" emitted outside facilitation-outreach-send`);
      }
    }
    // 4. resolve-only names appear only in escalation-resolve dir.
    if (!dir.endsWith("facilitation-outreach-escalation-resolve")) {
      for (const name of RESOLVE_ONLY) {
        if (src.includes(`"${name}"`)) errors.push(`${rel}: resolve-only audit "${name}" emitted outside facilitation-outreach-escalation-resolve`);
      }
    }
    // banned-mutation patterns.
    for (const re of BANNED_MUTATION_PATTERNS) {
      if (re.test(src)) errors.push(`${rel}: banned Phase 2 mutation pattern detected: ${re}`);
    }
  }
}

// 5. No stray facilitation_outreach.* literals outside the SSOT, the 5
// Phase 2 functions, this guard, and the test files.
const ALLOWED_HOSTS = new Set([
  SSOT,
  "scripts/check-facilitation-outreach-audit-names.mjs",
  ...FN_DIRS,
]);
function isUnderAllowed(rel) {
  for (const a of ALLOWED_HOSTS) if (rel === a || rel.startsWith(a + "/") || rel.startsWith(a + "\\")) return true;
  if (rel.startsWith("src/tests/facilitation-outreach")) return true;
  return false;
}
for (const root of ["supabase/functions", "src", "scripts"]) {
  for (const file of walk(resolve(ROOT, root))) {
    const rel = file.slice(ROOT.length + 1);
    if (isUnderAllowed(rel)) continue;
    const src = readFileSync(file, "utf8");
    const m = src.match(literalRe);
    if (m && m.length > 0) {
      errors.push(`${rel}: facilitation_outreach.* literal outside allowed hosts: ${m[0]}`);
    }
  }
}

// 6. Send-path guarantee: ONLY facilitation-outreach-send may hit the
// Resend HTTP API.
const RESEND_PATTERNS = [/api\.resend\.com/i, /resend\.emails\.send/i];
for (const dir of FN_DIRS) {
  for (const file of walk(resolve(ROOT, dir))) {
    const rel = file.slice(ROOT.length + 1);
    if (rel.startsWith("supabase/functions/facilitation-outreach-send")) continue;
    const src = readFileSync(file, "utf8");
    for (const re of RESEND_PATTERNS) {
      if (re.test(src)) errors.push(`${rel}: send path detected outside facilitation-outreach-send`);
    }
  }
}

if (errors.length) {
  console.error("[check-facilitation-outreach-audit-names] FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("[check-facilitation-outreach-audit-names] OK");
