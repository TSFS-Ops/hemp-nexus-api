#!/usr/bin/env node
/**
 * Phase 1 hard guarantee: the facilitation feature must NOT introduce any
 * email / notification send path, POI / WaD / match / token / credit /
 * payment mutation. Phase 1 is intake + admin triage + manual-log only.
 *
 * Scans the five facilitation edge function directories and the client
 * surfaces under src/{components,pages}/**facilitation* for forbidden
 * call sites.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const FN_DIRS = [
  "supabase/functions/create-facilitation-case",
  "supabase/functions/get-facilitation-case",
  "supabase/functions/list-facilitation-cases",
  "supabase/functions/facilitation-case-admin-action",
  "supabase/functions/register-facilitation-case-evidence",
];

// Forbidden literals: any send / notification / mutation path.
const FORBIDDEN = [
  // Outreach / email
  /send-transactional-email/i,
  /send-team-invite/i,
  /notification-dispatch/i,
  /resend\.emails\.send/i,
  /api\.resend\.com/i,
  /smtp\.|sendgrid|twilio/i,
  // POI / WaD / match / token / payment mutations
  /atomic_generate_poi/i,
  /atomic_token_burn/i,
  /atomic_token_credit/i,
  /atomic_accept_bind/i,
  /atomic_engagement_transition/i,
  /\bwads\b.*\.insert\(/i,
  /\bmatches\b.*\.insert\(/i,
  /\bpois\b.*\.insert\(/i,
  /\btoken_ledger\b.*\.insert\(/i,
  /\btoken_purchases\b.*\.insert\(/i,
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

function scan(file) {
  const src = readFileSync(file, "utf8");
  // Strip /* ... */ block comments and // line comments to avoid false positives.
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const re of FORBIDDEN) {
    if (re.test(stripped)) errors.push(`${file}: forbidden pattern ${re}`);
  }
}

for (const d of FN_DIRS) {
  for (const f of walk(resolve(ROOT, d))) scan(f);
}

// Scan client surfaces matching *facilitation*.
function walkAll(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walkAll(full));
    else if (/\.(ts|tsx)$/.test(e) && /facilitation/i.test(e)) out.push(full);
  }
  return out;
}
for (const root of ["src/components", "src/pages", "src/lib"]) {
  for (const f of walkAll(resolve(ROOT, root))) {
    // Same forbidden list — but note `src/lib/facilitation-case-state.ts` is pure SSOT.
    scan(f);
  }
}

if (errors.length) {
  console.error("[check-facilitation-no-send-path] FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("[check-facilitation-no-send-path] OK");
