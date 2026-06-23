/**
 * DEC-007 - Refund Policy SSOT (TS mirror).
 *
 * Authoritative rules used by the admin UI and tests.
 * No legal/public refund copy lives here - admin disclaimer copy only.
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
 * Provider-side money-movement lifecycle for a refund_requests row.
 * Independent of REFUND_REQUEST_STATUSES — `status='approved'` means
 * the credit reversal was recorded in-platform; it does NOT mean money
 * has been returned to the customer. Money returned is signalled by
 * `provider_settlement_status` (see `MONEY_RETURNED_STATUSES`).
 *
 * Mirrors the trigger `refund_requests_settlement_status_guard` and the
 * migration `<ts>_refund_provider_settlement_separation.sql`.
 */
export const REFUND_PROVIDER_SETTLEMENT_STATUSES = [
  "not_submitted",            // approved internally; provider has not been told
  "submitted",                // (reserved; outbound submission not built yet)
  "provider_pending",         // (reserved; provider acknowledged, not completed)
  "provider_completed",       // provider webhook confirmed money returned
  "provider_failed",          // provider webhook reported failure
  "manually_settled_offline", // admin issued refund in provider dashboard
  "not_applicable",           // refund row was declined / blocked / superseded
] as const;
export type RefundProviderSettlementStatus =
  (typeof REFUND_PROVIDER_SETTLEMENT_STATUSES)[number];

/**
 * Mandatory disclaimer on every admin refund/dispute decision dialog.
 * Pinned verbatim by scripts/check-dec-007-pay-009-guard-coverage.mjs.
 */
export const DEC_007_PAY_009_ADMIN_DISCLAIMER =
  "Approval/resolution records the financial decision only. Burned credits and any POI / WaD / execution audit history remain immutable. No evidence is deleted. Approval does NOT submit a refund to Paystack and does NOT confirm that money has been returned to the customer. Provider settlement must be issued separately in the Paystack dashboard.";

/**
 * Disclaimer for the "Mark manually settled" admin action. Records that
 * an approved refund was issued outside Izenzo (e.g. via the provider
 * dashboard). Does NOT move money and does NOT change credits/ledger.
 */
export const DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER =
  "Marking manually settled records that you issued the refund directly in the provider dashboard. It does NOT move money, does NOT call Paystack or PayFast, and does NOT change credits or the token ledger. The internal approval and credit reversal are unchanged. Provide a reference and any external receipt id in the notes (≥ 20 characters).";
