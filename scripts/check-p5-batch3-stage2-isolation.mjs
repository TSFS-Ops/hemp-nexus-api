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

// Rule A: no Stage 4/5/6 files allowed yet (rpc.ts is permitted as of Stage 3).
const FORBIDDEN_PATHS = [
  "src/pages/funder/p5-batch3",
  "src/pages/registry/p5-batch3",
  "src/lib/p5-batch3/summary-client.ts",
  "src/lib/p5-batch3/notifications.ts",
  "src/lib/p5-batch3/sla-rules.ts",
  "src/lib/p5-batch3/finality-bridge.ts",
  "src/lib/p5-batch3/readiness-bridge.ts",
];
for (const p of FORBIDDEN_PATHS) {
  if (existsSync(join(ROOT, p))) V.push(`Stage 2 leak: ${p} present`);
}

// Rule B: only the Stage 3 safe summary edge function is allowed.
const ALLOWED_BATCH3_FNS = new Set(["p5-batch3-funder-summary"]);
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

// Rule C: Stage 3 may add exactly one additional Batch 3 migration
// (Stage 1 contributed two). Anything beyond that requires Stage 4+ sign-off.
const migDir = join(ROOT, "supabase/migrations");
let batch3Migrations = 0;
if (existsSync(migDir)) {
  for (const f of readdirSync(migDir)) {
    if (!f.endsWith(".sql")) continue;
    const body = readFileSync(join(migDir, f), "utf8");
    if (/p5_batch3_|p5b3_/.test(body)) batch3Migrations++;
  }
}
if (batch3Migrations > 3) {
  V.push(`Stage 2 leak: unexpected Batch 3 migrations (${batch3Migrations} > 3)`);
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

// rpc.ts is the legitimate Stage 3 RPC wrapper; it is intentionally
// allowed to import the supabase client and call .rpc().
const files = walk(join(ROOT, "src/lib/p5-batch3")).filter(
  (f) => !/[\\/]rpc\.ts$/.test(f),
);
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const tok of FORBIDDEN_TOKENS) {
    if (tok.test(text)) {
      V.push(`Stage 2 leak: ${f} matches ${tok}`);
    }
  }
}

// Rule E: App.tsx must not register Batch 3 routes yet.
const appTsx = join(ROOT, "src/App.tsx");
if (existsSync(appTsx)) {
  const text = readFileSync(appTsx, "utf8");
  if (/p5-?batch-?3/i.test(text)) {
    V.push("Stage 2 leak: src/App.tsx references Batch 3 routes");
  }
}

if (V.length > 0) {
  console.error("❌ P5_BATCH_3_STAGE_2_ISOLATION_FAILED");
  for (const v of V) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_3_STAGE_2_ISOLATION_OK");
console.log(`   scanned ${files.length} Batch 3 lib files`);
