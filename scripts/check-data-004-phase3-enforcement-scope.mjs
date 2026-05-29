#!/usr/bin/env node
/**
 * DATA-004 Phase 3 — single-consumer enforcement-scope guard.
 *
 * Scans every supabase/functions/* folder and asserts that the ONLY
 * sweeper / job consuming `org_retention_policies` or
 * `get_effective_retention_days` is `purge-email-send-log-daily`
 * (with `admin-org-retention` being the writer/reader, and
 * `_shared/retention-decision.ts` being the canonical helper).
 *
 * Any other consumer fails the build — Phase 3 is "ONE wired sweeper".
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(process.cwd());
const FN_ROOT = resolve(ROOT, "supabase/functions");

const ALLOWED_DIRS = new Set([
  "admin-org-retention",
  "purge-email-send-log-daily",
  "_shared", // retention-decision lives here
]);

const FORBIDDEN_TOKENS = [
  "org_retention_policies",
  "get_effective_retention_days",
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|js|mjs|sql)$/.test(name)) out.push(p);
  }
  return out;
}

if (!existsSync(FN_ROOT)) {
  console.log("✓ DATA-004 Phase 3 enforcement scope: no functions dir.");
  process.exit(0);
}

const violations = [];
for (const fnName of readdirSync(FN_ROOT)) {
  if (ALLOWED_DIRS.has(fnName)) continue;
  const fnDir = join(FN_ROOT, fnName);
  if (!statSync(fnDir).isDirectory()) continue;
  for (const file of walk(fnDir)) {
    const src = readFileSync(file, "utf8");
    for (const tok of FORBIDDEN_TOKENS) {
      if (src.includes(tok)) {
        violations.push(`${file}: references '${tok}' (only purge-email-send-log-daily is wired in Phase 3)`);
      }
    }
  }
}

// `_shared/retention-decision.ts` is the only file in _shared allowed to
// reference the table. Make sure no other _shared file does.
const sharedDir = resolve(FN_ROOT, "_shared");
if (existsSync(sharedDir)) {
  for (const file of walk(sharedDir)) {
    if (file.endsWith("retention-decision.ts")) continue;
    const src = readFileSync(file, "utf8");
    for (const tok of FORBIDDEN_TOKENS) {
      if (src.includes(tok)) {
        violations.push(`${file}: shared helper references '${tok}' — only retention-decision.ts may.`);
      }
    }
  }
}

if (violations.length) {
  console.error("✗ DATA-004 Phase 3 enforcement-scope guard FAILED:");
  console.error("  Phase 3 authorises ONLY purge-email-send-log-daily as a sweeper.\n");
  for (const v of violations) console.error("  -", v);
  process.exit(1);
}

console.log(
  "✓ DATA-004 Phase 3 enforcement scope OK: only purge-email-send-log-daily consumes org_retention_policies.",
);
