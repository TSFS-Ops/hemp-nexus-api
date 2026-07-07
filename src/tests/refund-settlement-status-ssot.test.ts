/**
 * SSOT guard for refund provider-settlement separation.
 *
 * Pins the new status tuple, the money-returned helper, and the manual-
 * settlement disclaimer copy.
 *
 * Batch Q update: manual settlement now finally deducts the reserved
 * credits (it is the only close-out path when there is no provider
 * webhook), so the old "does NOT move money / does NOT change credits"
 * assertions are no longer true and have been replaced below with the
 * corrected, honest claims. See DEC_007_BATCH_Q_APPROVAL_DISCLAIMER for
 * the equivalent honesty guard on the approval step itself.
 */
import { describe, it, expect } from "vitest";
import {
    REFUND_PROVIDER_SETTLEMENT_STATUSES,
    REFUND_REQUEST_STATUSES,
    REFUND_RESERVATION_STATUSES,
    CUSTOMER_REFUND_LABELS,
    DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER,
    DEC_007_BATCH_Q_APPROVAL_DISCLAIMER,
} from "@/lib/policy/dec-007-refund-policy";
import {
    MONEY_RETURNED_STATUSES,
    isMoneyReturned,
    settlementBadgeLabel,
    customerRefundLabel,
} from "@/lib/policy/refund-settlement";

describe("refund provider-settlement SSOT", () => {
    it("exports the canonical seven settlement statuses", () => {
          expect(REFUND_PROVIDER_SETTLEMENT_STATUSES).toEqual([
                  "not_submitted",
                  "submitted",
                  "provider_pending",
                  "provider_completed",
                  "provider_failed",
                  "manually_settled_offline",
                  "not_applicable",
                ]);
    });

           it("internal refund statuses are unchanged by this migration", () => {
                 expect(REFUND_REQUEST_STATUSES).toEqual([
                         "pending",
                         "approved",
                         "declined",
                         "blocked_credits_used",
                         "blocked_expired",
                         "superseded",
                       ]);
           });

           it("only provider_completed and manually_settled_offline count as money returned", () => {
                 expect(MONEY_RETURNED_STATUSES).toEqual([
                         "provider_completed",
                         "manually_settled_offline",
                       ]);
                 expect(isMoneyReturned("provider_completed")).toBe(true);
                 expect(isMoneyReturned("manually_settled_offline")).toBe(true);
                 expect(isMoneyReturned("not_submitted")).toBe(false);
                 expect(isMoneyReturned("submitted")).toBe(false);
                 expect(isMoneyReturned("provider_pending")).toBe(false);
                 expect(isMoneyReturned("provider_failed")).toBe(false);
                 expect(isMoneyReturned("not_applicable")).toBe(false);
                 expect(isMoneyReturned(null)).toBe(false);
                 expect(isMoneyReturned(undefined)).toBe(false);
           });

           it("manual settlement disclaimer is honest about provider calls and credit deduction (Batch Q)", () => {
                 // Batch Q: this action never calls a live provider...
                  expect(DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER).toMatch(
                          /does NOT call Paystack or PayFast/,
                        );
                 // ...but, unlike pre-Batch-Q behaviour, it now DOES perform the final
                  // deduction, because credits are only reserved (not deducted) at
                  // approval time under the reservation model.
                  expect(DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER).toMatch(
                          /DOES finally deduct the reserved credits/,
                        );
                 expect(DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER).toMatch(
                         /closing token ledger entry/,
                       );
           });

           it("approval disclaimer is honest that credits are reserved, not finally deducted (Batch Q)", () => {
                 expect(DEC_007_BATCH_Q_APPROVAL_DISCLAIMER).toMatch(/reserves \(holds\) the credits/);
                 expect(DEC_007_BATCH_Q_APPROVAL_DISCLAIMER).toMatch(/does NOT finally deduct them/);
                 expect(DEC_007_BATCH_Q_APPROVAL_DISCLAIMER).toMatch(/does NOT move money/);
           });

           it("settlementBadgeLabel returns human strings for every status", () => {
                 for (const s of REFUND_PROVIDER_SETTLEMENT_STATUSES) {
                         expect(settlementBadgeLabel(s)).toBeTruthy();
                 }
           });

           it("exports the canonical three reservation statuses (Batch Q)", () => {
                 expect(REFUND_RESERVATION_STATUSES).toEqual(["active", "consumed", "released"]);
           });

           describe("customerRefundLabel (Batch Q)", () => {
                 it("reads request status alone for pending/declined/blocked/superseded", () => {
                         expect(customerRefundLabel("pending", null)).toBe(CUSTOMER_REFUND_LABELS.requested);
                         expect(customerRefundLabel("declined", "not_applicable")).toBe(
                                   CUSTOMER_REFUND_LABELS.declined,
                                 );
                         expect(customerRefundLabel("blocked_credits_used", null)).toBe(
                                   CUSTOMER_REFUND_LABELS.declined,
                                 );
                         expect(customerRefundLabel("blocked_expired", null)).toBe(
                                   CUSTOMER_REFUND_LABELS.declined,
                                 );
                         expect(customerRefundLabel("superseded", "not_applicable")).toBe(
                                   CUSTOMER_REFUND_LABELS.superseded,
                                 );
                 });

                        it("never shows completed before provider_settlement_status is a money-returned status", () => {
                                expect(customerRefundLabel("approved", "not_submitted")).toBe(
                                          CUSTOMER_REFUND_LABELS.approvedForProcessing,
                                        );
                                expect(customerRefundLabel("approved", "submitted")).toBe(
                                          CUSTOMER_REFUND_LABELS.awaitingProviderConfirmation,
                                        );
                                expect(customerRefundLabel("approved", "provider_pending")).toBe(
                                          CUSTOMER_REFUND_LABELS.awaitingProviderConfirmation,
                                        );
                                expect(customerRefundLabel("approved", "provider_completed")).toBe(
                                          CUSTOMER_REFUND_LABELS.completed,
                                        );
                                expect(customerRefundLabel("approved", "manually_settled_offline")).toBe(
                                          CUSTOMER_REFUND_LABELS.completed,
                                        );
                        });

                        it("routes provider_failed (or a detected settlement mismatch) to admin-review wording, never to completed", () => {
                                expect(customerRefundLabel("approved", "provider_failed")).toBe(
                                          CUSTOMER_REFUND_LABELS.requiresAdminReview,
                                        );
                        });

                        it("a provider-settled refund no longer gets stuck showing an approval-only label", () => {
                                // This is the exact regression Batch Q fixes: previously the UI only
                                 // read refund_requests.status, so an 'approved' row stayed on an
                                 // approval-only label forever, even after the provider confirmed
                                 // settlement.
                                 const requestStatus = "approved";
                                const beforeProviderConfirms = customerRefundLabel(requestStatus, "not_submitted");
                                const afterProviderConfirms = customerRefundLabel(requestStatus, "provider_completed");
                                expect(beforeProviderConfirms).not.toBe(CUSTOMER_REFUND_LABELS.completed);
                                expect(afterProviderConfirms).toBe(CUSTOMER_REFUND_LABELS.completed);
                        });
           });
});
