/**
 * Refund settlement reporting helper.
 *
 * `refund_requests.status='approved'` records the in-platform credit
 * reversal only. Reports that mean "money was returned to the customer"
 * MUST filter on `provider_settlement_status` via this helper, not on
 * `status='approved'`.
 *
 * Pairs with the migration `<ts>_refund_provider_settlement_separation.sql`
 * and the SSOT in `dec-007-refund-policy.ts`.
 */

import type { RefundProviderSettlementStatus, RefundRequestStatus } from "./dec-007-refund-policy";
import { CUSTOMER_REFUND_LABELS } from "./dec-007-refund-policy";

/**
 * The only `provider_settlement_status` values that mean money has
 * actually been returned to the customer (either by provider webhook
 * confirmation or by an admin recording an offline settlement).
 */
export const MONEY_RETURNED_STATUSES = [
  "provider_completed",
  "manually_settled_offline",
] as const;
export type MoneyReturnedStatus = (typeof MONEY_RETURNED_STATUSES)[number];

export function isMoneyReturned(
  status: RefundProviderSettlementStatus | string | null | undefined,
): boolean {
  if (!status) return false;
  return (MONEY_RETURNED_STATUSES as readonly string[]).includes(status);
}

/**
 * Human-readable label for the settlement status badge.
 */
export function settlementBadgeLabel(
  status: RefundProviderSettlementStatus | string | null | undefined,
): string {
  switch (status) {
    case "not_submitted":
      return "Awaiting provider settlement";
    case "submitted":
      return "Submitted to provider";
    case "provider_pending":
      return "Provider pending";
    case "provider_completed":
      return "Provider settled";
    case "provider_failed":
      return "Provider failed";
    case "manually_settled_offline":
      return "Manually settled offline";
    case "not_applicable":
      return "Not applicable";
    default:
      return status ? String(status) : "—";
  }
}

/**
 * Batch Q — customer-facing refund status label.
 *
 * Reads BOTH `refund_requests.status` and `provider_settlement_status`.
 * A refund that has been provider-settled (or manually settled offline)
 * must show "Refund completed", not "provider settlement pending" — the
 * previous UI only read `refund_requests.status` and so could get stuck
 * showing an approval-only label forever once the provider actually
 * confirmed settlement. See CUSTOMER_REFUND_LABELS for the exact wording
 * strings, which must not be altered outside dec-007-refund-policy.ts.
 */
export function customerRefundLabel(
    requestStatus: RefundRequestStatus | string | null | undefined,
    providerSettlementStatus:
      | RefundProviderSettlementStatus
      | string
      | null
      | undefined,
  ): string {
    switch (requestStatus) {
      case "pending":
              return CUSTOMER_REFUND_LABELS.requested;
      case "declined":
      case "blocked_credits_used":
      case "blocked_expired":
              return CUSTOMER_REFUND_LABELS.declined;
      case "superseded":
              return CUSTOMER_REFUND_LABELS.superseded;
      case "approved": {
              if (isMoneyReturned(providerSettlementStatus)) {
                        return CUSTOMER_REFUND_LABELS.completed;
              }
              if (providerSettlementStatus === "provider_failed") {
                        return CUSTOMER_REFUND_LABELS.requiresAdminReview;
              }
              if (
                        providerSettlementStatus === "submitted" ||
                        providerSettlementStatus === "provider_pending"
                      ) {
                        return CUSTOMER_REFUND_LABELS.awaitingProviderConfirmation;
              }
              // not_submitted / not_applicable / null: approved, held in reserve,
              // not yet submitted to (or not relevant for) the provider.
              return CUSTOMER_REFUND_LABELS.approvedForProcessing;
      }
      default:
              return requestStatus ? String(requestStatus) : "—";
    }
}
