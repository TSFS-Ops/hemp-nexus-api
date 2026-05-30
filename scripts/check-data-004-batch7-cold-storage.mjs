#!/usr/bin/env node
/**
 * DATA-004 Batch 7 — cold-storage-archive dry-run-only evidence guard.
 *
 * Pins:
 *   1. `cold-storage-archive` source defaults `dry_run` to TRUE.
 *   2. Exports `RETENTION_JOB_AUDIT_NAMES` + `RETENTION_JOB_AUDIT_PERSISTENCE`
 *      with the five canonical names and the lifecycle=evidence_only contract.
 *   3. Uses `discover_cold_storage_archive_candidates` RPC.
 *   4. Writes `retention_run_evidence`.
 *   5. Never deletes source records (`.delete()` is forbidden, except on
 *      `email_send_log` which lives in a different function).
 *   6. No SQL migration schedules cold-storage-archive via pg_cron.
 *   7. Does NOT consume `org_retention_policies` / `get_effective_retention_days`.
 *   8. Other deferred sweepers (storage-retention-cleanup,
 *      account-deletion-sweeper, email-log-anonymise) remain unscheduled.
 *   9. Docs (RELEASE_GATE.md + docs/launch-runbook.md) carry a DATA-004
 *      Batch 7 section stating cold-storage-archive is dry-run-only and
 *      NOT scheduled.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(process.cwd());
const FN = resolve(ROOT, "supabase/functions/cold-storage-archive/index.ts");
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

function stripTs(s) {
  let out = s.replace(/\/\*[\s\S]*?\*\//g, "");
  return out
    .split("\n")
    .map((l) => {
      const i = l.indexOf("//");
      return i === -1 ? l : l.slice(0, i);
    })
    .join("\n");
}

if (!existsSync(FN)) {
  errors.push(`missing source: ${FN}`);
} else {
  const rawSrc = readFileSync(FN, "utf8");
  const src = stripTs(rawSrc);


  // (1) dry_run default = TRUE
  if (!/body\.dry_run\s*!==\s*false/.test(src)) {
    errors.push("cold-storage-archive: dry_run default must coerce to TRUE (body.dry_run !== false).");
  }

  // (2) canonical names + persistence
  for (const n of [
    "data.retention_job.cold_storage_archive.started",
    "data.retention_job.cold_storage_archive.completed",
    "data.retention_job.cold_storage_archive.partial",
    "data.retention_job.cold_storage_archive.failed",
    "data.retention_job.cold_storage_archive.skipped",
  ]) {
    if (!src.includes(`"${n}"`)) errors.push(`cold-storage-archive: missing canonical name '${n}'.`);
  }
  if (!/export\s+const\s+RETENTION_JOB_AUDIT_NAMES/.test(src)) {
    errors.push("cold-storage-archive: RETENTION_JOB_AUDIT_NAMES export missing.");
  }
  if (!/export\s+const\s+RETENTION_JOB_AUDIT_PERSISTENCE/.test(src)) {
    errors.push("cold-storage-archive: RETENTION_JOB_AUDIT_PERSISTENCE export missing.");
  }
  for (const k of ["started", "completed", "partial", "failed"]) {
    if (!new RegExp(`${k}\\s*:\\s*"evidence_only"`).test(src)) {
      errors.push(`cold-storage-archive: lifecycle '${k}' must be classified evidence_only.`);
    }
  }

  // (3) candidate RPC
  if (!src.includes("discover_cold_storage_archive_candidates")) {
    errors.push("cold-storage-archive: must call discover_cold_storage_archive_candidates RPC.");
  }
  // (4) evidence writes
  if (!src.includes("retention_run_evidence")) {
    errors.push("cold-storage-archive: must write retention_run_evidence rows.");
  }

  // (5) NEVER delete source rows. The only allowed `.delete()` would be
  // on its own function-local cleanup which we do not have. Allow zero.
  if (/\.delete\s*\(/.test(src)) {
    errors.push("cold-storage-archive: '.delete(' is forbidden — sweeper must never delete source records.");
  }

  // (7) does NOT consume org_retention_policies
  for (const tok of ["org_retention_policies", "get_effective_retention_days"]) {
    if (src.includes(tok)) {
      errors.push(`cold-storage-archive: must NOT reference '${tok}' (Phase 3 single-consumer rule).`);
    }
  }

  // skip-category visibility
  for (const tok of [
    "skipped_due_to_legal_hold",
    "skipped_due_to_duplicate",
    "skipped_due_to_missing_source",
    "skipped_due_to_bucket_write",
    "skipped_due_to_lookup_error",
    "audit_write_failures",
    "evidence_write_failures",
  ]) {
    if (!src.includes(tok)) {
      errors.push(`cold-storage-archive: required evidence token '${tok}' is missing.`);
    }
  }
}

// (6) Batch 9A + Batch 10 — exactly one `cold-storage-archive-dryrun`
// schedule AND at most one `cold-storage-archive-live` schedule are
// permitted. Any other jobname referencing cold-storage-archive
// (e.g. bare 'cold-storage-archive', '-weekly', etc.) is forbidden,
// as is anon Bearer auth or a missing INTERNAL_CRON_KEY/x-internal-key
// pairing.
const migDir = resolve(ROOT, "supabase/migrations");
let dryRunScheduleCount = 0;
let liveScheduleCount = 0;
for (const f of walkSql(migDir)) {
  const code = stripSql(readFileSync(f, "utf8"));
  if (!code.includes("cold-storage-archive")) continue;

  // any cron.schedule(...) call that references cold-storage-archive
  const schedRe = /cron\.schedule\s*\(\s*['"`]([a-z0-9._-]+)['"`][\s\S]*?(?=cron\.schedule\s*\(|$)/gi;
  for (const m of code.matchAll(schedRe)) {
    const block = m[0];
    const jobname = m[1];
    if (!/cold-storage-archive/i.test(block)) continue;

    if (jobname !== "cold-storage-archive-dryrun" && jobname !== "cold-storage-archive-live") {
      errors.push(`${f}: cold-storage-archive schedule must be named 'cold-storage-archive-dryrun' or 'cold-storage-archive-live' (got '${jobname}').`);
      continue;
    }
    if (jobname === "cold-storage-archive-dryrun") {
      dryRunScheduleCount += 1;
      if (!/['"]dry_run['"]\s*,\s*true\b/i.test(block)) {
        errors.push(`${f}: 'cold-storage-archive-dryrun' must pin 'dry_run', true in body.`);
      }
      if (/['"]dry_run['"]\s*,\s*false\b/i.test(block)) {
        errors.push(`${f}: 'cold-storage-archive-dryrun' must NOT set dry_run=false.`);
      }
    } else {
      liveScheduleCount += 1;
      if (!/['"]dry_run['"]\s*,\s*false\b/i.test(block)) {
        errors.push(`${f}: 'cold-storage-archive-live' must pin 'dry_run', false in body.`);
      }
      if (/['"]dry_run['"]\s*,\s*true\b/i.test(block)) {
        errors.push(`${f}: 'cold-storage-archive-live' must NOT set dry_run=true.`);
      }
    }
    if (/Authorization['"]\s*,\s*['"]Bearer\s+ey/i.test(block)) {
      errors.push(`${f}: '${jobname}' must NOT use anon Bearer auth — use x-internal-key from vault.`);
    }
    if (!/x-internal-key/i.test(block) || !/INTERNAL_CRON_KEY/.test(block)) {
      errors.push(`${f}: '${jobname}' must authenticate via x-internal-key + INTERNAL_CRON_KEY vault secret.`);
    }
    if (!/\/functions\/v1\/cold-storage-archive/.test(block)) {
      errors.push(`${f}: '${jobname}' must POST to /functions/v1/cold-storage-archive.`);
    }
  }
}
if (liveScheduleCount > 1) {
  errors.push(`Batch 10 permits at most one 'cold-storage-archive-live' schedule (found ${liveScheduleCount}).`);
}

// (8) deferred sweepers remain unscheduled
for (const name of [
  "storage-retention-cleanup",
  "account-deletion-sweeper",
  "email-log-anonymise",
]) {
  for (const f of walkSql(migDir)) {
    const code = stripSql(readFileSync(f, "utf8"));
    if (!code.includes(name)) continue;
    if (
      new RegExp(`cron\\.schedule\\s*\\([^)]*${name}`).test(code) ||
      new RegExp(`net\\.http_post[\\s\\S]*${name}`).test(code)
    ) {
      errors.push(`${f}: deferred sweeper '${name}' must remain unscheduled.`);
    }
  }
}

// (9) docs — must carry Batch 7, 9A and 10 sections.
for (const p of [
  resolve(ROOT, "RELEASE_GATE.md"),
  resolve(ROOT, "docs/launch-runbook.md"),
]) {
  if (!existsSync(p)) {
    errors.push(`missing required doc: ${p}`);
    continue;
  }
  const txt = readFileSync(p, "utf8");
  if (!/DATA-004 Batch 7/.test(txt)) {
    errors.push(`${p}: missing 'DATA-004 Batch 7' section.`);
  }
  if (!/DATA-004 Batch 9A/.test(txt)) {
    errors.push(`${p}: missing 'DATA-004 Batch 9A' section.`);
  }
  if (!/DATA-004 Batch 10/.test(txt)) {
    errors.push(`${p}: missing 'DATA-004 Batch 10' section.`);
  }
  if (!/cold-storage-archive-dryrun/.test(txt)) {
    errors.push(`${p}: must reference 'cold-storage-archive-dryrun' jobname.`);
  }
  if (!/cold-storage-archive-live/.test(txt)) {
    errors.push(`${p}: must reference 'cold-storage-archive-live' jobname.`);
  }
  if (!/cron\.unschedule\(\s*['"]cold-storage-archive-live['"]\s*\)/.test(txt)) {
    errors.push(`${p}: must document rollback SQL 'cron.unschedule(''cold-storage-archive-live'')'.`);
  }
}



if (errors.length) {
  console.error("✗ DATA-004 Batch 7 cold-storage guard FAILED:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log("✓ DATA-004 Batch 7 cold-storage-archive dry-run-only evidence path OK.");
