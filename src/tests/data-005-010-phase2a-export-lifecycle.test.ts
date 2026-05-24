/**
 * DATA-005 / DATA-010 Phase 2A — Shared export lifecycle SSOT + guard
 * pinning tests. Side-effect-free: only inspects modules, package.json,
 * and runs the prebuild guard semantically by re-importing constants.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DATA_005_AUDIT_ACTIONS,
  DATA_010_AUDIT_ACTIONS,
  EXPORT_LIFECYCLE_CANONICAL_AUDIT_ACTIONS,
  DATA_005_LEGACY_AUDIT_ACTIONS,
} from "@/lib/data/export-lifecycle-audit";
import {
  USER_EXPORT_STATES,
  ADMIN_EXPORT_STATES,
} from "@/lib/data/export-state-machine";
import {
  FORBIDDEN_EXPORT_COLUMN_NAMES,
  USER_EXPORT_CATEGORY_ALLOW_LISTS,
  ADMIN_EXPORT_CATEGORY_ALLOW_LISTS,
  isForbiddenExportColumn,
  safeProjection,
} from "@/lib/data/export-redaction";

describe("DATA-005/010 Phase 2A — canonical audit SSOT", () => {
  it("declares 7 DATA-005 canonical audit actions verbatim", () => {
    expect(DATA_005_AUDIT_ACTIONS.request_received).toBe("data.export_request_received");
    expect(DATA_005_AUDIT_ACTIONS.requester_verified).toBe("data.export_requester_verified");
    expect(DATA_005_AUDIT_ACTIONS.prepared).toBe("data.export_prepared");
    expect(DATA_005_AUDIT_ACTIONS.delivered).toBe("data.export_delivered");
    expect(DATA_005_AUDIT_ACTIONS.blocked_verification_failed).toBe("data.export_blocked_verification_failed");
    expect(DATA_005_AUDIT_ACTIONS.limited_retention_or_confidentiality_required).toBe(
      "data.export_limited_retention_or_confidentiality_required",
    );
    expect(DATA_005_AUDIT_ACTIONS.file_destroyed).toBe("data.export_file_destroyed");
  });
  it("declares 6 DATA-010 canonical audit actions verbatim", () => {
    expect(DATA_010_AUDIT_ACTIONS.requested).toBe("data.admin_export_requested");
    expect(DATA_010_AUDIT_ACTIONS.approved).toBe("data.admin_export_approved");
    expect(DATA_010_AUDIT_ACTIONS.generated).toBe("data.admin_export_generated");
    expect(DATA_010_AUDIT_ACTIONS.downloaded).toBe("data.admin_export_downloaded");
    expect(DATA_010_AUDIT_ACTIONS.blocked_or_declined).toBe("data.admin_export_blocked_or_declined");
    expect(DATA_010_AUDIT_ACTIONS.file_destroyed).toBe("data.admin_export_file_destroyed");
  });
  it("freezes the 13-name canonical tuple", () => {
    expect(EXPORT_LIFECYCLE_CANONICAL_AUDIT_ACTIONS).toHaveLength(13);
    expect(() => {
      // @ts-expect-error — frozen at runtime
      EXPORT_LIFECYCLE_CANONICAL_AUDIT_ACTIONS.push("data.injected");
    }).toThrow();
  });
  it("preserves the 3 Phase 1 legacy audit names", () => {
    expect(DATA_005_LEGACY_AUDIT_ACTIONS).toEqual([
      "data.user_export_requested",
      "data.user_export_scope_resolved",
      "data.user_export_blocked_or_declined",
    ]);
  });
});

describe("DATA-005/010 Phase 2A — state machines", () => {
  it("user export has 8 states", () => {
    expect(USER_EXPORT_STATES).toHaveLength(8);
    expect(USER_EXPORT_STATES).toContain("verification_required");
    expect(USER_EXPORT_STATES).toContain("export_preparation_required");
    expect(USER_EXPORT_STATES).toContain("ready_for_delivery");
    expect(USER_EXPORT_STATES).toContain("delivered");
    expect(USER_EXPORT_STATES).toContain("destroyed");
  });
  it("admin export has 7 states", () => {
    expect(ADMIN_EXPORT_STATES).toHaveLength(7);
    expect(ADMIN_EXPORT_STATES).toContain("awaiting_approval");
    expect(ADMIN_EXPORT_STATES).toContain("ready_for_download");
    expect(ADMIN_EXPORT_STATES).toContain("downloaded");
    expect(ADMIN_EXPORT_STATES).toContain("blocked_or_declined");
  });
});

describe("DATA-005/010 Phase 2A — redaction", () => {
  it.each([
    "password", "password_hash", "api_key", "auth_token", "session_token",
    "webhook_secret", "card_number", "admin_notes", "privileged_legal_notes",
  ])("forbids column %s", (col) => {
    expect(isForbiddenExportColumn(col)).toBe(true);
  });
  it("strips forbidden columns from a candidate projection", () => {
    const dirty = ["id", "email", "password_hash", "api_key_raw", "created_at"];
    expect(safeProjection(dirty)).toEqual(["id", "email", "created_at"]);
  });
  it("user export allow-lists contain no forbidden columns", () => {
    for (const cols of Object.values(USER_EXPORT_CATEGORY_ALLOW_LISTS)) {
      for (const col of cols) expect(isForbiddenExportColumn(col)).toBe(false);
    }
  });
  it("admin export allow-lists contain no forbidden columns", () => {
    for (const cols of Object.values(ADMIN_EXPORT_CATEGORY_ALLOW_LISTS)) {
      for (const col of cols) expect(isForbiddenExportColumn(col)).toBe(false);
    }
  });
  it("forbidden list includes 20+ items", () => {
    expect(FORBIDDEN_EXPORT_COLUMN_NAMES.length).toBeGreaterThanOrEqual(20);
  });
});

describe("DATA-005/010 Phase 2A — edge-function contracts", () => {
  const adminReq = readFileSync("supabase/functions/admin-export-request/index.ts", "utf8");
  const approve = readFileSync("supabase/functions/admin-export-approve/index.ts", "utf8");
  const prepare = readFileSync("supabase/functions/export-prepare/index.ts", "utf8");
  const download = readFileSync("supabase/functions/export-download/index.ts", "utf8");
  const destroy = readFileSync("supabase/functions/export-destroy/index.ts", "utf8");
  const userReq = readFileSync("supabase/functions/user-export-request/index.ts", "utf8");

  it("admin-export-request enforces AAL2 and is_admin", () => {
    expect(adminReq).toContain("assertAal2(");
    expect(adminReq).toContain('rpc("is_admin"');
    expect(adminReq).toContain("MIN_EXPORT_REASON_LENGTH");
  });
  it("admin-export-approve blocks self-approval server-side", () => {
    expect(approve).toContain("SELF_APPROVAL_BLOCKED");
    expect(approve).toContain("approver.id === reqRow.requester_user_id");
  });
  it("export-prepare uses allow-list projection (no SELECT *)", () => {
    expect(prepare).toContain("USER_EXPORT_CATEGORY_ALLOW_LISTS");
    expect(prepare).toContain("safeProjection");
    expect(/from\(["'][a-z_]+["']\)\.select\(\s*['"`]\*['"`]/i.test(prepare)).toBe(false);
  });
  it("export-download signed URL TTL is 300 seconds", () => {
    expect(download).toContain("EXPORT_DOWNLOAD_SIGNED_URL_TTL_SECONDS = 300");
    expect(download).toContain("createSignedUrl");
  });
  it("export-destroy is dry-run only in Phase 2A", () => {
    expect(destroy).toContain("phase_2a_dry_run_only");
    expect(destroy).toContain("destructiveEnabled = false");
    expect(destroy).not.toMatch(/\.storage\.from\([^)]+\)\.remove\s*\(/);
    expect(destroy).not.toContain("data.export_file_destroyed");
    expect(destroy).not.toContain("data.admin_export_file_destroyed");
  });
  it("user-export-request retains Phase 1 legacy audit names", () => {
    expect(userReq).toContain("data.user_export_requested");
    expect(userReq).toContain("data.user_export_scope_resolved");
    expect(userReq).toContain("data.user_export_blocked_or_declined");
  });
});

describe("DATA-005/010 Phase 2A — prebuild wiring", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  it("check-data-005-010-export-lifecycle.mjs is wired into prebuild", () => {
    expect(pkg.scripts?.prebuild ?? "").toContain("scripts/check-data-005-010-export-lifecycle.mjs");
  });
});
