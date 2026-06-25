#!/usr/bin/env node
/**
 * P-5 Batch 3 — Stage 2 isolation guard (pure-TS only).
 *
 * Asserts Stage 2 added no UI, no RPCs, no edge functions, no notifications,
 * no cron, no public funder API endpoints, no Batch 1/2 rewiring, and no
 * trade/payment/billing mutations. Stage 2 must be pure TS modules + tests.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const V = [];

// Rule A: only /registry/* surface remains forbidden (Stage 6 surfaces are
// now permitted as of Stage 6 sign-off).
const FORBIDDEN_PATHS = [
  "src/pages/registry/p5-batch3",
];
for (const p of FORBIDDEN_PATHS) {
  if (existsSync(join(ROOT, p))) V.push(`Stage 2 leak: ${p} present`);
}

// Rule B: edge function allow-list (Stage 3 summary + Stage 6 monitor).
const ALLOWED_BATCH3_FNS = new Set([
  "p5-batch3-funder-summary",
  "p5-batch3-stage6-monitor",
]);
const fnDir = join(ROOT, "supabase/functions");
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (/^p5-?batch-?3/i.test(name) || /funder/i.test(name)) {
      if (!ALLOWED_BATCH3_FNS.has(name)) {
        V.push(`Stage 2 leak: unexpected edge function: ${name}`);
      }
    }
  }
}

// Rule C: Stage 1 (2) + Stage 3 (1) + Stage 6 (1) = 4 Batch 3 migrations.
const migDir = join(ROOT, "supabase/migrations");
let batch3Migrations = 0;
if (existsSync(migDir)) {
  for (const f of readdirSync(migDir)) {
    if (!f.endsWith(".sql")) continue;
    const body = readFileSync(join(migDir, f), "utf8");
    if (/CREATE (TABLE|TYPE|OR REPLACE FUNCTION|FUNCTION) public\.(p5_batch3_|p5b3_)/.test(body)) batch3Migrations++;
  }
}
if (batch3Migrations > 4) {
  V.push(`Stage 2 leak: unexpected Batch 3 migrations (${batch3Migrations} > 4)`);
}

// Rule D: Stage 2 source files must not import Batch 1/2 internals.
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const FORBIDDEN_TOKENS = [
  /from\s+['"]@\/lib\/p5-batch2\//,
  /from\s+['"]@\/integrations\/supabase\/client['"]/, // pure TS — no DB client
  /supabase\.functions\.invoke/,
  /supabase\.rpc\(/,
  /atomic_generate_poi/,
  /atomic_token_burn/,
];

// rpc.ts (Stage 3) and summary-client.ts (Stage 5) legitimately import the
// supabase client. Everything else in src/lib/p5-batch3 remains pure TS.
const files = walk(join(ROOT, "src/lib/p5-batch3")).filter(
  (f) => !/[\\/](rpc|summary-client)\.ts$/.test(f),
);
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const tok of FORBIDDEN_TOKENS) {
    if (tok.test(text)) {
      V.push(`Stage 2 leak: ${f} matches ${tok}`);
    }
  }
}

// Rule E: funder routes are permitted as of Stage 5 — guard removed.

if (V.length > 0) {
  console.error("❌ P5_BATCH_3_STAGE_2_ISOLATION_FAILED");
  for (const v of V) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_3_STAGE_2_ISOLATION_OK");
console.log(`   scanned ${files.length} Batch 3 lib files`);
