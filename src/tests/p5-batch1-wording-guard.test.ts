import { describe, it, expect } from "vitest";
import {
  assertCustomerSafeWording,
  findForbiddenWording,
  isCustomerSafeWording,
  P5WordingGuardError,
} from "@/lib/p5-governance/wording-guard";
import {
  P5_ALLOWED_WORDS,
  P5_FORBIDDEN_WORDS,
} from "@/lib/p5-governance/constants";

describe("P-5 wording guard", () => {
  it("rejects every forbidden phrase on customer surfaces", () => {
    for (const phrase of P5_FORBIDDEN_WORDS) {
      expect(() =>
        assertCustomerSafeWording(`Status: ${phrase}.`, { surface: "customer" }),
      ).toThrow(P5WordingGuardError);
    }
  });

  it("rejects forbidden phrases on funder surfaces", () => {
    expect(() =>
      assertCustomerSafeWording("Counterparty is Bankable.", {
        surface: "funder",
      }),
    ).toThrow();
  });

  it("rejects forbidden phrases on public_api surfaces", () => {
    expect(() =>
      assertCustomerSafeWording("status: Verified", {
        surface: "public_api",
      }),
    ).toThrow();
  });

  it("accepts all allowed phrases on every external surface", () => {
    for (const phrase of P5_ALLOWED_WORDS) {
      for (const surface of ["customer", "funder", "public_api"] as const) {
        expect(
          isCustomerSafeWording(`Status: ${phrase}.`, { surface }),
        ).toBe(true);
      }
    }
  });

  it("is case-insensitive", () => {
    expect(() =>
      assertCustomerSafeWording("totally guaranteed", { surface: "customer" }),
    ).toThrow();
    expect(() =>
      assertCustomerSafeWording("PAYMENT CONFIRMED!", { surface: "funder" }),
    ).toThrow();
  });

  it("finality / payment / WaD wording is forbidden even with all supporting conditions", () => {
    for (const phrase of [
      "Final settlement",
      "Payment confirmed",
      "Refund complete",
      "Without a Doubt",
      "WaD finality",
      "Guaranteed",
    ]) {
      expect(() =>
        assertCustomerSafeWording(`Outcome: ${phrase}.`, {
          surface: "customer",
          supportingConditions: {
            approved_evidence_pack: true,
            provider_result_received: true,
            human_approval_recorded: true,
          },
        }),
      ).toThrow(/finality\/payment\/WaD/i);
    }
  });

  it("non-finality forbidden phrases may pass when ALL supporting conditions are met", () => {
    expect(
      isCustomerSafeWording("Counterparty is Verified.", {
        surface: "customer",
        supportingConditions: {
          approved_evidence_pack: true,
          provider_result_received: true,
          human_approval_recorded: true,
        },
      }),
    ).toBe(true);
  });

  it("partial supporting conditions are not enough", () => {
    expect(() =>
      assertCustomerSafeWording("Counterparty is Verified.", {
        surface: "customer",
        supportingConditions: {
          approved_evidence_pack: true,
          provider_result_received: false,
          human_approval_recorded: true,
        },
      }),
    ).toThrow();
  });

  it("admin_internal surface bypasses the guard", () => {
    expect(
      isCustomerSafeWording("Sanctions Cleared per ops note.", {
        surface: "admin_internal",
      }),
    ).toBe(true);
  });

  it("findForbiddenWording reports every hit with index", () => {
    const hits = findForbiddenWording("Verified and Guaranteed and Bankable");
    const phrases = hits.map((h) => h.phrase);
    expect(phrases).toEqual(expect.arrayContaining(["Verified", "Guaranteed", "Bankable"]));
    for (const h of hits) expect(h.index).toBeGreaterThanOrEqual(0);
  });

  it("clean text returns no violations", () => {
    expect(findForbiddenWording("Internally Ready — Under Review.")).toEqual([]);
  });

  it("default surface is customer (strict)", () => {
    expect(() => assertCustomerSafeWording("KYC Complete")).toThrow();
  });
});
