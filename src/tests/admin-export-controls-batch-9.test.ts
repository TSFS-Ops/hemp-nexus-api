/**
 * Admin Export Controls Batch 9 — HQ Redaction Preview Shell.
 *
 * Static-contract / source-pin tests (Vitest). Same pattern as Batches
 * 5 / 6 / 8. Proves:
 *   - preview edge function is platform_admin-gated + AAL2-gated
 *   - preview consumes the Batch 8 redaction helper
 *   - preview never mutates export_requests / legal_holds / matches
 *   - preview never generates files / signed URLs / downloads / Blob /
 *     prepare / destroy
 *   - preview emits only the canonical denial audit on refusal
 *   - HQ panel renders preview-only badges and renders no download /
 *     prepare / destroy / signed-URL / file / Blob / "ready to download"
 *     surface
 *   - HQ panel invokes only `admin-governance-export-preview`
 *   - guard exists and is wired into prebuild
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");

function readSrc(rel: string): string {
  const raw = readFileSync(join(REPO_ROOT, rel), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<![:"'`\\])\/\/[^\n]*/g, "");
}

const FN_SRC = readSrc(
  "supabase/functions/admin-governance-export-preview/index.ts",
);
const PANEL_SRC = readSrc(
  "src/components/admin/governance/AdminGovernanceExportPreviewPanel.tsx",
);
const GUARD_RAW = readFileSync(
  join(REPO_ROOT, "scripts/check-admin-export-controls-batch-9.mjs"),
  "utf8",
);
const PKG = readFileSync(join(REPO_ROOT, "package.json"), "utf8");
const RELEASE_GATE = readFileSync(
  join(REPO_ROOT, "RELEASE_GATE.md"),
  "utf8",
);

describe("Admin Export Controls Batch 9 — preview edge function", () => {
  it("requires platform_admin via is_admin RPC", () => {
    expect(FN_SRC).toMatch(/admin\.rpc\(\s*["']is_admin["']/);
    expect(FN_SRC).toMatch(/NOT_PLATFORM_ADMIN/);
  });
  it("requires AAL2 via assertAal2", () => {
    expect(FN_SRC).toMatch(/assertAal2\s*\(/);
    expect(FN_SRC).toMatch(/MFA_REQUIRED/);
  });
  it("consumes the Batch 8 redaction helper", () => {
    expect(FN_SRC).toMatch(/redactGovernanceRecord\s*\(/);
    expect(FN_SRC).toMatch(/_shared\/admin-export-redaction/);
  });
  it("defaults redaction_mode to redacted_client_safe", () => {
    expect(FN_SRC).toMatch(/DEFAULT_REDACTION_MODE/);
    // Zod schema enumerates exactly the four canonical modes.
    for (const m of [
      "redacted_client_safe",
      "evidence_only",
      "metadata_only",
      "full_internal",
    ]) {
      expect(FN_SRC).toContain(`"${m}"`);
    }
  });
  it("emits the canonical denial audit on refusal", () => {
    expect(FN_SRC).toMatch(/DATA_010_AUDIT_ACTIONS\.blocked_or_declined/);
  });
  it("never mutates export_requests / legal_holds / matches / governance_records", () => {
    expect(FN_SRC).not.toMatch(/\.insert\s*\(/);
    expect(FN_SRC).not.toMatch(/\.update\s*\(/);
    expect(FN_SRC).not.toMatch(/\.delete\s*\(/);
    expect(FN_SRC).not.toMatch(/\.upsert\s*\(/);
    expect(FN_SRC).not.toMatch(
      /from\(\s*["']export_requests["']\s*\)[\s\S]{0,200}\.(insert|update|delete|upsert)/,
    );
    expect(FN_SRC).not.toMatch(
      /from\(\s*["']legal_holds["']\s*\)[\s\S]{0,200}\.(insert|update|delete|upsert)/,
    );
  });
  it("never generates files / signed URLs / downloads", () => {
    expect(FN_SRC).not.toMatch(/createSignedUrl/);
    expect(FN_SRC).not.toMatch(/\.storage\b/);
    expect(FN_SRC).not.toMatch(/Deno\.writeFile|Deno\.writeTextFile/);
    expect(FN_SRC).not.toMatch(/\bnew\s+Blob\s*\(/);
    expect(FN_SRC).not.toMatch(/text\/csv/i);
    expect(FN_SRC).not.toMatch(/application\/pdf/i);
    expect(FN_SRC).not.toMatch(/Content-Disposition/i);
    expect(FN_SRC).not.toMatch(
      /admin-governance-export-(prepare|download|destroy)/,
    );
  });
  it("does not call other governance export endpoints", () => {
    expect(FN_SRC).not.toMatch(/supabase\.functions\.invoke/);
  });
  it("does not touch the Batch 7C production guard or DATA-004 surface", () => {
    expect(FN_SRC).not.toMatch(/is_production_environment/);
    expect(FN_SRC).not.toMatch(/RUN_ADMIN_EXPORT_BATCH_7C_SMOKE/);
    expect(FN_SRC).not.toMatch(/org_retention_policies/);
    expect(FN_SRC).not.toMatch(/cron\.schedule|net\.http_post/i);
    expect(FN_SRC).not.toMatch(/cold-storage-archive/);
  });
});

describe("Admin Export Controls Batch 9 — HQ preview panel", () => {
  it("renders the preview-only / no-download / no-signed-URL / AAL2 badges", () => {
    expect(PANEL_SRC).toMatch(/data-testid=["']badge-preview-only["']/);
    expect(PANEL_SRC).toMatch(/data-testid=["']badge-no-download["']/);
    expect(PANEL_SRC).toMatch(/data-testid=["']badge-no-signed-url["']/);
    expect(PANEL_SRC).toMatch(/data-testid=["']badge-aal2["']/);
  });
  it("renders the redacted preview + manifest containers", () => {
    expect(PANEL_SRC).toMatch(/data-testid=["']preview-redacted["']/);
    expect(PANEL_SRC).toMatch(/data-testid=["']preview-manifest["']/);
  });
  it("invokes only admin-governance-export-preview", () => {
    expect(PANEL_SRC).toMatch(/admin-governance-export-preview/);
    expect(PANEL_SRC).not.toMatch(/admin-governance-export-list/);
    expect(PANEL_SRC).not.toMatch(/admin-governance-export-request/);
    expect(PANEL_SRC).not.toMatch(/admin-governance-export-approve/);
    expect(PANEL_SRC).not.toMatch(
      /admin-governance-export-(prepare|download|destroy)/,
    );
  });
  it("renders no download / prepare / destroy / signed-URL / file / Blob surface", () => {
    // Anchor / blob / file-saver surface
    expect(PANEL_SRC).not.toMatch(/<a\s+[^>]*download\b/i);
    expect(PANEL_SRC).not.toMatch(/\bnew\s+Blob\s*\(/);
    expect(PANEL_SRC).not.toMatch(/URL\.createObjectURL/);
    expect(PANEL_SRC).not.toMatch(/saveAs\s*\(/);
    expect(PANEL_SRC).not.toMatch(/text\/csv/i);
    expect(PANEL_SRC).not.toMatch(/application\/pdf/i);
    expect(PANEL_SRC).not.toMatch(/Content-Disposition/i);
    // Action-label surface
    expect(PANEL_SRC).not.toMatch(/\bDownload\b/);
    expect(PANEL_SRC).not.toMatch(/\bPrepare\b/);
    expect(PANEL_SRC).not.toMatch(/\bDestroy\b/);
    expect(PANEL_SRC).not.toMatch(/Ready to download/i);
    expect(PANEL_SRC).not.toMatch(/signed[ _-]?url/i);
  });
  it("is platform_admin-gated in the UI", () => {
    expect(PANEL_SRC).toMatch(/isPlatformAdmin/);
    expect(PANEL_SRC).toMatch(/data-testid=["']not-platform-admin["']/);
  });
  it("validates governance_record_id as a UUID client-side", () => {
    expect(PANEL_SRC).toMatch(
      /\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$/i,
    );
  });
});

describe("Admin Export Controls Batch 9 — prebuild wiring", () => {
  it("guard script exists with banner", () => {
    expect(GUARD_RAW).toMatch(/Admin Export Controls Batch 9/);
  });
  it("prebuild invokes the Batch 9 guard", () => {
    expect(PKG).toMatch(/check-admin-export-controls-batch-9\.mjs/);
  });
  it("RELEASE_GATE.md documents Batch 9", () => {
    expect(RELEASE_GATE).toMatch(
      /Admin Export Controls — Batch 9/,
    );
    expect(RELEASE_GATE).toMatch(/check-admin-export-controls-batch-9\.mjs/);
  });
});
