/**
 * Admin Export Controls Batch 5 — HQ Governance Export Request List View.
 *
 * Static-contract / source-pin tests (Vitest). Same pattern as
 * src/tests/admin-export-controls-batch-3.test.ts and -batch-4.test.ts.
 * Proves the list-view surface stays narrow:
 *   - platform_admin + AAL2 only
 *   - read-only — no mutation, no preparation, no generation,
 *     no download, no destroy, no signed URL
 *   - only governance-record-anchored admin_export rows are returned
 *   - reason / approval note exposed only as summaries
 *   - no raw sensitive metadata in payload contract
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");

const EDGE_SRC = readFileSync(
  join(
    REPO_ROOT,
    "supabase/functions/admin-governance-export-list/index.ts",
  ),
  "utf8",
);
const PANEL_SRC = readFileSync(
  join(
    REPO_ROOT,
    "src/components/admin/governance/AdminGovernanceExportRequestsListPanel.tsx",
  ),
  "utf8",
);
const HQ_SRC = readFileSync(join(REPO_ROOT, "src/pages/HQ.tsx"), "utf8");
const GUARD_SRC = readFileSync(
  join(REPO_ROOT, "scripts/check-admin-export-controls-batch-5.mjs"),
  "utf8",
);

describe("Batch 5 — edge function access matrix", () => {
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

  it("uses strict Zod schema to validate input", () => {
    expect(EDGE_SRC).toMatch(/BodySchema\s*=\s*z\.object\([\s\S]+\.strict\(\)/);
  });
});

describe("Batch 5 — query scope (governance-anchored admin_export only)", () => {
  it("filters to kind=admin_export", () => {
    expect(EDGE_SRC).toMatch(
      /\.eq\(\s*["']kind["']\s*,\s*["']admin_export["']\s*\)/,
    );
  });

  it("requires non-null governance_record_id", () => {
    expect(EDGE_SRC).toMatch(
      /\.not\(\s*["']governance_record_id["']\s*,\s*["']is["']\s*,\s*null\s*\)/,
    );
  });

  it("restricts visible statuses to Batch 5 list set", () => {
    expect(EDGE_SRC).toMatch(/BATCH_5_VISIBLE_STATUSES/);
    expect(EDGE_SRC).toMatch(/awaiting_approval/);
    expect(EDGE_SRC).toMatch(/"approved"/);
    expect(EDGE_SRC).toMatch(/"denied"/);
    expect(EDGE_SRC).toMatch(/"failed"/);
    expect(EDGE_SRC).not.toMatch(/"ready_for_download"/);
    expect(EDGE_SRC).not.toMatch(/"prepared"/);
    expect(EDGE_SRC).not.toMatch(/"generated"/);
    expect(EDGE_SRC).not.toMatch(/"downloaded"/);
    expect(EDGE_SRC).not.toMatch(/"destroyed"/);
  });

  it("orders newest-first and limits result size", () => {
    expect(EDGE_SRC).toMatch(/\.order\(\s*["']requested_at["']/);
    expect(EDGE_SRC).toMatch(/\.limit\(/);
  });

  it("optional governance_record_id filter narrows the result set", () => {
    expect(EDGE_SRC).toMatch(
      /\.eq\(\s*["']governance_record_id["']\s*,\s*b\.governance_record_id/,
    );
  });
});

describe("Batch 5 — response payload is governance-safe", () => {
  it("returns summarised reason / approval note only (no raw free-text in payload contract)", () => {
    expect(EDGE_SRC).toMatch(/reason_summary/);
    expect(EDGE_SRC).toMatch(/approval_note_summary/);
    expect(EDGE_SRC).toMatch(/function summarise/);
  });

  it("exposes legal_hold context only as presence + scope (no full reason text in row)", () => {
    expect(EDGE_SRC).toMatch(/legal_hold_context_present/);
    expect(EDGE_SRC).toMatch(/legal_hold_context_scope/);
    expect(EDGE_SRC).not.toMatch(/legal_hold_context_reason/);
  });

  it("does NOT return file paths, storage keys, signed URLs, download tokens, or raw payloads", () => {
    expect(EDGE_SRC).not.toMatch(/storage_key/);
    expect(EDGE_SRC).not.toMatch(/file_path/);
    expect(EDGE_SRC).not.toMatch(/(?<!no_)signed_url|createSignedUrl/);
    expect(EDGE_SRC).not.toMatch(/download_token/);
    expect(EDGE_SRC).not.toMatch(/raw_response|raw_payload/);
  });

  it("contract block in response explicitly disclaims download / signed URL / prepare / destroy", () => {
    expect(EDGE_SRC).toMatch(/no_file_generated:\s*true/);
    expect(EDGE_SRC).toMatch(/no_download_link:\s*true/);
    expect(EDGE_SRC).toMatch(/no_signed_url:\s*true/);
    expect(EDGE_SRC).toMatch(/no_prepare:\s*true/);
    expect(EDGE_SRC).toMatch(/no_destroy:\s*true/);
    expect(EDGE_SRC).toMatch(/aal2_required:\s*true/);
    expect(EDGE_SRC).toMatch(/platform_admin_only:\s*true/);
  });
});

describe("Batch 5 — edge function does NOT mutate export_requests", () => {
  it("never calls .insert on export_requests", () => {
    expect(EDGE_SRC).not.toMatch(
      /from\(\s*["']export_requests["']\s*\)[\s\S]{0,80}\.insert\s*\(/,
    );
  });
  it("never calls .update on export_requests", () => {
    expect(EDGE_SRC).not.toMatch(
      /from\(\s*["']export_requests["']\s*\)[\s\S]{0,80}\.update\s*\(/,
    );
  });
  it("never calls .delete on export_requests", () => {
    expect(EDGE_SRC).not.toMatch(
      /from\(\s*["']export_requests["']\s*\)[\s\S]{0,80}\.delete\s*\(/,
    );
  });
  it("never writes status = anything", () => {
    expect(EDGE_SRC).not.toMatch(/SET\s+status\s*=/i);
  });
  it("never calls the approve or request RPCs", () => {
    expect(EDGE_SRC).not.toMatch(/approve_admin_governance_export/);
    expect(EDGE_SRC).not.toMatch(/request_admin_governance_export/);
  });
});

describe("Batch 5 — denial path emits canonical DATA-010 audit", () => {
  it("emits data.admin_export_blocked_or_declined on NOT_PLATFORM_ADMIN", () => {
    expect(EDGE_SRC).toMatch(
      /DATA_010_AUDIT_ACTIONS\.blocked_or_declined[\s\S]{0,400}not_platform_admin/,
    );
  });
  it("emits data.admin_export_blocked_or_declined on MFA_REQUIRED", () => {
    expect(EDGE_SRC).toMatch(
      /DATA_010_AUDIT_ACTIONS\.blocked_or_declined[\s\S]{0,400}mfa_required/,
    );
  });
  it("never invents a new audit name outside DATA-010 SSOT", () => {
    expect(EDGE_SRC).not.toMatch(/data\.admin_export_listed/);
    expect(EDGE_SRC).not.toMatch(/data\.admin_export_read/);
    expect(EDGE_SRC).not.toMatch(/data\.admin_export_viewed/);
  });
});

describe("Batch 5 — UI panel is read-only and platform_admin-only", () => {
  it("guards on isPlatformAdmin", () => {
    expect(PANEL_SRC).toMatch(/isPlatformAdmin/);
  });

  it("invokes only admin-governance-export-list", () => {
    expect(PANEL_SRC).toMatch(
      /supabase\.functions\.invoke\(\s*\n?\s*["']admin-governance-export-list["']/,
    );
    expect(PANEL_SRC).not.toMatch(
      /supabase\.functions\.invoke\(\s*\n?\s*["'](?!admin-governance-export-list["'])/,
    );
  });

  it("renders mandatory governance fields", () => {
    for (const field of [
      "Request",
      "Governance Record",
      "Status",
      "Requested by",
      "Requested at",
      "Approved by",
      "Approved at",
      "Redaction",
      "Legal hold",
      "Reason",
      "Approval note",
    ]) {
      expect(PANEL_SRC).toContain(field);
    }
  });

  it("renders empty state, loading state, error state, and denied state", () => {
    expect(PANEL_SRC).toMatch(/list-loading/);
    expect(PANEL_SRC).toMatch(/list-empty/);
    expect(PANEL_SRC).toMatch(/list-error/);
    expect(PANEL_SRC).toMatch(/list-denied/);
  });

  it("renders AAL2 banner and contract reassurance badge", () => {
    expect(PANEL_SRC).toMatch(/AAL2 required/);
    expect(PANEL_SRC).toMatch(/No file generated · No download link/);
  });

  it("renders no download / signed URL / prepare / destroy / generate controls", () => {
    expect(PANEL_SRC).not.toMatch(
      /Prepare export|Destroy export|Generate export|Download export|Download CSV|Download JSON|Download PDF/i,
    );
    expect(PANEL_SRC).not.toMatch(/signedUrl|createSignedUrl|signed_url/);
    expect(PANEL_SRC).not.toMatch(/new\s+Blob\s*\(|text\/(csv|plain|json|pdf)/i);
    expect(PANEL_SRC).not.toMatch(/<a[^>]*\bdownload\b/i);
    expect(PANEL_SRC).not.toMatch(/\bdownloadCSV(?:Raw)?\s*\(/);
    expect(PANEL_SRC).not.toMatch(/ready to download|export ready|ready_for_download/i);
  });

  it("never invokes prepare / download / destroy / approve / request edge functions", () => {
    expect(PANEL_SRC).not.toMatch(/["']export-prepare["']/);
    expect(PANEL_SRC).not.toMatch(/["']export-download["']/);
    expect(PANEL_SRC).not.toMatch(/["']export-destroy["']/);
    expect(PANEL_SRC).not.toMatch(/["']admin-governance-export-approve["']/);
    expect(PANEL_SRC).not.toMatch(/["']admin-governance-export-request["']/);
    expect(PANEL_SRC).not.toMatch(/approve_admin_governance_export/);
    expect(PANEL_SRC).not.toMatch(/request_admin_governance_export/);
  });

  it("never writes to export_requests directly", () => {
    expect(PANEL_SRC).not.toMatch(
      /\.from\(\s*["']export_requests["']\s*\)[\s\S]{0,120}\.(update|insert|delete)\s*\(/,
    );
  });

  it("status filter is limited to the Batch 5 visible set", () => {
    expect(PANEL_SRC).toMatch(/BATCH_5_LIST_STATUSES/);
    expect(PANEL_SRC).toMatch(/awaiting_approval/);
    expect(PANEL_SRC).toMatch(/approved/);
    expect(PANEL_SRC).toMatch(/denied/);
    expect(PANEL_SRC).toMatch(/failed/);
    expect(PANEL_SRC).not.toMatch(/"prepared"/);
    expect(PANEL_SRC).not.toMatch(/"generated"/);
    expect(PANEL_SRC).not.toMatch(/"downloaded"/);
    expect(PANEL_SRC).not.toMatch(/"destroyed"/);
  });

  it("validates the governance_record_id filter as a UUID before sending it server-side", () => {
    expect(PANEL_SRC).toMatch(/\^\[0-9a-f\]\{8\}-/);
  });
});

describe("Batch 5 — mount and tab wiring", () => {
  it("HQ.tsx imports the list panel", () => {
    expect(HQ_SRC).toMatch(
      /import\s*\{\s*AdminGovernanceExportRequestsListPanel\s*\}\s*from\s*["']@\/components\/admin\/governance\/AdminGovernanceExportRequestsListPanel["']/,
    );
  });
  it("HQ.tsx mounts the list panel under a Governance Records sub-tab", () => {
    expect(HQ_SRC).toMatch(/<AdminGovernanceExportRequestsListPanel\s*\/>/);
    expect(HQ_SRC).toMatch(/\["records",\s*"memory",\s*"export-requests"\]/);
  });
  it("HQ tree itself is wrapped by platform_admin RequireAuth", () => {
    expect(HQ_SRC).toMatch(/RequireAuth/);
    expect(HQ_SRC).toMatch(/platform_admin/);
  });
});

describe("Batch 5 — guard wiring", () => {
  it("guard script exists and pins the read-only contract", () => {
    expect(GUARD_SRC).toMatch(/list-view contract drift/);
    expect(GUARD_SRC).toMatch(/NO signed URL minting/);
    expect(GUARD_SRC).toMatch(/NO calls to export-prepare/);
    expect(GUARD_SRC).toMatch(/NO calls to export-download/);
    expect(GUARD_SRC).toMatch(/NO calls to export-destroy/);
    expect(GUARD_SRC).toMatch(/NO export_requests mutation/);
  });
});
