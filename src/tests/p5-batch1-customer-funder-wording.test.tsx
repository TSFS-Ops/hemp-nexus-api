/**
 * Stage 5 — Customer/funder wording guard tests.
 *
 * Asserts the Stage 2 wording guard rejects any forbidden phrase that
 * could appear in the Stage 5 customer/funder/API-client components, and
 * accepts the cautious replacements the UI actually uses.
 */
import { describe, it, expect } from "vitest";
import {
  assertCustomerSafeWording,
  isCustomerSafeWording,
  P5WordingGuardError,
} from "@/lib/p5-governance/wording-guard";
import {
  P5_ALLOWED_WORDS,
  P5_FORBIDDEN_WORDS,
} from "@/lib/p5-governance/constants";

describe("P-5 Stage 5 customer/funder wording guard", () => {
  it("rejects every forbidden phrase on customer surface (no supporting conditions)", () => {
    for (const phrase of P5_FORBIDDEN_WORDS) {
      expect(isCustomerSafeWording(phrase, { surface: "customer" })).toBe(false);
    }
  });

  it("rejects every forbidden phrase on funder surface", () => {
    for (const phrase of P5_FORBIDDEN_WORDS) {
      expect(isCustomerSafeWording(phrase, { surface: "funder" })).toBe(false);
    }
  });

  it("rejects every forbidden phrase on public_api surface", () => {
    for (const phrase of P5_FORBIDDEN_WORDS) {
      expect(isCustomerSafeWording(phrase, { surface: "public_api" })).toBe(false);
    }
  });

  it("accepts every cautious allowed phrase on customer surface", () => {
    for (const phrase of P5_ALLOWED_WORDS) {
      expect(isCustomerSafeWording(phrase, { surface: "customer" })).toBe(true);
    }
  });

  it("provider-dependent labels never imply pass/verified/cleared", () => {
    const providerCopy = [
      "Provider not live",
      "Credentials pending",
      "External confirmation pending",
      "Provider timeout — retry pending",
      "Provider result inconclusive — manual review required",
      "Provider result received",
      "Provider result requires review",
      "Not applicable",
    ];
    for (const text of providerCopy) {
      expect(isCustomerSafeWording(text, { surface: "customer" })).toBe(true);
      expect(isCustomerSafeWording(text, { surface: "funder" })).toBe(true);
    }
  });

  it("finality/payment/WaD wording stays forbidden even with all supporting conditions", () => {
    expect(() =>
      assertCustomerSafeWording("Payment confirmed", {
        surface: "customer",
        supportingConditions: {
          approved_evidence_pack: true,
          provider_result_received: true,
          human_approval_recorded: true,
        },
      }),
    ).toThrow(P5WordingGuardError);
  });
});
