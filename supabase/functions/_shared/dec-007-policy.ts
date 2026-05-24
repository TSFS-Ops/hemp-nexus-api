/**
 * DEC-007 — Refund Policy SSOT (Deno mirror).
 * Must remain numerically/string identical to src/lib/policy/dec-007-refund-policy.ts.
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

export const DEC_007_PAY_009_ADMIN_DISCLAIMER =
  "Approval/resolution records the financial decision only. Burned credits and any POI / WaD / execution audit history remain immutable. No evidence is deleted.";
