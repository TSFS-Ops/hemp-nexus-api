#!/usr/bin/env node
/** Batch 19A — forbidden-wording guard.
 *  Claim approval must never imply company verification, authority, bank or API
 *  verification. Sample records must never be labelled production-ready. */
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src", "supabase/functions", "docs/registry"];
const FORBIDDEN = [
  // claim-approval over-claims
  /\bclaim\s+approved\s*[:.\-]\s*company\s+verified\b/i,
  /\bclaim\s+approval\s+confirms\s+(?:authority|bank|api)\b/i,
  /\bclaim\s+approval\s+grants?\s+(?:authority|bank|api)\b/i,
  // sample-record over-claims
  /\bsample[_\s-]only.{0,40}production[_\s-]ready\b/i,
  /\bsample[_\s-]only.{0,40}verified[_\s-]by[_\s-]izenzo\b/i,
];
const ALLOWED_FILES = new Set([
  "src/lib/registry-client-decisions-19a.ts",
  "src/tests/batch-19a-client-claim-search-profile-decisions.test.ts",
  "scripts/check-batch-19a-forbidden-wording.mjs",
]);

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|md)$/.test(e.name)) yield p;
  }
}

let bad = 0;
for (const root of ROOTS) {
  for (const f of walk(root)) {
    if (ALLOWED_FILES.has(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    for (const re of FORBIDDEN) {
      if (re.test(src)) {
        console.error(`[batch-19a] forbidden wording in ${f}: ${re}`);
        bad++;
      }
    }
  }
}
if (bad) process.exit(1);
console.log("[batch-19a] forbidden-wording guard ok");
