#!/usr/bin/env node
/**
 * P-5 Batch 3 — Stage 6 isolation guard.
 *
 * Stage 6 legitimately adds:
 *   - src/lib/p5-batch3/notifications.ts
 *   - src/lib/p5-batch3/sla-rules.ts
 *   - src/lib/p5-batch3/finality-bridge.ts
 *   - src/lib/p5-batch3/readiness-bridge.ts
 *   - supabase/functions/p5-batch3-stage6-monitor (internal-cron, non-public)
 *   - one Stage 6 migration adding p5_batch3_tasks + p5b3_record_task_intent_v1
 *
 * Stage 6 must NOT add:
 *   - any /api/v1/funder/* route, page, or edge function
 *   - any /registry/p5-batch3/* surface
 *   - Batch 1/2 rewiring or trade/POI/WaD/billing/payment/ledger/token/
 *     business-decision mutations
 *   - public funder-callable endpoints
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
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

// 1. Allowed edge fns: summary (Stage 3) + monitor (Stage 6) only.
const ALLOWED_BATCH3_FNS = new Set([
  "p5-batch3-funder-summary",
  "p5-batch3-stage6-monitor",
]);
const fnDir = join(ROOT, "supabase/functions");
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (/p5-?batch-?3/i.test(name) || /funder/i.test(name)) {
      if (!ALLOWED_BATCH3_FNS.has(name)) {
        V.push(`Stage 6 leak: unexpected edge function "${name}"`);
      }
    }
    if (/^api[-_]?v1[-_]?funder/i.test(name)) {
      V.push(`Stage 6 leak: public api/v1 funder edge fn "${name}" must not exist`);
    }
  }
}

// 2. Monitor must require internal key + not declare /api/v1/funder.
const monitor = join(ROOT, "supabase/functions/p5-batch3-stage6-monitor/index.ts");
if (existsSync(monitor)) {
  const text = readFileSync(monitor, "utf8");
  if (!/x-internal-cron-key/i.test(text) || !/INTERNAL_CRON_KEY/.test(text)) {
    V.push("Stage 6 leak: monitor missing internal-cron-key auth");
  }
  if (/\b(app|router|Deno\.serve|fetch)\b[^\n]{0,40}["']\/api\/v1\/funder/.test(text)) {
    V.push("Stage 6 leak: monitor declares /api/v1/funder route");
  }
  // Monitor must not mutate Batch 1/2 business tables.
  for (const re of [
    /from\(['"]trade_requests['"]\)[^;]{0,80}\.(insert|update|delete|upsert)\(/,
    /from\(['"]pois['"]\)[^;]{0,80}\.(insert|update|delete|upsert)\(/,
    /from\(['"]wads['"]\)[^;]{0,80}\.(insert|update|delete|upsert)\(/,
    /from\(['"]token_ledger['"]\)[^;]{0,80}\.(insert|update|delete|upsert)\(/,
    /from\(['"]business_decisions['"]\)[^;]{0,80}\.(insert|update|delete|upsert)\(/,
    /atomic_generate_poi/,
    /atomic_token_burn/,
  ]) {
    if (re.test(text)) V.push(`Stage 6 leak: monitor mutates business table (${re})`);
  }
}

// 3. Migration count: Stage 1 (2) + Stage 3 (1) + Stage 6 (1) = 4.
let batch3Migrations = 0;
const migDir = join(ROOT, "supabase/migrations");
if (existsSync(migDir)) {
  for (const f of readdirSync(migDir)) {
    if (!f.endsWith(".sql")) continue;
    const body = readFileSync(join(migDir, f), "utf8");
    if (/p5_batch3_|p5b3_/.test(body)) batch3Migrations++;
  }
}
if (batch3Migrations !== 4) {
  V.push(`Stage 6 leak: expected 4 Batch 3 migrations, found ${batch3Migrations}`);
}

// 4. Stage 6 lib modules must be pure TS (no supabase client/rpc/invoke).
const PURE_STAGE6 = [
  "src/lib/p5-batch3/notifications.ts",
  "src/lib/p5-batch3/sla-rules.ts",
  "src/lib/p5-batch3/finality-bridge.ts",
  "src/lib/p5-batch3/readiness-bridge.ts",
];
for (const rel of PURE_STAGE6) {
  const f = join(ROOT, rel);
  if (!existsSync(f)) {
    V.push(`Stage 6 leak: required module missing: ${rel}`);
    continue;
  }
  const text = readFileSync(f, "utf8");
  if (/from\s+['"]@\/integrations\/supabase\/client['"]/.test(text)) {
    V.push(`Stage 6 leak: ${rel} imports supabase client (must be pure TS)`);
  }
  if (/supabase\s*\.\s*(rpc|from|functions)/.test(text)) {
    V.push(`Stage 6 leak: ${rel} calls supabase.* directly`);
  }
}

// 5. No /api/v1/funder route anywhere in src or supabase/functions.
const allFiles = walk(join(ROOT, "src")).concat(walk(join(ROOT, "supabase/functions")));
for (const f of allFiles) {
  if (!/\.(ts|tsx|mjs|js)$/.test(f)) continue;
  if (/\.test\.tsx?$/.test(f)) continue;
  const text = readFileSync(f, "utf8");
  if (/\b(app|router|Deno\.serve|fetch)\b[^\n]{0,40}["']\/api\/v1\/funder/.test(text)) {
    V.push(`Stage 6 leak: ${f} declares /api/v1/funder route`);
  }
}

// 6. No /registry/p5-batch3 surface anywhere in src/pages.
if (existsSync(join(ROOT, "src/pages/registry/p5-batch3"))) {
  V.push("Stage 6 leak: /registry/p5-batch3 surface present");
}

if (V.length > 0) {
  console.error("❌ P5_BATCH_3_STAGE_6_ISOLATION_FAILED");
  for (const v of V) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_3_STAGE_6_ISOLATION_OK");
console.log(`   allowed edge fns: ${[...ALLOWED_BATCH3_FNS].join(", ")}`);
console.log(`   Batch 3 migrations: ${batch3Migrations}`);
