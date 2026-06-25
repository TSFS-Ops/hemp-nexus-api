#!/usr/bin/env node
/**
 * P-5 Batch 4 — Stage 4 isolation guard (admin UI only).
 *
 * Stage 4 legitimately adds:
 *   - src/pages/admin/p5-batch4/**          (admin pages + components)
 *   - src/lib/p5-batch4/summary-client.ts   (typed wrapper around the
 *                                           Stage 3 edge function)
 *   - admin-only route registrations in src/App.tsx (platform_admin guarded)
 *
 * Stage 4 must NOT add:
 *   - any /funder/p5-batch4/* route or page
 *   - any /desk/p5-batch4/* route or page
 *   - any /registry/p5-batch4/* surface
 *   - additional Batch 4 edge functions beyond the Stage 3 summary
 *   - notifications, cron, SLA rules, reports
 *   - direct supabase.from('p5_batch4_*') calls from pages/components
 *   - direct supabase.rpc('p5b4_*') calls (must go via @/lib/p5-batch4/rpc)
 *   - mutations against trade / POI / WaD / token / payment tables
 *   - any new Batch 1/2/3 file modifications
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

// --- 1. Forbidden non-admin Batch 4 surfaces ---
for (const rel of [
  "src/pages/funder/p5-batch4",
  "src/pages/desk/p5-batch4",
  "src/pages/registry/p5-batch4",
]) {
  if (existsSync(join(ROOT, rel))) V.push(`Stage 4 leak: ${rel} present`);
}

// --- 2. Single Batch 4 edge function ---
const fnDir = join(ROOT, "supabase/functions");
const allowedFns = new Set(["p5-batch4-execution-summary"]);
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (/p5-?batch-?4/i.test(name) && !allowedFns.has(name)) {
      V.push(`Stage 4 leak: unexpected Batch 4 edge function "${name}"`);
    }
  }
}

// --- 3. Admin UI invariants ---
const adminDir = join(ROOT, "src/pages/admin/p5-batch4");
const adminFiles = walk(adminDir).filter((f) => /\.tsx?$/.test(f));
if (adminFiles.length === 0) {
  V.push("Stage 4 guard: no admin UI files found under src/pages/admin/p5-batch4");
}

const FORBIDDEN_WORDING = [
  /\bverified\b/i,
  /\bcompliant\b/i,
  /\bbankable\b/i,
  /\blive[-\s]provider verified\b/i,
];
const RAW_SENSITIVE = [
  /\braw_file_hash\b/,
  /\braw_id_number\b/,
  /\braw_bank_account_number\b/,
];

for (const f of adminFiles) {
  const text = readFileSync(f, "utf8");

  // Direct table reads/writes are forbidden.
  if (/supabase\s*\.\s*from\(\s*['"]p5_batch4_[a-z_]+['"]\s*\)/.test(text)) {
    V.push(`Stage 4 leak: ${f} calls supabase.from('p5_batch4_*') directly`);
  }
  // Direct rpc calls are forbidden (must go through @/lib/p5-batch4/rpc).
  if (/supabase\s*\.\s*rpc\(/.test(text)) {
    V.push(`Stage 4 leak: ${f} calls supabase.rpc directly (must use @/lib/p5-batch4/rpc)`);
  }
  // No mutation of trade / POI / WaD / token / payment tables.
  for (const re of [
    /from\(\s*['"]trade_requests['"]\s*\)/,
    /from\(\s*['"]pois['"]\s*\)/,
    /from\(\s*['"]wads['"]\s*\)/,
    /from\(\s*['"]token_ledger['"]\s*\)/,
    /from\(\s*['"]token_wallets['"]\s*\)/,
    /from\(\s*['"]payment_disputes['"]\s*\)/,
    /atomic_generate_poi/,
    /atomic_token_burn/,
  ]) {
    if (re.test(text)) V.push(`Stage 4 leak: ${f} touches business table (${re})`);
  }
  // No Batch 1/2/3 internal imports.
  for (const re of [
    /from\s+['"]@\/lib\/p5-batch2\/rpc['"]/,
    /from\s+['"]@\/lib\/p5-batch3\/rpc['"]/,
    /\bp5b2_[a-z_]+_v\d+/,
    /\bp5b3_[a-z_]+_v\d+/,
  ]) {
    if (re.test(text)) V.push(`Stage 4 leak: ${f} imports Batch 2/3 internals (${re})`);
  }
  // Forbidden provider wording (skip the wording-guard itself and badge translator).
  if (!/P5B4ProviderSafeLabel|P5B4StatusBadge/.test(f)) {
    for (const re of FORBIDDEN_WORDING) {
      if (re.test(text)) {
        V.push(`Stage 4 leak: ${f} contains forbidden provider wording (${re})`);
      }
    }
  }
  for (const re of RAW_SENSITIVE) {
    if (re.test(text)) {
      V.push(`Stage 4 leak: ${f} renders raw sensitive field (${re})`);
    }
  }
}

// --- 4. App.tsx admin routes must be platform_admin guarded ---
const appTsx = join(ROOT, "src/App.tsx");
if (existsSync(appTsx)) {
  const text = readFileSync(appTsx, "utf8");
  for (const bad of [/\/funder\/p5-batch4/, /\/desk\/p5-batch4/, /\/registry\/p5-batch4/]) {
    if (bad.test(text)) V.push(`Stage 4 leak: src/App.tsx registers forbidden Batch 4 route ${bad}`);
  }
  const routeRe = /<Route\s+path=["']\/admin\/p5-batch4[^"']*["'][\s\S]*?\/>/g;
  const matches = text.match(routeRe) ?? [];
  if (matches.length === 0) {
    V.push("Stage 4 guard: no /admin/p5-batch4 routes registered in src/App.tsx");
  }
  for (const m of matches) {
    if (!/role=["']platform_admin["']/.test(m)) {
      V.push(`Stage 4 leak: admin route not guarded by platform_admin: ${m.slice(0, 100)}…`);
    }
  }
}

// --- 5. supabase/config.toml: no Batch 4 cron declarations ---
const cfg = join(ROOT, "supabase/config.toml");
if (existsSync(cfg)) {
  const text = readFileSync(cfg, "utf8");
  if (/p5-batch4.*\n[^[]*(schedule|cron)/i.test(text)) {
    V.push("Stage 4 leak: supabase/config.toml declares Batch 4 cron");
  }
}

// --- 6. summary-client.ts must use functions.invoke, not direct table reads ---
const sc = join(ROOT, "src/lib/p5-batch4/summary-client.ts");
if (!existsSync(sc)) {
  V.push("Stage 4 guard: src/lib/p5-batch4/summary-client.ts missing");
} else {
  const text = readFileSync(sc, "utf8");
  if (/supabase\s*\.\s*from\(/.test(text)) {
    V.push("Stage 4 leak: summary-client.ts calls supabase.from(...) directly");
  }
  if (!/functions\.invoke/.test(text)) {
    V.push("Stage 4 guard: summary-client.ts must call supabase.functions.invoke");
  }
}

if (V.length > 0) {
  console.error("❌ P5_BATCH_4_STAGE_4_ISOLATION_FAILED");
  for (const v of V) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_4_STAGE_4_ISOLATION_OK");
console.log(`   admin files scanned: ${adminFiles.length}`);
