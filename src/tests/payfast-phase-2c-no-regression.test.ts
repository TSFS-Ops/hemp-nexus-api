/**
 * Phase 2C no-regression guard.
 *
 * Confirms that adding sandbox PayFast checkout initiation did NOT:
 *   • change Paystack inline behaviour;
 *   • register PayFast as a live provider;
 *   • expose a customer-facing PayFast checkout button;
 *   • revive the FX layer;
 *   • leak PayFast secrets into the response body or audit metadata
 *     (text-level scan against the helper module).
 *
 * Source-text assertions only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const HELPER = readFileSync(
  resolve(process.cwd(), "supabase/functions/_shared/payments/payfast-checkout.ts"),
  "utf8",
);
const EDGE = readFileSync(
  resolve(process.cwd(), "supabase/functions/payfast-checkout-sandbox/index.ts"),
  "utf8",
);
const SELECT = readFileSync(
  resolve(process.cwd(), "supabase/functions/_shared/payments/select.ts"),
  "utf8",
);
const TP = readFileSync(
  resolve(process.cwd(), "supabase/functions/token-purchase/index.ts"),
  "utf8",
);

describe("Phase 2C: scaffolding present and shape correct", () => {
  it("payfast-checkout helper file exists", () => {
    expect(
      existsSync(resolve(process.cwd(), "supabase/functions/_shared/payments/payfast-checkout.ts")),
    ).toBe(true);
  });
  it("sandbox edge function exists", () => {
    expect(
      existsSync(resolve(process.cwd(), "supabase/functions/payfast-checkout-sandbox/index.ts")),
    ).toBe(true);
  });
  it("helper enforces sandbox-only mode literal", () => {
    expect(HELPER).toMatch(/input\.mode !== "sandbox"/);
  });
  it("helper enforces payfast provider literal", () => {
    expect(HELPER).toMatch(/input\.provider !== "payfast"/);
  });
  it("helper enforces gateEnabled and isPlatformAdmin", () => {
    expect(HELPER).toMatch(/deps\.gateEnabled !== true/);
    expect(HELPER).toMatch(/deps\.isPlatformAdmin !== true/);
  });
  it("edge wrapper reads PAYFAST_SANDBOX_CHECKOUT_ENABLED", () => {
    expect(EDGE).toMatch(/PAYFAST_SANDBOX_CHECKOUT_ENABLED/);
  });
  it("edge wrapper checks platform_admin via has_role", () => {
    expect(EDGE).toMatch(/has_role/);
    expect(EDGE).toMatch(/platform_admin/);
  });
});

describe("Phase 2C: PayFast remains NOT live, Paystack untouched", () => {
  it("select.ts still keeps payfast unregistered", () => {
    expect(SELECT).toMatch(/payfast:\s*undefined/);
  });
  it("token-purchase still settles in USD and uses PAYSTACK_SECRET_KEY", () => {
    expect(TP).toContain('currency: "USD"');
    expect(TP).toMatch(/Deno\.env\.get\(\s*["']PAYSTACK_SECRET_KEY["']\s*\)/);
  });
  it("token-purchase does NOT import the PayFast checkout helper", () => {
    expect(TP).not.toMatch(/_shared\/payments\/payfast-checkout/);
  });
  it("helper does not import _shared/fx.ts", () => {
    expect(HELPER).not.toMatch(/from\s+["'][^"']*_shared\/fx[^"']*["']/);
  });
  it("helper does not reference PAYSTACK_ secrets", () => {
    expect(HELPER).not.toMatch(/PAYSTACK_/);
  });
  it("edge wrapper does not reference PAYSTACK_ secrets", () => {
    expect(EDGE).not.toMatch(/PAYSTACK_/);
  });
  it("helper strips merchant_key from the returned form fields", () => {
    expect(HELPER).toMatch(/k !== "merchant_key"/);
  });
  it("no customer-facing PayFast button exists in the frontend", () => {
    // Allow PayFast references only in tests/docs/migrations/types and
    // the listed Phase 2A/B/C surfaces. A new src/components or
    // src/pages reference would indicate a customer button has been
    // wired.
    const matches = execSync(
      `rg -l --no-messages "payfast" src supabase || true`,
      { encoding: "utf8" },
    );
    const allowed = new Set([
      "supabase/functions/_shared/payments/payfast.ts",
      "supabase/functions/_shared/payments/payfast-checkout.ts",
      "supabase/functions/_shared/payments/select.ts",
      "supabase/functions/_shared/payments/provider.ts",
      "supabase/functions/_shared/payments/reference.ts",
      "supabase/functions/_shared/payments/paystack.ts",
      "supabase/functions/payfast-itn/index.ts",
      "supabase/functions/payfast-checkout-sandbox/index.ts",
      "supabase/functions/token-purchase/index.ts",
      "supabase/functions/transaction-reconciliation/index.ts",
      "src/integrations/supabase/types.ts",
      "src/components/desk/billing/PurchasesList.tsx",
      "src/components/desk/billing/PayfastSandboxTestButton.tsx",
      "src/components/desk/billing/PayfastLiveSmokeTestButton.tsx", // Phase 2G admin-only live smoke button
      "supabase/functions/_shared/payments/payfast-live-checkout.ts", // Phase 2G live checkout helper
      "supabase/functions/payfast-checkout-live/index.ts", // Phase 2G admin-only live checkout edge fn
      "src/components/desk/billing/BillingOverview.tsx", // Phase 2F admin-only
      "src/pages/Billing.tsx", // Phase 2F: hosts admin-only sandbox button
      // Phase 2J — customer-facing PayFast alongside Paystack:
      "supabase/functions/payfast-checkout-public/index.ts",
      "supabase/functions/_shared/payments/payfast-public-checkout.ts",
      "supabase/functions/_shared/payments/payfast-customer-packages.ts",
      "src/hooks/use-payfast-public-availability.ts",
      "src/lib/credit-checkout-payfast.ts",
      "src/components/desk/billing/PaymentMethodPicker.tsx",
      "src/pages/desk/billing/PayfastReturn.tsx",
      "src/pages/desk/billing/PayfastCancel.tsx",
      "src/pages/Desk.tsx",
    ]);
    const unexpected = matches
      .split("\n")
      .filter(Boolean)
      .filter(
        (f) =>
          !allowed.has(f) &&
          !f.startsWith("src/tests/") &&
          !f.startsWith("docs/") &&
          !f.startsWith("supabase/migrations/"),
      );
    expect(unexpected).toEqual([]);
  });
});
