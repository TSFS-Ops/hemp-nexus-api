#!/usr/bin/env node
// COMP-002 / COMP-012 — pin canonical audit name strings across the SSOT
// modules and forbid drift in either the TS mirror or Deno mirror.

import fs from "node:fs";

const REQUIRED = [
  "compliance.sanctions_rescreen_required",
  "compliance.sanctions_rescreen_passed",
  "compliance.sanctions_potential_match_detected",
  "compliance.sanctions_hold_released",
  "compliance.sanctions_hold_closed",
  "compliance.verification_refresh_required",
  "compliance.verification_refresh_passed",
  "compliance.verification_refresh_failed",
  "compliance.verification_hold_released",
  "compliance.verification_hold_closed",
  "compliance.progression_blocked_sanctions_stale",
  "compliance.progression_blocked_verification_stale",
];

const FILES = [
  "src/lib/compliance/comp-002-012-audit.ts",
  "supabase/functions/_shared/comp-002-012-audit.ts",
];

let failed = false;
for (const f of FILES) {
  if (!fs.existsSync(f)) {
    console.error(`[check-comp-002-012-audit-names] missing file: ${f}`);
    failed = true;
    continue;
  }
  const src = fs.readFileSync(f, "utf8");
  for (const name of REQUIRED) {
    if (!src.includes(`"${name}"`)) {
      console.error(
        `[check-comp-002-012-audit-names] ${f} is missing canonical audit "${name}"`,
      );
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(
  `[check-comp-002-012-audit-names] ok — ${REQUIRED.length} canonical audit names pinned in both mirrors.`,
);
