#!/usr/bin/env node
/**
 * R2 — Edge-function path drift checker.
 *
 * Scans every fetchEdgeFunction("<path>") call in src/ and asserts that the
 * first path segment matches an existing supabase/functions/<name>/ directory.
 *
 * Why: hand-rolled fetch wrappers silently 404 when an edge function is
 * renamed or removed (e.g. sprint-11 admin-lookup-profiles → admin-users).
 * This catches drift at build time instead of at runtime as a "Session
 * expired" or "Network error" toast in production.
 *
 * Runs in `prebuild` so a missing function fails CI before deploy.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");
const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");

// ── Build the set of valid edge-function names ─────────────────────────
const validFunctions = new Set(
  readdirSync(FUNCTIONS_DIR).filter((name) => {
    if (name.startsWith("_") || name.startsWith(".")) return false;
    try {
      return statSync(join(FUNCTIONS_DIR, name)).isDirectory();
    } catch {
      return false;
    }
  }),
);

// ── Walk src/ and collect fetchEdgeFunction("...") usages ──────────────
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

// Captures three call shapes:
//   fetchEdgeFunction("path") / fetchEdgeFunction<T>("path") / fetchEdgeFunction(`path/${id}`)
//   supabase.functions.invoke("name", ...)
//   functions/v1/name in URL strings (caught for raw fetch use)
const PATTERNS = [
  /fetchEdgeFunction\s*(?:<[^>]+>)?\s*\(\s*[`'"]([^`'"$/]+)/g,
  /\.functions\.invoke\s*\(\s*[`'"]([^`'"$/]+)/g,
  /\/functions\/v1\/([a-z0-9_-]+)/gi,
];

const issues = [];
const seen = new Set();

for (const file of walk(SRC_DIR)) {
  const src = readFileSync(file, "utf8");
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const firstSegment = m[1].split("/")[0].split("?")[0];
      if (!firstSegment) continue;
      const key = `${firstSegment}::${file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!validFunctions.has(firstSegment)) {
        issues.push({
          file: relative(ROOT, file),
          path: m[1],
          firstSegment,
        });
      }
    }
  }
}

if (issues.length === 0) {
  console.log(
    `✓ check:edge-paths — all ${seen.size} fetchEdgeFunction call sites map to existing functions (${validFunctions.size} functions deployed)`,
  );
  process.exit(0);
}

console.error(
  `\n✗ check:edge-paths — ${issues.length} call site(s) reference non-existent edge functions:\n`,
);
for (const i of issues) {
  console.error(`  ${i.file}`);
  console.error(`    fetchEdgeFunction("${i.path}") — no supabase/functions/${i.firstSegment}/ directory`);
}
console.error(
  `\nValid edge function names:\n  ${[...validFunctions].sort().join(", ")}\n`,
);
console.error(
  `Fix: either restore the missing function, or update the call site to use the new name.`,
);
process.exit(1);
