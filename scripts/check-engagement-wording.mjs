#!/usr/bin/env node
/**
 * Batch B Phase 5 — Engagement wording guard.
 *
 * Scans user-facing source for unsafe pre-acceptance / late-acceptance
 * wording. The intent is NOT to ban every occurrence of "accepted" or
 * "sealed" — those words are correct in the right context. The guard
 * flags only the patterns we have explicitly prohibited:
 *
 *   1. The phrase "auto-decline" (and variants) anywhere in user-facing
 *      source. The Batch B contract calls this out by name: a missed
 *      reconfirmation must not be described as an auto-decline.
 *
 *   2. Strings that imply mutual / binding / sealed / settled progress
 *      next to a `late_acceptance_pending_initiator_reconfirmation`
 *      branch — i.e. wording that would misrepresent a recorded late
 *      acceptance as a completed engagement.
 *
 * Exit code 1 when violations are found.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { extname, join } from "path";

const SCAN_DIRS = [
  "src/components",
  "src/pages",
  "src/lib",
  "supabase/functions",
];
const EXTENSIONS = new Set([".ts", ".tsx"]);
const IGNORE = [
  "node_modules",
  ".test.",
  "_test.",
  "tests/",
  "__tests__",
  "scripts/",
  "src/integrations/supabase/types.ts",
  "src/lib/engagement-wording.ts",
  // The guard script itself talks about the banned phrase descriptively.
  "scripts/check-engagement-wording.mjs",
];

const HARD_BANNED = [
  {
    pattern: /auto[-\s_]?decline/gi,
    label: "'auto-decline' wording",
    fix: "Describe as 'late acceptance remains recorded; original engagement remains expired'.",
  },
];

// Wording that is ONLY safe after counterparty acceptance. We scan lines
// that *also* mention pre-acceptance / late-acceptance / renewed states,
// because those are where context-violations have historically crept in.
const CONTEXTUAL_UNSAFE = [
  /\b(?:mutually\s+(?:accepted|binding|agreed)|both\s+parties\s+have\s+(?:accepted|confirmed|agreed))\b/i,
  /\bdeal\s+is\s+(?:final|sealed|settled|executed|complete)\b/i,
  /\bengagement\s+(?:is\s+)?(?:sealed|finalised|finalized|executed|settled)\b/i,
];
const PRE_ACCEPTANCE_KEY = /(notification_sent|contacted|late_acceptance|renewed_from|expired|accepted_after_expiry|pending\s+engagement)/i;

let violations = 0;

function scan(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of HARD_BANNED) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) {
        console.log(`  ${file}:${i + 1}  [HARD] ${rule.label}`);
        console.log(`     ${line.trim().slice(0, 140)}`);
        console.log(`     fix: ${rule.fix}`);
        violations++;
      }
    }
    if (PRE_ACCEPTANCE_KEY.test(line)) {
      for (const re of CONTEXTUAL_UNSAFE) {
        if (re.test(line)) {
          console.log(`  ${file}:${i + 1}  [CONTEXT] unsafe finality wording near pre-acceptance state`);
          console.log(`     ${line.trim().slice(0, 140)}`);
          console.log(`     fix: route this string through getEngagementWording() so the label matches the actual state.`);
          violations++;
        }
      }
    }
  }
}

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (IGNORE.some((p) => full.includes(p))) continue;
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) walk(full);
    else if (EXTENSIONS.has(extname(full))) scan(full);
  }
}

console.log("Batch B Phase 5 — Engagement Wording Guard");
console.log("==========================================");
for (const dir of SCAN_DIRS) walk(dir);
if (violations > 0) {
  console.log(`\n FAIL: ${violations} engagement-wording violation(s).`);
  process.exit(1);
} else {
  console.log("\n PASS: no engagement-wording violations detected.");
}
