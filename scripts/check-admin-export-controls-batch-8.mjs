#!/usr/bin/env node
/**
 * Admin Export Controls Batch 8 — prebuild guard.
 *
 * Pins the redaction-contract module's safety floor:
 *   - helper exists at the canonical path
 *   - exports redactGovernanceRecord, REDACTION_MODES, DEFAULT_REDACTION_MODE,
 *     ALLOWED_FIELDS_BY_MODE, LEGAL_HOLD_SAFE_FIELDS, MASK_TOKEN
 *   - declares the four canonical modes
 *   - default mode is redacted_client_safe
 *   - forbidden substring list covers secrets / file-output / raw payloads
 *     / raw legal-hold reasons
 *   - helper does NOT perform any IO or output-generation:
 *       no fetch / createSignedUrl / storage.* / Deno.writeFile / new Blob /
 *       supabase.functions.invoke / supabase.from / .insert / .update / .delete /
 *       rpc / Content-Disposition / text/csv / application/pdf
 *   - vitest test file exists
 *   - prebuild wires this guard
 *
 * Production-guard / Batch 7C invariant: this batch does NOT touch
 * supabase/functions/admin-export-batch-7c-smoke/index.ts,
 * is_production_environment, DATA-004 (cron / retention / cold-storage),
 * or legal_holds. The guard checks no such files were modified by this
 * batch by only inspecting Batch 8 artifacts.
 */
import { readFileSync, existsSync } from "node:fs";

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}

const HELPER = "supabase/functions/_shared/admin-export-redaction.ts";
const TEST = "src/tests/admin-export-controls-batch-8.test.ts";
const EVIDENCE = "evidence/admin-export-controls-batch-8-redaction-contract.md";
const PKG = "package.json";

if (!existsSync(HELPER)) {
  console.error(`❌ Batch 8 redaction helper missing: ${HELPER}`);
  process.exit(1);
}
if (!existsSync(TEST)) {
  console.error(`❌ Batch 8 tests missing: ${TEST}`);
  process.exit(1);
}
if (!existsSync(EVIDENCE)) {
  console.error(`❌ Batch 8 evidence missing: ${EVIDENCE}`);
  process.exit(1);
}

const raw = readFileSync(HELPER, "utf8");
// Strip comments so ABSENT predicates do not false-positive on JSDoc /
// banner text that legitimately enumerates banned tokens.
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(?<![:"'`\\])\/\/[^\n]*/g, "");

// --- PRESENT requirements -------------------------------------------------
check(/export\s+function\s+redactGovernanceRecord\b/.test(code),
  "must export redactGovernanceRecord");
check(/export\s+const\s+REDACTION_MODES\b/.test(code),
  "must export REDACTION_MODES");
check(/export\s+const\s+DEFAULT_REDACTION_MODE\b/.test(code),
  "must export DEFAULT_REDACTION_MODE");
check(/DEFAULT_REDACTION_MODE\s*:\s*RedactionMode\s*=\s*"redacted_client_safe"/.test(code),
  "default redaction mode must be 'redacted_client_safe'");
check(/export\s+const\s+ALLOWED_FIELDS_BY_MODE\b/.test(code),
  "must export ALLOWED_FIELDS_BY_MODE");
check(/export\s+const\s+LEGAL_HOLD_SAFE_FIELDS\b/.test(code),
  "must export LEGAL_HOLD_SAFE_FIELDS");
check(/export\s+const\s+MASK_TOKEN\b/.test(code),
  "must export MASK_TOKEN");
check(/export\s+class\s+UnsupportedRedactionModeError\b/.test(code),
  "must export UnsupportedRedactionModeError");

// Four canonical modes literal-pinned.
for (const m of [
  "redacted_client_safe",
  "evidence_only",
  "metadata_only",
  "full_internal",
]) {
  check(new RegExp(`"${m}"`).test(code), `must declare mode literal "${m}"`);
}

// Critical forbidden substrings must be in the always-forbidden list.
for (const fb of [
  "password",
  "api_key",
  "auth_token",
  "signed_url",
  "download_url",
  "download_token",
  "storage_path",
  "file_path",
  "sanctions_raw",
  "pep_raw",
  "adverse_media_raw",
  "internal_notes",
  "admin_notes",
  "legal_hold_reason",
  "legal_hold_notes",
  "raw_api_response",
]) {
  check(new RegExp(`"${fb}"`).test(code),
    `ALWAYS_FORBIDDEN list must contain "${fb}"`);
}

// --- ABSENT requirements (no IO, no generation, no mutation) -------------
const FORBIDDEN_CODE_PATTERNS = [
  [/\bfetch\s*\(/, "must NOT call fetch()"],
  [/createSignedUrl/, "must NOT create signed URLs"],
  [/\.storage\b/, "must NOT touch storage"],
  [/Deno\.writeFile|Deno\.writeTextFile/, "must NOT write files"],
  [/\bnew\s+Blob\s*\(/, "must NOT construct Blob output"],
  [/text\/csv/i, "must NOT emit CSV media type"],
  [/application\/pdf/i, "must NOT emit PDF media type"],
  [/Content-Disposition/i, "must NOT emit Content-Disposition (download)"],
  [/supabase\.functions\.invoke/, "must NOT invoke edge functions"],
  [/from\s*\(\s*["']export_requests["']\s*\)/, "must NOT touch export_requests"],
  [/from\s*\(\s*["']legal_holds["']\s*\)/, "must NOT touch legal_holds"],
  [/from\s*\(\s*["']governance_records["']\s*\)/, "must NOT touch governance_records"],
  [/\.insert\s*\(/, "must NOT call .insert()"],
  [/\.update\s*\(/, "must NOT call .update()"],
  [/\.delete\s*\(/, "must NOT call .delete()"],
  [/\.rpc\s*\(/, "must NOT call .rpc()"],
  // DATA-004 surface
  [/org_retention_policies/, "must NOT reference org_retention_policies"],
  [/cron\.schedule|net\.http_post/i, "must NOT touch cron / net.http_post"],
  [/cold-storage-archive|cold_storage_archive/, "must NOT touch cold-storage"],
  // Batch 7C production guard must remain untouched by this batch
  [/is_production_environment/, "must NOT reference is_production_environment in this helper"],
  [/RUN_ADMIN_EXPORT_BATCH_7C_SMOKE/, "must NOT reference Batch 7C confirm phrase"],
  // No prepare/download/destroy endpoint references
  [/admin-governance-export-(prepare|download|destroy)/,
    "must NOT reference prepare/download/destroy endpoints"],
];
for (const [re, msg] of FORBIDDEN_CODE_PATTERNS) {
  if (re.test(code)) failures.push(msg);
}

// --- Prebuild wiring ------------------------------------------------------
const pkg = readFileSync(PKG, "utf8");
check(
  /check-admin-export-controls-batch-8\.mjs/.test(pkg),
  "package.json prebuild must invoke check-admin-export-controls-batch-8.mjs",
);

if (failures.length) {
  console.error("❌ Admin Export Controls Batch 8 guard FAILED:\n");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("✅ Admin Export Controls Batch 8 guard passed.");
