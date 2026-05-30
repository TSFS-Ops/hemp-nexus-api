/**
 * Admin Export Controls Batch 4 — Governance Record Export Approval Shell.
 *
 * Static-contract / source-pin tests (Vitest), same pattern as
 * src/tests/admin-export-controls-batch-3.test.ts. Proves the approval
 * surface stays narrow:
 *   - platform_admin + AAL2 only
 *   - awaiting_approval → approved (no prepare/generate/download/destroy)
 *   - self-approval blocked at DB AND mapped to SELF_APPROVAL_BLOCKED
 *   - audit emission on success + every denial path
 *   - panel renders no download / signed-URL / prepare / destroy controls
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");

const EDGE_SRC = readFileSync(
  join(
    REPO_ROOT,
    "supabase/functions/admin-governance-export-approve/index.ts",
  ),
  "utf8",
);
const PANEL_SRC = readFileSync(
  join(
    REPO_ROOT,
    "src/components/admin/governance/AdminGovernanceExportApprovalPanel.tsx",
  ),
  "utf8",
);
const MOUNT_SRC = readFileSync(
  join(
    REPO_ROOT,
    "src/components/admin/governance/GovernanceRecordDetail.tsx",
  ),
  "utf8",
);
const MIGRATION_SRC = (() => {
  // Find the most recent Batch 4 migration by scanning supabase/migrations.
  const fs = require("node:fs") as typeof import("node:fs");
  const dir = join(REPO_ROOT, "supabase/migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  // Pick the newest migration that references approve_admin_governance_export.
  for (let i = files.length - 1; i >= 0; i--) {
    const body = fs.readFileSync(join(dir, files[i]), "utf8");
    if (body.includes("approve_admin_governance_export")) return body;
  }
  throw new Error("Batch 4 migration not found");
})();

describe("Batch 4 — edge function access matrix", () => {
  it("requires Bearer Authorization (401)", () => {
    expect(EDGE_SRC).toMatch(/authHeader\.startsWith\(\s*["']Bearer\s/);
    expect(EDGE_SRC).toMatch(/"unauthorized"[^}]*\}\s*,\s*401/);
  });

  it("rejects non-POST methods (405)", () => {
    expect(EDGE_SRC).toMatch(/req\.method\s*!==\s*"POST"/);
    expect(EDGE_SRC).toMatch(/method_not_allowed/);
  });

  it("gates on platform_admin and returns NOT_PLATFORM_ADMIN", () => {
    expect(EDGE_SRC).toMatch(/rpc\(\s*["']is_admin["']/);
    expect(EDGE_SRC).toMatch(/code:\s*["']NOT_PLATFORM_ADMIN["']/);
    expect(EDGE_SRC).toMatch(/403/);
  });

  it("gates on AAL2 and returns MFA_REQUIRED on AAL1", () => {
    expect(EDGE_SRC).toMatch(/\bassertAal2\s*\(/);
    expect(EDGE_SRC).toMatch(/code:\s*["']MFA_REQUIRED["']/);
  });

  it("enforces order: is_admin BEFORE assertAal2", () => {
    const a = EDGE_SRC.indexOf('rpc("is_admin"');
    const b = EDGE_SRC.indexOf("assertAal2(");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
  });
});

describe("Batch 4 — body validation", () => {
  it("uses strict Zod schema", () => {
    expect(EDGE_SRC).toMatch(/BodySchema\s*=\s*z\.object\(/);
    expect(EDGE_SRC).toMatch(/\}\)\.strict\(\)/);
  });
  it("requires request_id as uuid", () => {
    expect(EDGE_SRC).toMatch(/request_id:\s*z\.string\(\)\.uuid\(\)/);
  });
  it("returns invalid_body + denial audit on Zod failure", () => {
    expect(EDGE_SRC).toMatch(/parsed\.success/);
    expect(EDGE_SRC).toMatch(/error:\s*"invalid_body"/);
    expect(EDGE_SRC).toMatch(/reason:\s*"invalid_body"/);
  });
  it("returns invalid_json on malformed JSON", () => {
    expect(EDGE_SRC).toMatch(/invalid_json/);
  });
});

describe("Batch 4 — RPC error mapping (stable codes)", () => {
  const cases: Array<[string, RegExp]> = [
    ["REQUEST_NOT_FOUND", /REQUEST_NOT_FOUND/],
    ["NOT_ADMIN_EXPORT", /NOT_ADMIN_EXPORT/],
    ["NOT_GOVERNANCE_RECORD_REQUEST", /NOT_GOVERNANCE_RECORD_REQUEST/],
    ["REQUEST_NOT_PENDING", /REQUEST_NOT_PENDING/],
    ["SELF_APPROVAL_BLOCKED", /SELF_APPROVAL_BLOCKED/],
    ["INVALID_ARGS / APPROVER_REQUIRED", /APPROVER_REQUIRED/],
  ];
  for (const [label, re] of cases) {
    it(`maps ${label} from RPC error message`, () => {
      expect(EDGE_SRC).toMatch(re);
    });
  }
  it("falls back to APPROVAL_FAILED for unknown RPC errors", () => {
    expect(EDGE_SRC).toMatch(/APPROVAL_FAILED/);
  });
});

describe("Batch 4 — audit emission (DATA-010 canonical)", () => {
  it("imports canonical DATA-010 actions", () => {
    expect(EDGE_SRC).toMatch(
      /from\s+"\.\.\/_shared\/export-lifecycle-audit\.ts"/,
    );
    expect(EDGE_SRC).toMatch(/DATA_010_AUDIT_ACTIONS/);
  });
  it("emits approved audit on success", () => {
    expect(EDGE_SRC).toMatch(/DATA_010_AUDIT_ACTIONS\.approved/);
  });
  it("emits blocked_or_declined on every denial path (>=4)", () => {
    const m = EDGE_SRC.match(/DATA_010_AUDIT_ACTIONS\.blocked_or_declined/g);
    expect(m?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
  it("approval audit payload pins required fields", () => {
    expect(EDGE_SRC).toMatch(/approver_user_id:\s*adminUser\.id/);
    expect(EDGE_SRC).toMatch(/request_id:\s*r\.request_id/);
    expect(EDGE_SRC).toMatch(/governance_record_id:\s*r\.governance_record_id/);
    expect(EDGE_SRC).toMatch(/requested_by:\s*r\.requested_by/);
    expect(EDGE_SRC).toMatch(/redaction_mode:\s*r\.redaction_mode/);
    // Batch 6 replaced the single field with a detected-at-request +
    // detected-at-approval + operator + changed-since-request shape.
    expect(EDGE_SRC).toMatch(/legal_hold_context_detected_at_request:\s*storedDetected/);
    expect(EDGE_SRC).toMatch(/legal_hold_context_detected_at_approval:\s*recheckDetected/);
    expect(EDGE_SRC).toMatch(/legal_hold_context_operator:\s*storedOperator/);
    expect(EDGE_SRC).toMatch(/legal_hold_context_changed_since_request:/);
    expect(EDGE_SRC).toMatch(/previous_status:\s*r\.previous_status/);
    expect(EDGE_SRC).toMatch(/new_status:\s*r\.new_status/);
  });
  it("denial audits carry structured reason codes", () => {
    expect(EDGE_SRC).toMatch(/reason:\s*"not_platform_admin"/);
    expect(EDGE_SRC).toMatch(/reason:\s*"mfa_required"/);
    expect(EDGE_SRC).toMatch(/reason:\s*"invalid_body"/);
    expect(EDGE_SRC).toMatch(/reason:\s*code\.toLowerCase\(\)/);
  });
});

describe("Batch 4 — RPC + DB contract", () => {
  it("migration adds 'approved' to admin_export status allow-list", () => {
    expect(MIGRATION_SRC).toMatch(/'awaiting_approval'/);
    expect(MIGRATION_SRC).toMatch(/'approved'/);
    expect(MIGRATION_SRC).toMatch(/export_requests_status_domain/);
  });
  it("RPC is SECURITY DEFINER with locked search_path", () => {
    expect(MIGRATION_SRC).toMatch(
      /CREATE OR REPLACE FUNCTION public\.approve_admin_governance_export/,
    );
    expect(MIGRATION_SRC).toMatch(/SECURITY DEFINER/);
    expect(MIGRATION_SRC).toMatch(/SET search_path\s*=\s*public/);
  });
  it("RPC raises clean codes for every denial branch", () => {
    expect(MIGRATION_SRC).toMatch(/APPROVER_REQUIRED/);
    expect(MIGRATION_SRC).toMatch(/REQUEST_ID_REQUIRED/);
    expect(MIGRATION_SRC).toMatch(/REQUEST_NOT_FOUND/);
    expect(MIGRATION_SRC).toMatch(/NOT_ADMIN_EXPORT/);
    expect(MIGRATION_SRC).toMatch(/NOT_GOVERNANCE_RECORD_REQUEST/);
    expect(MIGRATION_SRC).toMatch(/REQUEST_NOT_PENDING/);
    expect(MIGRATION_SRC).toMatch(/SELF_APPROVAL_BLOCKED/);
  });
  it("RPC writes only status='approved' and records approver_user_id + approved_at", () => {
    expect(MIGRATION_SRC).toMatch(/SET\s+status\s*=\s*'approved'/);
    expect(MIGRATION_SRC).toMatch(/'approver_user_id'/);
    expect(MIGRATION_SRC).toMatch(/'approved_at'/);
    expect(MIGRATION_SRC).toMatch(/'previous_status'/);
    expect(MIGRATION_SRC).toMatch(/'new_status'/);
    // Never any forward-state in this migration.
    expect(MIGRATION_SRC).not.toMatch(/SET\s+status\s*=\s*'ready_for_download'/);
    expect(MIGRATION_SRC).not.toMatch(/SET\s+status\s*=\s*'downloaded'/);
    expect(MIGRATION_SRC).not.toMatch(/SET\s+status\s*=\s*'export_preparation_required'/);
    expect(MIGRATION_SRC).not.toMatch(/SET\s+status\s*=\s*'destroyed'/);
  });
  it("RPC REVOKEs PUBLIC/anon/authenticated and GRANTs only service_role", () => {
    expect(MIGRATION_SRC).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.approve_admin_governance_export[\s\S]*FROM PUBLIC,\s*anon,\s*authenticated/,
    );
    expect(MIGRATION_SRC).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.approve_admin_governance_export[\s\S]*TO service_role/,
    );
  });
  it("RPC takes a row-level FOR UPDATE lock", () => {
    expect(MIGRATION_SRC).toMatch(/FOR UPDATE/);
  });
});

describe("Batch 4 — UI visibility + scope", () => {
  it("returns null for non-platform-admin viewers", () => {
    expect(PANEL_SRC).toMatch(/if\s*\(!isPlatformAdmin\)\s*return\s+null/);
  });
  it("renders AAL2 banner", () => {
    expect(PANEL_SRC).toMatch(/AAL2 required/);
  });
  it("queries only awaiting_approval admin_export rows for this Governance Record", () => {
    expect(PANEL_SRC).toMatch(/\.eq\(\s*"kind"\s*,\s*"admin_export"\s*\)/);
    expect(PANEL_SRC).toMatch(/\.eq\(\s*"status"\s*,\s*"awaiting_approval"\s*\)/);
    expect(PANEL_SRC).toMatch(
      /\.eq\(\s*"governance_record_id"\s*,\s*governanceRecordId\s*\)/,
    );
  });
  it("only invokes the admin-governance-export-approve edge function", () => {
    expect(PANEL_SRC).toMatch(/"admin-governance-export-approve"/);
    expect(PANEL_SRC).not.toMatch(/"export-prepare"/);
    expect(PANEL_SRC).not.toMatch(/"export-download"/);
    expect(PANEL_SRC).not.toMatch(/"admin-export-destroy"/);
    expect(PANEL_SRC).not.toMatch(/"admin-export-prepare"/);
  });
  it("disables the Approve button when current user is the requester (self-approval)", () => {
    expect(PANEL_SRC).toMatch(/isSelf\s*=\s*user\?\.id\s*===\s*row\.requester_user_id/);
    expect(PANEL_SRC).toMatch(/disabled=\{isSelf\s*\|\|/);
    expect(PANEL_SRC).toMatch(/Self-approval blocked/);
  });
  it("displays the no-file / no-download contract badge and success copy", () => {
    expect(PANEL_SRC).toMatch(/No file generated/);
    expect(PANEL_SRC).toMatch(/No download link/);
    expect(PANEL_SRC).toMatch(
      /Approved means approved only[\s\S]*no file has been generated/i,
    );
  });
  it("surfaces legal-hold context badge when present", () => {
    expect(PANEL_SRC).toMatch(/legal-hold context/);
    expect(PANEL_SRC).toMatch(/legal_hold_context/);
  });
  it("never renders prepare/download/destroy/signed-URL/Blob/anchor-download controls", () => {
    expect(PANEL_SRC).not.toMatch(/Prepare export/i);
    expect(PANEL_SRC).not.toMatch(/Download export/i);
    expect(PANEL_SRC).not.toMatch(/Destroy export/i);
    expect(PANEL_SRC).not.toMatch(/Ready to download/i);
    expect(PANEL_SRC).not.toMatch(/<a[^>]*\bdownload\b/i);
    expect(PANEL_SRC).not.toMatch(/createSignedUrl|signed_url/);
    expect(PANEL_SRC).not.toMatch(/new\s+Blob\s*\([^)]*text\/(csv|plain|json|pdf)/i);
    expect(PANEL_SRC).not.toMatch(/raw_payload/);
    expect(PANEL_SRC).not.toMatch(/\bexport_all\b|\bdump_all\b/i);
  });
});

describe("Batch 4 — mount contract (GovernanceRecordDetail)", () => {
  it("mounts the approval panel only when isPlatformAdmin AND anchor.matchId", () => {
    expect(MOUNT_SRC).toMatch(
      /isPlatformAdmin\s*&&\s*anchor\.matchId[\s\S]{0,120}AdminGovernanceExportApprovalPanel/,
    );
  });
  it("passes governanceRecordId from the match anchor", () => {
    expect(MOUNT_SRC).toMatch(
      /AdminGovernanceExportApprovalPanel[\s\S]{0,200}governanceRecordId=\{anchor\.matchId\}/,
    );
  });
});

describe("Batch 4 — Batch 2/3 boundary preserved (no scope creep)", () => {
  it("approve edge function does NOT generate, sign, or upload anything", () => {
    expect(EDGE_SRC).not.toMatch(/createSignedUrl\s*\(/);
    expect(EDGE_SRC).not.toMatch(/\.upload\s*\(/);
    expect(EDGE_SRC).not.toMatch(/new\s+Blob\s*\(/);
    expect(EDGE_SRC).not.toMatch(/text\/csv/i);
    expect(EDGE_SRC).not.toMatch(/\bsigned_url\b/);
  });
  it("approve edge function does NOT call prepare/download/destroy verbs", () => {
    expect(EDGE_SRC).not.toMatch(/admin_export_prepared/);
    expect(EDGE_SRC).not.toMatch(/admin_export_downloaded/);
    expect(EDGE_SRC).not.toMatch(/admin_export_destroyed/);
    expect(EDGE_SRC).not.toMatch(/admin_export_generated/);
  });
  it("migration never writes any post-approved status", () => {
    expect(MIGRATION_SRC).not.toMatch(/SET\s+status\s*=\s*'ready_for_download'/);
    expect(MIGRATION_SRC).not.toMatch(/SET\s+status\s*=\s*'downloaded'/);
    expect(MIGRATION_SRC).not.toMatch(/SET\s+status\s*=\s*'destroyed'/);
    expect(MIGRATION_SRC).not.toMatch(/SET\s+status\s*=\s*'export_preparation_required'/);
  });
});
