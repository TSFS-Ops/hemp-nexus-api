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


// Batch Q -- refund credit reservation lifecycle. Mirrors
// src/lib/policy/dec-007-refund-policy.ts REFUND_RESERVATION_STATUSES.
export const REFUND_RESERVATION_STATUSES = [
    "active",
    "consumed",
    "released",
  ] as const;

// Batch Q -- approved customer-facing refund wording sequence. Mirrors
// src/lib/policy/dec-007-refund-policy.ts CUSTOMER_REFUND_LABELS. Centralised
// here so edge functions cannot introduce drifted customer-facing copy.
export const CUSTOMER_REFUND_LABELS = {
    requested: "Refund requested",
    approvedForProcessing: "Refund approved for processing",
    awaitingProviderConfirmation: "Awaiting provider confirmation",
    completed: "Refund completed",
    requiresAdminReview: "Refund requires admin review",
    declined: "Refund declined",
    superseded: "Refund superseded",
} as const;

// Batch Q -- explicit provider-adapter gap. PayFast has no automated
// refund-status confirmation API/webhook in this codebase (confirmed in
// docs/payfast-phase-2j-customer-rollout-report.md section 9). Any function
// that would otherwise call a live PayFast refund-status check must instead
// fail closed and return this code. Do not fabricate a PayFast checker.
export const PAYFAST_REFUND_STATUS_CHECK_NOT_IMPLEMENTED =
    "PAYFAST_REFUND_STATUS_CHECK_NOT_IMPLEMENTED";
