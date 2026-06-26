#!/usr/bin/env node
/**
 * P-5 Batch 7 — forbidden field + banned wording guard.
 *
 * Scans all src/pages/**, src/components/** and (when present) Batch 7
 * UI surfaces for any reference to a Batch 7 forbidden external field
 * or banned external wording string. Registry itself is excluded
 * because it defines the strings.
 *
 * Note: this guard is intentionally narrow during Phase 1 — it asserts
 * the registry is the only place these tokens live. Later phases extend
 * coverage to Phase 4 projections and Phase 5 UI surfaces.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const REG = resolve(ROOT, "src/lib/p5-batch7/registry.ts");

const errors = [];
const fail = (m) => { errors.push(m); console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

if (!existsSync(REG)) {
  fail(`Registry missing at ${REG}`);
  process.exit(1);
}
const reg = readFileSync(REG, "utf8");
function extractArray(name) {
  const re = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`);
  const m = reg.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}
const FORBIDDEN = extractArray("P5_BATCH7_FORBIDDEN_EXTERNAL_FIELDS");
const BANNED = extractArray("P5_BATCH7_BANNED_EXTERNAL_WORDING");

// Scan only Batch 7 surfaces that exist today (just the registry's directory).
// As Phases 4/5 land, add their paths to TARGETS.
const TARGETS = [
  resolve(ROOT, "src/lib/p5-batch7"),
  resolve(ROOT, "src/pages/admin/p5-batch7"),
  resolve(ROOT, "src/pages/desk/p5-batch7"),
  resolve(ROOT, "src/pages/funder/p5-batch7"),
  resolve(ROOT, "src/components/p5-batch7"),
];

function walk(dir, hits = []) {
  if (!existsSync(dir)) return hits;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, hits);
    else if (/\.(ts|tsx|mjs|js|jsx)$/.test(full)) hits.push(full);
  }
  return hits;
}

const files = TARGETS.flatMap((d) => walk(d)).filter((p) => p !== REG);
let scanned = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  scanned++;
  for (const ff of FORBIDDEN) {
    if (new RegExp(`\\b${ff}\\b`).test(src))
      fail(`${f.replace(ROOT + "/", "")}: references forbidden field "${ff}"`);
  }
  const lower = src.toLowerCase();
  for (const w of BANNED) {
    if (lower.includes(w.toLowerCase()))
      fail(`${f.replace(ROOT + "/", "")}: contains banned wording "${w}"`);
  }
}
ok(`Scanned ${scanned} file(s) outside the registry`);

if (errors.length) {
  console.error(`\n[check-p5-batch7-forbidden-wording] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[check-p5-batch7-forbidden-wording] OK");
