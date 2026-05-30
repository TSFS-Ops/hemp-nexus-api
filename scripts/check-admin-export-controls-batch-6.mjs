#!/usr/bin/env node
/**
 * Admin Export Controls Batch 6 — prebuild guard.
 *
 * Pins safe Legal-Hold Context Auto-Detection across the
 * request → approval → list-view surface:
 *   - detection helper exists and never selects/returns raw legal-hold
 *     reason / metadata / released_* / applied_by fields
 *   - request edge function calls detectGovernanceRecordLegalHold and
 *     audits detected context (no operator override)
 *   - approve edge function re-detects read-only and includes diff
 *   - list edge function exposes safe summary only (no reason / notes /
 *     metadata) and never selects them from legal_holds
 *   - list panel renders safe indicator only — no raw legal-hold text
 *   - no surface in this batch adds prepare/download/destroy/signed-URL
 *     /CSV/Blob/file-generation
 *   - DATA-004 cron files are not touched in this batch
 */
import { readFileSync, existsSync } from "node:fs";

const failures = [];

/**
 * Strip comments so guard predicates only scan executable code, not
 * JSDoc / banner / inline doc text that legitimately mentions banned
 * tokens (e.g. "NOT selecting released_reason", "no signed URL").
 *
 * Removes:
 *   - block comments, including JSDoc and banner blocks
 *   - // line comments
 *
 * Naive on string literals containing comment markers, which is
 * acceptable for the surfaces under guard.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<![:"'`\\])\/\/[^\n]*/g, "");
}

function check(path, label, predicates) {
  if (!existsSync(path)) {
    failures.push(`${label}: missing file ${path}`);
    return;
  }
  const raw = readFileSync(path, "utf8");
  const src = stripComments(raw);
  for (const [name, re, expect] of predicates) {
    const found = re.test(src);
    if (found !== expect) {
      failures.push(
        `${label}: predicate "${name}" expected ${expect ? "PRESENT" : "ABSENT"} but was ${found ? "PRESENT" : "ABSENT"} in ${path}`,
      );
    }
  }
}

// 1. Detection helper — read-only, exposes ONLY safe fields.
const HELPER = "supabase/functions/_shared/legal-hold-detection.ts";
check(HELPER, "shared:legal-hold-detection", [
  ["exports detection function", /export\s+async\s+function\s+detectGovernanceRecordLegalHold/, true],
  ["exports sanitiser", /export\s+function\s+sanitiseOperatorLegalHoldContext/, true],
  ["exports diff helper", /export\s+function\s+diffDetectedLegalHoldContext/, true],
  ["selects only safe legal_holds columns", /\.from\(\s*["']legal_holds["']\s*\)\s*\n?\s*\.select\(\s*["']id,\s*scope_type,\s*scope_id["']/, true],
  ["scopes to status=active", /\.eq\(\s*["']status["']\s*,\s*["']active["']\s*\)/, true],
  // Negative — never select sensitive fields.
  ["NO select of reason", /\bselect\([^)]*\breason\b[^)]*\)/i, false],
  ["NO select of metadata", /\bselect\([^)]*\bmetadata\b[^)]*\)/i, false],
  ["NO select of released_reason", /released_reason/, false],
  ["NO select of applied_by", /applied_by/, false],
  // Never mutates legal_holds.
  ["NO insert into legal_holds", /from\(\s*["']legal_holds["']\s*\)[\s\S]{0,80}\.insert\s*\(/, false],
  ["NO update of legal_holds", /from\(\s*["']legal_holds["']\s*\)[\s\S]{0,80}\.update\s*\(/, false],
  ["NO delete of legal_holds", /from\(\s*["']legal_holds["']\s*\)[\s\S]{0,80}\.delete\s*\(/, false],
  // No file generation / download / signed URL.
  ["NO signed URL", /createSignedUrl|(?<!no_)signed_url/, false],
  ["NO storage upload", /storage\.from\([^)]*\)\.upload\s*\(/, false],
  ["NO storage download", /storage\.from\([^)]*\)\.download\s*\(/, false],
  ["NO CSV/Blob output", /new\s+Blob\s*\(|text\/csv/i, false],
]);

// 2. Request edge function — wires detection in.
const REQ = "supabase/functions/admin-governance-export-request/index.ts";
check(REQ, "edge:admin-governance-export-request", [
  ["imports detection", /detectGovernanceRecordLegalHold/, true],
  ["imports sanitiser", /sanitiseOperatorLegalHoldContext/, true],
  ["calls detection", /await\s+detectGovernanceRecordLegalHold\s*\(/, true],
  ["audits detected legal-hold context", /legal_hold_context_detected/, true],
  ["preserves operator context separately", /legal_hold_context_operator/, true],
  // Never adds prepare/download/destroy.
  ["NO signed URL", /createSignedUrl|(?<!no_)signed_url/, false],
  ["NO storage upload", /storage\.from\([^)]*\)\.upload\s*\(/, false],
  ["NO CSV/Blob output", /new\s+Blob\s*\(|text\/csv/i, false],
  ["NO prepare/destroy/generate verbs", /admin_export_prepared|admin_export_downloaded|admin_export_destroyed|admin_export_generated/, false],
  ["NO calls to export-prepare/download/destroy", /["'](export-prepare|export-download|export-destroy|admin-export-prepare|admin-export-download|admin-export-destroy)["']/, false],
  ["NO mutation of legal_holds", /from\(\s*["']legal_holds["']\s*\)[\s\S]{0,80}\.(insert|update|delete)\s*\(/, false],
]);

// 3. Approve edge function — re-detects read-only.
const APR = "supabase/functions/admin-governance-export-approve/index.ts";
check(APR, "edge:admin-governance-export-approve", [
  ["imports detection", /detectGovernanceRecordLegalHold/, true],
  ["imports diff helper", /diffDetectedLegalHoldContext/, true],
  ["calls re-detection", /await\s+detectGovernanceRecordLegalHold\s*\(/, true],
  ["audits detected-at-request", /legal_hold_context_detected_at_request/, true],
  ["audits detected-at-approval", /legal_hold_context_detected_at_approval/, true],
  ["audits change flag", /legal_hold_context_changed_since_request/, true],
  // Approval must NOT prepare / generate / download.
  ["NO signed URL", /createSignedUrl|(?<!no_)signed_url/, false],
  ["NO storage upload", /storage\.from\([^)]*\)\.upload\s*\(/, false],
  ["NO CSV/Blob output", /new\s+Blob\s*\(|text\/csv/i, false],
  ["NO prepare/destroy/generate verbs", /admin_export_prepared|admin_export_downloaded|admin_export_destroyed|admin_export_generated/, false],
  ["NO mutation of legal_holds", /from\(\s*["']legal_holds["']\s*\)[\s\S]{0,80}\.(insert|update|delete)\s*\(/, false],
]);

// 4. List edge function — exposes safe summary only.
const LIST = "supabase/functions/admin-governance-export-list/index.ts";
check(LIST, "edge:admin-governance-export-list", [
  ["surfaces legal_hold_auto_detected", /legal_hold_auto_detected/, true],
  ["surfaces hold_count", /legal_hold_hold_count/, true],
  ["surfaces hold_sources", /legal_hold_hold_sources/, true],
  ["surfaces primary_scope", /legal_hold_primary_scope/, true],
  ["surfaces detected_at", /legal_hold_detected_at/, true],
  // Negative — never reads/returns raw legal-hold fields.
  ["NO read of legal_holds.reason", /from\(\s*["']legal_holds["'][\s\S]{0,200}\.select\([^)]*reason/i, false],
  ["NO read of legal_holds.metadata", /from\(\s*["']legal_holds["'][\s\S]{0,200}\.select\([^)]*metadata/i, false],
  ["NO release of raw reason in row payload", /\breason:\s*[^,\n]*hold/i, false],
  ["NO release of raw notes in row payload", /\bnotes:\s*[^,\n]*hold/i, false],
  ["NO release of raw metadata in row payload", /\bmetadata:\s*[^,\n]*hold/i, false],
  ["NO mutation of legal_holds", /from\(\s*["']legal_holds["']\s*\)[\s\S]{0,80}\.(insert|update|delete)\s*\(/, false],
  // List remains read-only across all surfaces.
  ["NO mutation of export_requests", /from\(\s*["']export_requests["']\s*\)[\s\S]{0,80}\.(insert|update|delete)\s*\(/, false],
  ["NO signed URL", /createSignedUrl|(?<!no_)signed_url/, false],
  ["NO storage upload", /storage\.from\([^)]*\)\.upload\s*\(/, false],
  ["NO CSV/Blob output", /new\s+Blob\s*\(|text\/csv/i, false],
]);

// 5. List panel — safe indicator only, no raw legal-hold text.
const PANEL_LIST =
  "src/components/admin/governance/AdminGovernanceExportRequestsListPanel.tsx";
check(PANEL_LIST, "panel:list", [
  ["renders legal-hold indicator", /legal-hold-indicator/, true],
  ["renders auto-detected badge", /auto-detected/, true],
  // Negative — never renders raw legal-hold reason / notes / metadata.
  ["NO 'Reason:' label for holds", /hold[\s\S]{0,40}reason\s*[:=]/i, false],
  ["NO 'Notes:' label for holds", /hold[\s\S]{0,40}notes\s*[:=]/i, false],
  ["NO 'Metadata' label for holds", /hold[\s\S]{0,40}metadata/i, false],
  ["NO signed URL surface", /(?<!no)signedUrl|createSignedUrl|(?<!no_)signed_url/, false],
  ["NO download CSV button", /Download (CSV|JSON|PDF)/i, false],
]);

// 6. Request panel — safe auto-detection result surface only.
const PANEL_REQ =
  "src/components/admin/governance/AdminGovernanceExportRequestPanel.tsx";
check(PANEL_REQ, "panel:request", [
  ["renders auto-detection block", /legal-hold-auto-detection/, true],
  ["mentions no mutation", /does not mutate held data/i, true],
  ["preserves no-file copy", /No file has been generated/, true],
  // Negative.
  ["NO download/prepare/destroy buttons", /Prepare export|Destroy export|Download export|Generate export/i, false],
  ["NO signed URL surface", /(?<!no)signedUrl|createSignedUrl|(?<!no_)signed_url/, false],
  ["NO raw hold reason rendering", /hold\.reason|legal_hold\.reason|legal_hold_reason/, false],
]);

// 7. Test file present.
check(
  "src/tests/admin-export-controls-batch-6.test.ts",
  "test:admin-export-controls-batch-6",
  [
    ["pins detection helper used in request", /detectGovernanceRecordLegalHold/, true],
    ["pins no raw reason exposure", /reason/i, true],
    ["pins no mutation of legal_holds", /legal_holds/, true],
  ],
);

if (failures.length > 0) {
  console.error(
    "[check-admin-export-controls-batch-6] FAIL — legal-hold auto-detection contract drift:",
  );
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nBatch 6 is detection + safe metadata only. No prepare, no generate, no download, no destroy, no signed URL. No mutation of legal_holds. No raw legal-hold reason / notes / metadata exposed.",
  );
  process.exit(1);
}

console.log(
  "[check-admin-export-controls-batch-6] OK — legal-hold auto-detection contract holds.",
);
