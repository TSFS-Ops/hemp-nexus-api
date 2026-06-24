#!/usr/bin/env node
// P-5 Batch 2 — provider wording guard: no forbidden phrases in any
// p5-batch2 component/test/edge function source under non-admin scope.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const ROOTS = [
  "src/lib/p5-batch2",
  "src/pages/registry/p5-batch2",
  "src/pages/funder/p5-batch2",
  "supabase/functions/p5-batch2-readiness-summary",
  "supabase/functions/p5-batch2-evidence-sla-monitor",
];
const FORBIDDEN = [
  "Verified", "Passed", "Cleared", "Sanctions Clear", "Bank Verified",
  "Provider Approved", "No Adverse Result",
];
const FORBIDDEN_RE = FORBIDDEN.map((p) => ({
  p,
  re: new RegExp(`(?<!not\\s)(?<!not\\s[a-z-]{1,15}\\s)\\b${p.replace(/ /g, "[ -]?")}\\b`, "i"),
}));
function walk(dir, files = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return files; }
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, files);
    else if (/\.(ts|tsx|mjs)$/.test(e)) files.push(p);
  }
  return files;
}
let bad = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const txt = readFileSync(file, "utf8");
    // Skip the SSOT forbidden list itself + the wording guard implementation +
    // tests that intentionally reference the words inside string arrays.
    if (/constants\.ts$|provider-wording-guard\.ts$/.test(file)) continue;
    if (/\.test\.tsx?$/.test(file)) continue;
    for (const { p, re } of FORBIDDEN_RE) {
      if (re.test(txt)) bad.push(`${file}: forbidden wording "${p}"`);
    }
  }
}
if (bad.length) { console.error("provider-wording:\n" + bad.join("\n")); process.exit(1); }
console.log("provider-wording: OK");
