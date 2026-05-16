#!/usr/bin/env node
/**
 * Batch U — Required Fix 4: function/RPC migration coupling guard.
 *
 * Greps every `.rpc("name", …)` call site inside `supabase/functions/**`
 * and verifies that the named function is declared somewhere in
 * `supabase/migrations/**` via a `CREATE [OR REPLACE] FUNCTION public.name`
 * statement.
 *
 * Allowlist covers RPCs that are intentionally provided by Supabase /
 * pgcrypto / extensions and therefore won't appear in our migrations.
 *
 * Fails (exit 1) if any edge function references an RPC that has no
 * migration providing it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "supabase", "functions");
const MIG_DIR = join(ROOT, "supabase", "migrations");

// Built-in / extension-provided RPCs that we don't define ourselves.
const ALLOWLIST = new Set([
  // pgcrypto / auth conveniences sometimes called via .rpc — extend as
  // needed and document why.
]);

function walk(dir, exts) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

// 1) Collect every RPC name declared in our migrations.
const fnRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gi;
const declared = new Set();
for (const file of walk(MIG_DIR, [".sql"])) {
  const src = readFileSync(file, "utf8");
  let m;
  while ((m = fnRe.exec(src)) !== null) declared.add(m[1]);
}

// 2) Collect every RPC call from edge functions.
const callRe = /\.rpc\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']/g;
const violations = [];
for (const file of walk(FN_DIR, [".ts"])) {
  // Skip test files — they may reference scratch RPCs.
  if (/_test\.ts$|\.test\.ts$/.test(file)) continue;
  const src = readFileSync(file, "utf8");
  let m;
  while ((m = callRe.exec(src)) !== null) {
    const name = m[1];
    if (ALLOWLIST.has(name)) continue;
    if (!declared.has(name)) {
      violations.push({ file: relative(ROOT, file), name });
    }
  }
}

if (violations.length > 0) {
  console.error("[check-edge-function-rpc-coverage] FAIL — RPCs called from edge functions but missing in supabase/migrations:");
  for (const v of violations) {
    console.error(`  - ${v.file}  →  rpc("${v.name}")`);
  }
  console.error(`\nFix: add a migration that CREATE [OR REPLACE]s the missing function, or add the name to the allowlist in scripts/check-edge-function-rpc-coverage.mjs with a written justification.`);
  process.exit(1);
}

console.log(`[check-edge-function-rpc-coverage] OK — all referenced RPCs are migration-backed (${declared.size} declared).`);
