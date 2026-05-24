/**
 * DATA-005 / DATA-010 Phase 2A — Shared export-lifecycle canonical audit
 * SSOT (client mirror).
 *
 * Mirror file: supabase/functions/_shared/export-lifecycle-audit.ts
 * Drift guard: scripts/check-data-005-010-export-lifecycle.mjs
 *
 * Legacy Phase 1 names (data.user_export_requested / _scope_resolved /
 * _blocked_or_declined) are preserved by the existing
 * `user-export-request` edge function for one release alongside these
 * canonical names. Do NOT remove the legacy names in this patch.
 */

/** DATA-005 — user (subject-access) export lifecycle. */
export const DATA_005_AUDIT_ACTIONS = {
  request_received: "data.export_request_received",
  requester_verified: "data.export_requester_verified",
  prepared: "data.export_prepared",
  delivered: "data.export_delivered",
  blocked_verification_failed: "data.export_blocked_verification_failed",
  limited_retention_or_confidentiality_required:
    "data.export_limited_retention_or_confidentiality_required",
  file_destroyed: "data.export_file_destroyed",
} as const;

/** DATA-010 — admin client-data export lifecycle. */
export const DATA_010_AUDIT_ACTIONS = {
  requested: "data.admin_export_requested",
  approved: "data.admin_export_approved",
  generated: "data.admin_export_generated",
  downloaded: "data.admin_export_downloaded",
  blocked_or_declined: "data.admin_export_blocked_or_declined",
  file_destroyed: "data.admin_export_file_destroyed",
} as const;

export type Data005AuditAction =
  (typeof DATA_005_AUDIT_ACTIONS)[keyof typeof DATA_005_AUDIT_ACTIONS];
export type Data010AuditAction =
  (typeof DATA_010_AUDIT_ACTIONS)[keyof typeof DATA_010_AUDIT_ACTIONS];

export const EXPORT_LIFECYCLE_CANONICAL_AUDIT_ACTIONS: readonly string[] =
  Object.freeze([
    ...Object.values(DATA_005_AUDIT_ACTIONS),
    ...Object.values(DATA_010_AUDIT_ACTIONS),
  ]);

/** Phase 1 legacy audit names — DO NOT remove until Phase 2B cutover. */
export const DATA_005_LEGACY_AUDIT_ACTIONS: readonly string[] = Object.freeze([
  "data.user_export_requested",
  "data.user_export_scope_resolved",
  "data.user_export_blocked_or_declined",
]);
