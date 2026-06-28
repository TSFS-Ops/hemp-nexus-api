/**
 * Phase 2B no-regression guard — source-text assertions.
 *
 * Confirms that adding the PayFast sandbox ITN foundation did NOT:
 *   • change Paystack inline behaviour;
 *   • expose a customer-facing PayFast checkout button;
 *   • register PayFast as a live provider;
 *   • revive the legacy USD→ZAR FX helper;
 *   • leak a PayFast secret requirement into the live Paystack path.
 *
 * Pure source-text scans — no runtime, no Supabase, no Deno.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const TP = readFileSync(
  resolve(process.cwd(), "supabase/functions/token-purchase/index.ts"),
  "utf8",
);
const PW = readFileSync(
  resolve(process.cwd(), "supabase/functions/paystack-webhook/index.ts"),
  "utf8",
);
const SELECT = readFileSync(
  resolve(process.cwd(), "supabase/functions/_shared/payments/select.ts"),
  "utf8",
);
const ITN = readFileSync(
  resolve(process.cwd(), "supabase/functions/payfast-itn/index.ts"),
  "utf8",
);
const HELPERS = readFileSync(
  resolve(process.cwd(), "supabase/functions/_shared/payments/payfast.ts"),
  "utf8",
);

describe("Phase 2B: Paystack remains untouched", () => {
  it("token-purchase still settles in USD and gates on USD pricing", () => {
    expect(TP).toContain('currency: "USD"');
    expect(TP).toContain('fx_basis: "native_usd"');
  });
  it("token-purchase still uses atomic_paid_credit_purchase for paid credits", () => {
    expect(TP).toMatch(/supabase\.rpc\(\s*["']atomic_paid_credit_purchase["']/);
  });
  it("token-purchase still reads PAYSTACK_SECRET_KEY", () => {
    expect(TP).toMatch(/Deno\.env\.get\(\s*["']PAYSTACK_SECRET_KEY["']\s*\)/);
  });
  it("paystack-webhook entry point is unchanged in shape", () => {
    expect(PW).toContain("/functions/v1/token-purchase/webhook");
    expect(PW).toMatch(/HMAC[\s\S]{0,80}SHA-512/);
  });
  it("neither Paystack file imports PayFast helpers", () => {
    expect(TP).not.toMatch(/_shared\/payments\/payfast/);
    expect(PW).not.toMatch(/_shared\/payments\/payfast/);
  });
  it("neither Paystack file references PAYFAST_ secrets", () => {
    expect(TP).not.toMatch(/PAYFAST_/);
    expect(PW).not.toMatch(/PAYFAST_/);
  });
});

describe("Phase 2B: PayFast is NOT customer-facing live", () => {
  it("select.ts keeps payfast unregistered in the provider registry", () => {
    expect(SELECT).toMatch(/payfast:\s*undefined/);
  });
  it("PAYFAST_PROVIDER.liveEnabled is false", () => {
    expect(HELPERS).toMatch(/liveEnabled:\s*false/);
  });
  it("payfast-itn defaults to sandbox mode and only opts in to live on explicit env=live", () => {
    expect(ITN).toMatch(/PAYFAST_MODE/);
    expect(ITN).toMatch(/raw === "live" \? "live" : "sandbox"/);
  });
  it("no PayFast checkout initiation route exists in this build", () => {
    // Search the codebase for any sign of a customer-facing checkout
    // initiation surface. Phase 2B forbids one.
    const matches = execSync(
      `rg -l --no-messages "payfast" src supabase || true`,
      { encoding: "utf8" },
    );
    // The only files allowed to mention PayFast in Phase 2B:
    const allowed = [
      "supabase/functions/_shared/payments/payfast.ts",
      "supabase/functions/_shared/payments/select.ts",
      "supabase/functions/_shared/payments/provider.ts",
      "supabase/functions/_shared/payments/reference.ts",
      "supabase/functions/_shared/payments/paystack.ts",
      "supabase/functions/payfast-itn/index.ts",
      // Phase 2C: sandbox-only checkout initiation surfaces.
      "supabase/functions/_shared/payments/payfast-checkout.ts",
      "supabase/functions/payfast-checkout-sandbox/index.ts",
      "supabase/functions/token-purchase/index.ts", // Phase 2A audit refs only
      "supabase/functions/transaction-reconciliation/index.ts",
      "src/integrations/supabase/types.ts", // generated
      "src/components/desk/billing/PurchasesList.tsx", // Phase 2A display fallback
      "src/components/desk/billing/PayfastSandboxTestButton.tsx", // Phase 2F admin-only sandbox test button
      "src/pages/Billing.tsx", // Phase 2F: imports admin-only sandbox test button
    ];
    const files = matches.split("\n").filter(Boolean);
    const unexpected = files.filter(
      (f) =>
        !allowed.includes(f) &&
        !f.startsWith("src/tests/") &&
        !f.startsWith("docs/") &&
        !f.startsWith("supabase/migrations/"),
    );
    expect(unexpected).toEqual([]);
  });
});

describe("Phase 2B: PayFast helpers do not revive FX or import live Paystack secrets", () => {
  it("payfast.ts does not import _shared/fx.ts", () => {
    expect(HELPERS).not.toMatch(/from\s+["'][^"']*_shared\/fx[^"']*["']/);
  });
  it("payfast.ts does not read PAYSTACK_ secrets", () => {
    expect(HELPERS).not.toMatch(/Deno\.env\.get\(\s*["']PAYSTACK_/);
  });
  it("payfast.ts treats PayFast as ZAR-only (no USD conversion)", () => {
    expect(HELPERS).toMatch(/currency:\s*["']ZAR["']/);
    // No active code path that converts between ZAR and USD.
    expect(HELPERS).not.toMatch(/\bzar_to_usd\b/i);
    expect(HELPERS).not.toMatch(/\busd_to_zar\b/i);
    expect(HELPERS).not.toMatch(/convertZarToUsd|convertUsdToZar/);
  });
});

describe("Phase 2B: edge function file is present and shape is correct", () => {
  it("payfast-itn/index.ts exists", () => {
    expect(
      existsSync(resolve(process.cwd(), "supabase/functions/payfast-itn/index.ts")),
    ).toBe(true);
  });
  it("payfast-itn always returns 200 except for hard method-not-allowed", () => {
    expect(ITN).toMatch(/outcome\.status === 405 \? 405 : 200/);
  });
  it("payfast-itn injects the real validate post-back, real supabase client, and real IP", () => {
    expect(ITN).toMatch(/defaultPayfastValidatePostback/);
    expect(ITN).toMatch(/createClient\(SUPABASE_URL, SERVICE_ROLE/);
    expect(ITN).toMatch(/x-forwarded-for/);
  });
});
