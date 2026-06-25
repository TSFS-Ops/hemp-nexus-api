#!/usr/bin/env node
/**
 * P-5 Batch 5 — Phase 5 UI wording drift guard.
 *
 * Scans every Batch 5 UI file for the 15 banned phrases defined in
 * `src/lib/p5-batch5/outcomes.ts` (P5B5_FORBIDDEN_WORDS). Whole-phrase,
 * case-insensitive substring search.
 *
 * Exempts the SSOT (where the list is defined), the wording helper
 * (which re-exports it), the drift guard itself and the test file
 * (which asserts the list).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const FORBIDDEN = [
  "legally final",
  "guaranteed",
  "risk-free",
  "regulator verified",
  "government approved",
  "bank verified",
  "certified true",
  "fraud-proof",
  "permanent truth",
  "unquestionable",
  "compliant without qualification",
  "ai knows",
  "memory knows",
  "trusted forever",
  "automatically approved",
];

const SCAN_DIRS = [
  "src/pages/admin/p5-batch5",
  "src/pages/desk/p5-batch5",
  "src/pages/funder/p5-batch5",
  "src/components/p5-batch5",
];

const EXEMPT = new Set([
  resolve(ROOT, "src/lib/p5-batch5/outcomes.ts"),
  resolve(ROOT, "src/lib/p5-batch5/wording.ts"),
  resolve(ROOT, "scripts/check-p5-batch5-ui-wording.mjs"),
]);

function walk(dir, out) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|md)$/.test(entry)) out.push(p);
  }
}

const files = [];
for (const d of SCAN_DIRS) walk(resolve(ROOT, d), files);

const errors = [];
for (const f of files) {
  if (EXEMPT.has(f)) continue;
  const src = readFileSync(f, "utf8").toLowerCase();
  for (const phrase of FORBIDDEN) {
    if (src.includes(phrase.toLowerCase())) {
      errors.push(`${f}: forbidden phrase "${phrase}"`);
    }
  }
}

if (errors.length) {
  console.error("[check-p5-batch5-ui-wording] FAIL");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log(`[check-p5-batch5-ui-wording] OK (${files.length} files scanned)`);
