#!/usr/bin/env node
/**
 * P-5 Batch 3 — Stage 5 isolation guard (funder UI only).
 *
 * Stage 5 legitimately adds:
 *   - src/pages/funder/p5-batch3/**          (funder pages + safe components)
 *   - src/lib/p5-batch3/summary-client.ts    (single funder read path)
 *   - src/lib/p5-batch3/downloads-constants.ts (UI-side constant mirror)
 *   - funder route registrations in src/App.tsx (auth-guarded)
 *
 * Stage 5 must NOT add:
 *   - any /api/v1/funder/* route, page, or edge function
 *   - any /registry/p5-batch3/* surface
 *   - new DB migrations, RPCs, or edge functions
 *   - notifications, cron, SLA rules, finality/Memory bridges (Stage 6)
 *   - direct supabase.from('p5_batch3_*') reads or writes in funder UI
 *   - direct supabase.rpc(...) calls in funder UI
 *   - admin-only RPC wrappers imported into funder UI
 *   - forbidden provider wording verbatim
 *   - raw sensitive field names verbatim
 *   - other-funder fields verbatim
 *   - Batch 1/2 internals / trade / POI / WaD / billing / payment / ledger /
 *     token / business-decision mutations
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const V = [];

// 1. Only /registry/* surface remains forbidden.
const FORBIDDEN_PATHS = [
  "src/pages/registry/p5-batch3",
];
for (const p of FORBIDDEN_PATHS) {
  if (existsSync(join(ROOT, p))) V.push(`Stage 5 leak: ${p} present`);
}

// 2. Edge functions allow-list: Stage 3 summary + Stage 6 monitor.
const ALLOWED_BATCH3_FNS = new Set([
  "p5-batch3-funder-summary",
  "p5-batch3-stage6-monitor",
]);
const fnDir = join(ROOT, "supabase/functions");
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (/p5-?batch-?3/i.test(name) || /funder/i.test(name)) {
      if (!ALLOWED_BATCH3_FNS.has(name)) {
        V.push(`Stage 5 leak: unexpected edge function "${name}"`);
      }
    }
    if (/^api[-_]?v1[-_]?funder/i.test(name)) {
      V.push(`Stage 5 leak: public api/v1 funder edge fn "${name}" must not exist`);
    }
  }
}

// 3. Stage 1 (2) + Stage 3 (1) + Stage 6 (1) = 4 Batch 3 migrations.
const migDir = join(ROOT, "supabase/migrations");
let batch3Migrations = 0;
if (existsSync(migDir)) {
  for (const f of readdirSync(migDir)) {
    if (!f.endsWith(".sql")) continue;
    const body = readFileSync(join(migDir, f), "utf8");
    if (/CREATE (TABLE|TYPE|OR REPLACE FUNCTION|FUNCTION) public\.(p5_batch3_|p5b3_)/.test(body)) batch3Migrations++;
  }
}
if (batch3Migrations !== 4) {
  V.push(`Stage 5 leak: unexpected Batch 3 migration count (${batch3Migrations} != 4)`);
}

// 4. Walk funder pages: only safe RPC wrappers, no direct table writes, no
//    raw sensitive field names, no forbidden wording, no other-funder fields.
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

const funderDir = join(ROOT, "src/pages/funder/p5-batch3");
const funderFiles = walk(funderDir).filter((f) => /\.tsx?$/.test(f));

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

const RAW_SENSITIVE = [
  /\braw_bank_account_number\b/,
  /\braw_iban\b/,
  /\braw_id_number\b/,
  /\braw_passport_number\b/,
  /\braw_ubo_details\b/,
  /\braw_documents\b/,
  /\braw_kyc\b/,
];

const OTHER_FUNDER_FIELDS = [
  /\bother_funder_status\b/,
  /\bother_funder_notes\b/,
  /\bother_funder_requests\b/,
];

// Allowed funder-callable RPC names (positive list).
const ALLOWED_FUNDER_RPCS = new Set([
  "p5b3SubmitRequest",
  "p5b3SubmitOutcome",
  "p5b3RecordDownload",
]);
// Admin-only wrappers — must NOT appear in funder UI.
const FORBIDDEN_ADMIN_RPCS = [
  "p5b3CreateFunderOrg",
  "p5b3UpdateFunderOrg",
  "p5b3InviteFunderUser",
  "p5b3AssignFunderRole",
  "p5b3SetFunderUserStatus",
  "p5b3CreateAccessGrant",
  "p5b3ReleasePackVersion",
  "p5b3ChangeGrantExpiry",
  "p5b3RevokeGrant",
  "p5b3ReactivateGrant",
  "p5b3EditRequestExternalText",
  "p5b3DecideRequest",
  "p5b3ReviewOutcome",
  "p5b3ExitReview",
];

for (const f of funderFiles) {
  const text = readFileSync(f, "utf8");

  // No direct supabase.from('p5_batch3_*') reads OR writes from funder UI.
  if (/supabase\s*\.\s*from\(\s*['"]p5_batch3_[a-z_]+['"]\s*\)/.test(text)) {
    V.push(`Stage 5 leak: ${f} reads/writes p5_batch3_* table directly`);
  }
  // No direct supabase.rpc(...).
  if (/supabase\s*\.\s*rpc\(/.test(text)) {
    V.push(`Stage 5 leak: ${f} calls supabase.rpc directly (use @/lib/p5-batch3/rpc)`);
  }
  // No direct functions.invoke from funder pages — must go through summary-client.
  if (/supabase\s*\.\s*functions\s*\.\s*invoke\(/.test(text)) {
    V.push(`Stage 5 leak: ${f} calls functions.invoke directly (use summary-client)`);
  }
  // No Batch 1/2 internal imports.
  if (/from\s+['"]@\/lib\/p5-batch2\/(?!summary-client)/.test(text)) {
    V.push(`Stage 5 leak: ${f} imports Batch 2 internals`);
  }
  // No admin-only RPC wrappers.
  for (const name of FORBIDDEN_ADMIN_RPCS) {
    const re = new RegExp(`\\b${name}\\b`);
    if (re.test(text)) {
      V.push(`Stage 5 leak: ${f} imports admin-only RPC wrapper ${name}`);
    }
  }
  // Forbidden business-table mutations.
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
    if (re.test(text)) V.push(`Stage 5 leak: ${f} mutates business table (${re})`);
  }
  // Forbidden wording — but safe-label / shell files legitimately compare.
  for (const re of FORBIDDEN_WORDING) {
    if (/P5B3FunderSafeLabel|provider-wording/.test(f)) continue;
    if (re.test(text)) {
      V.push(`Stage 5 leak: ${f} contains forbidden provider wording (${re})`);
    }
  }
  for (const re of RAW_SENSITIVE) {
    if (re.test(text)) V.push(`Stage 5 leak: ${f} references raw sensitive field (${re})`);
  }
  for (const re of OTHER_FUNDER_FIELDS) {
    if (re.test(text)) V.push(`Stage 5 leak: ${f} references other-funder field (${re})`);
  }
  // Funder pages must render provider-derived labels through the guard.
  // Heuristic: any file that displays provider_safe_status_label must import
  // P5B3FunderSafeLabel (or be the component itself).
  if (
    /provider_safe_status_label/.test(text) &&
    !/P5B3FunderSafeLabel|provider-wording/.test(f) &&
    !/P5B3FunderSafeLabel/.test(text)
  ) {
    V.push(`Stage 5 leak: ${f} renders provider label without P5B3FunderSafeLabel guard`);
  }
}

// 5. summary-client.ts must be the single funder read path; assert it exists
//    and exports fetchFunderSummary.
const sc = join(ROOT, "src/lib/p5-batch3/summary-client.ts");
if (!existsSync(sc)) {
  V.push("Stage 5 leak: src/lib/p5-batch3/summary-client.ts missing");
} else {
  const t = readFileSync(sc, "utf8");
  if (!/export\s+(async\s+)?function\s+fetchFunderSummary/.test(t)) {
    V.push("Stage 5 leak: summary-client.ts missing fetchFunderSummary export");
  }
  if (!/p5-batch3-funder-summary/.test(t)) {
    V.push("Stage 5 leak: summary-client.ts does not invoke p5-batch3-funder-summary");
  }
}

// 6. App.tsx: all /funder/p5-batch3/* routes must be wrapped in RequireAuth;
//    no /api/v1/funder/* route; no /registry/p5-batch3/* surface.
const appTsx = join(ROOT, "src/App.tsx");
if (existsSync(appTsx)) {
  const text = readFileSync(appTsx, "utf8");
  if (/\/api\/v1\/funder/.test(text)) {
    V.push("Stage 5 leak: src/App.tsx references /api/v1/funder/*");
  }
  if (/\/registry\/p5-batch3/.test(text)) {
    V.push("Stage 5 leak: src/App.tsx registers /registry/p5-batch3 route");
  }
  const routeRe = /<Route\s+path=["']\/funder\/p5-batch3[^"']*["'][\s\S]*?\/>/g;
  const matches = text.match(routeRe) ?? [];
  for (const m of matches) {
    if (!/RequireAuth/.test(m)) {
      V.push(`Stage 5 leak: funder route not wrapped in RequireAuth: ${m.slice(0, 80)}…`);
    }
  }
  const expected = [
    "/funder/p5-batch3",
    "/funder/p5-batch3/opportunities/:grantId",
    "/funder/p5-batch3/readiness/:grantId",
    "/funder/p5-batch3/requests/:grantId",
    "/funder/p5-batch3/outcomes/:grantId",
    "/funder/p5-batch3/downloads/:grantId",
  ];
  for (const e of expected) {
    if (!text.includes(`path="${e}"`)) {
      V.push(`Stage 5 leak: expected funder route missing: ${e}`);
    }
  }
}

// 7. Walk src to confirm no /api/v1/funder/* declaration anywhere.
const allSrc = walk(join(ROOT, "src")).concat(walk(join(ROOT, "supabase/functions")));
for (const f of allSrc) {
  if (!/\.(ts|tsx|mjs|js)$/.test(f)) continue;
  if (/\.test\.tsx?$/.test(f)) continue;
  const text = readFileSync(f, "utf8");
  if (/\b(app|router|Deno\.serve|fetch)\b[^\n]{0,40}["']\/api\/v1\/funder/.test(text)) {
    V.push(`Stage 5 leak: ${f} declares /api/v1/funder route`);
  }
}

// 8. supabase/config.toml: no Batch 3 cron declarations.
const cfg = join(ROOT, "supabase/config.toml");
if (existsSync(cfg)) {
  const text = readFileSync(cfg, "utf8");
  if (/p5-batch3.*\n[^[]*(schedule|cron)/i.test(text)) {
    V.push("Stage 5 leak: supabase/config.toml declares Batch 3 cron");
  }
}

if (V.length > 0) {
  console.error("❌ P5_BATCH_3_STAGE_5_ISOLATION_FAILED");
  for (const v of V) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_3_STAGE_5_ISOLATION_OK");
console.log(`   funder files scanned: ${funderFiles.length}`);
console.log(`   allowed funder RPCs:  ${[...ALLOWED_FUNDER_RPCS].join(", ")}`);
