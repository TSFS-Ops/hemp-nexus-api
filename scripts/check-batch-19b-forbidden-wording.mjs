#!/usr/bin/env node
/** Batch 19B — forbidden UI/API/docs wording guard.
 *  - "claim verified company" wording is blocked
 *  - "claim approval grants authority/bank/api" wording is blocked
 *  - sample_only must never be labelled production-ready or verified */
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src", "supabase/functions", "docs/registry"];
const FORBIDDEN = [
  /\bclaim\s+verified\s+company\b/i,
  /\bclaim\s+approval\s+grants?\s+(?:authority|bank|api)\b/i,
  /\bclaim\s+approval\s+(?:confirms|verifies)\s+(?:the\s+)?company\b/i,
  /\bsample[_\s-]only\s+(?:records?\s+)?(?:is|are)\s+production[_\s-]ready\b/i,
  /\bsample[_\s-]only\s+(?:records?\s+)?(?:is|are)\s+verified[_\s-]by[_\s-]izenzo\b/i,
];
const ALLOWED = new Set([
  "src/lib/registry-client-decisions-19a.ts",
  "src/lib/registry-client-decisions-19b.ts",
  "src/tests/batch-19a-client-claim-search-profile-decisions.test.ts",
  "src/tests/batch-19b-client-decision-ui-api-uat-alignment.test.ts",
  "scripts/check-batch-19a-forbidden-wording.mjs",
  "scripts/check-batch-19b-forbidden-wording.mjs",
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
    if (ALLOWED.has(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    for (const re of FORBIDDEN) {
      if (re.test(src)) {
        console.error(`[batch-19b] forbidden wording in ${f}: ${re}`);
        bad++;
      }
    }
  }
}
if (bad) process.exit(1);
console.log("[batch-19b] forbidden-wording guard ok");
