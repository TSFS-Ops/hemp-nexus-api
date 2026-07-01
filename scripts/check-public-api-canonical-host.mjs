#!/usr/bin/env node
/**
 * Batch C2 — Public API V1 canonical-host guard.
 *
 * Fails the build if any runtime source (src/, scripts/, or the public-api
 * shared helpers) introduces a raw `*.functions.supabase.co` URL combined
 * with a V1 route path.
 *
 * Rationale: Batch C2 rejects unrecognised hosts on the V1 gateway. Any
 * runtime caller that hits `<project>.functions.supabase.co` for a V1
 * endpoint would now receive `unrecognised_host` (HTTP 421). This guard
 * catches such drift at build time.
 *
 * Allowed:
 *  - documentation examples using canonical hosts
 *    (api.trade.izenzo.co.za, api-sandbox.trade.izenzo.co.za);
 *  - tests / guards / evidence that assert the raw-host rejection.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_ROOTS = [
  join(ROOT, "src"),
  join(ROOT, "scripts"),
  join(ROOT, "supabase", "functions", "_shared"),
  join(ROOT, "supabase", "functions", "public-api"),
];

const V1_PATH_HINTS = [
  "/v1/health",
  "/v1/status",
  "/v1/counterparty/lookup",
  "/v1/counterparty/",
  "/functions/v1/public-api/",
];

const RAW_HOST_RE = /[a-z0-9-]+\.functions\.supabase\.co/i;

function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const e of entries) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e)) files.push(full);
  }
  return files;
}

// This guard file itself references the raw host as a documented pattern;
// exclude it and its evidence sibling from scanning.
const SELF = relative(ROOT, new URL(import.meta.url).pathname);

const offenders = [];
for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    const rel = relative(ROOT, file);
    if (rel === SELF) continue;
    // Test files intentionally assert the rejection behaviour.
    if (/(^|\/)(tests?|__tests__)\//.test(rel)) continue;
    if (/\.test\.(t|j)sx?$/.test(rel)) continue;
    const src = readFileSync(file, "utf8");
    if (!RAW_HOST_RE.test(src)) continue;
    if (!V1_PATH_HINTS.some((h) => src.includes(h))) continue;
    // Combined signal: raw functions.supabase.co host + a V1 path in the
    // same file. Flag for review.
    offenders.push(rel);
  }
}

if (offenders.length === 0) {
  console.log("✓ check:public-api-canonical-host — no raw functions.supabase.co V1 callers found");
  process.exit(0);
}

console.error("\n✗ check:public-api-canonical-host — raw functions.supabase.co URL combined with V1 path:");
for (const o of offenders) console.error("  " + o);
console.error(
  "\nBatch C2 rejects unrecognised hosts on the V1 gateway. Use the canonical hosts:",
);
console.error("  https://api.trade.izenzo.co.za/v1/…");
console.error("  https://api-sandbox.trade.izenzo.co.za/v1/…");
process.exit(1);
