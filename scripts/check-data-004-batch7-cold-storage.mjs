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

if (!existsSync(FN)) {
  errors.push(`missing source: ${FN}`);
} else {
  const src = readFileSync(FN, "utf8");

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

// (6) no pg_cron schedule for cold-storage-archive in any migration
const migDir = resolve(ROOT, "supabase/migrations");
for (const f of walkSql(migDir)) {
  const code = stripSql(readFileSync(f, "utf8"));
  if (!code.includes("cold-storage-archive")) continue;
  if (
    /cron\.schedule\s*\([^)]*cold-storage-archive/.test(code) ||
    /net\.http_post[\s\S]*cold-storage-archive/.test(code)
  ) {
    errors.push(`${f}: Batch 7 forbids scheduling cold-storage-archive via pg_cron.`);
  }
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

// (9) docs
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
  if (!/cold-storage-archive.*dry-run-only|dry-run-only.*cold-storage-archive/is.test(txt)) {
    errors.push(`${p}: must state cold-storage-archive is dry-run-only.`);
  }
  if (!/cold-storage-archive[^.]*NOT scheduled/i.test(txt)) {
    errors.push(`${p}: must state cold-storage-archive is NOT scheduled.`);
  }
}

if (errors.length) {
  console.error("✗ DATA-004 Batch 7 cold-storage guard FAILED:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log("✓ DATA-004 Batch 7 cold-storage-archive dry-run-only evidence path OK.");
