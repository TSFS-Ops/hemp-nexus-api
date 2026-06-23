/**
 * SSOT guard for refund provider-settlement separation.
 *
 * Pins the new status tuple, the money-returned helper, and the manual-
 * settlement disclaimer copy.
 */
import { describe, it, expect } from "vitest";
import {
  REFUND_PROVIDER_SETTLEMENT_STATUSES,
  REFUND_REQUEST_STATUSES,
  DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER,
} from "@/lib/policy/dec-007-refund-policy";
import {
  MONEY_RETURNED_STATUSES,
  isMoneyReturned,
  settlementBadgeLabel,
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

  it("manual settlement disclaimer is honest about no money movement", () => {
    expect(DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER).toMatch(
      /does NOT move money/,
    );
    expect(DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER).toMatch(
      /does NOT call Paystack or PayFast/,
    );
    expect(DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER).toMatch(
      /does NOT change credits/,
    );
  });

  it("settlementBadgeLabel returns human strings for every status", () => {
    for (const s of REFUND_PROVIDER_SETTLEMENT_STATUSES) {
      expect(settlementBadgeLabel(s)).toBeTruthy();
    }
  });
});
