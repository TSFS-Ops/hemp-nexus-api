#!/usr/bin/env node
/**
 * P-5 Batch 4 — Stage 5 isolation guard (organisation / counterparty
 * user surface only).
 *
 * Stage 5 legitimately adds:
 *   - src/pages/desk/p5-batch4/**         (org-user pages + components)
 *   - src/lib/p5-batch4/org-user-client.ts
 *   - /desk/p5-batch4 + /desk/p5-batch4/:caseId routes (registered in
 *     src/pages/Desk.tsx — these live inside the Desk shell, not under
 *     a top-level App.tsx route).
 *   - audience = "org_user" branch in the Stage 3 edge function.
 *
 * Stage 5 must NOT add:
 *   - any /funder/p5-batch4/* surface
 *   - any /registry/p5-batch4/* surface
 *   - any new Batch 4 edge function (only the Stage 3 summary exists)
 *   - notifications, cron, SLA rules, reports
 *   - direct supabase.from('p5_batch4_*') calls in desk pages/components
 *   - direct supabase.rpc('p5b4_*') calls in desk pages/components
 *   - admin-only RPC wrappers (`p5b4Admin.*`) in desk pages/components
 *   - admin summary client (`p5b4SummaryClient`) in desk pages/components
 *   - admin field rendering (owner_user_id, funder_status,
 *     provider_dependency_status, finality_status, internal_*)
 *   - raw evidence file references / hashes rendered to the user
 *   - forbidden provider wording (verified / compliant / bankable)
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

// --- 1. Forbidden non-desk Batch 4 surfaces (Stage 6 introduced funder UI;
//       desk guard now only forbids the registry surface). ---
for (const rel of [
  "src/pages/registry/p5-batch4",
]) {
  if (existsSync(join(ROOT, rel))) V.push(`Stage 5 leak: ${rel} present`);
}

// --- 2. Only the Stage 3 edge function may exist ---
const fnDir = join(ROOT, "supabase/functions");
const allowedFns = new Set(["p5-batch4-execution-summary", "p5-batch4-sla-monitor"]);
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (/p5-?batch-?4/i.test(name) && !allowedFns.has(name)) {
      V.push(`Stage 5 leak: unexpected Batch 4 edge function "${name}"`);
    }
  }
}

// --- 3. Org-user client must exist and be invoke-only ---
const ouClient = join(ROOT, "src/lib/p5-batch4/org-user-client.ts");
if (!existsSync(ouClient)) {
  V.push("Stage 5 guard: src/lib/p5-batch4/org-user-client.ts missing");
} else {
  const text = readFileSync(ouClient, "utf8");
  if (/supabase\s*\.\s*from\(/.test(text)) {
    V.push("Stage 5 leak: org-user-client.ts calls supabase.from(...) directly");
  }
  if (!/functions\.invoke/.test(text)) {
    V.push("Stage 5 guard: org-user-client.ts must call supabase.functions.invoke");
  }
  if (/audience.{0,20}(admin|funder)/.test(text)) {
    V.push("Stage 5 leak: org-user-client.ts hard-codes a non org_user audience");
  }
}

// --- 4. Desk org-user UI invariants ---
const deskDir = join(ROOT, "src/pages/desk/p5-batch4");
const deskFiles = walk(deskDir).filter((f) => /\.tsx?$/.test(f));
if (deskFiles.length === 0) {
  V.push("Stage 5 guard: no desk UI files under src/pages/desk/p5-batch4");
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
const ADMIN_ONLY_FIELDS = [
  /\bowner_user_id\b/,
  /\bfunder_status\b/,
  /\bfinality_status\b/,
  /\bprovider_dependency_status\b/,
  /\binternal_detail\b/,
  /\binternal_note\b/,
  /\bactor_user_id\b/,
];

for (const f of deskFiles) {
  const text = readFileSync(f, "utf8");

  if (/supabase\s*\.\s*from\(\s*['"]p5_batch4_[a-z_]+['"]\s*\)/.test(text)) {
    V.push(`Stage 5 leak: ${f} calls supabase.from('p5_batch4_*') directly`);
  }
  if (/supabase\s*\.\s*rpc\(/.test(text)) {
    V.push(`Stage 5 leak: ${f} calls supabase.rpc directly (must use p5b4OrgUser wrapper)`);
  }
  // Admin-only wrappers / clients are forbidden here.
  if (/from\s+['"]@\/lib\/p5-batch4\/rpc['"]/.test(text)) {
    if (/p5b4Admin\b/.test(text)) {
      V.push(`Stage 5 leak: ${f} imports p5b4Admin (admin-only RPC wrapper)`);
    }
    if (/p5b4Funder\b/.test(text)) {
      V.push(`Stage 5 leak: ${f} imports p5b4Funder (funder-only RPC wrapper)`);
    }
  }
  if (/from\s+['"]@\/lib\/p5-batch4\/summary-client['"]/.test(text)) {
    V.push(`Stage 5 leak: ${f} imports admin summary-client (must use org-user-client)`);
  }
  // No business-domain table access.
  for (const re of [
    /from\(\s*['"]trade_requests['"]\s*\)/,
    /from\(\s*['"]pois['"]\s*\)/,
    /from\(\s*['"]wads['"]\s*\)/,
    /from\(\s*['"]token_ledger['"]\s*\)/,
    /from\(\s*['"]payment_disputes['"]\s*\)/,
  ]) {
    if (re.test(text)) V.push(`Stage 5 leak: ${f} touches business table (${re})`);
  }
  // No Batch 1/2/3 internal imports.
  for (const re of [
    /from\s+['"]@\/lib\/p5-batch2\/rpc['"]/,
    /from\s+['"]@\/lib\/p5-batch3\/rpc['"]/,
  ]) {
    if (re.test(text)) V.push(`Stage 5 leak: ${f} imports Batch 2/3 internals (${re})`);
  }
  // Forbidden provider wording. Status-badge file is allowed to mention
  // the wording-safe substitute path (uses the wording-guard helper).
  for (const re of FORBIDDEN_WORDING) {
    if (re.test(text)) {
      V.push(`Stage 5 leak: ${f} contains forbidden provider wording (${re})`);
    }
  }
  for (const re of RAW_SENSITIVE) {
    if (re.test(text)) {
      V.push(`Stage 5 leak: ${f} references raw sensitive field (${re})`);
    }
  }
  // Admin-only fields must not appear in desk UI. The evidence-upload
  // component is allowed to NAME `p5b4OrgUser.submitEvidence` args.
  if (!/P5B4DeskEvidenceTask\.tsx$/.test(f)) {
    for (const re of ADMIN_ONLY_FIELDS) {
      if (re.test(text)) {
        V.push(`Stage 5 leak: ${f} renders admin-only field (${re})`);
      }
    }
  } else {
    for (const re of ADMIN_ONLY_FIELDS) {
      if (re.test(text)) {
        V.push(`Stage 5 leak: ${f} renders admin-only field (${re})`);
      }
    }
  }
}

// --- 5. Desk routes must be registered in src/pages/Desk.tsx ---
const deskTsx = join(ROOT, "src/pages/Desk.tsx");
if (existsSync(deskTsx)) {
  const text = readFileSync(deskTsx, "utf8");
  const routes = text.match(/<Route\s+path=["']p5-batch4[^"']*["'][\s\S]*?\/>/g) ?? [];
  if (routes.length < 2) {
    V.push("Stage 5 guard: /desk/p5-batch4 routes not registered in src/pages/Desk.tsx");
  }
  for (const bad of [/\/registry\/p5-batch4/]) {
    if (bad.test(text)) V.push(`Stage 5 leak: src/pages/Desk.tsx registers forbidden Batch 4 route ${bad}`);
  }
}

// --- 6. Edge function must declare the org_user audience ---
const edgePath = join(ROOT, "supabase/functions/p5-batch4-execution-summary/index.ts");
if (existsSync(edgePath)) {
  const text = readFileSync(edgePath, "utf8");
  if (!/audience === "org_user"/.test(text)) {
    V.push("Stage 5 guard: edge function missing audience === \"org_user\" branch");
  }
  if (!/ORG_USER_SAFE_FIELDS/.test(text)) {
    V.push("Stage 5 guard: edge function missing ORG_USER_SAFE_FIELDS allowlist");
  }
  for (const f of ["owner_user_id", "funder_status", "finality_status", "provider_dependency_status"]) {
    if (!new RegExp(`FORBIDDEN_ORG_USER_FIELDS[\\s\\S]{0,400}${f}`).test(text)) {
      V.push(`Stage 5 guard: edge function FORBIDDEN_ORG_USER_FIELDS missing ${f}`);
    }
  }
}

// --- 7. No Batch 4 cron in config.toml ---
const cfg = join(ROOT, "supabase/config.toml");
if (existsSync(cfg)) {
  const text = readFileSync(cfg, "utf8");
  if (/p5-batch4.*\n[^[]*(schedule|cron)/i.test(text)) {
    V.push("Stage 5 leak: supabase/config.toml declares Batch 4 cron");
  }
}

if (V.length > 0) {
  console.error("❌ P5_BATCH_4_STAGE_5_ISOLATION_FAILED");
  for (const v of V) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_4_STAGE_5_ISOLATION_OK");
console.log(`   desk files scanned: ${deskFiles.length}`);
