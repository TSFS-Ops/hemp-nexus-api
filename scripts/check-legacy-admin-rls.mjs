#!/usr/bin/env node
/**
 * Batch B Fix 5 — No-new legacy admin RLS literal guard.
 *
 * Scope: supabase/migrations/*.sql only.
 *
 * What this guards:
 *   Fails if a NEW migration introduces an additional legacy RBAC literal
 *   referencing public.app_role's frozen `'admin'` role. Existing
 *   occurrences are baselined in scripts/.legacy-admin-rls-baseline.json
 *   so historical migrations are not retroactively forbidden.
 *
 * Patterns considered legacy:
 *   - has_role(<expr>, 'admin')
 *   - has_role(<expr>, 'admin'::app_role)
 *   - role = 'admin'::app_role   (within an app_role / user_roles context)
 *
 * Explicitly IGNORED (not the public.app_role 'admin' role):
 *   - deal_certificate_signatories.role 'admin' — that's a signatory side
 *     label, not the public.app_role enum value. See Fix 8.
 *
 * Wired into `npm run build` via `prebuild`.
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const BASELINE_PATH = join(process.cwd(), "scripts", ".legacy-admin-rls-baseline.json");

// Patterns that MUST count as legacy app_role 'admin' usage.
// Note: has_role's first argument is typically `auth.uid()` which itself
// contains parens, so we cannot use `[^)]*?` as a stand-in for the first
// argument. Instead we anchor on the literal `, 'admin'` second argument.
const PATTERNS = [
  /has_role\s*\([^;]{0,200}?,\s*'admin'\s*(?:::\s*app_role)?\s*\)/gi,
  /\brole\s*=\s*'admin'::app_role\b/gi,
];

function scanFile(path) {
  const src = readFileSync(path, "utf8");
  let count = 0;
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    const matches = src.match(re);
    if (matches) count += matches.length;
  }
  return count;
}

function scanAll() {
  if (!existsSync(MIGRATIONS_DIR)) return {};
  const result = {};
  for (const f of readdirSync(MIGRATIONS_DIR).sort()) {
    if (!f.endsWith(".sql")) continue;
    const n = scanFile(join(MIGRATIONS_DIR, f));
    if (n > 0) result[f] = n;
  }
  return result;
}

const current = scanAll();

if (!existsSync(BASELINE_PATH)) {
  console.error(
    `[check:legacy-admin-rls] FATAL: baseline missing at ${BASELINE_PATH}. ` +
      `Run with --write-baseline to record the current state.`,
  );
  if (process.argv.includes("--write-baseline")) {
    const { writeFileSync } = await import("fs");
    writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
    console.log(`[check:legacy-admin-rls] wrote baseline with ${Object.keys(current).length} files.`);
    process.exit(0);
  }
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

if (process.argv.includes("--write-baseline")) {
  const { writeFileSync } = await import("fs");
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
  console.log(`[check:legacy-admin-rls] rewrote baseline (${Object.keys(current).length} files).`);
  process.exit(0);
}

const violations = [];

// New legacy occurrences in NEW migration files.
for (const [file, count] of Object.entries(current)) {
  if (!(file in baseline)) {
    violations.push(
      `  NEW file ${file} introduces ${count} legacy has_role(..,'admin') / role='admin'::app_role literal(s).`,
    );
  } else if (count > baseline[file]) {
    violations.push(
      `  ${file}: legacy literal count rose from ${baseline[file]} to ${count}. ` +
        `Migrations are immutable — this should never happen without a rebase.`,
    );
  }
}

if (violations.length > 0) {
  console.error("\n❌ check:legacy-admin-rls — new legacy app_role 'admin' RBAC predicate detected:\n");
  for (const v of violations) console.error(v);
  console.error(
    "\nThe canonical super-admin role is `platform_admin`. New migrations MUST route " +
      "admin checks through `public.is_admin(auth.uid())` or an explicit `has_role(auth.uid(), 'platform_admin')`.\n" +
      "If a baseline rebase is genuinely required, run:\n" +
      "  node scripts/check-legacy-admin-rls.mjs --write-baseline\n" +
      "and justify the change in code review.\n",
  );
  process.exit(1);
}

console.log(
  `✅ check:legacy-admin-rls — verified ${Object.keys(current).length} migration file(s) against baseline of ${Object.keys(baseline).length}.`,
);
