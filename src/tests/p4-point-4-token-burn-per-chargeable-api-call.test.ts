import { describe, it, expect } from "vitest";
import {
  ARTEFACT_PRICE_BOOK,
  ARTEFACT_PRICING_INVARIANTS,
  ARTEFACT_BURN_AUDIT_EVENTS,
  NON_CHARGEABLE_REASONS,
  CREDIT_UNITS_PER_CREDIT,
  USD_PER_CREDIT,
  getArtefactPrice,
  planArtefactBurn,
  usdToCreditUnits,
  creditUnitsToCredits,
} from "@/lib/registry-api-artefact-pricing";

describe("P-4 Point 4 — token / credit burn per chargeable API call", () => {
  describe("Base unit (David's confirmation)", () => {
    it("uses USD $10 = 1 credit = 100 credit_units", () => {
      expect(USD_PER_CREDIT).toBe(10);
      expect(CREDIT_UNITS_PER_CREDIT).toBe(100);
      expect(usdToCreditUnits(10)).toBe(100);
      expect(creditUnitsToCredits(100)).toBe(1);
    });

    it("treats Basic POI as 1 credit ($10)", () => {
      const p = getArtefactPrice("basic_poi");
      expect(p?.usd_price).toBe(10);
      expect(usdToCreditUnits(p!.usd_price)).toBe(100);
    });
  });

  describe("Invariants from the price book", () => {
    it("matches David-confirmed examples", () => {
      const I = ARTEFACT_PRICING_INVARIANTS;
      expect(I.basic_poi_credits).toBe(1);
      expect(I.counterparty_profile_credit_units).toBe(250); // 2.5 credits
      expect(I.verified_counterparty_credits).toBe(10);
      expect(I.basic_wad_credit_units).toBe(750); // 7.5 credits
      expect(I.payment_evidence_credits).toBe(50);
      expect(I.counterparty_memory_credits).toBe(50);
    });

    it("price book has no duplicate codes", () => {
      const codes = ARTEFACT_PRICE_BOOK.map((p) => p.code);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it("every chargeable artefact has a positive USD price", () => {
      for (const p of ARTEFACT_PRICE_BOOK) {
        if (p.chargeable) expect(p.usd_price).toBeGreaterThan(0);
      }
    });
  });

  describe("Chargeable production calls", () => {
    const ctx = (artefact_code: string, extra: any = {}) => ({
      environment: "production" as const,
      artefact_code,
      artefact_was_produced: true,
      request_id: "req_1",
      ...extra,
    });

    it("Basic POI burns 1 credit (100 credit_units)", () => {
      const p = planArtefactBurn(ctx("basic_poi"));
      expect(p.action).toBe("burn");
      if (p.action === "burn") {
        expect(p.wallet_credits).toBe(1);
        expect(p.credit_units).toBe(100);
        expect(p.audit_event).toBe("api.token_burn.succeeded");
      }
    });

    it("Basic Counterparty burns 1 credit", () => {
      const p = planArtefactBurn(ctx("basic_counterparty"));
      expect(p.action === "burn" && p.wallet_credits).toBe(1);
    });

    it("Counterparty Profile = $25 → 250 credit_units; wallet fail-closed (fractional)", () => {
      const p = planArtefactBurn(ctx("counterparty_profile"));
      // 250 % 100 != 0 → fail closed pending smallest-unit migration.
      expect(p.action).toBe("fail_closed");
      if (p.action === "fail_closed") {
        expect(p.reason).toBe("fractional_burn_requires_smallest_unit_migration");
      }
      // Lossless precision retained at the SSOT layer:
      expect(usdToCreditUnits(25)).toBe(250);
    });

    it("Verified Counterparty burns 10 credits ($100)", () => {
      const p = planArtefactBurn(ctx("verified_counterparty"));
      expect(p.action === "burn" && p.wallet_credits).toBe(10);
    });

    it("Basic WaD = $75 → 750 credit_units; wallet fail-closed (fractional)", () => {
      const p = planArtefactBurn(ctx("basic_wad"));
      expect(p.action).toBe("fail_closed");
      expect(usdToCreditUnits(75)).toBe(750);
    });

    it("Payment Evidence burns 50 credits ($500)", () => {
      const p = planArtefactBurn(ctx("payment_evidence"));
      expect(p.action === "burn" && p.wallet_credits).toBe(50);
    });

    it("Counterparty Memory burns 50 credits ($500)", () => {
      const p = planArtefactBurn(ctx("counterparty_memory"));
      expect(p.action === "burn" && p.wallet_credits).toBe(50);
    });
  });

  describe("No burn rules", () => {
    const baseCtx = {
      environment: "production" as const,
      artefact_code: "basic_poi",
      artefact_was_produced: true,
      request_id: "r",
    };

    it("sandbox calls do not burn", () => {
      const p = planArtefactBurn({ ...baseCtx, environment: "sandbox" });
      expect(p.action).toBe("skip");
      if (p.action === "skip") expect(p.audit_event).toBe("api.token_burn.skipped_sandbox");
    });

    it.each(NON_CHARGEABLE_REASONS)("non-chargeable reason %s does not burn", (reason) => {
      const p = planArtefactBurn({ ...baseCtx, non_chargeable_reason: reason });
      expect(p.action).toBe("skip");
    });

    it("no-result call (artefact_was_produced=false) does not burn", () => {
      const p = planArtefactBurn({ ...baseCtx, artefact_was_produced: false });
      expect(p.action).toBe("skip");
      if (p.action === "skip") expect(p.reason).toBe("no_result_no_artefact");
    });

    it("no-result call burns iff a retained priced artefact IS produced", () => {
      const yes = planArtefactBurn({ ...baseCtx, artefact_was_produced: true });
      const no = planArtefactBurn({ ...baseCtx, artefact_was_produced: false });
      expect(yes.action).toBe("burn");
      expect(no.action).toBe("skip");
    });

    it("failed technical call (non-chargeable reason) does not burn", () => {
      const p = planArtefactBurn({
        ...baseCtx,
        non_chargeable_reason: "failed_technical_call",
      });
      expect(p.action).toBe("skip");
      if (p.action === "skip") expect(p.audit_event).toBe("api.token_burn.skipped_failed_call");
    });

    it("revoked key path is non-chargeable", () => {
      const p = planArtefactBurn({ ...baseCtx, non_chargeable_reason: "revoked_key" });
      expect(p.action).toBe("skip");
    });

    it("invalid scope is non-chargeable", () => {
      const p = planArtefactBurn({ ...baseCtx, non_chargeable_reason: "invalid_scope" });
      expect(p.action).toBe("skip");
    });
  });

  describe("Variable-range pricing (Option A/C)", () => {
    const v = (artefact_code: string, admin?: number) =>
      planArtefactBurn({
        environment: "production",
        artefact_code,
        artefact_was_produced: true,
        admin_resolved_usd_price: admin,

      } as any);

    it("variable artefact without admin-resolved price fails closed", () => {
      const p = v("authority_backed_poi");
      expect(p.action).toBe("fail_closed");
      if (p.action === "fail_closed") expect(p.reason).toBe("variable_price_unresolved");
    });

    it("variable artefact with admin price out of range fails closed", () => {
      const p = v("authority_backed_poi", 500); // book says $75–$150
      expect(p.action).toBe("fail_closed");
      if (p.action === "fail_closed") expect(p.reason).toBe("variable_price_out_of_range");
    });

    it("variable artefact with admin price in range burns at exact price", () => {
      // $150 = 1500 credit_units = 15 wallet credits (exact).
      const p = v("authority_backed_poi", 150);
      expect(p.action).toBe("burn");
      if (p.action === "burn") {
        expect(p.usd_price).toBe(150);
        expect(p.wallet_credits).toBe(15);
      }
    });

    it("client cannot override fixed-price artefacts", () => {
      const p = v("basic_poi", 1); // attempt to underprice
      expect(p.action).toBe("fail_closed");
      if (p.action === "fail_closed") expect(p.reason).toBe("client_set_price_forbidden");
    });
  });

  describe("Fail-closed for missing / non-chargeable artefacts", () => {
    it("unknown artefact fails closed", () => {
      const p = planArtefactBurn({
        environment: "production",
        artefact_code: "this_artefact_does_not_exist",
        artefact_was_produced: true,

      });
      expect(p.action).toBe("fail_closed");
      if (p.action === "fail_closed") expect(p.reason).toBe("missing_price");
    });

    it("hash_chain_record is non-chargeable (included in governance layer)", () => {
      const price = getArtefactPrice("hash_chain_record");
      expect(price?.chargeable).toBe(false);
      const p = planArtefactBurn({
        environment: "production",
        artefact_code: "hash_chain_record",
        artefact_was_produced: true,

      });
      expect(p.action).toBe("fail_closed");
      if (p.action === "fail_closed") expect(p.reason).toBe("non_chargeable_artefact");
    });
  });

  describe("Audit events SSOT", () => {
    it("registers all required audit event names", () => {
      const required = [
        "api.token_burn.succeeded",
        "api.token_burn.insufficient_credits",
        "api.token_burn.skipped_sandbox",
        "api.token_burn.skipped_non_chargeable",
        "api.token_burn.skipped_no_result",
        "api.token_burn.skipped_failed_call",
        "api.token_burn.idempotent_replay",
        "api.token_burn.reversed",
      ];
      for (const ev of required) {
        expect(ARTEFACT_BURN_AUDIT_EVENTS).toContain(ev);
      }
    });
  });
});
