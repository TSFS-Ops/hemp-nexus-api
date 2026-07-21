/**
 * Institutional Funder Evidence Workspace
 * Tests for the pure validators powering the "Edit release permissions" dialog.
 * Server-side rules in fw_admin_update_release_permissions_v1 remain
 * authoritative; these tests guard the UI mirror.
 */
import { describe, it, expect } from "vitest";
import {
  RELEASE_PERMISSION_KEYS,
  diffPermissions,
  permissionsEqual,
  permissionsFromRelease,
  validatePermissionEdit,
} from "@/lib/funder-workspace/release-permission-edit";
import { FUNDER_WORKSPACE_ADMIN_RPCS } from "@/lib/funder-workspace/admin-client";

const base = {
  can_view_evidence_summary: true,
  can_view_evidence_room: true,
  can_download_compiled_pack: false,
  can_view_raw_documents: false,
  can_download_raw_documents: false,
  can_view_unmasked_sensitive_details: false,
};

describe("release-permission-edit", () => {
  it("keeps all six permission keys stable", () => {
    expect([...RELEASE_PERMISSION_KEYS].sort()).toEqual([
      "can_download_compiled_pack",
      "can_download_raw_documents",
      "can_view_evidence_room",
      "can_view_evidence_summary",
      "can_view_raw_documents",
      "can_view_unmasked_sensitive_details",
    ]);
  });

  it("coerces missing keys to false", () => {
    const p = permissionsFromRelease({ can_view_evidence_summary: true });
    expect(p.can_view_evidence_summary).toBe(true);
    expect(p.can_download_compiled_pack).toBe(false);
    expect(p.can_view_raw_documents).toBe(false);
  });

  it("equality and diff behave as expected", () => {
    const a = permissionsFromRelease(base);
    const b = permissionsFromRelease({ ...base, can_download_compiled_pack: true });
    expect(permissionsEqual(a, a)).toBe(true);
    expect(permissionsEqual(a, b)).toBe(false);
    expect(diffPermissions(a, b)).toEqual([
      { key: "can_download_compiled_pack", from: false, to: true },
    ]);
  });

  it("rejects a no-op edit", () => {
    const a = permissionsFromRelease(base);
    expect(validatePermissionEdit(a, a, "any reason")).toEqual(
      expect.objectContaining({ code: "no_change" }),
    );
  });

  it("rejects a blank reason", () => {
    const a = permissionsFromRelease(base);
    const b = permissionsFromRelease({ ...base, can_download_compiled_pack: true });
    expect(validatePermissionEdit(a, b, "   ")).toEqual(
      expect.objectContaining({ code: "reason_required" }),
    );
  });

  it("rejects raw-download without raw-view", () => {
    const a = permissionsFromRelease(base);
    const b = permissionsFromRelease({
      ...base,
      can_download_raw_documents: true,
      can_view_raw_documents: false,
    });
    expect(validatePermissionEdit(a, b, "pilot")).toEqual(
      expect.objectContaining({ code: "raw_download_requires_raw_view" }),
    );
  });

  it("accepts the exact pilot change: enable compiled-pack download only", () => {
    const before = permissionsFromRelease(base);
    const after = permissionsFromRelease({ ...base, can_download_compiled_pack: true });
    expect(
      validatePermissionEdit(
        before,
        after,
        "CONTROLLED PILOT — Enable authorised sealed-pack download for walkthrough validation",
      ),
    ).toBeNull();
    expect(diffPermissions(before, after)).toEqual([
      { key: "can_download_compiled_pack", from: false, to: true },
    ]);
  });

  it("accepts enabling raw view + download together", () => {
    const before = permissionsFromRelease(base);
    const after = permissionsFromRelease({
      ...base,
      can_view_raw_documents: true,
      can_download_raw_documents: true,
    });
    expect(validatePermissionEdit(before, after, "audit trail")).toBeNull();
  });

  it("registers the new RPC in the approved allow-list", () => {
    expect(FUNDER_WORKSPACE_ADMIN_RPCS).toContain(
      "fw_admin_update_release_permissions_v1",
    );
  });
});
