#!/usr/bin/env node
/**
 * DATA-004 Phase 3.2 / Phase 4 — scheduling guard.
 *
 * Phase 3.2 forbade ANY pg_cron schedule for the sweeper. Phase 4
 * (Batch 4 — scheduled dry-run only) relaxes that to permit a single
 * dry-run schedule, but ONLY when the schedule body pins `dry_run`
 * to true. Live (non-dry-run) scheduling for the sweeper remains a
 * separate, future, approval-gated batch.
 *
 * This guard fails the build if:
 *   1. Any SQL migration installs a cron schedule for the sweeper
 *      that is NOT dry-run-only (body does not contain `dry_run`
 *      literal true, or pins `dry_run` to false).
 *   2. The function source flips its `dry_run` default away from `true`.
 *   3. The function source removes the lifecycle `evidence_only`
 *      persistence classification.
 *   4. RELEASE_GATE.md / docs/launch-runbook.md ever claim the live
 *      purge is scheduled. Signed phrasing: "live purge is NOT
 *      scheduled" + "scheduled dry-run".
 *   5. Docs are missing the Phase 3.2 readiness section or the
 *      Phase 4 scheduled-dry-run section.
 *
 * Comments inside SQL files (lines starting with `--` after trim, or
 * fenced inside a `/* ... *​/` block) are intentionally ignored so the
 * runbook can carry a docs-only SQL template without tripping the guard.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(process.cwd());
const SWEEPER_NAME = "purge-email-send-log-daily";

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.sql$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Strip SQL comments so a docs-only schedule template inside a
 * `-- ...` line or a `/​* ... *​/` block is ignored by the scanner.
 */
function stripSqlComments(sql) {
  // remove /* ... */ blocks (non-greedy, multiline)
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, "");
  // remove -- line comments
  out = out
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
  return out;
}

const errors = [];

// 1. Migration scan -----------------------------------------------------
// Phase 4 permits a dry-run-only schedule for the sweeper inside a
// migration, but blocks any schedule whose body does not pin
// `dry_run` to true (or pins it to false).
const migDir = resolve(ROOT, "supabase/migrations");
for (const file of walk(migDir)) {
  const raw = readFileSync(file, "utf8");
  const code = stripSqlComments(raw);
  if (!code.includes(SWEEPER_NAME)) continue;

  const schedulesSweeper =
    /cron\.schedule\s*\([^)]*purge-email-send-log-daily/.test(code) ||
    /net\.http_post[\s\S]*purge-email-send-log-daily/.test(code);
  if (!schedulesSweeper) continue;

  // Dry-run-only allow-list: body must contain dry_run=true and must
  // NOT contain dry_run=false. Accepts both literal JSON
  // (`"dry_run": true`) and jsonb_build_object (`'dry_run', true`).
  const pinsDryRunTrue =
    /['"]dry_run['"]\s*[:,]\s*true\b/i.test(code);
  const pinsDryRunFalse =
    /['"]dry_run['"]\s*[:,]\s*false\b/i.test(code);

  if (!pinsDryRunTrue || pinsDryRunFalse) {
    errors.push(
      `${file}: schedules '${SWEEPER_NAME}' without pinning dry_run=true ` +
        `(or pins it to false). Phase 4 permits dry-run-only schedules; ` +
        `live scheduling requires a separate approved batch.`,
    );
  }
}


// 2. Sweeper defaults ---------------------------------------------------
const sweeperPath = resolve(
  ROOT,
  "supabase/functions/purge-email-send-log-daily/index.ts",
);
if (!existsSync(sweeperPath)) {
  errors.push(`missing sweeper source: ${sweeperPath}`);
} else {
  const src = readFileSync(sweeperPath, "utf8");
  if (!/dry_run\s*!==\s*false/.test(src)) {
    errors.push(
      `${sweeperPath}: dry_run default must remain TRUE (expected \`dry_run !== false\` coercion). ` +
        `Phase 3.2 forbids flipping the default.`,
    );
  }
  for (const key of ["started", "completed", "partial", "failed"]) {
    if (!new RegExp(`${key}\\s*:\\s*"evidence_only"`).test(src)) {
      errors.push(
        `${sweeperPath}: RETENTION_JOB_AUDIT_PERSISTENCE.${key} must remain "evidence_only" in Phase 3.2.`,
      );
    }
  }
  if (!/skipped\s*:\s*"audit_logs_per_org"/.test(src)) {
    errors.push(
      `${sweeperPath}: RETENTION_JOB_AUDIT_PERSISTENCE.skipped must remain "audit_logs_per_org" in Phase 3.2.`,
    );
  }
  for (const tok of [
    "discover_email_send_log_candidate_orgs",
    "rows_skipped_missing_policy",
    "audit_write_failures",
    "evidence_write_failures",
  ]) {
    if (!src.includes(tok)) {
      errors.push(
        `${sweeperPath}: Phase 3.1 contract token '${tok}' is missing — Phase 3.2 cannot regress it.`,
      );
    }
  }
}

// 3. Docs ---------------------------------------------------------------
const releaseGatePath = resolve(ROOT, "RELEASE_GATE.md");
const runbookPath = resolve(ROOT, "docs/launch-runbook.md");
for (const p of [releaseGatePath, runbookPath]) {
  if (!existsSync(p)) {
    errors.push(`missing required doc: ${p}`);
    continue;
  }
  const txt = readFileSync(p, "utf8");
  if (!/DATA-004 Phase 3\.2/.test(txt)) {
    errors.push(`${p}: missing 'DATA-004 Phase 3.2' section.`);
  }
  if (!/DATA-004 Phase 4/.test(txt)) {
    errors.push(`${p}: missing 'DATA-004 Phase 4' section.`);
  }
  if (!/live purge is NOT scheduled/i.test(txt)) {
    errors.push(`${p}: must explicitly state 'live purge is NOT scheduled'.`);
  }

  // Detect drift wording that would imply scheduling is live.
  const lines = txt.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Allow the explicit "NOT scheduled" denial. Block any positive claim.
    if (
      /pg_cron/i.test(line) &&
      /\b(active|scheduled|live|enabled)\b/i.test(line) &&
      !/not\s+(active|scheduled|live|enabled)/i.test(line) &&
      !/NOT scheduled/i.test(line) &&
      !/pending approval/i.test(line) &&
      !/requires.*approval/i.test(line) &&
      !/before.*scheduled/i.test(line) &&
      !/scheduled dry-run/i.test(line) &&
      !/scheduling readiness/i.test(line) &&
      !/\bBatch 19\b/.test(line)

    ) {
      errors.push(
        `${p}:${i + 1}: drift — line implies pg_cron is active for the sweeper: "${line.trim()}"`,
      );
    }
  }
}

// Runbook must also carry the scheduling readiness gate keywords.
if (existsSync(runbookPath)) {
  const rb = readFileSync(runbookPath, "utf8");
  for (const required of [
    "scheduling readiness",
    "scheduled dry-run",
    "rollback",
    "separate approval",
  ]) {
    if (!new RegExp(required, "i").test(rb)) {
      errors.push(
        `docs/launch-runbook.md: Phase 3.2 must mention '${required}'.`,
      );
    }
  }
}

if (errors.length) {
  console.error("✗ DATA-004 Phase 3.2 scheduling-readiness guard FAILED:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log(
  "✓ DATA-004 Phase 3.2 scheduling-readiness OK: no active schedule, dry_run default preserved, evidence-only lifecycle preserved, docs gate present.",
);
