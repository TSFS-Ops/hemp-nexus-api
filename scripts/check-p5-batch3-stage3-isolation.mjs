#!/usr/bin/env node
/**
 * P-5 Batch 3 — Stage 3 isolation guard.
 *
 * Stage 3 legitimately adds:
 *   - supabase/functions/p5-batch3-funder-summary  (safe summary edge fn)
 *   - src/lib/p5-batch3/rpc.ts                     (thin RPC wrappers)
 *   - one Stage 3 migration containing p5b3_*_v1 RPCs
 *
 * It must NOT add:
 *   - UI pages, hooks, App.tsx route registrations
 *   - notifications.ts, sla-rules.ts, finality-bridge.ts, readiness-bridge.ts
 *   - cron / scheduled function blocks in supabase/config.toml
 *   - any public /api/v1/funder/* route
 *   - imports of Batch 1/2 internals or rewiring of Batch 1/2 RPCs
 *   - mutation references to trade / POI / WaD / billing / payment /
 *     ledger / token / business-decision tables
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const V = [];

const FORBIDDEN_PATHS = [
  "src/pages/admin/p5-batch3",
  "src/pages/funder/p5-batch3",
  "src/pages/registry/p5-batch3",
  "src/hooks/useP5Batch3Permissions.ts",
  "src/lib/p5-batch3/notifications.ts",
  "src/lib/p5-batch3/sla-rules.ts",
  "src/lib/p5-batch3/finality-bridge.ts",
  "src/lib/p5-batch3/readiness-bridge.ts",
  "src/lib/p5-batch3/summary-client.ts",
];
for (const p of FORBIDDEN_PATHS) {
  if (existsSync(join(ROOT, p))) V.push(`Stage 3 leak: ${p} present (Stage 4+ only)`);
}

// Allowed Stage 3 edge function set (exact match list).
const ALLOWED_BATCH3_FNS = new Set(["p5-batch3-funder-summary"]);
const fnDir = join(ROOT, "supabase/functions");
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (/p5-?batch-?3/i.test(name) || /funder/i.test(name)) {
      if (!ALLOWED_BATCH3_FNS.has(name)) {
        V.push(`Stage 3 leak: unexpected edge function "${name}"`);
      }
    }
    if (/^api[-_]?v1[-_]?funder/i.test(name)) {
      V.push(`Stage 3 leak: public api/v1 funder edge fn "${name}" must not exist`);
    }
  }
}

// No /api/v1/funder route in the SPA or in edge functions.
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

const scanRoots = ["src", "supabase/functions"]
  .map((d) => join(ROOT, d))
  .flatMap((d) => walk(d));

for (const f of scanRoots) {
  if (!/p5-batch3|p5_batch3|p5b3/.test(f) && !f.includes("/p5-batch3-funder-summary/")) continue;
  if (!/\.(ts|tsx|mjs|js)$/.test(f)) continue;
  // Allow tests + the isolation guard files to *reference* forbidden tokens
  // as negative-assertion strings.
  const isTest = /\.test\.tsx?$/.test(f);
  const text = readFileSync(f, "utf8");

  // Real route registrations (Hono/Express/fetch/Deno.serve path) — not
  // comments. We approximate by requiring an opening route call before the path.
  if (
    !isTest &&
    /\b(app|router|Deno\.serve|fetch)\b[^\n]{0,40}["']\/api\/v1\/funder/.test(text)
  ) {
    V.push(`Stage 3 leak: ${f} declares /api/v1/funder route`);
  }
  // No Batch 1/2 internal rewiring.
  if (/from\s+['"]@\/lib\/p5-batch2\/(?!summary-client)/.test(text)) {
    V.push(`Stage 3 leak: ${f} imports Batch 2 internals`);
  }
  if (isTest) continue;
  // No mutations against business tables.
  for (const re of [
    /from\(['"]trade_requests['"]\)[^;]{0,80}\.(insert|update|delete|upsert)\(/,
    /from\(['"]pois['"]\)[^;]{0,80}\.(insert|update|delete|upsert)\(/,
    /from\(['"]wads['"]\)[^;]{0,80}\.(insert|update|delete|upsert)\(/,
    /from\(['"]token_ledger['"]\)[^;]{0,80}\.(insert|update|delete|upsert)\(/,
    /from\(['"]token_balances['"]\)[^;]{0,80}\.(insert|update|delete|upsert)\(/,
    /from\(['"]business_decisions['"]\)[^;]{0,80}\.(insert|update|delete|upsert)\(/,
    /from\(['"]payment_disputes['"]\)[^;]{0,80}\.(insert|update|delete|upsert)\(/,
    /atomic_generate_poi/,
    /atomic_token_burn/,
  ]) {
    if (re.test(text)) V.push(`Stage 3 leak: ${f} mutates business table (${re})`);
  }
}

// App.tsx must not register Batch 3 routes yet (Stage 4+).
const appTsx = join(ROOT, "src/App.tsx");
if (existsSync(appTsx)) {
  const text = readFileSync(appTsx, "utf8");
  if (/p5-?batch-?3|p5_batch3|\/funder\/p5-batch3|\/admin\/p5-batch3/.test(text)) {
    V.push("Stage 3 leak: src/App.tsx references Batch 3 routes");
  }
}

// supabase/config.toml must not declare cron / scheduled blocks for Batch 3.
const cfg = join(ROOT, "supabase/config.toml");
if (existsSync(cfg)) {
  const text = readFileSync(cfg, "utf8");
  if (/p5-batch3.*\n[^[]*(schedule|cron)/i.test(text)) {
    V.push("Stage 3 leak: supabase/config.toml declares Batch 3 cron");
  }
}

if (V.length > 0) {
  console.error("❌ P5_BATCH_3_STAGE_3_ISOLATION_FAILED");
  for (const v of V) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_3_STAGE_3_ISOLATION_OK");
console.log(`   allowed edge fns: ${[...ALLOWED_BATCH3_FNS].join(", ")}`);
