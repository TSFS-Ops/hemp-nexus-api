/**
 * DATA-005 / DATA-010 Phase 2A — Shared export-lifecycle canonical audit
 * SSOT (Deno mirror of src/lib/data/export-lifecycle-audit.ts).
 *
 * Drift guard: scripts/check-data-005-010-export-lifecycle.mjs
 *
 * Phase 1 legacy names (data.user_export_requested / _scope_resolved /
 * _blocked_or_declined) MUST remain emitted by user-export-request for
 * one release. Phase 2A adds canonical names; it does not remove
 * legacy names.
 */

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

export const DATA_010_AUDIT_ACTIONS = {
  requested: "data.admin_export_requested",
  approved: "data.admin_export_approved",
  generated: "data.admin_export_generated",
  downloaded: "data.admin_export_downloaded",
  blocked_or_declined: "data.admin_export_blocked_or_declined",
  file_destroyed: "data.admin_export_file_destroyed",
} as const;

export const EXPORT_LIFECYCLE_CANONICAL_AUDIT_ACTIONS: readonly string[] =
  Object.freeze([
    ...Object.values(DATA_005_AUDIT_ACTIONS),
    ...Object.values(DATA_010_AUDIT_ACTIONS),
  ]);

/** Best-effort audit writer. Never throws — never blocks the response. */
// deno-lint-ignore no-explicit-any
export async function writeLifecycleAudit(
  admin: any,
  action: string,
  payload: Record<string, unknown>,
  orgId: string | null,
  entityId: string | null,
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      org_id: orgId,
      actor_user_id: (payload.actor_user_id as string | null) ?? null,
      action,
      entity_type: "export_request",
      entity_id: entityId,
      metadata: payload,
    });
  } catch (e) {
    console.error(`[export-lifecycle-audit] write failed (${action}):`, e);
  }
}
