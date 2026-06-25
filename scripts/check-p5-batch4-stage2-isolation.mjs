#!/usr/bin/env node
/**
 * P-5 Batch 4 — Stage 2 isolation guard (static grep).
 *
 * Stage 2 introduces pure-TS engine modules under src/lib/p5-batch4/.
 *
 * Rules:
 *   A. Every Stage 2 module MUST import controlled vocab from
 *      `./constants` (or `@/lib/p5-batch4/constants`). The SSOT is the
 *      only place where status/milestone/blocker/etc string literals
 *      live; re-defining them locally is forbidden.
 *   B. Stage 2 modules must not import the Supabase client, any RPC
 *      module, any UI, any route registration, or any Batch 1/2/3 RPC.
 *   C. Stage 2 must not add edge functions, UI surfaces, or App.tsx
 *      route registrations.
 *   D. Stage 1 invariants (no Batch 4 edge functions, no Batch 4 UI)
 *      still hold.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const VIOLATIONS = [];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === "node_modules" || name === ".git" || name === "dist") continue;
      walk(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

const libDir = join(ROOT, "src/lib/p5-batch4");
const libFiles = walk(libDir).filter((p) => p.endsWith(".ts"));

// Stage 3 introduces `rpc.ts`, which legitimately imports the supabase
// client and is exempt from the "pure-TS only" Stage 2 ban.
const STAGE3_EXEMPT_BASENAMES = new Set(["rpc.ts"]);

const FORBIDDEN_IMPORT_TOKENS = [
  /from\s+['"]@\/integrations\/supabase\/client['"]/,
  /from\s+['"]@\/lib\/p5-batch2\/rpc['"]/,
  /from\s+['"]@\/lib\/p5-batch3\/rpc['"]/,
  /from\s+['"]react['"]/,
  /from\s+['"]react-router-dom['"]/,
  /\bp5b2_[a-z_]+_v[0-9]+\b/,
  /\bp5b3_[a-z_]+_v[0-9]+\b/,
  /atomic_generate_poi/,
  /atomic_token_burn/,
];


// Names of SSOT exports the guard knows about. Any *local* re-declaration
// of these vocab arrays inside a Stage 2 module is a leak.
const SSOT_CONST_NAMES = [
  "P5B4_PROCESS_TYPES",
  "P5B4_EXECUTION_STATUSES",
  "P5B4_READINESS_STATUSES",
  "P5B4_MILESTONE_KEYS",
  "P5B4_MILESTONE_STATUSES",
  "P5B4_EVIDENCE_STATUSES",
  "P5B4_BLOCKER_KEYS",
  "P5B4_BLOCKER_TYPES",
  "P5B4_TASK_STATUSES",
  "P5B4_FUNDER_RELEASE_STATUSES",
  "P5B4_FINALITY_OUTCOMES",
  "P5B4_ROLE_KEYS",
];

const REQUIRED_IMPORT_RE = /from\s+['"](?:\.\/constants|@\/lib\/p5-batch4\/constants)['"]/;
// Files in src/lib/p5-batch4 that are themselves the SSOT or do not need
// to consume vocabulary directly.
const SSOT_EXEMPT_BASENAMES = new Set(["constants.ts"]);

for (const f of libFiles) {
  const text = readFileSync(f, "utf8");
  const rel = relative(ROOT, f);
  const base = rel.split(/[\\/]/).pop() ?? "";

  // rpc.ts is a Stage 3 wrapper; it is allowed to import the supabase
  // client. All other forbidden tokens (Batch 2/3 RPCs, React, router)
  // still apply.
  if (!STAGE3_EXEMPT_BASENAMES.has(base)) {
    for (const tok of FORBIDDEN_IMPORT_TOKENS) {
      if (tok.test(text)) {
        VIOLATIONS.push(`Stage 2 leak: ${rel} contains forbidden token ${tok}`);
      }
    }
  } else {
    // Even exempt files must not reach into Batch 2/3 RPCs or trade paths.
    for (const tok of FORBIDDEN_IMPORT_TOKENS.slice(1)) {
      if (tok.test(text)) {
        VIOLATIONS.push(`Stage 2 leak: ${rel} contains forbidden token ${tok}`);
      }
    }
  }

  // Local re-declaration of SSOT constants
  for (const name of SSOT_CONST_NAMES) {
    const reDecl = new RegExp(`\\b(const|let|var|export\\s+const)\\s+${name}\\b`);
    if (rel.endsWith("constants.ts")) continue;
    if (reDecl.test(text)) {
      VIOLATIONS.push(`Stage 2 leak: ${rel} re-declares SSOT constant ${name}`);
    }
  }

  if (!SSOT_EXEMPT_BASENAMES.has(base) && !STAGE3_EXEMPT_BASENAMES.has(base)) {
    const referencesConstants =
      REQUIRED_IMPORT_RE.test(text) ||
      /from\s+['"]\.\/(constants|roles|blockers|milestones|permissions|wording-guard|finality)['"]/.test(text);
    if (!referencesConstants) {
      VIOLATIONS.push(`Stage 2 leak: ${rel} does not depend on the Batch 4 SSOT`);
    }
  }
}


// --- Stage 2 must not add edge functions, UI surfaces, or App.tsx routes ---
// --- Stage 2 invariants that still hold cumulatively after Stage 3 ---
// Stage 3 may add exactly one edge function (p5-batch4-execution-summary)
// and one additional migration (RPC wrappers). Anything beyond that is a
// surface leak Stage 2 must catch.
const ALLOWED_BATCH4_EDGE_FNS = new Set(["p5-batch4-execution-summary"]);
const fnDir = join(ROOT, "supabase/functions");
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (/^p5-?batch-?4/i.test(name) && !ALLOWED_BATCH4_EDGE_FNS.has(name)) {
      VIOLATIONS.push(`Stage 2 guard: unexpected Batch 4 edge function: ${name}`);
    }
  }
}
const FORBIDDEN_UI_DIRS = [
  "src/pages/admin/p5-batch4",
  "src/pages/funder/p5-batch4",
  "src/pages/desk/p5-batch4",
  "src/pages/registry/p5-batch4",
];
for (const rel of FORBIDDEN_UI_DIRS) {
  if (existsSync(join(ROOT, rel))) {
    VIOLATIONS.push(`Stage 2 guard: forbidden surface present: ${rel}`);
  }
}
const appTsx = join(ROOT, "src/App.tsx");
if (existsSync(appTsx)) {
  const text = readFileSync(appTsx, "utf8");
  if (/p5-batch4/i.test(text)) {
    VIOLATIONS.push("Stage 2 guard: src/App.tsx references p5-batch4 (no routes allowed yet)");
  }
}

const migDir = join(ROOT, "supabase/migrations");
let batch4Migrations = 0;
if (existsSync(migDir)) {
  for (const f of readdirSync(migDir)) {
    if (!f.endsWith(".sql")) continue;
    const body = readFileSync(join(migDir, f), "utf8");
    if (/CREATE (TABLE|TYPE|OR REPLACE FUNCTION|FUNCTION) public\.(p5_batch4_|p5b4_)/.test(body)) {
      batch4Migrations++;
    }
  }
}
// Stage 1 + Stage 3 = at most 2 Batch 4 migrations until Stage 7.
if (batch4Migrations < 1 || batch4Migrations > 2) {
  VIOLATIONS.push(`Stage 2 leak: expected 1-2 Batch 4 migrations, got ${batch4Migrations}`);
}

if (VIOLATIONS.length > 0) {
  console.error("❌ P5_BATCH_4_STAGE_2_ISOLATION_FAILED");
  for (const v of VIOLATIONS) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_4_STAGE_2_ISOLATION_OK");
console.log(`   Batch 4 lib files scanned: ${libFiles.length}`);
console.log(`   Batch 4 migrations: ${batch4Migrations}`);

