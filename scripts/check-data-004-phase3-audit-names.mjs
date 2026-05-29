#!/usr/bin/env node
/**
 * DATA-004 Phase 3 / 3.1 — canonical retention-job name parity guard.
 *
 * Names emitted by supabase/functions/purge-email-send-log-daily/index.ts:
 *   - data.retention_job.email_send_log.started     (evidence_only)
 *   - data.retention_job.email_send_log.completed   (evidence_only)
 *   - data.retention_job.email_send_log.partial     (evidence_only)
 *   - data.retention_job.email_send_log.failed      (evidence_only)
 *   - data.retention_job.email_send_log.skipped     (audit_logs per-org)
 *
 * Phase 3.1 evidence-hardening clarification:
 *   - `skipped` is the ONLY name that persists to `public.audit_logs`,
 *     and it always carries a real per-org `org_id`.
 *   - `started`/`completed`/`partial`/`failed` are run-level lifecycle
 *     events recorded on `retention_run_evidence` rows
 *     (`details.lifecycle_event_name`). They are NOT written to
 *     `audit_logs` because `audit_logs.org_id` is NOT NULL and there is
 *     no platform-system org.
 *
 * This guard pins:
 *   1. The five canonical name strings appear in the sweeper source.
 *   2. The exported `RETENTION_JOB_AUDIT_NAMES` constant is present.
 *   3. The exported `RETENTION_JOB_AUDIT_PERSISTENCE` map is present and
 *      classifies each name correctly (so any future refactor that flips
 *      a lifecycle event into an `audit_logs` write must be paired with
 *      a deliberate update here AND with a test that proves it persists).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const REQUIRED = [
  "data.retention_job.email_send_log.started",
  "data.retention_job.email_send_log.completed",
  "data.retention_job.email_send_log.partial",
  "data.retention_job.email_send_log.failed",
  "data.retention_job.email_send_log.skipped",
];

const EXPECTED_PERSISTENCE = {
  started: "evidence_only",
  completed: "evidence_only",
  partial: "evidence_only",
  failed: "evidence_only",
  skipped: "audit_logs_per_org",
};

const fnPath = resolve(ROOT, "supabase/functions/purge-email-send-log-daily/index.ts");
if (!existsSync(fnPath)) {
  console.error("✗ DATA-004 Phase 3: purge-email-send-log-daily/index.ts is missing");
  process.exit(1);
}
const src = readFileSync(fnPath, "utf8");

const errors = [];
for (const name of REQUIRED) {
  if (!src.includes(`"${name}"`)) {
    errors.push(`missing canonical name '${name}'`);
  }
}

if (!/export\s+const\s+RETENTION_JOB_AUDIT_NAMES\s*=/.test(src)) {
  errors.push("export const RETENTION_JOB_AUDIT_NAMES = { ... } not found");
}

if (!/export\s+const\s+RETENTION_JOB_AUDIT_PERSISTENCE\s*=/.test(src)) {
  errors.push(
    "export const RETENTION_JOB_AUDIT_PERSISTENCE = { ... } not found — Phase 3.1 requires per-name persistence classification",
  );
} else {
  // Best-effort static parity check on the persistence map.
  for (const [key, expected] of Object.entries(EXPECTED_PERSISTENCE)) {
    const re = new RegExp(`${key}\\s*:\\s*"${expected}"`);
    if (!re.test(src)) {
      errors.push(
        `RETENTION_JOB_AUDIT_PERSISTENCE.${key} must be "${expected}" (Phase 3.1 contract)`,
      );
    }
  }
}

if (errors.length) {
  console.error("✗ DATA-004 Phase 3 audit-name parity check failed:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log(
  `✓ DATA-004 Phase 3 audit-name parity OK (${REQUIRED.length} names pinned; lifecycle=evidence_only, skipped=audit_logs_per_org).`,
);
