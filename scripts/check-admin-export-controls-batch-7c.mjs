#!/usr/bin/env node
/**
 * Admin Export Controls Batch 7C — prebuild guard.
 *
 * Pins the staging-only internal smoke runner's safety contract:
 *   - production refusal via is_production_environment()
 *   - service_role / INTERNAL_CRON_KEY required
 *   - exact confirm phrase RUN_ADMIN_EXPORT_BATCH_7C_SMOKE required
 *   - only @test.izenzo.co.za fixture users
 *   - generation-leak guard present
 *   - no prepare/download/destroy/file generation/signed URL invocation
 *   - no DATA-004 / cron / retention / cold-storage / legal_holds mutations
 *   - no secrets (password / TOTP) leaked into evidence response
 */
import { readFileSync, existsSync } from "node:fs";

const failures = [];
function check(cond, msg) { if (!cond) failures.push(msg); }

const PATH = "supabase/functions/admin-export-batch-7c-smoke/index.ts";
if (!existsSync(PATH)) {
  console.error(`[batch-7c] missing ${PATH}`);
  process.exit(1);
}
const src = readFileSync(PATH, "utf8");
// Strip block + line comments so doc text isn't matched by ABSENT predicates.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(?<![:"'`\\])\/\/[^\n]*/g, "");

// PRESENT requirements
check(/CONFIRM_PHRASE\s*=\s*"RUN_ADMIN_EXPORT_BATCH_7C_SMOKE"/.test(code),
  "confirm phrase RUN_ADMIN_EXPORT_BATCH_7C_SMOKE must be defined");
check(/is_production_environment/.test(code),
  "must call is_production_environment() to refuse production");
check(/production_refused/.test(code),
  "must surface production_refused error");
check(/x-internal-key/.test(code) && /SERVICE_ROLE/.test(code),
  "must require x-internal-key OR Bearer SERVICE_ROLE");
check(/@test\.izenzo\.co\.za/.test(code),
  "must restrict fixture emails to @test.izenzo.co.za");
check(/assertNoGenerationLeak/.test(code),
  "must define generation-leak guard");
check(/admin-governance-export-request/.test(code) &&
      /admin-governance-export-approve/.test(code) &&
      /admin-governance-export-list/.test(code),
  "must exercise the three governance-export edge functions");
check(/data\.admin_export_requested/.test(code) &&
      /data\.admin_export_approved/.test(code) &&
      /data\.admin_export_blocked_or_declined/.test(code),
  "must verify the three canonical audit actions");

// ABSENT requirements — runner must NEVER call generation surfaces
const bannedCalls = [
  /admin-?export-?prepare|export-prepare/i,
  /admin-?export-?download|export-download/i,
  /admin-?export-?destroy|export-destroy/i,
  /createSignedUrl|signedUrl/i,
  /new\s+Blob/,
  /Content-Disposition/i,
  /text\/csv/i,
  /storage\.from\(.+\)\.upload/i,
];
for (const re of bannedCalls) {
  check(!re.test(code), `runner must not invoke banned generation surface: ${re}`);
}

// ABSENT — must not mutate legal_holds / retention / cron / cold-storage
const bannedMutations = [
  /from\(\s*["']legal_holds["']\s*\)\s*\.(update|insert|upsert|delete)/,
  /from\(\s*["']org_retention_policies["']\s*\)\s*\.(update|insert|upsert|delete)/,
  /from\(\s*["']export_requests["']\s*\)\s*\.(update|insert|upsert|delete)/,
  /cron\.(schedule|unschedule)/,
  /cold_storage/i,
];
for (const re of bannedMutations) {
  check(!re.test(code), `runner must not mutate restricted surface: ${re}`);
}

// ABSENT — evidence must not include passwords / TOTP secrets
check(!/totp_secret\s*:/i.test(code) && !/password\s*:\s*FIXTURE_PASSWORD/.test(code),
  "runner must not embed fixture password or TOTP secret into evidence payload");

if (failures.length) {
  console.error("[admin-export-controls-batch-7c] FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("[admin-export-controls-batch-7c] OK — staging-only smoke runner contract intact");
