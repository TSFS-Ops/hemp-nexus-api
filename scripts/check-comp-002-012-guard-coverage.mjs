#!/usr/bin/env node
// COMP-002 / COMP-012 — verify that every progression surface that runs
// MT-008/MT-009 also invokes the compliance freshness guard, that no
// enum-widening statement targets screening_runs / compliance_cases, and
// that the admin release/close edge functions do not pull in payment or
// credit modules.

import fs from "node:fs";
import path from "node:path";

const PROGRESSION_SURFACES = [
  "supabase/functions/wad/index.ts",
  "supabase/functions/p3-wad/index.ts",
  "supabase/functions/collapse/index.ts",
];

const GUARD_IMPORT = "compliance-freshness-guard";
const GUARD_CALL = "assertCompliantFreshness";

let failed = false;

for (const file of PROGRESSION_SURFACES) {
  if (!fs.existsSync(file)) {
    console.error(`[comp-002-012-guard-coverage] missing surface: ${file}`);
    failed = true;
    continue;
  }
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(GUARD_IMPORT) || !src.includes(GUARD_CALL)) {
    console.error(
      `[comp-002-012-guard-coverage] ${file} must import ${GUARD_IMPORT} and call ${GUARD_CALL}`,
    );
    failed = true;
  }
}

// 2. No enum / CHECK widening on the protected legacy tables.
const MIGRATIONS_DIR = "supabase/migrations";
const FORBIDDEN_PATTERNS = [
  /ALTER\s+TABLE\s+public\.screening_runs[\s\S]*?(DROP\s+CONSTRAINT|ADD\s+CONSTRAINT)/i,
  /ALTER\s+TABLE\s+public\.compliance_cases[\s\S]*?(DROP\s+CONSTRAINT|ADD\s+CONSTRAINT)/i,
];
if (fs.existsSync(MIGRATIONS_DIR)) {
  for (const f of fs.readdirSync(MIGRATIONS_DIR)) {
    if (!f.endsWith(".sql")) continue;
    // Only inspect migrations dated 2026-05-24 or later (this batch onward).
    if (!/^2026/.test(f)) continue;
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    for (const re of FORBIDDEN_PATTERNS) {
      if (re.test(src)) {
        console.error(
          `[comp-002-012-guard-coverage] ${f} alters constraints on screening_runs/compliance_cases — forbidden in COMP Phase 2A.`,
        );
        failed = true;
      }
    }
  }
}

// 3. Release / close must not import payment or credit modules.
const ADMIN_FNS = [
  "supabase/functions/admin-compliance-hold-release/index.ts",
  "supabase/functions/admin-compliance-hold-close/index.ts",
];
const FORBIDDEN_IMPORTS = [
  "atomic_token_burn",
  "paystack",
  "/credit-checkout",
  "credit-checkout.ts",
  "record-billing",
];
for (const file of ADMIN_FNS) {
  if (!fs.existsSync(file)) {
    console.error(`[comp-002-012-guard-coverage] missing admin fn: ${file}`);
    failed = true;
    continue;
  }
  const src = fs.readFileSync(file, "utf8");
  for (const needle of FORBIDDEN_IMPORTS) {
    if (src.includes(needle)) {
      console.error(
        `[comp-002-012-guard-coverage] ${file} references ${needle} — release/close must not trigger payment/credit side effects.`,
      );
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(
  "[comp-002-012-guard-coverage] ok — guard wired into wad/p3-wad/collapse, no enum widening, release/close payment-clean.",
);
