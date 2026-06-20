/**
 * Batch 2 — M012 Import Batch SSOT (Deno mirror).
 * Pinned to src/lib/registry-import-batches.ts by
 * scripts/check-registry-import-batch-parity.mjs.
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

export const IMPORT_BATCH_AUDIT_EVENT_NAMES = [
  "registry_import_batch_created",
  "registry_import_batch_state_changed",
  "registry_import_batch_validation_recorded",
  "registry_import_batch_published",
  "registry_import_batch_rolled_back",
] as const;
export type ImportBatchAuditEventName =
  (typeof IMPORT_BATCH_AUDIT_EVENT_NAMES)[number];

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
