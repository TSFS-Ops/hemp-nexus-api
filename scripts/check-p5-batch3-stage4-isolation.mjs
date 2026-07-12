#!/usr/bin/env node
/**
 * P-5 Batch 3 — Stage 4 isolation guard (admin UI only).
 *
 * Stage 4 legitimately adds:
 *   - src/pages/admin/p5-batch3/**          (admin pages + components)
 *   - admin-only route registrations in src/App.tsx (platform_admin guarded)
 *
 * Stage 4 must NOT add:
 *   - any /funder/p5-batch3/* route or page
 *   - any /registry/p5-batch3/* funder/customer surface
 *   - any /api/v1/funder/* route or edge function
 *   - notifications, cron, SLA rules, finality/readiness bridges
 *   - direct supabase.from('p5_batch3_*').(insert|update|delete|upsert) from UI
 *   - mutations against trade / POI / WaD / billing / payment tables
 *   - any new Batch 1/2 file modifications
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const V = [];

// Forbidden surfaces: only /registry/* remains forbidden.
const FORBIDDEN_PATHS = [
  "src/pages/registry/p5-batch3",
];
for (const p of FORBIDDEN_PATHS) {
  if (existsSync(join(ROOT, p))) V.push(`Stage 4 leak: ${p} present`);
}

// Edge functions allow-list: Stage 3 summary + Stage 6 monitor.
const ALLOWED_BATCH3_FNS = new Set([
  "p5-batch3-funder-summary",
  "p5-batch3-stage6-monitor",
  // Institutional Funder Evidence Workspace — Batch 4 (V1 sealed-pack pipeline; outside legacy p5-batch3 surface).
  "funder-pack-generate",
  "funder-pack-download",
]);
const fnDir = join(ROOT, "supabase/functions");
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (/p5-?batch-?3/i.test(name) || /funder/i.test(name)) {
      if (!ALLOWED_BATCH3_FNS.has(name)) {
        V.push(`Stage 4 leak: unexpected edge function "${name}"`);
      }
    }
    if (/^api[-_]?v1[-_]?funder/i.test(name)) {
      V.push(`Stage 4 leak: public api/v1 funder edge fn "${name}" must not exist`);
    }
  }
}

// Walk admin pages: must call only RPC wrappers, no direct table writes, no
// raw sensitive field renderings, must use ProviderSafeLabel for provider wording.
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

const adminDir = join(ROOT, "src/pages/admin/p5-batch3");
const adminFiles = walk(adminDir).filter((f) => /\.tsx?$/.test(f));

// Tokens that must never appear verbatim in admin UI (forbidden wording).
const FORBIDDEN_WORDING = [
  /\bVerified\b/,
  /\bGuaranteed\b/,
  /\bCompliance Passed\b/,
  /\bSanctions Cleared\b/,
  /\bBankable\b/,
  /\bProvider Verified\b/,
  /\bInvestment Grade\b/,
  /\bDue Diligence Complete\b/,
];

// Raw sensitive field names must not be rendered.
const RAW_SENSITIVE = [
  /\braw_bank_account_number\b/,
  /\braw_iban\b/,
  /\braw_id_number\b/,
  /\braw_passport_number\b/,
  /\braw_ubo_details\b/,
];

for (const f of adminFiles) {
  const text = readFileSync(f, "utf8");

  // Direct table writes are forbidden.
  if (/supabase\s*\.\s*from\(\s*['"]p5_batch3_[a-z_]+['"]\s*\)[^;]{0,120}\.(insert|update|delete|upsert)\(/.test(text)) {
    V.push(`Stage 4 leak: ${f} writes directly to p5_batch3_* table`);
  }
  // Forbidden mutation of business tables.
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
    if (re.test(text)) V.push(`Stage 4 leak: ${f} mutates business table (${re})`);
  }
  // No direct supabase.rpc(...) — must go through src/lib/p5-batch3/rpc.ts.
  if (/supabase\s*\.\s*rpc\(/.test(text)) {
    V.push(`Stage 4 leak: ${f} calls supabase.rpc directly (must use @/lib/p5-batch3/rpc)`);
  }
  // No imports of Batch 1/2 internals.
  if (/from\s+['"]@\/lib\/p5-batch2\/(?!summary-client)/.test(text)) {
    V.push(`Stage 4 leak: ${f} imports Batch 2 internals`);
  }
  // Forbidden wording must not appear as plain UI text.
  for (const re of FORBIDDEN_WORDING) {
    // allow inside the wording-guard registries themselves
    if (/provider-wording|ProviderSafeLabel/.test(f)) continue;
    if (re.test(text)) {
      V.push(`Stage 4 leak: ${f} contains forbidden provider wording (${re})`);
    }
  }
  for (const re of RAW_SENSITIVE) {
    if (re.test(text)) {
      V.push(`Stage 4 leak: ${f} references raw sensitive field (${re})`);
    }
  }
}

// App.tsx invariants: admin /admin/p5-batch3 routes must remain platform_admin
// guarded. Funder /funder/p5-batch3 routes are permitted as of Stage 5.
const appTsx = join(ROOT, "src/App.tsx");
if (existsSync(appTsx)) {
  const text = readFileSync(appTsx, "utf8");
  if (/\/registry\/p5-batch3/.test(text)) {
    V.push("Stage 4 leak: src/App.tsx registers /registry/p5-batch3 route (forbidden)");
  }
  // Every /admin/p5-batch3 route must include role="platform_admin".
  const routeRe = /<Route\s+path=["']\/admin\/p5-batch3[^"']*["'][\s\S]*?\/>/g;
  for (const m of text.match(routeRe) ?? []) {
    if (!/role=["']platform_admin["']/.test(m)) {
      V.push(`Stage 4 leak: admin route not guarded by platform_admin: ${m.slice(0, 80)}…`);
    }
  }
}

// supabase/config.toml: no Batch 3 cron declarations.
const cfg = join(ROOT, "supabase/config.toml");
if (existsSync(cfg)) {
  const text = readFileSync(cfg, "utf8");
  if (/p5-batch3.*\n[^[]*(schedule|cron)/i.test(text)) {
    V.push("Stage 4 leak: supabase/config.toml declares Batch 3 cron");
  }
}

if (V.length > 0) {
  console.error("❌ P5_BATCH_3_STAGE_4_ISOLATION_FAILED");
  for (const v of V) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_3_STAGE_4_ISOLATION_OK");
console.log(`   admin files scanned: ${adminFiles.length}`);
