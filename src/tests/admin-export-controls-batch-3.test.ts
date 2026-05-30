/**
 * Admin Export Controls Batch 3 — Redaction + Access Contract Tests.
 *
 * Source-pin / static-contract tests for the Batch 2 Governance Record
 * export REQUEST shell. Proves the request surface remains:
 *   - platform_admin + AAL2 only
 *   - audit-emitting (DATA-010 canonical)
 *   - redaction-mode-constrained
 *   - request-only (no approve / prepare / download / file gen)
 *
 * Pattern mirrors src/tests/data-010-export-aal2-universal.test.ts —
 * no live network, no auth, no side effects.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");

const EDGE_SRC = readFileSync(
  join(
    REPO_ROOT,
    "supabase/functions/admin-governance-export-request/index.ts",
  ),
  "utf8",
);
const PANEL_SRC = readFileSync(
  join(
    REPO_ROOT,
    "src/components/admin/governance/AdminGovernanceExportRequestPanel.tsx",
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
const MIGRATION_SRC = readFileSync(
  join(
    REPO_ROOT,
    "supabase/migrations/20260530063841_55c7e98e-fee7-4816-861b-6cc3f691c4e3.sql",
  ),
  "utf8",
);

describe("Batch 3 — edge function access matrix", () => {
  it("requires Bearer Authorization (rejects unauthenticated with 401)", () => {
    expect(EDGE_SRC).toMatch(/authHeader\.startsWith\(\s*["']Bearer\s/);
    expect(EDGE_SRC).toMatch(/"unauthorized"[^}]*\}\s*,\s*401/);
  });

  it("rejects non-POST methods (405)", () => {
    expect(EDGE_SRC).toMatch(/req\.method\s*!==\s*"POST"/);
    expect(EDGE_SRC).toMatch(/method_not_allowed/);
  });

  it("gates on platform_admin via is_admin RPC and returns NOT_PLATFORM_ADMIN", () => {
    expect(EDGE_SRC).toMatch(/rpc\(\s*["']is_admin["']/);
    expect(EDGE_SRC).toMatch(/code:\s*["']NOT_PLATFORM_ADMIN["']/);
    expect(EDGE_SRC).toMatch(/403/);
  });

  it("gates on AAL2 and returns MFA_REQUIRED on AAL1", () => {
    expect(EDGE_SRC).toMatch(/\bassertAal2\s*\(/);
    expect(EDGE_SRC).toMatch(/code:\s*["']MFA_REQUIRED["']/);
    expect(EDGE_SRC).toMatch(/ApiException/);
  });

  it("enforces order: is_admin BEFORE assertAal2 (no platform check skipped)", () => {
    const adminIdx = EDGE_SRC.indexOf('rpc("is_admin"');
    const aalIdx = EDGE_SRC.indexOf("assertAal2(");
    expect(adminIdx).toBeGreaterThan(-1);
    expect(aalIdx).toBeGreaterThan(-1);
    expect(adminIdx).toBeLessThan(aalIdx);
  });
});

describe("Batch 3 — body validation", () => {
  it("uses a strict Zod schema (no unknown fields)", () => {
    expect(EDGE_SRC).toMatch(/BodySchema\s*=\s*z\.object\(/);
    expect(EDGE_SRC).toMatch(/\}\)\.strict\(\)/);
  });

  it("requires governance_record_id as uuid", () => {
    expect(EDGE_SRC).toMatch(
      /governance_record_id:\s*z\.string\(\)\.uuid\(\)/,
    );
  });

  it("requires reason of minimum length", () => {
    expect(EDGE_SRC).toMatch(
      /reason:\s*z\.string\(\)\.trim\(\)\.min\(MIN_EXPORT_REASON_LENGTH\)/,
    );
  });

  it("constrains purpose to the shared EXPORT_PURPOSES enum", () => {
    expect(EDGE_SRC).toMatch(/purpose:\s*z\.enum\(EXPORT_PURPOSES\)/);
  });

  it("constrains redaction_mode to the 4-value allow-list", () => {
    expect(EDGE_SRC).toMatch(
      /redaction_mode:\s*z\s*\.\s*enum\(\s*ADMIN_GOVERNANCE_EXPORT_REDACTION_MODES\s*\)/,
    );
    expect(EDGE_SRC).toMatch(/"redacted_client_safe"/);
    expect(EDGE_SRC).toMatch(/"evidence_only"/);
    expect(EDGE_SRC).toMatch(/"metadata_only"/);
    expect(EDGE_SRC).toMatch(/"full_internal"/);
  });

  it("defaults redaction_mode to redacted_client_safe", () => {
    expect(EDGE_SRC).toMatch(
      /\.default\(\s*"redacted_client_safe"\s*\)/,
    );
  });

  it("returns invalid_body on Zod failure and writes a denial audit", () => {
    expect(EDGE_SRC).toMatch(/parsed\.success/);
    expect(EDGE_SRC).toMatch(/error:\s*"invalid_body"/);
    expect(EDGE_SRC).toMatch(/reason:\s*"invalid_body"/);
  });

  it("returns invalid_json on malformed JSON", () => {
    expect(EDGE_SRC).toMatch(/invalid_json/);
  });
});

describe("Batch 3 — audit emission (DATA-010 canonical)", () => {
  it("imports the canonical DATA-010 audit actions", () => {
    expect(EDGE_SRC).toMatch(
      /from\s+"\.\.\/_shared\/export-lifecycle-audit\.ts"/,
    );
    expect(EDGE_SRC).toMatch(/DATA_010_AUDIT_ACTIONS/);
  });

  it("emits requested audit on success", () => {
    expect(EDGE_SRC).toMatch(/DATA_010_AUDIT_ACTIONS\.requested/);
  });

  it("emits blocked_or_declined audit on every denial path", () => {
    const matches = EDGE_SRC.match(
      /DATA_010_AUDIT_ACTIONS\.blocked_or_declined/g,
    );
    // 4 denial paths: not_platform_admin, mfa_required, invalid_body, request_create_failed.
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("audit payload captures actor + governance + redaction context on success", () => {
    expect(EDGE_SRC).toMatch(/actor_user_id:\s*adminUser\.id/);
    expect(EDGE_SRC).toMatch(/governance_record_id:\s*b\.governance_record_id/);
    expect(EDGE_SRC).toMatch(/redaction_mode:\s*b\.redaction_mode/);
    expect(EDGE_SRC).toMatch(/legal_hold_context:\s*b\.legal_hold_context/);
    expect(EDGE_SRC).toMatch(/reason:\s*b\.reason/);
    expect(EDGE_SRC).toMatch(/purpose:\s*b\.purpose/);
  });

  it("denial audits carry a structured reason code", () => {
    expect(EDGE_SRC).toMatch(/reason:\s*"not_platform_admin"/);
    expect(EDGE_SRC).toMatch(/reason:\s*"mfa_required"/);
    expect(EDGE_SRC).toMatch(/reason:\s*"invalid_body"/);
    expect(EDGE_SRC).toMatch(/reason:\s*"request_create_failed"/);
  });
});

describe("Batch 3 — RPC + DB contract (request_admin_governance_export)", () => {
  it("migration enforces the redaction-mode CHECK constraint", () => {
    expect(MIGRATION_SRC).toMatch(/export_requests_redaction_mode_domain/);
    expect(MIGRATION_SRC).toMatch(/'redacted_client_safe'/);
    expect(MIGRATION_SRC).toMatch(/'evidence_only'/);
    expect(MIGRATION_SRC).toMatch(/'metadata_only'/);
    expect(MIGRATION_SRC).toMatch(/'full_internal'/);
  });

  it("migration adds governance_record_id + redaction_mode columns", () => {
    expect(MIGRATION_SRC).toMatch(
      /ADD COLUMN IF NOT EXISTS governance_record_id uuid/i,
    );
    expect(MIGRATION_SRC).toMatch(
      /ADD COLUMN IF NOT EXISTS redaction_mode text/i,
    );
  });

  it("RPC is SECURITY DEFINER with locked search_path", () => {
    expect(MIGRATION_SRC).toMatch(
      /CREATE OR REPLACE FUNCTION public\.request_admin_governance_export/,
    );
    expect(MIGRATION_SRC).toMatch(/SECURITY DEFINER/);
    expect(MIGRATION_SRC).toMatch(/SET search_path\s*=\s*public/);
  });

  it("RPC raises on missing governance_record_id and short/empty reason", () => {
    expect(MIGRATION_SRC).toMatch(/GOVERNANCE_RECORD_ID_REQUIRED/);
    expect(MIGRATION_SRC).toMatch(/length\(coalesce\(p_reason,\s*''\)\)\s*<\s*10/);
  });

  it("RPC defaults redaction_mode to redacted_client_safe", () => {
    expect(MIGRATION_SRC).toMatch(
      /coalesce\(p_redaction_mode,\s*'redacted_client_safe'\)/,
    );
  });

  it("RPC rejects invalid redaction modes inside the function body", () => {
    expect(MIGRATION_SRC).toMatch(/INVALID_REDACTION_MODE/);
  });

  it("RPC revokes EXECUTE from PUBLIC/anon/authenticated and grants only service_role", () => {
    expect(MIGRATION_SRC).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.request_admin_governance_export[\s\S]*FROM PUBLIC,\s*anon,\s*authenticated/,
    );
    expect(MIGRATION_SRC).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.request_admin_governance_export[\s\S]*TO service_role/,
    );
  });

  it("inserts with status='awaiting_approval' and kind='admin_export'", () => {
    expect(MIGRATION_SRC).toMatch(/'awaiting_approval'/);
    expect(MIGRATION_SRC).toMatch(/'admin_export'/);
  });
});

describe("Batch 3 — UI visibility + scope (panel)", () => {
  it("returns null for non-platform-admin viewers", () => {
    expect(PANEL_SRC).toMatch(/if\s*\(!isPlatformAdmin\)\s*return\s+null/);
  });

  it("renders the AAL2-required banner", () => {
    expect(PANEL_SRC).toMatch(/AAL2 required/);
  });

  it("defaults the redaction selector to redacted_client_safe", () => {
    expect(PANEL_SRC).toMatch(
      /useState<string>\(\s*\n?\s*"redacted_client_safe"\s*,?\s*\n?\s*\)/,
    );
  });

  it("offers all four redaction modes (none missing, none extra)", () => {
    const modes = [
      "redacted_client_safe",
      "evidence_only",
      "metadata_only",
      "full_internal",
    ];
    for (const m of modes) {
      expect(PANEL_SRC).toContain(`value: "${m}"`);
    }
    // Sanity: no rogue extra mode strings smuggled in.
    const valueMatches = PANEL_SRC.match(/value:\s*"([a-z_]+)"/g) ?? [];
    const rogue = valueMatches.filter(
      (v) =>
        !modes.some((m) => v.endsWith(`"${m}"`)) &&
        !/redacted_client_safe|evidence_only|metadata_only|full_internal/.test(
          v,
        ),
    );
    expect(rogue).toEqual([]);
  });

  it("shows reason input with ≥10 char gating", () => {
    expect(PANEL_SRC).toMatch(/reason\.trim\(\)\.length\s*>=\s*10/);
    expect(PANEL_SRC).toMatch(/data-testid="export-reason"/);
  });

  it("invokes the admin-governance-export-request edge function only", () => {
    expect(PANEL_SRC).toMatch(/"admin-governance-export-request"/);
    // No approve / prepare / download surface invoked from this panel.
    expect(PANEL_SRC).not.toMatch(/"admin-export-approve"/);
    expect(PANEL_SRC).not.toMatch(/"export-prepare"/);
    expect(PANEL_SRC).not.toMatch(/"export-download"/);
    expect(PANEL_SRC).not.toMatch(/"admin-export-destroy"/);
  });

  it("displays the no-file / no-download contract badge", () => {
    expect(PANEL_SRC).toMatch(/No file generated/);
    expect(PANEL_SRC).toMatch(/No download link/);
  });

  it("success state exposes request_id + redaction_mode + awaiting-approval wording", () => {
    expect(PANEL_SRC).toMatch(/Export request recorded/);
    expect(PANEL_SRC).toMatch(/state\.requestId/);
    expect(PANEL_SRC).toMatch(/state\.redactionMode/);
    expect(PANEL_SRC).toMatch(/awaiting/i);
  });

  it("never renders approve / prepare / download / destroy controls", () => {
    expect(PANEL_SRC).not.toMatch(/Approve export/i);
    expect(PANEL_SRC).not.toMatch(/Prepare export/i);
    expect(PANEL_SRC).not.toMatch(/Download export/i);
    expect(PANEL_SRC).not.toMatch(/Destroy export/i);
    expect(PANEL_SRC).not.toMatch(/<a[^>]*\bdownload\b/i);
    expect(PANEL_SRC).not.toMatch(/createSignedUrl|signed_url/);
    expect(PANEL_SRC).not.toMatch(/new\s+Blob\s*\([^)]*text\/(csv|plain|json)/i);
  });

  it("never serialises sensitive raw metadata client-side", () => {
    expect(PANEL_SRC).not.toMatch(/raw_payload/);
    expect(PANEL_SRC).not.toMatch(/event_store/);
    expect(PANEL_SRC).not.toMatch(/\bdump_all\b/);
    expect(PANEL_SRC).not.toMatch(/\bexport_all\b/);
  });
});

describe("Batch 3 — mount contract (GovernanceRecordDetail)", () => {
  it("only mounts the panel when isPlatformAdmin AND anchor.matchId are present", () => {
    expect(MOUNT_SRC).toMatch(
      /isPlatformAdmin\s*&&\s*anchor\.matchId[\s\S]{0,80}AdminGovernanceExportRequestPanel/,
    );
  });

  it("passes governanceRecordId from the match anchor (not a free-form value)", () => {
    expect(MOUNT_SRC).toMatch(
      /AdminGovernanceExportRequestPanel[\s\S]{0,200}governanceRecordId=\{anchor\.matchId\}/,
    );
  });
});

describe("Batch 3 — Batch 2 boundary preserved (no scope creep)", () => {
  it("edge function does NOT generate, sign, or upload any artefact", () => {
    expect(EDGE_SRC).not.toMatch(/createSignedUrl\s*\(/);
    expect(EDGE_SRC).not.toMatch(/\.upload\s*\(/);
    expect(EDGE_SRC).not.toMatch(/new\s+Blob\s*\(/);
    expect(EDGE_SRC).not.toMatch(/text\/csv/i);
    expect(EDGE_SRC).not.toMatch(/\bsigned_url\b/);
  });

  it("edge function does NOT call approval / prepare / download / destroy paths", () => {
    expect(EDGE_SRC).not.toMatch(/admin_export_approved/);
    expect(EDGE_SRC).not.toMatch(/admin_export_prepared/);
    expect(EDGE_SRC).not.toMatch(/admin_export_downloaded/);
    expect(EDGE_SRC).not.toMatch(/admin_export_destroyed/);
  });

  it("status written by the RPC is awaiting_approval — never approved/ready", () => {
    expect(MIGRATION_SRC).toMatch(/'awaiting_approval'/);
    expect(MIGRATION_SRC).not.toMatch(/'approved'/);
    expect(MIGRATION_SRC).not.toMatch(/'ready'/);
    expect(MIGRATION_SRC).not.toMatch(/'downloaded'/);
  });
});
