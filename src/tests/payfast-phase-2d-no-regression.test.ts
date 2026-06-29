/**
 * Phase 2D no-regression guard.
 *
 * Confirms that wiring sandbox checkout → ITN end-to-end did NOT:
 *   • flip PayFast on as a live customer-facing provider;
 *   • change Paystack runtime behaviour;
 *   • revive any USD↔ZAR FX helper;
 *   • introduce a customer-facing PayFast button anywhere in src/;
 *   • leak PayFast secrets into the Paystack files.
 *
 * Source-text scans only — pure, fast, no runtime.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const TP = readFileSync(resolve("supabase/functions/token-purchase/index.ts"), "utf8");
const PW = readFileSync(resolve("supabase/functions/paystack-webhook/index.ts"), "utf8");
const SELECT = readFileSync(resolve("supabase/functions/_shared/payments/select.ts"), "utf8");
const PF = readFileSync(resolve("supabase/functions/_shared/payments/payfast.ts"), "utf8");
const PFC = readFileSync(resolve("supabase/functions/_shared/payments/payfast-checkout.ts"), "utf8");

describe("Phase 2D: Paystack runtime untouched", () => {
  it("token-purchase still settles in USD with native_usd basis", () => {
    expect(TP).toContain('currency: "USD"');
    expect(TP).toContain('fx_basis: "native_usd"');
  });
  it("token-purchase still uses PAYSTACK_SECRET_KEY", () => {
    expect(TP).toMatch(/Deno\.env\.get\(\s*["']PAYSTACK_SECRET_KEY["']/);
  });
  it("paystack-webhook still uses HMAC SHA-512", () => {
    expect(PW).toMatch(/HMAC[\s\S]{0,80}SHA-512/);
  });
  it("Paystack files do not import the PayFast helper modules", () => {
    expect(TP).not.toMatch(/_shared\/payments\/payfast/);
    expect(PW).not.toMatch(/_shared\/payments\/payfast/);
  });
});

describe("Phase 2D: PayFast still NOT live", () => {
  it("select.ts keeps payfast unregistered in the live provider registry", () => {
    expect(SELECT).toMatch(/payfast:\s*undefined/);
  });
  it("PAYFAST_PROVIDER.liveEnabled remains false", () => {
    expect(PF).toMatch(/liveEnabled:\s*false/);
  });
  it("checkout helper still enforces mode === 'sandbox' literal", () => {
    expect(PFC).toMatch(/input\.mode !== "sandbox"/);
  });
});

describe("Phase 2D: no FX revival, no Paystack secret leak into PayFast helpers", () => {
  it("payfast.ts does not import _shared/fx.ts", () => {
    expect(PF).not.toMatch(/from\s+["'][^"']*_shared\/fx[^"']*["']/);
  });
  it("payfast-checkout.ts does not import _shared/fx.ts", () => {
    expect(PFC).not.toMatch(/from\s+["'][^"']*_shared\/fx[^"']*["']/);
  });
  it("payfast helpers do not read PAYSTACK_ secrets", () => {
    expect(PF).not.toMatch(/Deno\.env\.get\(\s*["']PAYSTACK_/);
    expect(PFC).not.toMatch(/Deno\.env\.get\(\s*["']PAYSTACK_/);
  });
  it("payfast helpers treat ZAR as the only settlement currency", () => {
    expect(PF).toMatch(/currency:\s*["']ZAR["']/);
    expect(PF).not.toMatch(/\bzar_to_usd\b|\busd_to_zar\b/i);
    expect(PFC).not.toMatch(/\bzar_to_usd\b|\busd_to_zar\b/i);
  });
});

describe("Phase 2D: no customer-facing PayFast surface in src/", () => {
  it("no new src/components or src/pages files reference payfast outside the allowlist", () => {
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
      "supabase/functions/list-org-purchases/index.ts",
      "src/integrations/supabase/types.ts",
      "src/components/desk/billing/PurchasesList.tsx",
      "src/components/desk/billing/PayfastSandboxTestButton.tsx",
      "src/components/desk/billing/PayfastLiveSmokeTestButton.tsx", // Phase 2G admin-only live smoke button
      "supabase/functions/_shared/payments/payfast-live-checkout.ts", // Phase 2G live checkout helper
      "supabase/functions/payfast-checkout-live/index.ts", // Phase 2G admin-only live checkout edge fn
      "src/components/desk/billing/BillingOverview.tsx",
      "src/pages/Billing.tsx",
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
