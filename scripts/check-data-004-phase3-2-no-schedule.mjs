#!/usr/bin/env node
/**
 * DATA-004 Phase 3.2 — scheduling readiness guard.
 *
 * Phase 3.2 explicitly does NOT schedule `purge-email-send-log-daily`
 * under pg_cron. Scheduling remains a separate, future, approval-gated
 * batch.
 *
 * This guard fails the build if:
 *   1. Any SQL migration installs an ACTIVE cron schedule for
 *      `purge-email-send-log-daily`. We detect this by scanning
 *      `supabase/migrations/**.sql` for non-comment lines that
 *      reference BOTH `cron.schedule` AND `purge-email-send-log-daily`,
 *      OR `net.http_post(...purge-email-send-log-daily...)` invoked
 *      from inside a cron.schedule(...) body.
 *   2. The function source flips its `dry_run` default away from `true`.
 *   3. The function source removes the lifecycle `evidence_only`
 *      persistence classification.
 *   4. RELEASE_GATE.md / docs/launch-runbook.md ever claim pg_cron is
 *      active for the sweeper. The signed phrasing is
 *      "pg_cron is NOT scheduled" / "scheduling readiness only".
 *   5. Docs are missing the Phase 3.2 scheduling-readiness gate.
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
const migDir = resolve(ROOT, "supabase/migrations");
for (const file of walk(migDir)) {
  const raw = readFileSync(file, "utf8");
  const code = stripSqlComments(raw);
  if (!code.includes(SWEEPER_NAME)) continue;

  // Allow pure read references (e.g. the get_email_retention_health
  // function querying cron.job WHERE jobname = '<sweeper>'). Block any
  // executable scheduling call that mentions the sweeper.
  const schedulesSweeper =
    /cron\.schedule\s*\([^)]*purge-email-send-log-daily/.test(code) ||
    /net\.http_post[\s\S]*purge-email-send-log-daily/.test(code);

  if (schedulesSweeper) {
    errors.push(
      `${file}: contains an ACTIVE pg_cron / net.http_post reference to '${SWEEPER_NAME}'. ` +
        `Phase 3.2 is scheduling-readiness only — actual scheduling requires a separate approved batch. ` +
        `Move template SQL into a comment block (-- or /​* ... *​/) inside docs/launch-runbook.md.`,
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
  if (!/pg_cron is NOT scheduled/.test(txt)) {
    errors.push(`${p}: must explicitly state 'pg_cron is NOT scheduled'.`);
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
      !/scheduling readiness/i.test(line)
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
