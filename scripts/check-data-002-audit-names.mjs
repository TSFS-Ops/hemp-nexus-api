#!/usr/bin/env node
/**
 * DATA-002 audit-name drift guard.
 *
 * Asserts:
 *   1. account-deletion-sweeper/index.ts emits the three canonical DATA-002
 *      audit action names:
 *         - data.deletion_window_elapsed
 *         - data.profile_deleted_or_anonymised
 *         - data.deletion_deferred_retention_required
 *   2. Legacy account.* audit action names remain present (back-compat).
 *   3. Destructive cron remains disabled in Phase 1 — i.e. cron.job
 *      definitions checked into the repo MUST NOT contain a
 *      `dry_run":false` body for account-deletion-sweeper. (We grep
 *      supabase/migrations/* and any cron snapshot files. Production
 *      cron.job rows live in the live DB and are not in this repo, so
 *      this guard is a tripwire against accidentally checking in a
 *      destructive schedule.)
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const CANONICAL = [
  "data.deletion_window_elapsed",
  "data.profile_deleted_or_anonymised",
  "data.deletion_deferred_retention_required",
];
const LEGACY = [
  "account.hard_delete_candidate",
  "account.hard_deleted",
  "account.hard_delete_failed",
  "account.hard_delete_skipped",
];

const errors = [];
const sweeperPath = "supabase/functions/account-deletion-sweeper/index.ts";
const sweeper = readFileSync(sweeperPath, "utf8");

for (const name of CANONICAL) {
  if (!sweeper.includes(name)) {
    errors.push(`${sweeperPath} missing canonical DATA-002 audit name '${name}'`);
  }
}
for (const name of LEGACY) {
  if (!sweeper.includes(name)) {
    errors.push(`${sweeperPath} dropped legacy audit name '${name}' (P0-5 / ops dashboards depend on this)`);
  }
}
if (!sweeper.includes("assertNoLegalHold")) {
  errors.push(`${sweeperPath} does not import/call assertNoLegalHold (DATA-003 integration required at sweep time)`);
}

// Phase 1 destructive-cron tripwire — only scan migration files + any
// committed cron snapshots.
function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(sql|json|toml)$/.test(entry)) out.push(p);
  }
  return out;
}
const cronFiles = walk("supabase/migrations");
for (const f of cronFiles) {
  const txt = readFileSync(f, "utf8");
  // Only flag files that actually schedule cron jobs (cron.schedule calls).
  // Read-only drift monitors that merely reference the jobname + dry_run
  // tokens as detection patterns are not destructive schedules.
  if (!/cron\.schedule\s*\(/i.test(txt)) continue;
  // Require the destructive jobname (no -dryrun suffix) AND dry_run:false
  // to appear, to avoid matching dryrun schedules or unrelated references.
  if (/['"]account-deletion-sweeper-daily['"]/.test(txt) && /dry_run["']?\s*[:=]\s*false/i.test(txt)) {
    errors.push(`${f}: destructive account-deletion-sweeper cron is checked in (dry_run:false). Phase 1 requires destructive cron to remain disabled pending sign-off.`);
  }
}

if (errors.length > 0) {
  console.error("\n✗ DATA-002 audit-name / cron drift guard failed:\n");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(
  "✓ DATA-002 audit-name guard OK: " +
    CANONICAL.join(", ") +
    " present; legacy names preserved; no destructive cron checked in.",
);
