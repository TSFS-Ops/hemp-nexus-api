#!/usr/bin/env node
/**
 * P-5 Batch 7 — no-Batch-8 leakage guard.
 *
 * Ensures no Batch 7 file (registry, future Phase 2–5 surfaces, future
 * guards) accidentally references Batch 8 tokens in executable code.
 * Comment lines (// or --) may reference Batch 8 negatively for scope
 * exclusions; those lines are excluded from the check.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const TARGETS = [
  resolve(ROOT, "src/lib/p5-batch7"),
  resolve(ROOT, "src/pages/admin/p5-batch7"),
  resolve(ROOT, "src/pages/desk/p5-batch7"),
  resolve(ROOT, "src/pages/funder/p5-batch7"),
  resolve(ROOT, "src/components/p5-batch7"),
];

const FORBIDDEN_TOKENS = [
  "p5-batch8",
  "p5_batch8",
  "P5_BATCH8",
  "Batch 8",
  "p5b8",
  "P5B8",
];

function walk(dir, hits = []) {
  if (!existsSync(dir)) return hits;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, hits);
    else if (/\.(ts|tsx|mjs|js|jsx|sql)$/.test(full)) hits.push(full);
  }
  return hits;
}

const errors = [];
const files = TARGETS.flatMap((d) => walk(d));
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const codeOnly = src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("--") && !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
  for (const tok of FORBIDDEN_TOKENS) {
    if (codeOnly.includes(tok)) {
      errors.push(`${f.replace(ROOT + "/", "")}: leaks "${tok}" in executable code`);
      console.error(`  ✗ ${f.replace(ROOT + "/", "")}: leaks "${tok}"`);
    }
  }
}
console.log(`  ✓ Scanned ${files.length} Batch 7 file(s) for Batch 8 leakage`);

if (errors.length) {
  console.error(`\n[check-p5-batch7-no-batch8] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[check-p5-batch7-no-batch8] OK");
