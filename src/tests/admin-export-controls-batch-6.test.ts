/**
 * Admin Export Controls Batch 6 — Legal-Hold Context Auto-Detection.
 *
 * Static-contract / source-pin tests (Vitest). Same pattern as
 * src/tests/admin-export-controls-batch-5.test.ts. Proves:
 *   - detection helper exists, exposes only safe fields
 *   - request edge function calls detection and audits safe context
 *   - approve edge function re-detects read-only and audits diff
 *   - list edge function exposes safe summary (no reason/notes/metadata)
 *   - list/request panels render safe indicator only
 *   - no surface introduces prepare/download/destroy/signed URL
 *   - legal_holds is never mutated by Batch 6 code paths
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");

// Strip comments so source-pin predicates do not false-positive on
// JSDoc / banner / inline doc text that legitimately mentions banned
// tokens (e.g. "NOT selecting released_reason", "no signed URL").
function readSrc(rel: string): string {
  const raw = readFileSync(join(REPO_ROOT, rel), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<![:"'`\\])\/\/[^\n]*/g, "");
}

const HELPER_SRC = readSrc(
  "supabase/functions/_shared/legal-hold-detection.ts",
);
const REQ_SRC = readSrc(
  "supabase/functions/admin-governance-export-request/index.ts",
);
const APR_SRC = readSrc(
  "supabase/functions/admin-governance-export-approve/index.ts",
);
const LIST_SRC = readSrc(
  "supabase/functions/admin-governance-export-list/index.ts",
);
const REQ_PANEL = readSrc(
  "src/components/admin/governance/AdminGovernanceExportRequestPanel.tsx",
);
const LIST_PANEL = readSrc(
  "src/components/admin/governance/AdminGovernanceExportRequestsListPanel.tsx",
);
const GUARD_SRC = readSrc(
  "scripts/check-admin-export-controls-batch-6.mjs",
);

describe("Batch 6 — detection helper", () => {
  it("exposes detection + sanitiser + diff helpers", () => {
    expect(HELPER_SRC).toMatch(/export\s+async\s+function\s+detectGovernanceRecordLegalHold/);
    expect(HELPER_SRC).toMatch(/export\s+function\s+sanitiseOperatorLegalHoldContext/);
    expect(HELPER_SRC).toMatch(/export\s+function\s+diffDetectedLegalHoldContext/);
  });

  it("selects ONLY safe columns from legal_holds", () => {
    expect(HELPER_SRC).toMatch(
      /\.from\(\s*["']legal_holds["']\s*\)\s*\n?\s*\.select\(\s*["']id,\s*scope_type,\s*scope_id["']/,
    );
    expect(HELPER_SRC).not.toMatch(/\bselect\([^)]*\breason\b[^)]*\)/i);
    expect(HELPER_SRC).not.toMatch(/\bselect\([^)]*\bmetadata\b[^)]*\)/i);
    expect(HELPER_SRC).not.toMatch(/released_reason/);
    expect(HELPER_SRC).not.toMatch(/applied_by/);
  });

  it("filters legal_holds to status=active", () => {
    expect(HELPER_SRC).toMatch(/\.eq\(\s*["']status["']\s*,\s*["']active["']\s*\)/);
  });

  it("never mutates legal_holds", () => {
    expect(HELPER_SRC).not.toMatch(
      /from\(\s*["']legal_holds["']\s*\)[\s\S]{0,80}\.(insert|update|delete)\s*\(/,
    );
  });

  it("walks match → org / dispute / engagement", () => {
    expect(HELPER_SRC).toMatch(/from\(\s*["']matches["']/);
    expect(HELPER_SRC).toMatch(/from\(\s*["']disputes["']/);
    expect(HELPER_SRC).toMatch(/from\(\s*["']poi_engagements["']/);
  });

  it("documents confirmed and deferred paths", () => {
    expect(HELPER_SRC).toMatch(/LEGAL_HOLD_DETECTION_CONFIRMED_PATHS/);
    expect(HELPER_SRC).toMatch(/LEGAL_HOLD_DETECTION_DEFERRED_PATHS/);
  });

  it("sanitiser drops free-text reason from operator input", () => {
    expect(HELPER_SRC).toMatch(/sanitiseOperatorLegalHoldContext/);
    // The comment block + implementation must NOT copy operator reason
    // into the persisted safe payload.
    expect(HELPER_SRC).not.toMatch(/safe\.reason\s*=/);
  });

  it("no file generation / signed URL / storage / blob", () => {
    expect(HELPER_SRC).not.toMatch(/createSignedUrl|signed_url/);
    expect(HELPER_SRC).not.toMatch(/storage\.from\([^)]*\)\.(upload|download)\s*\(/);
    expect(HELPER_SRC).not.toMatch(/new\s+Blob\s*\(|text\/csv/i);
  });
});

describe("Batch 6 — request edge function wiring", () => {
  it("imports + calls detection", () => {
    expect(REQ_SRC).toMatch(/detectGovernanceRecordLegalHold/);
    expect(REQ_SRC).toMatch(/await\s+detectGovernanceRecordLegalHold\s*\(/);
  });

  it("audits detected legal-hold context (safe key)", () => {
    expect(REQ_SRC).toMatch(/legal_hold_context_detected/);
    expect(REQ_SRC).toMatch(/legal_hold_context_operator/);
  });

  it("operator context is sanitised before storage", () => {
    expect(REQ_SRC).toMatch(/sanitiseOperatorLegalHoldContext/);
  });

  it("returns safe auto-detection summary to caller", () => {
    expect(REQ_SRC).toMatch(/legal_hold_auto_detection/);
    expect(REQ_SRC).toMatch(/has_legal_hold/);
    expect(REQ_SRC).toMatch(/hold_sources/);
  });

  it("still emits requested + blocked_or_declined canonical audits", () => {
    expect(REQ_SRC).toMatch(/DATA_010_AUDIT_ACTIONS\.requested/);
    expect(REQ_SRC).toMatch(/DATA_010_AUDIT_ACTIONS\.blocked_or_declined/);
  });

  it("never adds prepare/download/destroy/signed URL/CSV", () => {
    expect(REQ_SRC).not.toMatch(/createSignedUrl|signed_url/);
    expect(REQ_SRC).not.toMatch(/storage\.from\([^)]*\)\.(upload|download)\s*\(/);
    expect(REQ_SRC).not.toMatch(/new\s+Blob\s*\(|text\/csv/i);
    expect(REQ_SRC).not.toMatch(
      /admin_export_prepared|admin_export_downloaded|admin_export_destroyed|admin_export_generated/,
    );
    expect(REQ_SRC).not.toMatch(
      /["'](export-prepare|export-download|export-destroy|admin-export-prepare|admin-export-download|admin-export-destroy)["']/,
    );
  });

  it("never mutates legal_holds", () => {
    expect(REQ_SRC).not.toMatch(
      /from\(\s*["']legal_holds["']\s*\)[\s\S]{0,80}\.(insert|update|delete)\s*\(/,
    );
  });
});

describe("Batch 6 — approve edge function wiring", () => {
  it("imports + calls re-detection", () => {
    expect(APR_SRC).toMatch(/detectGovernanceRecordLegalHold/);
    expect(APR_SRC).toMatch(/await\s+detectGovernanceRecordLegalHold\s*\(/);
    expect(APR_SRC).toMatch(/diffDetectedLegalHoldContext/);
  });

  it("audits detected-at-request + detected-at-approval + diff flag", () => {
    expect(APR_SRC).toMatch(/legal_hold_context_detected_at_request/);
    expect(APR_SRC).toMatch(/legal_hold_context_detected_at_approval/);
    expect(APR_SRC).toMatch(/legal_hold_context_changed_since_request/);
  });

  it("approval transition unchanged (awaiting_approval → approved)", () => {
    expect(APR_SRC).toMatch(/approve_admin_governance_export/);
    expect(APR_SRC).toMatch(/DATA_010_AUDIT_ACTIONS\.approved/);
    expect(APR_SRC).not.toMatch(
      /admin_export_prepared|admin_export_downloaded|admin_export_destroyed|admin_export_generated/,
    );
  });

  it("approval never mutates legal_holds and never prepares/downloads", () => {
    expect(APR_SRC).not.toMatch(
      /from\(\s*["']legal_holds["']\s*\)[\s\S]{0,80}\.(insert|update|delete)\s*\(/,
    );
    expect(APR_SRC).not.toMatch(/createSignedUrl|signed_url/);
    expect(APR_SRC).not.toMatch(/storage\.from\([^)]*\)\.(upload|download)\s*\(/);
    expect(APR_SRC).not.toMatch(/new\s+Blob\s*\(|text\/csv/i);
  });
});

describe("Batch 6 — list edge function payload", () => {
  it("surfaces safe detected fields", () => {
    expect(LIST_SRC).toMatch(/legal_hold_auto_detected/);
    expect(LIST_SRC).toMatch(/legal_hold_hold_count/);
    expect(LIST_SRC).toMatch(/legal_hold_hold_sources/);
    expect(LIST_SRC).toMatch(/legal_hold_primary_scope/);
    expect(LIST_SRC).toMatch(/legal_hold_detected_at/);
  });

  it("never reads raw reason/metadata from legal_holds", () => {
    expect(LIST_SRC).not.toMatch(
      /from\(\s*["']legal_holds["'][\s\S]{0,200}\.select\([^)]*reason/i,
    );
    expect(LIST_SRC).not.toMatch(
      /from\(\s*["']legal_holds["'][\s\S]{0,200}\.select\([^)]*metadata/i,
    );
  });

  it("never mutates export_requests or legal_holds", () => {
    expect(LIST_SRC).not.toMatch(
      /from\(\s*["']export_requests["']\s*\)[\s\S]{0,80}\.(insert|update|delete)\s*\(/,
    );
    expect(LIST_SRC).not.toMatch(
      /from\(\s*["']legal_holds["']\s*\)[\s\S]{0,80}\.(insert|update|delete)\s*\(/,
    );
  });

  it("never returns raw hold reason/notes/metadata under hold-prefixed keys", () => {
    expect(LIST_SRC).not.toMatch(/legal_hold_reason/);
    expect(LIST_SRC).not.toMatch(/legal_hold_notes/);
    expect(LIST_SRC).not.toMatch(/legal_hold_metadata/);
  });
});

describe("Batch 6 — UI surfaces", () => {
  it("list panel renders auto-detected badge", () => {
    expect(LIST_PANEL).toMatch(/legal-hold-indicator/);
    expect(LIST_PANEL).toMatch(/auto-detected/);
    expect(LIST_PANEL).toMatch(/legal-hold-count/);
  });

  it("list panel exposes no raw reason/notes/metadata for holds", () => {
    expect(LIST_PANEL).not.toMatch(/legal_hold_reason/);
    expect(LIST_PANEL).not.toMatch(/legal_hold_notes/);
    expect(LIST_PANEL).not.toMatch(/legal_hold_metadata/);
  });

  it("list panel still bans prepare/download/destroy controls", () => {
    expect(LIST_PANEL).not.toMatch(/Prepare export|Destroy export|Download export|Generate export/i);
    expect(LIST_PANEL).not.toMatch(/Download (CSV|JSON|PDF)/i);
    expect(LIST_PANEL).not.toMatch(/signedUrl|createSignedUrl|signed_url/);
  });

  it("request panel renders auto-detection result block", () => {
    expect(REQ_PANEL).toMatch(/legal-hold-auto-detection/);
    expect(REQ_PANEL).toMatch(/does not mutate held data/i);
    expect(REQ_PANEL).toMatch(/No file has been generated/);
  });

  it("request panel exposes no raw hold reason and no download controls", () => {
    expect(REQ_PANEL).not.toMatch(/hold\.reason|legal_hold\.reason|legal_hold_reason/);
    expect(REQ_PANEL).not.toMatch(/Prepare export|Destroy export|Download export|Generate export/i);
    expect(REQ_PANEL).not.toMatch(/signedUrl|createSignedUrl|signed_url/);
  });
});

describe("Batch 6 — prebuild guard", () => {
  it("references the guard contract", () => {
    expect(GUARD_SRC).toMatch(/Admin Export Controls Batch 6/);
    expect(GUARD_SRC).toMatch(/legal-hold-detection/);
  });
});
