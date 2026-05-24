/**
 * DATA-005 / DATA-010 Phase 2A — Export state machine SSOT (Deno mirror
 * of src/lib/data/export-state-machine.ts).
 */

export const USER_EXPORT_STATES = [
  "verification_required",
  "export_preparation_required",
  "ready_for_delivery",
  "delivered",
  "expired",
  "destroyed",
  "blocked_verification_failed",
  "limited_retention_or_confidentiality_required",
] as const;

export const ADMIN_EXPORT_STATES = [
  "awaiting_approval",
  "export_preparation_required",
  "ready_for_download",
  "downloaded",
  "expired",
  "destroyed",
  "blocked_or_declined",
] as const;

export type UserExportState = (typeof USER_EXPORT_STATES)[number];
export type AdminExportState = (typeof ADMIN_EXPORT_STATES)[number];
