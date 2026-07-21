/**
 * Institutional Funder Evidence Workspace
 * Pure helpers for the "Edit release permissions" admin dialog.
 * Server-side (fw_admin_update_release_permissions_v1) remains the
 * authoritative enforcer; these helpers only power the UI.
 */

export const RELEASE_PERMISSION_KEYS = [
  "can_view_evidence_summary",
  "can_view_evidence_room",
  "can_download_compiled_pack",
  "can_view_raw_documents",
  "can_download_raw_documents",
  "can_view_unmasked_sensitive_details",
] as const;

export type ReleasePermissionKey = (typeof RELEASE_PERMISSION_KEYS)[number];

export type ReleasePermissionSet = Record<ReleasePermissionKey, boolean>;

export const RELEASE_PERMISSION_LABEL: Record<ReleasePermissionKey, string> = {
  can_view_evidence_summary: "Evidence summary",
  can_view_evidence_room: "Evidence room",
  can_download_compiled_pack: "Compiled pack download",
  can_view_raw_documents: "Raw documents (view)",
  can_download_raw_documents: "Raw documents (download)",
  can_view_unmasked_sensitive_details: "Unmasked sensitive details",
};

export const ELEVATED_PERMISSION_KEYS: readonly ReleasePermissionKey[] = [
  "can_view_raw_documents",
  "can_download_raw_documents",
  "can_view_unmasked_sensitive_details",
];

export function permissionsFromRelease(r: Partial<Record<ReleasePermissionKey, boolean>>): ReleasePermissionSet {
  return RELEASE_PERMISSION_KEYS.reduce((acc, k) => {
    acc[k] = Boolean(r[k]);
    return acc;
  }, {} as ReleasePermissionSet);
}

export function permissionsEqual(a: ReleasePermissionSet, b: ReleasePermissionSet): boolean {
  return RELEASE_PERMISSION_KEYS.every((k) => a[k] === b[k]);
}

export function diffPermissions(
  before: ReleasePermissionSet,
  after: ReleasePermissionSet,
): { key: ReleasePermissionKey; from: boolean; to: boolean }[] {
  return RELEASE_PERMISSION_KEYS
    .filter((k) => before[k] !== after[k])
    .map((k) => ({ key: k, from: before[k], to: after[k] }));
}

export type PermissionValidationError =
  | { code: "no_change"; message: string }
  | { code: "reason_required"; message: string }
  | { code: "raw_download_requires_raw_view"; message: string };

/**
 * Client-side mirror of the fw_admin_update_release_permissions_v1
 * validation rules. Server remains authoritative.
 */
export function validatePermissionEdit(
  before: ReleasePermissionSet,
  after: ReleasePermissionSet,
  reason: string,
): PermissionValidationError | null {
  if (permissionsEqual(before, after)) {
    return { code: "no_change", message: "No permission has changed." };
  }
  if ((reason ?? "").trim() === "") {
    return { code: "reason_required", message: "A written reason is required." };
  }
  if (after.can_download_raw_documents && !after.can_view_raw_documents) {
    return {
      code: "raw_download_requires_raw_view",
      message: "Raw-document download requires raw-document view.",
    };
  }
  return null;
}
