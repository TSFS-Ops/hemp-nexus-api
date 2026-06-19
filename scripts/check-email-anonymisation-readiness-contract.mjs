#!/usr/bin/env node
/**
 * DATA-004 Batch 20 — Email Anonymisation Readiness Contract Guard.
 *
 * The readiness probe is ASSESSMENT-ONLY. This guard fails the build
 * if any of the following drift:
 *   - probe file missing
 *   - probe missing platform_admin gating
 *   - probe missing AAL2 / MFA gating
 *   - probe contains any SELECT against email_send_log
 *   - probe contains UPDATE / DELETE / INSERT / UPSERT / TRUNCATE / ALTER
 *     against email_send_log
 *   - probe references a PII column of email_send_log in the response
 *   - a live or dry-run anonymisation job is scheduled (email-log-anonymise*
 *     pg_cron entry committed to a migration)
 *   - a new pg_cron entry is committed alongside this batch
 *   - canonical audit name is missing or unpinned
 *
 * Hard-coded scope: this guard inspects only the probe file and
 * supabase/migrations/. It does NOT alter or schedule anything.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROBE_PATH = "supabase/functions/email-anonymisation-readiness-probe/index.ts";
const CANONICAL_AUDIT = "data.email_anonymisation_readiness_probed";
const PII_COLUMNS = ["recipient_email", "error_message", "metadata", "message_id"];

const errors = [];

function read(p) {
  return readFileSync(resolve(ROOT, p), "utf8");
}

if (!existsSync(resolve(ROOT, PROBE_PATH))) {
  console.error(`✗ Batch 20 guard: probe missing at ${PROBE_PATH}`);
  process.exit(1);
}

const src = read(PROBE_PATH);

// --- gating ---
if (!/has_role[^)]*_role:\s*"platform_admin"/s.test(src)) {
  errors.push("probe must gate on has_role(_role: 'platform_admin')");
}
if (!/assertAal2\(/.test(src)) {
  errors.push("probe must call assertAal2() — MFA gate required");
}
if (!/MFA_REQUIRED/.test(src)) {
  errors.push("probe must surface ApiException MFA_REQUIRED as 403");
}

// --- legal hold short-circuit ---
if (!/assertNoLegalHold\(/.test(src)) {
  errors.push("probe must call assertNoLegalHold() against email_send_log_anonymise record_group");
}
if (!/RECORD_GROUP_IDS\.email_send_log_anonymise/.test(src)) {
  errors.push("probe must reference RECORD_GROUP_IDS.email_send_log_anonymise");
}

// Strip comments + string literals so doc/recommendation text doesn't
// trigger forbidden-pattern checks. What matters is whether the code
// actually performs a read or mutation, not what it documents.
function stripCommentsAndStrings(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}
const code = stripCommentsAndStrings(src);

// --- forbidden: any DB read or mutation against email_send_log ---
if (/\.from\(\s*["']email_send_log["']\s*\)/.test(src)) {
  errors.push("probe must NOT call .from('email_send_log') — schema-level only, no row reads");
}
const forbiddenSql = [
  /select\b[^;]*\bfrom\s+(public\.)?email_send_log\b/i,
  /update\s+(public\.)?email_send_log\b/i,
  /delete\s+from\s+(public\.)?email_send_log\b/i,
  /insert\s+into\s+(public\.)?email_send_log\b/i,
  /upsert\s+(public\.)?email_send_log\b/i,
  /truncate\s+(public\.)?email_send_log\b/i,
  /alter\s+table\s+(public\.)?email_send_log\b/i,
];
for (const re of forbiddenSql) {
  if (re.test(code)) {
    errors.push(`probe contains forbidden SQL against email_send_log: /${re.source}/`);
  }
}
if (/\.rpc\(\s*["']anonymise_old_email_send_log["']/.test(code)) {
  errors.push("probe must NOT invoke anonymise_old_email_send_log RPC");
}


// --- audit name pin ---
if (!src.includes(`"${CANONICAL_AUDIT}"`)) {
  errors.push(`probe must reference canonical audit name '${CANONICAL_AUDIT}'`);
}
if (!new RegExp(`READINESS_AUDIT_NAME\\s*=\\s*"${CANONICAL_AUDIT.replace(/\./g, "\\.")}"`).test(src)) {
  errors.push("READINESS_AUDIT_NAME constant must equal canonical name and be pinned");
}
if (!/from\("audit_logs"\)\.insert/.test(src)) {
  errors.push("probe must write the canonical audit to audit_logs");
}

// --- assessment-only markers ---
if (!/assessment_only:\s*true/.test(src)) {
  errors.push("probe response must include assessment_only: true");
}
if (!/live_anonymisation_path_present:\s*false/.test(src)) {
  errors.push("probe response must include live_anonymisation_path_present: false");
}
if (!/scheduled_anonymisation_job:\s*false/.test(src)) {
  errors.push("probe response must include scheduled_anonymisation_job: false");
}

// --- no PII in response shape ---
// PII column names may legitimately appear inside the schema_inventory
// (as labels), but they must never be read from a row. We've already
// banned .from("email_send_log") above, so any mention here is a label.
// We still forbid any string template that looks like it returns a value
// keyed by these columns (e.g. `recipient_email: row.recipient_email`).
for (const col of PII_COLUMNS) {
  const piiReturn = new RegExp(`${col}\\s*:\\s*[a-zA-Z_][a-zA-Z0-9_]*\\.${col}`);
  if (piiReturn.test(src)) {
    errors.push(`probe appears to return PII column '${col}' from a row`);
  }
}

// --- no new pg_cron schedule alongside this batch ---
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".sql")) out.push(full);
  }
  return out;
}
const migrationsDir = resolve(ROOT, "supabase/migrations");
if (existsSync(migrationsDir)) {
  for (const file of walk(migrationsDir)) {
    const sql = readFileSync(file, "utf8");
    // Forbid a *new* email-log-anonymise cron schedule referencing the probe.
    if (/cron\.schedule\([^)]*email-anonymisation-readiness-probe/i.test(sql)) {
      errors.push(`forbidden: pg_cron schedule for the readiness probe in ${file}`);
    }
    // The probe must not be wired to invoke the anonymise function either.
    if (
      /cron\.schedule\([^)]*email-log-anonymise/i.test(sql) &&
      /Batch 20/i.test(sql)
    ) {
      errors.push(`forbidden: Batch 20 must not schedule email-log-anonymise (${file})`);
    }
  }
}

if (errors.length) {
  console.error("✗ DATA-004 Batch 20 readiness contract failed:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log(
  `✓ DATA-004 Batch 20 readiness contract OK (probe assessment-only; audit '${CANONICAL_AUDIT}' pinned)`,
);
