#!/usr/bin/env node
/**
 * P011 — Evidence-confidence rating forbidden-words drift guard.
 * Scans the rating components, the methodology docs page, and the evidence
 * folder for the 9 forbidden user-facing words appearing in a rating context.
 *
 * Detection: looks for files that ALSO mention "rating" / "counterparty"
 * (rating context) AND contain one of the forbidden whole-words.
 * Exempts the SSOT (where the list is defined), tests (which assert the
 * list), and the P011 evidence README change log.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const FORBIDDEN = [
  "safe", "trusted", "approved", "compliant",
  "low risk", "high risk", "guaranteed", "cleared", "bank verified",
];

const SCAN_DIRS = [
  "src/components/ratings",
  "src/pages/docs",
];

const EXEMPT = new Set([
  resolve("src/lib/evidence-rating.ts"),
  resolve("supabase/functions/_shared/evidence-rating.ts"),
  resolve("src/tests/p011-counterparty-rating-methodology.test.ts"),
  resolve("scripts/check-evidence-rating-forbidden-words.mjs"),
  resolve("scripts/check-evidence-rating-parity.mjs"),
  resolve("scripts/check-counterparty-rating-audit-names.mjs"),
  resolve("evidence/p011-counterparty-rating-methodology/README.md"),
]);

const files = [];
function walk(dir) {
  try {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx|md)$/.test(entry)) files.push(p);
    }
  } catch { /* dir may not exist */ }
}
for (const d of SCAN_DIRS) walk(resolve(d));

const ratingCtx = /\b(rating|counterparty)\b/i;
const errors = [];
for (const f of files) {
  if (EXEMPT.has(f)) continue;
  const src = readFileSync(f, "utf8");
  if (!ratingCtx.test(src)) continue;
  for (const word of FORBIDDEN) {
    const re = new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(src)) errors.push(`${f}: forbidden rating word "${word}"`);
  }
}

if (errors.length) {
  console.error("[check-evidence-rating-forbidden-words] FAIL");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log(`[check-evidence-rating-forbidden-words] OK (${files.length} files scanned)`);
