/**
 * DATA-005 / DATA-010 Phase 2A - Export state machine SSOT (client +
 * Deno mirror). Drift guard pins both files.
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

export const USER_EXPORT_TERMINAL_STATES: readonly UserExportState[] = [
  "delivered",
  "expired",
  "destroyed",
  "blocked_verification_failed",
  "limited_retention_or_confidentiality_required",
];

export const ADMIN_EXPORT_TERMINAL_STATES: readonly AdminExportState[] = [
  "expired",
  "destroyed",
  "blocked_or_declined",
];
