/**
 * Paystack no-regression guard — Phase 1 (PayFast-readiness scaffolding).
 *
 * Phase 1 introduces a shared payments scaffolding module under
 * `supabase/functions/_shared/payments/` but MUST NOT change any
 * Paystack runtime behaviour. This source-text guard locks in the
 * critical Paystack-specific behaviours that the live request path
 * is required to keep, so a future refactor cannot quietly regress
 * them.
 *
 * Strictly source-text assertions — no Deno runtime, no Supabase,
 * no provider calls, no ledger writes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TP = readFileSync(
  resolve(process.cwd(), "supabase/functions/token-purchase/index.ts"),
  "utf8",
);
const PW = readFileSync(
  resolve(process.cwd(), "supabase/functions/paystack-webhook/index.ts"),
  "utf8",
);

describe("Phase 1: Paystack inline behaviour is unchanged", () => {
  it("token-purchase still reads PAYSTACK_SECRET_KEY from env", () => {
    expect(TP).toMatch(/Deno\.env\.get\(\s*["']PAYSTACK_SECRET_KEY["']\s*\)/);
  });

  it("token-purchase still calls Paystack initialize at the canonical URL", () => {
    expect(TP).toContain("https://api.paystack.co/transaction/initialize");
  });

  it("token-purchase still calls Paystack verify at the canonical URL", () => {
    expect(TP).toContain("https://api.paystack.co/transaction/verify/");
  });

  it("token-purchase still settles in USD (no ZAR/FX revival)", () => {
    expect(TP).toContain('currency: "USD"');
    expect(TP).toContain('fx_basis: "native_usd"');
    expect(TP).not.toMatch(/amount_zar/);
    expect(TP).not.toMatch(/from\s+["']\.\.\/_shared\/fx\.ts["']/);
  });

  it("token-purchase still credits paid purchases via atomic_paid_credit_purchase", () => {
    expect(TP).toMatch(/supabase\.rpc\(\s*["']atomic_paid_credit_purchase["']/);
    // Note: `atomic_token_credit` legitimately remains in this file
    // for refund / debit paths. Phase 1 only guards the credit-
    // purchase path, which MUST stay on `atomic_paid_credit_purchase`.
  });

  it("token-purchase still writes provider: \"paystack\" on init metadata", () => {
    expect(TP).toMatch(/provider:\s*["']paystack["']/);
  });

  it("token-purchase webhook still verifies HMAC-SHA512 with PAYSTACK_SECRET_KEY", () => {
    expect(TP).toMatch(/x-paystack-signature/);
    expect(TP).toMatch(/HMAC[\s\S]{0,80}SHA-512/);
  });

  it("token-purchase still keys idempotent token_purchases rows on paystack_reference", () => {
    expect(TP).toMatch(/paystack_reference:\s*paystackData\.data\.reference/);
  });

  it("token-purchase still gates checkout on get_billing_availability", () => {
    expect(TP).toContain('supabase.rpc("get_billing_availability")');
    expect(TP).toMatch(/BILLING_UNAVAILABLE/);
  });
});

describe("Phase 1: paystack-webhook entry point is unchanged", () => {
  it("paystack-webhook still validates HMAC-SHA512 before forwarding", () => {
    expect(PW).toMatch(/HMAC[\s\S]{0,80}SHA-512/);
    expect(PW).toMatch(/x-paystack-signature/);
  });

  it("paystack-webhook still forwards to the canonical token-purchase/webhook handler", () => {
    expect(PW).toContain("/functions/v1/token-purchase/webhook");
  });

  it("paystack-webhook still reads PAYSTACK_SECRET_KEY", () => {
    expect(PW).toMatch(/Deno\.env\.get\(\s*["']PAYSTACK_SECRET_KEY["']\s*\)/);
  });
});

describe("Phase 1: shared payments scaffolding is NOT yet wired into the live path", () => {
  it("token-purchase does NOT import the new _shared/payments scaffolding (Phase 1 is additive only)", () => {
    // Wiring this module into the live request path is a Phase 2
    // decision, gated on a behaviour-preserving lift covered by
    // regression tests. Importing it here in Phase 1 would be a
    // behaviour-change risk and is explicitly out of scope.
    expect(TP).not.toMatch(/_shared\/payments\//);
  });

  it("paystack-webhook does NOT import the new _shared/payments scaffolding (Phase 1 is additive only)", () => {
    expect(PW).not.toMatch(/_shared\/payments\//);
  });

  it("no PayFast secret is referenced anywhere in the live payment functions in Phase 1", () => {
    expect(TP).not.toMatch(/PAYFAST_/);
    expect(PW).not.toMatch(/PAYFAST_/);
  });

  it("no PayFast ITN route is exposed from token-purchase in Phase 1", () => {
    expect(TP).not.toMatch(/payfast-itn/);
    expect(TP).not.toMatch(/payfast[_-]?webhook/i);
  });
});
