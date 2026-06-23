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

import type { RefundProviderSettlementStatus } from "./dec-007-refund-policy";

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
