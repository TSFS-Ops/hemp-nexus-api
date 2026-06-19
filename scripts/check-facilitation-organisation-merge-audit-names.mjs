#!/usr/bin/env node
/**
 * Pins the Batch 17 `facilitation.organisation_merge.*` audit names across:
 *   - supabase/functions/_shared/facilitation-case-state.ts (Deno SSOT)
 *   - src/lib/facilitation-case-state.ts                    (browser mirror)
 *
 * Also forbids stray `facilitation.organisation_merge.<x>` literals outside
 * the canonical list anywhere under supabase/functions/ or src/.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const REQUIRED = [
  "facilitation.organisation_merge.eligibility_checked",
  "facilitation.organisation_merge.blocked",
  "facilitation.organisation_merge.confirmed",
  "facilitation.organisation_merge.completed",
];

const SSOT_FILES = [
  "supabase/functions/_shared/facilitation-case-state.ts",
  "src/lib/facilitation-case-state.ts",
];

const errors = [];

for (const f of SSOT_FILES) {
  const path = resolve(ROOT, f);
  if (!existsSync(path)) { errors.push(`Missing SSOT file: ${f}`); continue; }
  const src = readFileSync(path, "utf8");
  for (const name of REQUIRED) {
    if (!src.includes(`"${name}"`)) errors.push(`${f} missing canonical audit name "${name}"`);
  }
}

const SCAN_ROOTS = ["supabase/functions", "src"];
const literalRe = /"facilitation\.organisation_merge\.[a-z_]+"/g;
const allow = new Set(REQUIRED.map((n) => `"${n}"`));

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

for (const root of SCAN_ROOTS) {
  for (const file of walk(resolve(ROOT, root))) {
    const src = readFileSync(file, "utf8");
    const matches = src.match(literalRe) ?? [];
    for (const m of matches) {
      if (!allow.has(m)) errors.push(`${file}: non-canonical audit literal ${m}`);
    }
  }
}

if (errors.length) {
  console.error("[check-facilitation-organisation-merge-audit-names] FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`[check-facilitation-organisation-merge-audit-names] OK (${REQUIRED.length} pinned)`);
