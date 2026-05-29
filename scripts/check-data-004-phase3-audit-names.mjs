#!/usr/bin/env node
/**
 * DATA-004 Phase 3 — canonical retention-job audit-name parity guard.
 *
 * Names emitted by supabase/functions/purge-email-send-log-daily/index.ts:
 *   - data.retention_job.email_send_log.started
 *   - data.retention_job.email_send_log.completed
 *   - data.retention_job.email_send_log.partial
 *   - data.retention_job.email_send_log.failed
 *   - data.retention_job.email_send_log.skipped
 *
 * Drift here would silently break the HQ Retention Health panel and any
 * downstream evidence reconciliation, so prebuild fails on rename.
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

const fnPath = resolve(ROOT, "supabase/functions/purge-email-send-log-daily/index.ts");
if (!existsSync(fnPath)) {
  console.error("✗ DATA-004 Phase 3: purge-email-send-log-daily/index.ts is missing");
  process.exit(1);
}
const src = readFileSync(fnPath, "utf8");

const errors = [];
for (const name of REQUIRED) {
  if (!src.includes(`"${name}"`)) {
    errors.push(`missing canonical audit name '${name}'`);
  }
}

// Constant block must exist and be exported (consumers and tests rely on it).
if (!/export\s+const\s+RETENTION_JOB_AUDIT_NAMES\s*=/.test(src)) {
  errors.push("export const RETENTION_JOB_AUDIT_NAMES = { ... } not found");
}

if (errors.length) {
  console.error("✗ DATA-004 Phase 3 audit-name parity check failed:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log(
  `✓ DATA-004 Phase 3 audit-name parity OK (${REQUIRED.length} names pinned).`,
);
