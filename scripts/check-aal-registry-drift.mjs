#!/usr/bin/env node
/**
 * SEC-001 — AAL Registry Drift Guard
 *
 * Cross-checks that every `assertAal2({ action: "<key>" })` call-site in
 * `supabase/functions/**` has a matching entry in the
 * `ACTION_AAL_REQUIREMENTS` registry exported by
 * `supabase/functions/aal-preflight/index.ts`, and vice-versa.
 *
 * Rules:
 *  - An action key found in code but missing from the registry FAILS the build.
 *  - A registry key with no matching call-site FAILS the build, unless
 *    explicitly allowlisted (see ALLOWLIST_NO_CALLSITE).
 *  - `break_glass` is deliberately NOT in the preflight registry because the
 *    break-glass endpoint requires fresh GoTrue password re-auth rather than
 *    a cached JWT aal claim. It is explicitly allowlisted here as "must not
 *    appear in the registry".
 *
 * This script runs as part of `npm run prebuild`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");
const REGISTRY_FILE = join(FUNCTIONS_DIR, "aal-preflight", "index.ts");

// Registry keys that may legitimately have no matching `assertAal2()` call-site
// in the repo (e.g. they are gated by a different mechanism but still need to
// be advertised to the UI preflight).
const ALLOWLIST_NO_CALLSITE = new Set([
  // Challenge transitions are emitted from RPC-side handlers that wrap
  // assertAal2 indirectly. Tracked separately by match-challenge tests.
  "match_challenge.transition_outcome_recorded",
  "match_challenge.transition_closed_no_action",
  "match_challenge.platform_admin_override",
  "match_challenge.break_glass",
]);

// Action keys that must NEVER be in the preflight registry. break-glass uses
// password re-auth via GoTrue, not the JWT aal claim, so listing it as
// aal2-gated would mislead the UI.
const MUST_NOT_BE_IN_REGISTRY = new Set([
  "break_glass",
]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, acc);
    } else if (name.endsWith(".ts")) {
      acc.push(full);
    }
  }
  return acc;
}

function loadRegistry() {
  const src = readFileSync(REGISTRY_FILE, "utf8");
  const start = src.indexOf("ACTION_AAL_REQUIREMENTS");
  if (start < 0) {
    throw new Error("ACTION_AAL_REQUIREMENTS not found in aal-preflight/index.ts");
  }
  const open = src.indexOf("{", start);
  const close = src.indexOf("};", open);
  if (open < 0 || close < 0) {
    throw new Error("Could not delimit ACTION_AAL_REQUIREMENTS literal");
  }
  const body = src.slice(open + 1, close);
  const entries = new Map();
  const rx = /["']([^"']+)["']\s*:\s*["'](aal1|aal2)["']/g;
  let m;
  while ((m = rx.exec(body)) !== null) {
    entries.set(m[1], m[2]);
  }
  return entries;
}

function findAssertAal2CallSites() {
  const callSites = new Map(); // action -> [file, ...]
  const files = walk(FUNCTIONS_DIR).filter((f) => !f.includes("/_shared/aal.ts"));
  // Match: action: "key" within ~400 chars after an assertAal2( token.
  const callRx = /assertAal2\s*\(([\s\S]{0,400}?)\)/g;
  const actionRx = /action\s*:\s*["']([^"']+)["']/;
  // Helper wrapper detection: many edge functions define a local helper like
  // `const requireMfaForX = async (...) => { await assertAal2(authHeader, {
  //   ..., action, ... }) }` and then invoke `requireMfaForX("entity.mutate")`.
  // The direct assertAal2 block then carries `action: action` (a variable,
  // not a literal) so the strict scanner above misses the key. To still
  // detect those, if a file imports `assertAal2` we also scan every
  // `action: "literal"` line in the file as a potential gate key.
  const fileImportsAssertAal2 = (src) => /from\s+["']\.\.\/_shared\/aal\.ts["']/.test(src) && /assertAal2/.test(src);
  const literalActionRx = /\baction\s*:\s*["']([a-zA-Z][a-zA-Z0-9_.]+)["']/g;
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    let m;
    while ((m = callRx.exec(src)) !== null) {
      const block = m[1];
      const am = actionRx.exec(block);
      if (am) {
        const key = am[1];
        if (!callSites.has(key)) callSites.set(key, []);
        const list = callSites.get(key);
        if (!list.includes(relative(ROOT, file))) list.push(relative(ROOT, file));
      }
    }
    // Fallback: detect helper-wrapped gate keys.
    if (fileImportsAssertAal2(src)) {
      let lm;
      while ((lm = literalActionRx.exec(src)) !== null) {
        const key = lm[1];
        // Only treat as a gate key if it looks dotted (avoids audit-action
        // false positives like `action: "create"`).
        if (!key.includes(".")) continue;
        if (!callSites.has(key)) callSites.set(key, []);
        const list = callSites.get(key);
        if (!list.includes(relative(ROOT, file))) list.push(relative(ROOT, file));
      }
    }
  }
  return callSites;
}

function main() {
  const registry = loadRegistry();
  const callSites = findAssertAal2CallSites();

  const errors = [];

  // 1. Every call-site action must be in registry.
  for (const [key, files] of callSites) {
    if (!registry.has(key)) {
      errors.push(
        `❌ assertAal2 action "${key}" is used in ${files.join(", ")} but is missing from ACTION_AAL_REQUIREMENTS in aal-preflight/index.ts.`,
      );
    }
  }

  // 2. Every registry key must have a call-site (or be allowlisted).
  for (const [key, level] of registry) {
    if (level !== "aal2") continue;
    if (callSites.has(key)) continue;
    if (ALLOWLIST_NO_CALLSITE.has(key)) continue;
    errors.push(
      `❌ Registry key "${key}" is declared aal2-gated in aal-preflight/index.ts but no assertAal2({ action: "${key}" }) call-site was found in supabase/functions/**. Either wire the gate or add the key to ALLOWLIST_NO_CALLSITE with justification.`,
    );
  }

  // 3. Forbidden keys must NOT be in the registry.
  for (const forbidden of MUST_NOT_BE_IN_REGISTRY) {
    if (registry.has(forbidden)) {
      errors.push(
        `❌ "${forbidden}" must not appear in ACTION_AAL_REQUIREMENTS. It uses GoTrue password re-auth, not the JWT aal claim, and listing it as aal2-gated would mislead the UI.`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("\n❌ AAL registry drift check FAILED:\n");
    for (const e of errors) console.error("  " + e);
    console.error(
      `\nRegistry keys: ${registry.size}\nCall-site keys: ${callSites.size}\n`,
    );
    process.exit(1);
  }

  console.log(
    `✅ AAL registry drift check passed (${registry.size} registry keys, ${callSites.size} call-site keys).`,
  );
}

main();
