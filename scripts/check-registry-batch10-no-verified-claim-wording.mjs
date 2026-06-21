#!/usr/bin/env node
/**
 * Batch 10 — Forbid wording that implies claim_enabled means verified /
 * production-ready / institutionally usable / authority confirmed /
 * bank verified, anywhere in the registry surfaces.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const FORBIDDEN = [
  /verified company/i,
  /verified profile/i,
  /production[\s-]ready/i,
  /institutionally usable/i,
  /bank details verified/i,
  /authority confirmed/i,
  /officially verified/i,
];

const SCAN_ROOTS = [
  "src/pages/registry",
  "src/pages/admin/registry",
  "src/components/registry",
  "supabase/functions",
];

const SSOT_FILES = new Set([
  "src/lib/registry-record-lifecycle.ts",
  "supabase/functions/_shared/registry-record-lifecycle.ts",
  "scripts/check-registry-batch10-no-verified-claim-wording.mjs",
  "scripts/check-registry-record-lifecycle-parity.mjs",
]);

const failures = [];

function walk(root) {
  let entries;
  try { entries = readdirSync(root); } catch { return; }
  for (const e of entries) {
    const full = join(root, e);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if ([".ts", ".tsx"].includes(extname(full))) scan(full);
  }
}

function scan(path) {
  if (SSOT_FILES.has(path)) return;
  const src = readFileSync(path, "utf8");
  const lines = src.split(/\r?\n/);
  // Negative / disclaimer context: legitimate to mention forbidden phrases.
  const isNegativeContext = (line) =>
    /\b(not|never|no|do not|don't|cannot|must not|disclaim|forbid|forbidden|without|excludes?|exclude|FORBIDDEN|removed|denied)\b/i.test(line)
    || /^\s*[\/*#-]/.test(line) // comments/bullets often describe rules
    || /forbidden|disclaim|warning|guard|rule:/i.test(line);
  for (const re of FORBIDDEN) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!re.test(line)) continue;
      if (isNegativeContext(line)) continue;
      failures.push(`${path}:${i + 1}: forbidden wording "${line.match(re)[0]}"`);
    }
  }
}

for (const r of SCAN_ROOTS) walk(r);

if (failures.length) {
  console.error("[check-registry-batch10-no-verified-claim-wording] FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("[check-registry-batch10-no-verified-claim-wording] OK");
