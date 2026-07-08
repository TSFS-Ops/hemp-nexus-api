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
    "not_submitted", // approved internally; provider has not been told
    "submitted", // (reserved; outbound submission not built yet)
    "provider_pending", // (reserved; provider acknowledged, not completed)
    "provider_completed", // provider webhook confirmed money returned
    "provider_failed", // provider webhook reported failure, or a
                        // settlement mismatch was detected — manual review
    "manually_settled_offline", // admin issued refund in provider dashboard
    "not_applicable", // refund row was declined / blocked / superseded
  ] as const;
export type RefundProviderSettlementStatus =
    (typeof REFUND_PROVIDER_SETTLEMENT_STATUSES)[number];

/**
 * Batch Q — refund credit reservation lifecycle. One row per refund_request
 * in token_refund_reservations, referenced by refund_requests.reservation_id.
 * `active` while a refund is approved and awaiting settlement (credits are
 * held/unspendable but NOT finally deducted); `consumed` once a final
 * deduction has been written by mark_refund_provider_settled or
 * mark_refund_manually_settled_with_governance; `released` if a pending
 * reservation is ever explicitly reversed.
 */
export const REFUND_RESERVATION_STATUSES = [
    "active",
    "consumed",
    "released",
  ] as const;
export type RefundReservationStatus =
    (typeof REFUND_RESERVATION_STATUSES)[number];

/**
 * Batch Q — approved customer-facing refund wording sequence. Centralised
 * here so UI, API responses and (if ever added) email copy cannot drift.
 * "Refund completed" must NEVER be shown before provider_settlement_status
 * is in MONEY_RETURNED_STATUSES (provider_completed or
 * manually_settled_offline, see refund-settlement.ts).
 */
export const CUSTOMER_REFUND_LABELS = {
    requested: "Refund requested",
    approvedForProcessing: "Refund approved for processing",
    awaitingProviderConfirmation: "Awaiting provider confirmation",
    completed: "Refund completed",
    requiresAdminReview: "Refund requires admin review",
    declined: "Refund declined",
    superseded: "Refund superseded",
} as const;

/**
 * Mandatory disclaimer on every admin refund/dispute decision dialog.
 * Pinned verbatim by scripts/check-dec-007-pay-009-guard-coverage.mjs.
 */
export const DEC_007_PAY_009_ADMIN_DISCLAIMER =
    "Approval/resolution records the financial decision only. Burned credits and any POI / WaD / execution audit history remain immutable. No evidence is deleted. Approval does NOT submit a refund to Paystack and does NOT confirm that money has been returned to the customer. Provider settlement must be issued separately in the Paystack dashboard.";

/**
 * Batch Q — approval now reserves/holds credits instead of finally
 * deducting them. This disclaimer explains that distinction to admins.
 */
export const DEC_007_BATCH_Q_APPROVAL_DISCLAIMER =
    "Approving this refund reserves (holds) the credits so they cannot be spent, but does NOT finally deduct them and does NOT move money. Credits are only finally deducted once the payment provider confirms settlement, or once an authorised admin records a manual offline settlement below.";

/**
 * Disclaimer for the "Mark manually settled" admin action. Records that
 * an approved refund was issued outside Izenzo (e.g. via the provider
 * dashboard).
 *
 * Batch Q: unlike the pre-Batch-Q behaviour, this action DOES now finally
 * deduct the reserved credits and write the final token_ledger entry —
 * because under the reservation model, credits are not finally deducted
 * at approval time, so manual settlement is the only remaining step that
 * can close out the reservation for refunds without a provider webhook.
 * It still never calls Paystack or PayFast directly.
 */
export const DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER =
      "Marking manually settled records that you issued the refund directly in the provider dashboard. It does NOT call Paystack or PayFast. It DOES finally deduct the reserved credits and write the closing token ledger entry, because no automated provider confirmation exists for this refund. The internal approval decision itself is unchanged. Provide a reference and any external receipt id in the notes (minimum 20 characters).";
