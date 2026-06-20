/**
 * Batch 2 — M012 Import Batch SSOT (browser).
 *
 * Pinned by:
 *   - scripts/check-registry-import-batch-parity.mjs
 *   - scripts/check-registry-batch2-audit-names.mjs
 *
 * Mirror: supabase/functions/_shared/registry-import-batches.ts
 */

export const IMPORT_BATCH_STATES = [
  "draft",
  "uploaded",
  "validating",
  "validation_failed",
  "validated",
  "quarantined",
  "pending_approval",
  "approved",
  "published",
  "rejected",
  "rolled_back",
  "cancelled",
] as const;
export type ImportBatchState = (typeof IMPORT_BATCH_STATES)[number];

export const IMPORT_BATCH_STATE_LABEL: Record<ImportBatchState, string> = {
  draft: "Draft",
  uploaded: "Uploaded",
  validating: "Validating",
  validation_failed: "Validation failed",
  validated: "Validated",
  quarantined: "Quarantined",
  pending_approval: "Pending approval",
  approved: "Approved",
  published: "Published",
  rejected: "Rejected",
  rolled_back: "Rolled back",
  cancelled: "Cancelled",
};

export const IMPORT_BATCH_AUDIT_EVENT_NAMES = [
  "registry_import_batch_created",
  "registry_import_batch_state_changed",
  "registry_import_batch_validation_recorded",
  "registry_import_batch_published",
  "registry_import_batch_rolled_back",
] as const;
export type ImportBatchAuditEventName =
  (typeof IMPORT_BATCH_AUDIT_EVENT_NAMES)[number];

/**
 * Permitted forward transitions. Any move to `published` MUST be preceded by
 * `approved` AND require an approved business-decision evidence URL (enforced
 * server-side by the registry-import-batch-manage edge function).
 */
export const IMPORT_BATCH_ALLOWED_TRANSITIONS: Record<ImportBatchState, ImportBatchState[]> = {
  draft: ["uploaded", "cancelled"],
  uploaded: ["validating", "cancelled"],
  validating: ["validated", "validation_failed", "quarantined"],
  validation_failed: ["uploaded", "cancelled"],
  validated: ["pending_approval", "cancelled"],
  quarantined: ["validated", "rejected", "cancelled"],
  pending_approval: ["approved", "rejected"],
  approved: ["published", "cancelled"],
  published: ["rolled_back"],
  rejected: [],
  rolled_back: [],
  cancelled: [],
};

export function canTransition(from: ImportBatchState, to: ImportBatchState): boolean {
  return IMPORT_BATCH_ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
