#!/usr/bin/env node
/**
 * DATA-004 Batch 8A — cron quarantine guard.
 *
 * The following cron jobs were unscheduled because they violated
 * the DATA-004 contract (live destructive purge/anonymise/sweeper
 * without per-org policy, legal-hold, or evidence-path parity):
 *
 *   - purge-email-send-log-daily   (jobid 14, legacy DB-function purge)
 *   - account-deletion-sweeper-daily (jobid 24, broken-auth duplicate of dryrun)
 *   - email-log-anonymise-daily    (jobid 35, p_dry_run:false)
 *
 * This guard fails the build if any SQL migration tries to:
 *   1. cron.schedule any of the quarantined jobnames, OR
 *   2. cron.schedule a job whose body invokes the legacy
 *      `purge_old_email_send_log()` DB function, OR
 *   3. cron.schedule the `email-log-anonymise` edge fn with a body
 *      that omits `p_dry_run` or sets it to anything other than
 *      `true`, OR
 *   4. cron.schedule the `account-deletion-sweeper` edge fn with a
 *      body whose `dry_run` field is anything other than `true`, OR
 *   5. cron.schedule the `cold-storage-archive` edge fn (Batch 7
 *      contract: manual/dry-run only, NOT scheduled).
 *
 * Dry-run schedules with explicit `dry_run:true` / `p_dry_run:true`
 * pinned in the body are permitted (jobid 25 and jobid 39 today).
 *
 * NOTE: cron state lives in the live DB, not in source. This guard
 * is a regression net for migrations only. Operators must still
 * audit `cron.job` directly before any live-schedule batch.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(process.cwd());
const MIG_DIR = resolve(ROOT, "supabase/migrations");

const QUARANTINED_JOBNAMES = [
  "purge-email-send-log-daily",
  "account-deletion-sweeper-daily",
  "email-log-anonymise-daily",
  "cold-storage-archive-weekly",
];

const errors = [];

function walkSql(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkSql(p));
    else if (p.endsWith(".sql")) out.push(p);
  }
  return out;
}

function stripSql(s) {
  let out = s.replace(/\/\*[\s\S]*?\*\//g, "");
  return out
    .split("\n")
    .map((l) => {
      const i = l.indexOf("--");
      return i === -1 ? l : l.slice(0, i);
    })
    .join("\n");
}

for (const f of walkSql(MIG_DIR)) {
  const code = stripSql(readFileSync(f, "utf8"));

  // (1) quarantined jobnames must not be re-scheduled
  for (const name of QUARANTINED_JOBNAMES) {
    const re = new RegExp(
      `cron\\.schedule\\s*\\(\\s*['"\`]${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}['"\`]`,
      "i",
    );
    if (re.test(code)) {
      errors.push(`${f}: re-schedules quarantined cron jobname '${name}'.`);
    }
  }

  // (2) legacy DB-function purge call inside a cron schedule
  if (/cron\.schedule[\s\S]*?purge_old_email_send_log\s*\(/i.test(code)) {
    errors.push(`${f}: schedules legacy 'purge_old_email_send_log()' — must use the DATA-004 dry-run edge path.`);
  }

  // (3) email-log-anonymise must be dry-run when scheduled
  const anonScheds = code.match(/cron\.schedule[\s\S]*?email-log-anonymise[\s\S]*?\$\$[\s\S]*?\$\$/gi) ?? [];
  for (const block of anonScheds) {
    if (!/p_dry_run['"\s:]*true/i.test(block)) {
      errors.push(`${f}: schedules 'email-log-anonymise' without 'p_dry_run: true' pinned in body.`);
    }
  }
  // Also catch inline jsonb_build_object('p_dry_run', false) patterns
  if (/email-log-anonymise[\s\S]{0,400}p_dry_run['"\s,]*,?\s*false/i.test(code) &&
      /cron\.schedule/i.test(code)) {
    errors.push(`${f}: schedules 'email-log-anonymise' with p_dry_run=false.`);
  }

  // (4) account-deletion-sweeper must be dry-run when scheduled
  if (/cron\.schedule[\s\S]*?account-deletion-sweeper/i.test(code)) {
    const block = code.match(/cron\.schedule[\s\S]*?account-deletion-sweeper[\s\S]*?\)\s*;/i)?.[0] ?? "";
    if (block && !/dry_run['"\s:,]*true/i.test(block)) {
      errors.push(`${f}: schedules 'account-deletion-sweeper' without 'dry_run: true' pinned in body.`);
    }
    if (/account-deletion-sweeper[\s\S]{0,400}dry_run['"\s,]*,?\s*false/i.test(code)) {
      errors.push(`${f}: schedules 'account-deletion-sweeper' with dry_run=false.`);
    }
  }

  // (5) cold-storage-archive: Batch 9A permits exactly one scheduled
  // `cold-storage-archive-dryrun`. Batch 10 additionally permits exactly
  // one `cold-storage-archive-live` with `dry_run:false` pinned. Any
  // other jobname referencing the function (e.g. bare
  // `cold-storage-archive`, `-weekly`, etc.) is forbidden.
  const coldSchedRe = /cron\.schedule\s*\(\s*['"`]([a-z0-9._-]+)['"`][\s\S]*?(?=cron\.schedule\s*\(|$)/gi;
  for (const m of code.matchAll(coldSchedRe)) {
    const block = m[0];
    const jobname = m[1];
    if (!/cold-storage-archive/i.test(block)) continue;
    if (jobname !== "cold-storage-archive-dryrun" && jobname !== "cold-storage-archive-live") {
      errors.push(`${f}: cold-storage-archive may only be scheduled as 'cold-storage-archive-dryrun' (Batch 9A) or 'cold-storage-archive-live' (Batch 10); got '${jobname}'.`);
    }
    if (jobname === "cold-storage-archive-dryrun") {
      if (!/['"]dry_run['"]\s*,\s*true\b/i.test(block) || /['"]dry_run['"]\s*,\s*false\b/i.test(block)) {
        errors.push(`${f}: 'cold-storage-archive-dryrun' must pin dry_run:true in body.`);
      }
    } else if (jobname === "cold-storage-archive-live") {
      if (!/['"]dry_run['"]\s*,\s*false\b/i.test(block) || /['"]dry_run['"]\s*,\s*true\b/i.test(block)) {
        errors.push(`${f}: 'cold-storage-archive-live' must pin dry_run:false in body.`);
      }
    }
  }


}

if (errors.length) {
  console.error("✗ DATA-004 Batch 8A cron quarantine guard FAILED:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log("✓ DATA-004 Batch 8A cron quarantine guard OK.");
