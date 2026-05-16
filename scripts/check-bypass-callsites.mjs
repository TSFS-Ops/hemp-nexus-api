#!/usr/bin/env node
/**
 * Batch I Fix 7 — Bypass callsite drift guard.
 *
 * Forbids direct use of `isBypassEnabled` in edge functions UNLESS the same
 * file ALSO imports/uses `recordBypassUsage` or routes through `tryBypass`.
 *
 * Rationale: every test-mode bypass MUST land an audit row. Calling
 * `isBypassEnabled` without recording usage silently sidesteps audit and is
 * a Sev-2 compliance regression.
 *
 * The shared helper module itself is the canonical exception (it defines
 * both functions). Add other exceptions to ALLOWLIST below only with a
 * written reason in code review.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");

const ALLOWLIST = new Set([
  // Helper module defines both — recursion would be pointless.
  "supabase/functions/_shared/test-mode-bypass.ts",
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const violations = [];
for (const abs of walk(FUNCTIONS_DIR)) {
  const rel = abs.slice(ROOT.length + 1);
  if (ALLOWLIST.has(rel)) continue;
  const src = readFileSync(abs, "utf8");
  const usesIsBypass = /\bisBypassEnabled\s*\(/.test(src);
  if (!usesIsBypass) continue;
  const recordsBypass =
    /\brecordBypassUsage\s*\(/.test(src) || /\btryBypass\s*\(/.test(src);
  if (!recordsBypass) {
    violations.push(rel);
  }
}

if (violations.length > 0) {
  console.error(
    "[check-bypass-callsites] FAIL — the following edge functions call isBypassEnabled() without recordBypassUsage()/tryBypass():",
  );
  for (const v of violations) console.error("  - " + v);
  console.error(
    "\nEvery bypass MUST be audited. Use `tryBypass()` (preferred) or call `recordBypassUsage()` immediately after `isBypassEnabled()` returns true.",
  );
  process.exit(1);
}

console.log(
  `[check-bypass-callsites] OK — scanned ${walk(FUNCTIONS_DIR).length} edge function files.`,
);
