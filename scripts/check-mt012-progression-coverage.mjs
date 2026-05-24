#!/usr/bin/env node
/**
 * MT-012 — Progression-guard coverage pin.
 *
 * Asserts:
 *  1. The five protected progression surfaces still import
 *     `assertMatchProgressable` so the exception-hold marker continues to
 *     block POI / WaD / execution / finality / outreach.
 *  2. The match-progression guard still recognises the
 *     `parent_archived_admin_exception_hold` marker.
 *  3. No MT-012 edge function references payment or credit-burn surfaces.
 */
import { readFileSync, existsSync } from "node:fs";

const failures = [];
const fail = (m) => failures.push(m);

const PROTECTED = [
  "supabase/functions/poi-engagements/index.ts",
  "supabase/functions/poi-transition/index.ts",
  "supabase/functions/wad/index.ts",
  "supabase/functions/p3-wad/index.ts",
  "supabase/functions/collapse/index.ts",
];
for (const p of PROTECTED) {
  if (!existsSync(p)) { fail(`Missing protected surface: ${p}`); continue; }
  const body = readFileSync(p, "utf8");
  if (!body.includes("assertMatchProgressable")) {
    fail(`${p} no longer imports assertMatchProgressable — MT-012 hold coverage at risk`);
  }
}

const guard = existsSync("supabase/functions/_shared/match-progression-guard.ts")
  ? readFileSync("supabase/functions/_shared/match-progression-guard.ts", "utf8")
  : "";
if (!guard.includes("parent_archived_admin_exception_hold")) {
  fail("match-progression-guard.ts no longer recognises parent_archived_admin_exception_hold");
}

const MT012_EDGE = [
  "supabase/functions/trade-request-archive/index.ts",
  "supabase/functions/admin-trade-request-archive-override/index.ts",
  "supabase/functions/admin-trade-request-exception-hold-release/index.ts",
];
const FORBIDDEN = [
  "atomic_token_burn",
  "token_ledger",
  "credits.purchased",
  "credits.granted",
  "payment_intents",
  "paystack",
];
for (const p of MT012_EDGE) {
  if (!existsSync(p)) { fail(`Missing MT-012 edge function: ${p}`); continue; }
  // Strip comments (// to EOL and /* ... */) before scanning for forbidden surfaces
  // so safety-promise comments aren't flagged.
  const raw = readFileSync(p, "utf8");
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .toLowerCase();
  for (const term of FORBIDDEN) {
    if (stripped.includes(term.toLowerCase())) {
      fail(`${p} must not reference payment/credit surface: ${term}`);
    }
  }
}

if (failures.length) {
  console.error("\n❌ MT-012 progression-coverage guard FAILED:\n");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(
  `✓ MT-012 progression coverage: ${PROTECTED.length} protected surface(s), exception-hold marker recognised, ${MT012_EDGE.length} MT-012 edge fn(s) free of payment/credit surfaces.`,
);
