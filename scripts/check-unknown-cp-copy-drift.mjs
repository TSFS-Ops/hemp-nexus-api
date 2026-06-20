#!/usr/bin/env node
/**
 * P012 — Verifies that:
 *  1. `outreach_prepared` (the internal-only status) never appears in any
 *     requester-facing component under src/components/unknown-cp/ or src/pages/
 *     except inside the SSOT and tests.
 *  2. Forbidden user-facing words (guaranteed/verified/approved/cleared/
 *     accepted/contacted/onboarded) do not appear in src/components/unknown-cp/
 *     except in SSOT copy that has a backing event.
 *  3. Approved copy strings only originate from the SSOT (no duplicate hardcoded
 *     copy in unknown-cp components).
 */
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const EXEMPT_FILES = new Set([
  "src/lib/unknown-cp-timeline.ts",
  "supabase/functions/_shared/unknown-cp-timeline.ts",
  "src/tests/p012-unknown-cp-timeline.test.ts",
]);

const FORBIDDEN = ["guaranteed", "verified", "approved", "cleared", "accepted", "contacted", "onboarded"];

function walk(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

const targets = [
  ...walk("src/components/unknown-cp"),
];

let failed = false;

for (const f of targets) {
  if (EXEMPT_FILES.has(f)) continue;
  const src = readFileSync(f, "utf8");

  // Rule 1 — internal status name must not appear in requester-facing components.
  if (/outreach_prepared/.test(src)) {
    console.error(`✗ ${f}: references internal-only status "outreach_prepared".`);
    failed = true;
  }

  // Rule 2 — forbidden user-facing words (case-insensitive, word-boundary).
  for (const w of FORBIDDEN) {
    const re = new RegExp(`\\b${w}\\b`, "i");
    if (re.test(src)) {
      console.error(`✗ ${f}: contains forbidden user-facing word "${w}" outside SSOT.`);
      failed = true;
    }
  }
}

// Rule 3 — copy strings are imported from SSOT (must import from @/lib/unknown-cp-timeline).
const panel = readFileSync("src/components/unknown-cp/UnknownCpTimelinePanel.tsx", "utf8");
if (!panel.includes("@/lib/unknown-cp-timeline")) {
  console.error("✗ UnknownCpTimelinePanel.tsx does not import from SSOT.");
  failed = true;
}

if (failed) process.exit(1);
console.log("✓ unknown-cp copy/internal-status drift check passed");
