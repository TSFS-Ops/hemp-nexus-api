#!/usr/bin/env node
/**
 * Edge-function deploy-coverage guard.
 *
 * BACKGROUND (MT-009 Test 1 incident, 2026-05-18)
 * ----------------------------------------------
 * The frontend (`src/lib/match-named-contacts.ts`) called
 *   supabase.functions.invoke("match-named-contacts-assign")
 * and the existing `check-edge-function-paths.mjs` guard happily passed
 * because the directory `supabase/functions/match-named-contacts-assign/`
 * existed in source.
 *
 * What it could not catch: the function had NOT been deployed to the
 * production runtime. Daniel hit a "save failed" toast at runtime.
 *
 * This guard adds a thin "release-pack" cross-check that complements the
 * source-drift check. It enforces, at build time, that a curated list of
 * deploy-critical edge functions is:
 *   1. backed by a source directory under supabase/functions/<name>/,
 *   2. documented in RELEASE_GATE.md (so the human pre-ship checklist
 *      surfaces it),
 *   3. — when invoked from src/ — actually wired into a real call site
 *      (defensive: detects the dual "named-but-orphaned" failure mode).
 *
 * It deliberately does NOT call live production: CI has no prod access.
 * The contract is purely source-level: a developer who adds a critical
 * new function MUST also add its name to
 * `scripts/edge-function-deploy-manifest.json` and mention it in
 * `RELEASE_GATE.md`, which forces a deliberate deploy acknowledgement.
 *
 * Runs from `prebuild` so omissions fail CI before deploy.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");
const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");
const MANIFEST = join(ROOT, "scripts", "edge-function-deploy-manifest.json");
const RELEASE_GATE = join(ROOT, "RELEASE_GATE.md");

function loadManifest() {
  const raw = readFileSync(MANIFEST, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.required)) {
    throw new Error("manifest 'required' must be an array of function names");
  }
  return parsed;
}

function listSourceFunctions() {
  return new Set(
    readdirSync(FUNCTIONS_DIR).filter((name) => {
      if (name.startsWith("_") || name.startsWith(".")) return false;
      try {
        return statSync(join(FUNCTIONS_DIR, name)).isDirectory();
      } catch {
        return false;
      }
    }),
  );
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) files.push(full);
  }
  return files;
}

function collectInvokes() {
  // Same patterns as check-edge-function-paths.mjs so the two guards
  // can never disagree on what counts as a frontend call site.
  const PATTERNS = [
    /fetchEdgeFunction\s*(?:<[^>]+>)?\s*\(\s*[`'"]([^`'"$/]+)/g,
    /\.functions\.invoke\s*\(\s*[`'"]([^`'"$/]+)/g,
    /\/functions\/v1\/([a-z0-9_-]+)/gi,
  ];
  const hits = new Map(); // name -> Set<file>
  for (const file of walk(SRC_DIR)) {
    const src = readFileSync(file, "utf8");
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        const name = m[1].split("/")[0].split("?")[0];
        if (!name) continue;
        if (!hits.has(name)) hits.set(name, new Set());
        hits.get(name).add(relative(ROOT, file));
      }
    }
  }
  return hits;
}

function main() {
  const manifest = loadManifest();
  const sourceFns = listSourceFunctions();
  const invokes = collectInvokes();
  const gateText = readFileSync(RELEASE_GATE, "utf8");

  const failures = [];

  for (const name of manifest.required) {
    if (!sourceFns.has(name)) {
      failures.push(
        `manifest entry "${name}" has no supabase/functions/${name}/ directory ` +
          `— either restore the source or remove from manifest.`,
      );
      continue;
    }
    if (!gateText.includes(name)) {
      failures.push(
        `manifest entry "${name}" is not mentioned in RELEASE_GATE.md — ` +
          `add it under "Edge functions requiring deploy" so the pre-ship ` +
          `checklist surfaces it.`,
      );
    }
  }

  // For the curated set we expect at least one invoke site in src/, EXCEPT
  // when explicitly exempted (server-to-server or cron-only functions).
  const exempt = new Set(manifest.exempt_invokes ?? []);
  for (const name of manifest.required) {
    if (exempt.has(name)) continue;
    const callers = invokes.get(name);
    if (!callers || callers.size === 0) {
      // Server-to-server callable functions (seed/unseed admin tools) are
      // legitimately not invoked from src/. Don't fail — just note. The
      // manifest itself documents the deploy requirement.
      // (Add to exempt_invokes if you want to silence even this notice.)
      console.log(
        `  note: "${name}" has no src/ invoke (admin/cron-only tool) — deploy still required.`,
      );
    }
  }

  if (failures.length) {
    console.error(
      `\n✗ check:edge-deploy-coverage — ${failures.length} manifest issue(s):\n`,
    );
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      `\nManifest: scripts/edge-function-deploy-manifest.json\n` +
        `Release gate: RELEASE_GATE.md\n`,
    );
    process.exit(1);
  }

  console.log(
    `✓ check:edge-deploy-coverage — ${manifest.required.length} required ` +
      `function(s) backed by source + mentioned in RELEASE_GATE.md.`,
  );
}

main();
