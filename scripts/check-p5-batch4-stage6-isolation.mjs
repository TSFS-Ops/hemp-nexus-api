#!/usr/bin/env node
/**
 * P-5 Batch 4 — Stage 6 isolation guard (funder surface only).
 *
 * Stage 6 legitimately adds:
 *   - src/pages/funder/p5-batch4/**          (funder pages + components)
 *   - src/lib/p5-batch4/funder-client.ts     (typed audience=funder wrapper)
 *   - /funder/p5-batch4 + /funder/p5-batch4/:caseId routes in src/App.tsx
 *   - audience=funder release-metadata extension to the Stage 3 edge fn
 *
 * Stage 6 must NOT add:
 *   - any /registry/p5-batch4/* surface
 *   - any new Batch 4 edge function (only the Stage 3 summary exists)
 *   - notifications, cron, SLA rules, reports, finality/readiness bridges
 *   - direct supabase.from('p5_batch4_*') calls in funder pages/components
 *   - direct supabase.rpc('p5b4_*') calls in funder pages/components
 *   - admin-only RPC wrappers (`p5b4Admin.*`) in funder pages/components
 *   - org-user RPC wrappers (`p5b4OrgUser.*`) in funder pages/components
 *   - admin summary client (`p5b4SummaryClient`) in funder pages/components
 *   - org-user summary client (`p5b4OrgUserClient`) in funder pages/components
 *   - admin-only / org-user-only fields (owner_user_id, finality_status,
 *     provider_dependency_status, internal_*, audit, raw evidence refs)
 *   - forbidden provider wording (verified / compliant / bankable /
 *     live-provider verified)
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

// --- 1. Forbidden non-funder Batch 4 surfaces ---
for (const rel of ["src/pages/registry/p5-batch4"]) {
  if (existsSync(join(ROOT, rel))) V.push(`Stage 6 leak: ${rel} present`);
}

// --- 2. Only the Stage 3 edge function may exist ---
const fnDir = join(ROOT, "supabase/functions");
const allowedFns = new Set(["p5-batch4-execution-summary"]);
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (/p5-?batch-?4/i.test(name) && !allowedFns.has(name)) {
      V.push(`Stage 6 leak: unexpected Batch 4 edge function "${name}"`);
    }
  }
}

// --- 3. Funder client must exist and be invoke-only, audience=funder ---
const fc = join(ROOT, "src/lib/p5-batch4/funder-client.ts");
if (!existsSync(fc)) {
  V.push("Stage 6 guard: src/lib/p5-batch4/funder-client.ts missing");
} else {
  const text = readFileSync(fc, "utf8");
  if (/supabase\s*\.\s*from\(/.test(text)) {
    V.push("Stage 6 leak: funder-client.ts calls supabase.from(...) directly");
  }
  if (/supabase\s*\.\s*rpc\(/.test(text)) {
    V.push("Stage 6 leak: funder-client.ts calls supabase.rpc(...) directly");
  }
  if (!/functions\.invoke/.test(text)) {
    V.push("Stage 6 guard: funder-client.ts must call supabase.functions.invoke");
  }
  if (!/audience["']?\s*,\s*["']funder["']/.test(text) && !/qs\.set\(["']audience["'],\s*["']funder["']\)/.test(text)) {
    V.push("Stage 6 guard: funder-client.ts must pin audience=funder");
  }
  if (/audience["']?\s*[,:]\s*["'](admin|org_user)["']/.test(text)) {
    V.push("Stage 6 leak: funder-client.ts hard-codes a non funder audience");
  }
}

// --- 4. Funder UI invariants ---
const funderDir = join(ROOT, "src/pages/funder/p5-batch4");
const funderFiles = walk(funderDir).filter((f) => /\.tsx?$/.test(f));
if (funderFiles.length === 0) {
  V.push("Stage 6 guard: no funder UI files under src/pages/funder/p5-batch4");
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
  /\bfile_reference\s*[:=]/,
  /\bfile_hash\s*[:=]/,
];
const ADMIN_OR_ORGUSER_ONLY_FIELDS = [
  /\bowner_user_id\b/,
  /\bcreated_by\b/,
  /\blinked_company_id\b/,
  /\blinked_transaction_id\b/,
  /\blinked_project_id\b/,
  /\blinked_workstream_id\b/,
  /\bresponsible_party_id\b/,
  /\bmemory_summary_id\b/,
  /\bfinality_status\b/,
  /\bprovider_dependency_status\b/,
  /\binternal_detail\b/,
  /\binternal_note\b/,
  /\bactor_user_id\b/,
];

for (const f of funderFiles) {
  const rawText = readFileSync(f, "utf8");
  // Strip /* ... */ and // comments so doc strings naming forbidden
  // tokens (explicitly explaining "never render X") do not trip the
  // grep. The compiled code still must not contain them.
  const text = rawText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  if (/supabase\s*\.\s*from\(\s*['"]p5_batch4_[a-z_]+['"]\s*\)/.test(text)) {
    V.push(`Stage 6 leak: ${f} calls supabase.from('p5_batch4_*') directly`);
  }
  if (/supabase\s*\.\s*rpc\(/.test(text)) {
    V.push(`Stage 6 leak: ${f} calls supabase.rpc directly (must use p5b4Funder wrapper)`);
  }
  // Admin / org-user wrappers and clients are forbidden here.
  if (/from\s+['"]@\/lib\/p5-batch4\/rpc['"]/.test(text)) {
    if (/\bp5b4Admin\b/.test(text)) {
      V.push(`Stage 6 leak: ${f} imports p5b4Admin (admin-only RPC wrapper)`);
    }
    if (/\bp5b4OrgUser\b/.test(text)) {
      V.push(`Stage 6 leak: ${f} imports p5b4OrgUser (org-user RPC wrapper)`);
    }
  }
  if (/from\s+['"]@\/lib\/p5-batch4\/summary-client['"]/.test(text)) {
    V.push(`Stage 6 leak: ${f} imports admin summary-client (must use funder-client)`);
  }
  if (/from\s+['"]@\/lib\/p5-batch4\/org-user-client['"]/.test(text)) {
    V.push(`Stage 6 leak: ${f} imports org-user-client (must use funder-client)`);
  }
  // No business-domain table access.
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
    if (re.test(text)) V.push(`Stage 6 leak: ${f} touches business table (${re})`);
  }
  // No Batch 1/2/3 internal imports.
  for (const re of [
    /from\s+['"]@\/lib\/p5-batch2\/rpc['"]/,
    /from\s+['"]@\/lib\/p5-batch3\/rpc['"]/,
    /\bp5b2_[a-z_]+_v\d+/,
    /\bp5b3_[a-z_]+_v\d+/,
  ]) {
    if (re.test(text)) V.push(`Stage 6 leak: ${f} imports Batch 2/3 internals (${re})`);
  }
  // Forbidden provider wording — status badge is allowed because it
  // routes through the wording-guard safe label.
  if (!/P5B4FunderStatusBadge\.tsx$/.test(f)) {
    for (const re of FORBIDDEN_WORDING) {
      if (re.test(text)) {
        V.push(`Stage 6 leak: ${f} contains forbidden provider wording (${re})`);
      }
    }
  }
  for (const re of RAW_SENSITIVE) {
    if (re.test(text)) {
      V.push(`Stage 6 leak: ${f} references raw sensitive field (${re})`);
    }
  }
  for (const re of ADMIN_OR_ORGUSER_ONLY_FIELDS) {
    if (re.test(text)) {
      V.push(`Stage 6 leak: ${f} renders admin/org-user-only field (${re})`);
    }
  }
}

// --- 5. Funder routes must be registered in src/App.tsx and be authenticated ---
const appTsx = join(ROOT, "src/App.tsx");
if (existsSync(appTsx)) {
  const text = readFileSync(appTsx, "utf8");
  const routes = text.match(/<Route\s+path=["']\/funder\/p5-batch4[^"']*["'][\s\S]*?\/>/g) ?? [];
  if (routes.length < 2) {
    V.push("Stage 6 guard: /funder/p5-batch4 routes not registered in src/App.tsx");
  }
  for (const m of routes) {
    if (!/<RequireAuth[\s>]/.test(m)) {
      V.push(`Stage 6 leak: funder route not wrapped in RequireAuth: ${m.slice(0, 100)}…`);
    }
  }
}

// --- 6. Edge function must declare audience=funder and the funder-safe
//        field allowlist (released-only / funder-org scoping). ---
const edgePath = join(ROOT, "supabase/functions/p5-batch4-execution-summary/index.ts");
if (existsSync(edgePath)) {
  const text = readFileSync(edgePath, "utf8");
  if (!/FUNDER_SAFE_FIELDS/.test(text)) {
    V.push("Stage 6 guard: edge function missing FUNDER_SAFE_FIELDS allowlist");
  }
  if (!/p5b4_current_funder_org/.test(text)) {
    V.push("Stage 6 guard: edge function missing funder-org gate (p5b4_current_funder_org)");
  }
  if (!/p5_batch4_funder_releases/.test(text)) {
    V.push("Stage 6 guard: edge function missing release-only scoping (p5_batch4_funder_releases)");
  }
  if (!/neq\(['"]status['"],\s*['"]revoked['"]\)/.test(text)) {
    V.push("Stage 6 guard: edge function must exclude revoked releases");
  }
  if (!/access_expires_at/.test(text)) {
    V.push("Stage 6 guard: edge function must enforce release expiry");
  }
  for (const f of ["owner_user_id", "finality_status", "provider_dependency_status"]) {
    if (!new RegExp(`FORBIDDEN_FUNDER_FIELDS[\\s\\S]{0,400}${f}`).test(text)) {
      V.push(`Stage 6 guard: edge function FORBIDDEN_FUNDER_FIELDS missing ${f}`);
    }
  }
}

// --- 7. No Batch 4 cron in supabase/config.toml ---
const cfg = join(ROOT, "supabase/config.toml");
if (existsSync(cfg)) {
  const text = readFileSync(cfg, "utf8");
  if (/p5-batch4.*\n[^[]*(schedule|cron)/i.test(text)) {
    V.push("Stage 6 leak: supabase/config.toml declares Batch 4 cron");
  }
}

if (V.length > 0) {
  console.error("❌ P5_BATCH_4_STAGE_6_ISOLATION_FAILED");
  for (const v of V) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_4_STAGE_6_ISOLATION_OK");
console.log(`   funder files scanned: ${funderFiles.length}`);
