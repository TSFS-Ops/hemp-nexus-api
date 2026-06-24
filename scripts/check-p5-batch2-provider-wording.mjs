#!/usr/bin/env node
// P-5 Batch 2 — provider wording guard.
// Checks that NO forbidden provider wording is present in *rendered* content
// on Stage 5 customer/funder/API surfaces. The SSOT (constants.ts), the
// wording-guard module, edge functions (which echo statuses as enum tokens
// only), and admin surfaces are deliberately excluded because the wording
// is checked at render time via `ProviderSafeLabel` there.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const ROOTS = [
  "src/pages/registry/p5-batch2",
  "src/pages/funder/p5-batch2",
];
const FORBIDDEN = [
  /\bverified\b/i,
  /\bpassed\b/i,
  /\bcleared\b/i,
  /\bsanctions\s+clear\b/i,
  /\bbank\s+verified\b/i,
  /\bprovider\s+approved\b/i,
  /\bno\s+adverse\s+result\b/i,
];
function walk(dir, files = []) {
  let entries; try { entries = readdirSync(dir); } catch { return files; }
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, files);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\./.test(e)) files.push(p);
  }
  return files;
}
function stripCommentsAndStrings(src) {
  // Strip JS line + block comments. Keep string literals (they may render).
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const NEGATION = /\bnot\b\s+(?:[a-z-]+\s+){0,3}$/i;
let bad = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const cleaned = stripCommentsAndStrings(readFileSync(file, "utf8"));
    for (const re of FORBIDDEN) {
      const m = re.exec(cleaned);
      if (!m) continue;
      const preceding = cleaned.slice(0, m.index);
      if (NEGATION.test(preceding)) continue;
      bad.push(`${file}: forbidden wording near offset ${m.index} ("${m[0]}")`);
    }
  }
}
if (bad.length) { console.error("provider-wording:\n" + bad.join("\n")); process.exit(1); }
console.log("provider-wording: OK");
