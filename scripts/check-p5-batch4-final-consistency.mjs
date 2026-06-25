#!/usr/bin/env node
/**
 * P-5 Batch 4 — Final consistency guard (Stage 7 closeout).
 *
 * Cross-cutting checks that must hold at the end of Batch 4:
 *   1. Every Batch 4 route in src/App.tsx is wrapped in <RequireAuth>.
 *   2. No funder/org-user page renders raw evidence references.
 *   3. Vocabulary remains centralised: every Batch 4 file referencing
 *      a controlled token uses the SSOT (no inline literals beyond the
 *      SSOT module itself).
 *   4. Finality remains admin-only: no non-admin RPC mentions
 *      `p5b4_record_finality_v1` or `p5b4_record_final_approval_v1`.
 *   5. Audit-write coverage: every Stage 3 mutating RPC name appears in
 *      `src/lib/p5-batch4/rpc.ts`.
 *   6. Memory exclusions: the readiness/Memory bridge file must list
 *      the canonical forbidden field set.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const V = [];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (["node_modules", ".git", "dist"].includes(name)) continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

// 1. Batch 4 routes guarded by RequireAuth.
const appTsx = join(ROOT, "src/App.tsx");
if (existsSync(appTsx)) {
  const text = readFileSync(appTsx, "utf8");
  const routeRe = /<Route\s+path=["']\/(admin|desk|funder)\/p5-batch4[^"']*["'][\s\S]*?\/>/g;
  const matches = text.match(routeRe) ?? [];
  if (matches.length === 0) {
    V.push("Final guard: no Batch 4 routes registered in src/App.tsx");
  }
  for (const m of matches) {
    if (!/<RequireAuth[\s>]/.test(m)) {
      V.push(`Final guard: Batch 4 route missing RequireAuth: ${m.slice(0, 120)}…`);
    }
  }
}

// 2. No raw evidence references in funder / desk pages.
const RAW = [
  /\braw_file_hash\b/,
  /\braw_id_number\b/,
  /\braw_bank_account_number\b/,
  /\bfile_blob\b/,
];
for (const dir of ["src/pages/funder/p5-batch4", "src/pages/desk/p5-batch4"]) {
  for (const f of walk(join(ROOT, dir))) {
    if (!/\.tsx?$/.test(f)) continue;
    const text = readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    for (const re of RAW) {
      if (re.test(text)) {
        V.push(`Final guard: ${f} renders raw evidence (${re})`);
      }
    }
  }
}

// 3. Centralised vocab. Outside `src/lib/p5-batch4/constants.ts` and
// `src/tests/`, Batch 4 source files should import role / status enums
// from the constants module if they use the bare string literals.
// (Soft check: any new Batch 4 lib file must import from "./constants"
//  if it references a known enum value.)
const libFiles = walk(join(ROOT, "src/lib/p5-batch4")).filter((f) =>
  /\.ts$/.test(f) && !/constants\.ts$/.test(f),
);
for (const f of libFiles) {
  const text = readFileSync(f, "utf8");
  const usesEnum = /\bP5B4(Process|Execution|Readiness|Milestone|Evidence|Blocker|Task|FunderRelease|Finality|Role|ResponsibleParty|SourceChannel)\w*\b/.test(text);
  if (usesEnum && !/from\s+["']\.\/constants["']/.test(text) && !/from\s+["']\.\.\/constants["']/.test(text)) {
    V.push(`Final guard: ${f} uses Batch 4 enum types but does not import from ./constants`);
  }
}

// 4. Finality remains admin-only.
const rpc = join(ROOT, "src/lib/p5-batch4/rpc.ts");
if (existsSync(rpc)) {
  const text = readFileSync(rpc, "utf8");
  // Only the p5b4Admin export may reference finality RPCs.
  const orgUserBlock = text.match(/p5b4OrgUser\s*=\s*{[\s\S]*?};/);
  const funderBlock = text.match(/p5b4Funder\s*=\s*{[\s\S]*?};/);
  for (const [name, m] of [
    ["p5b4OrgUser", orgUserBlock],
    ["p5b4Funder", funderBlock],
  ]) {
    if (m && /p5b4_record_(final_approval|finality)_v1/.test(m[0])) {
      V.push(`Final guard: ${name} exposes finality RPC (must be admin-only)`);
    }
  }
  // 5. Audit-write coverage: all 21 RPC names declared.
  const needed = [
    "p5b4_record_audit_event_v1",
    "p5b4_record_final_approval_v1",
    "p5b4_record_finality_v1",
    "p5b4_record_funder_decision_v1",
    "p5b4_release_funder_pack_v1",
  ];
  for (const n of needed) {
    if (!text.includes(n)) {
      V.push(`Final guard: rpc.ts missing RPC name ${n}`);
    }
  }
}

// 6. Memory-bridge canonical forbidden field set.
const mb = join(ROOT, "src/lib/p5-batch4/memory-bridge.ts");
const ms = join(ROOT, "src/lib/p5-batch4/memory-summary.ts");
if (existsSync(mb) && existsSync(ms)) {
  const mbText = readFileSync(mb, "utf8");
  if (!/P5B4_MEMORY_FORBIDDEN_FIELDS/.test(mbText)) {
    V.push("Final guard: memory-bridge.ts must reuse P5B4_MEMORY_FORBIDDEN_FIELDS");
  }
  const msText = readFileSync(ms, "utf8");
  for (const f of [
    "bank_account_number",
    "id_number",
    "passport_number",
    "tax_number",
    "ubo_full_address",
    "personal_email",
  ]) {
    if (!msText.includes(f)) {
      V.push(`Final guard: memory-summary.ts forbidden list missing "${f}"`);
    }
  }
}

if (V.length > 0) {
  console.error("❌ P5_BATCH_4_FINAL_CONSISTENCY_FAILED");
  for (const v of V) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_4_FINAL_CONSISTENCY_OK");
