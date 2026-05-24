/**
 * DEC-007 — Refund Policy SSOT (TS mirror).
 *
 * Authoritative rules used by the admin UI and tests.
 * No legal/public refund copy lives here — admin disclaimer copy only.
 */

export const DEC_007_REFUND_POLICY = {
  unusedCreditsRefundableDays: 7,
  expiryDays: 180,
  consumedCreditsRefundable: false,
  partialPackageAutoRefund: false,
  upgradeOrSupersededAutoRefund: false,
  minAdminReasonLength: 20,
} as const;

export const REFUND_REASON_CODES = [
  "unused_within_window",
  "unused_outside_window",
  "accidental_purchase",
  "duplicate_purchase",
  "service_dissatisfaction",
  "other",
] as const;
export type RefundReasonCode = (typeof REFUND_REASON_CODES)[number];

export const REFUND_REQUEST_STATUSES = [
  "pending",
  "approved",
  "declined",
  "blocked_credits_used",
  "blocked_expired",
  "superseded",
] as const;
export type RefundRequestStatus = (typeof REFUND_REQUEST_STATUSES)[number];

/**
 * Mandatory disclaimer on every admin refund/dispute decision dialog.
 * Pinned verbatim by scripts/check-dec-007-pay-009-guard-coverage.mjs.
 */
export const DEC_007_PAY_009_ADMIN_DISCLAIMER =
  "Approval/resolution records the financial decision only. Burned credits and any POI / WaD / execution audit history remain immutable. No evidence is deleted.";
