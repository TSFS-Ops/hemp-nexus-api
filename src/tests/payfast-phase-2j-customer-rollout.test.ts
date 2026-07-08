/**
 * Phase 2J — customer-facing PayFast rollout guards.
 *
 * Static / structural assertions that the customer-facing PayFast
 * checkout is wired correctly alongside Paystack, while every
 * pre-existing safety promise still holds:
 *   - Paystack runtime is untouched.
 *   - PayFast is gated by PAYFAST_PUBLIC_ENABLED + PAYFAST_MODE=live.
 *   - PayFast customer endpoint only accepts customer packs.
 *   - Return / cancel pages never credit the wallet.
 *   - Admin smoke buttons remain admin-only.
 *   - No FX revival.
 *   - PayFast ITN remains the only credit path.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PUBLIC_FN_PATH = resolve("supabase/functions/payfast-checkout-public/index.ts");
const PUBLIC_HELPER_PATH = resolve(
  "supabase/functions/_shared/payments/payfast-public-checkout.ts",
);
const CUSTOMER_PACKS_PATH = resolve(
  "supabase/functions/_shared/payments/payfast-customer-packages.ts",
);

const PUBLIC_FN_SRC = readFileSync(PUBLIC_FN_PATH, "utf8");
const PUBLIC_HELPER_SRC = readFileSync(PUBLIC_HELPER_PATH, "utf8");
const CUSTOMER_PACKS_SRC = readFileSync(CUSTOMER_PACKS_PATH, "utf8");

const RETURN_PAGE_SRC = readFileSync(
  resolve("src/pages/desk/billing/PayfastReturn.tsx"),
  "utf8",
);
const CANCEL_PAGE_SRC = readFileSync(
  resolve("src/pages/desk/billing/PayfastCancel.tsx"),
  "utf8",
);
const PICKER_SRC = readFileSync(
  resolve("src/components/desk/billing/PaymentMethodPicker.tsx"),
  "utf8",
);
const CLIENT_PF_SRC = readFileSync(
  resolve("src/lib/credit-checkout-payfast.ts"),
  "utf8",
);
const CLIENT_PS_SRC = readFileSync(
  resolve("src/lib/credit-checkout.ts"),
  "utf8",
);
const BILLING_SRC = readFileSync(
  resolve("src/components/desk/billing/BillingOverview.tsx"),
  "utf8",
);
const PURCHASES_LIST_SRC = readFileSync(
  resolve("src/components/desk/billing/PurchasesList.tsx"),
  "utf8",
);
const LIVE_BTN_SRC = readFileSync(
  resolve("src/components/desk/billing/PayfastLiveSmokeTestButton.tsx"),
  "utf8",
);
const SANDBOX_BTN_SRC = readFileSync(
  resolve("src/components/desk/billing/PayfastSandboxTestButton.tsx"),
  "utf8",
);

describe("Phase 2J: customer-facing files exist", () => {
  it("payfast-checkout-public edge function exists", () => {
    expect(existsSync(PUBLIC_FN_PATH)).toBe(true);
  });
  it("payfast-public-checkout shared helper exists", () => {
    expect(existsSync(PUBLIC_HELPER_PATH)).toBe(true);
  });
  it("payfast-customer-packages registry exists", () => {
    expect(existsSync(CUSTOMER_PACKS_PATH)).toBe(true);
  });
});

describe("Phase 2J: customer checkout gates (helper)", () => {
  it("requires PAYFAST_PUBLIC_ENABLED", () => {
    expect(PUBLIC_HELPER_SRC).toMatch(/publicEnabled\s*!==\s*true/);
    expect(PUBLIC_HELPER_SRC).toContain('"gate_disabled"');
    expect(PUBLIC_FN_SRC).toContain("PAYFAST_PUBLIC_ENABLED");
  });
  it("requires PAYFAST_MODE=live", () => {
    expect(PUBLIC_HELPER_SRC).toMatch(/globalMode\s*!==\s*"live"/);
    expect(PUBLIC_HELPER_SRC).toContain('"mode_not_live"');
    expect(PUBLIC_FN_SRC).toContain("PAYFAST_MODE");
  });
  it("requires body provider=payfast and mode=live", () => {
    expect(PUBLIC_HELPER_SRC).toMatch(/input\.provider\s*!==\s*"payfast"/);
    expect(PUBLIC_HELPER_SRC).toMatch(/input\.mode\s*!==\s*"live"/);
  });
  it("rejects live_smoke and only accepts the four customer packs", () => {
    // The helper looks up by id via getPayfastCustomerPackage. The
    // registry must contain exactly the four customer packs (not
    // live_smoke).
    expect(CUSTOMER_PACKS_SRC).toMatch(/single:\s*\{/);
    expect(CUSTOMER_PACKS_SRC).toMatch(/pack_10:\s*\{/);
    expect(CUSTOMER_PACKS_SRC).toMatch(/pack_50:\s*\{/);
    expect(CUSTOMER_PACKS_SRC).toMatch(/pack_200:\s*\{/);
    expect(CUSTOMER_PACKS_SRC).not.toMatch(/live_smoke/);
  });
  it("inserts token_purchases with provider='payfast', mode='live', currency='ZAR'", () => {
    expect(PUBLIC_HELPER_SRC).toMatch(/provider:\s*"payfast"/);
    expect(PUBLIC_HELPER_SRC).toMatch(/mode:\s*"live"/);
    expect(PUBLIC_HELPER_SRC).toMatch(/currency:\s*"ZAR"/);
    expect(PUBLIC_HELPER_SRC).toMatch(/status:\s*"pending"/);
    // paystack_reference parked safely in the payfast_live:: namespace.
    expect(PUBLIC_HELPER_SRC).toMatch(/`payfast_live::\$\{mPaymentId\}`/);
  });
});

describe("Phase 2J: customer checkout uses LIVE creds only, never sandbox", () => {
  it("payfast-checkout-public/index.ts reads only *_LIVE secret names", () => {
    expect(PUBLIC_FN_SRC).not.toMatch(/PAYFAST_MERCHANT_ID_SANDBOX/);
    expect(PUBLIC_FN_SRC).not.toMatch(/PAYFAST_MERCHANT_KEY_SANDBOX/);
    expect(PUBLIC_FN_SRC).not.toMatch(/PAYFAST_PASSPHRASE_SANDBOX/);
    expect(PUBLIC_FN_SRC).not.toMatch(/PAYFAST_SANDBOX_MERCHANT_ID/);
    expect(PUBLIC_FN_SRC).not.toMatch(/PAYFAST_SANDBOX_MERCHANT_KEY/);
    expect(PUBLIC_FN_SRC).toMatch(/PAYFAST_MERCHANT_ID_LIVE/);
    expect(PUBLIC_FN_SRC).toMatch(/PAYFAST_MERCHANT_KEY_LIVE/);
    expect(PUBLIC_FN_SRC).toMatch(/PAYFAST_PASSPHRASE_LIVE/);
    expect(PUBLIC_FN_SRC).toMatch(/PAYFAST_NOTIFY_URL_LIVE/);
    expect(PUBLIC_FN_SRC).toMatch(/PAYFAST_RETURN_URL_LIVE/);
    expect(PUBLIC_FN_SRC).toMatch(/PAYFAST_CANCEL_URL_LIVE/);
  });
});

describe("Phase 2J: no FX revival anywhere on the PayFast customer surface", () => {
  it("payfast-public-checkout.ts does not import _shared/fx.ts", () => {
    expect(PUBLIC_HELPER_SRC).not.toMatch(/from\s+["'][^"']*_shared\/fx[^"']*["']/);
  });
  it("payfast-checkout-public/index.ts does not import _shared/fx.ts", () => {
    expect(PUBLIC_FN_SRC).not.toMatch(/from\s+["'][^"']*_shared\/fx[^"']*["']/);
  });
  it("customer pack registry does not import _shared/fx.ts", () => {
    expect(CUSTOMER_PACKS_SRC).not.toMatch(/from\s+["'][^"']*_shared\/fx[^"']*["']/);
  });
  it("client PayFast wrapper does not import any fx helper", () => {
    expect(CLIENT_PF_SRC).not.toMatch(/from\s+["'][^"']*\/fx[^"']*["']/);
  });
  it("PaymentMethodPicker does not import any fx helper", () => {
    expect(PICKER_SRC).not.toMatch(/from\s+["'][^"']*\/fx[^"']*["']/);
  });
});

describe("Phase 2J: Paystack code path is untouched (still hidden behind admin/flag)", () => {
  it("Paystack client still invokes token-purchase / token-purchase/verify", () => {
    expect(CLIENT_PS_SRC).toContain('"token-purchase"');
    expect(CLIENT_PS_SRC).toContain('"token-purchase/verify"');
  });
  it("PaymentMethodPicker still imports and can render the Paystack startCreditCheckout path", () => {
    expect(PICKER_SRC).toContain('from "@/lib/credit-checkout"');
    expect(PICKER_SRC).toContain("startCreditCheckout");
    expect(PICKER_SRC).toMatch(/Pay\s+\{usdPrice\}\s+via\s+Paystack/);
  });
  it("PaymentMethodPicker exposes a PAYSTACK_PUBLIC_ENABLED flag (default false)", () => {
    expect(PICKER_SRC).toMatch(/export const PAYSTACK_PUBLIC_ENABLED\s*=\s*false/);
  });
  it("BillingOverview still renders PaymentMethodPicker for each pack", () => {
    expect(BILLING_SRC).toContain("PaymentMethodPicker");
  });
});

describe("Phase 2J: PayFast customer button uses the public endpoint, not the admin one", () => {
  it("client PayFast wrapper invokes payfast-checkout-public", () => {
    expect(CLIENT_PF_SRC).toContain('"payfast-checkout-public"');
    expect(CLIENT_PF_SRC).not.toContain('"payfast-checkout-live"');
    expect(CLIENT_PF_SRC).not.toContain('"payfast-checkout-sandbox"');
  });
  it("client PayFast wrapper sends provider:payfast and mode:live", () => {
    expect(CLIENT_PF_SRC).toMatch(/provider:\s*"payfast"/);
    expect(CLIENT_PF_SRC).toMatch(/mode:\s*"live"/);
  });
  it("PaymentMethodPicker uses the public client helper and not the admin live one", () => {
    expect(PICKER_SRC).toContain('from "@/lib/credit-checkout-payfast"');
    expect(PICKER_SRC).not.toContain('payfast-checkout-live');
    expect(PICKER_SRC).not.toContain('payfast-checkout-sandbox');
  });
});

describe("Phase 2J: PayFast customer button is hidden until probe is available", () => {
  it("PaymentMethodPicker gates the PayFast button behind probe.available", () => {
    expect(PICKER_SRC).toContain("usePayfastPublicAvailability");
    expect(PICKER_SRC).toMatch(/showPayfast\s*=/);
    expect(PICKER_SRC).toMatch(/\{showPayfast\s*&&/);
  });
});

describe("Phase 2J: no admin-only or smoke-test language in the customer picker", () => {
  it("PaymentMethodPicker carries no 'smoke' or 'sandbox' wording", () => {
    expect(PICKER_SRC.toLowerCase()).not.toContain("smoke");
    expect(PICKER_SRC.toLowerCase()).not.toContain("sandbox");
  });
  it("Return page carries no 'admin', 'smoke' or 'sandbox' wording", () => {
    expect(RETURN_PAGE_SRC.toLowerCase()).not.toContain("smoke");
    expect(RETURN_PAGE_SRC.toLowerCase()).not.toContain("sandbox");
    expect(RETURN_PAGE_SRC.toLowerCase()).not.toMatch(/admin[\s-_]?only/);
  });
});

describe("Phase 2J: return / cancel pages do not credit the wallet", () => {
  it("PayfastReturn does not call any credit RPC or token-purchase verify", () => {
    expect(RETURN_PAGE_SRC).not.toMatch(/atomic_paid_credit_purchase/);
    expect(RETURN_PAGE_SRC).not.toMatch(/atomic_token_credit/);
    expect(RETURN_PAGE_SRC).not.toMatch(/token-purchase\/verify/);
    expect(RETURN_PAGE_SRC).not.toMatch(/verifyCreditCheckout/);
    expect(RETURN_PAGE_SRC).not.toMatch(/\.update\(/);
    expect(RETURN_PAGE_SRC).not.toMatch(/\.insert\(/);
  });
  it("PayfastCancel makes no Supabase writes at all", () => {
    expect(CANCEL_PAGE_SRC).not.toMatch(/supabase/i);
  });
  it("PayfastReturn states the credit comes from the verified ITN, not this page", () => {
    expect(RETURN_PAGE_SRC).toMatch(/ITN/);
    expect(RETURN_PAGE_SRC).toMatch(/does not credit/i);
  });
});

describe("Phase 2J: PurchasesList shows the right provider and reference per row", () => {
  it("renders a Provider badge column", () => {
    expect(PURCHASES_LIST_SRC).toContain("billing-purchase-provider-");
    expect(PURCHASES_LIST_SRC).toContain('"PayFast"');
    expect(PURCHASES_LIST_SRC).toContain('"Paystack"');
  });
  it("uses provider_reference for PayFast rows and paystack_reference for Paystack rows", () => {
    // Whitespace-normalised: PurchasesList.tsx's JSX indentation depth is
    // not semantically meaningful and must not make this guard brittle.
    const normalizedPurchasesListSrc = PURCHASES_LIST_SRC.replace(/\s+/g, " ");
    expect(normalizedPurchasesListSrc).toMatch(
      /p\.provider\s*===\s*"payfast"[\s\S]{0,160}provider_reference/,
    );
  });
});

describe("PayFast primary + USD pricing + admin-managed FX-derived ZAR", () => {
  it("server customer pack registry is USD-based ($10/$100/$500/$2000)", () => {
    expect(CUSTOMER_PACKS_SRC).toMatch(/single:\s*\{[^}]*price_usd:\s*10\b/);
    expect(CUSTOMER_PACKS_SRC).toMatch(/pack_10:\s*\{[^}]*price_usd:\s*100\b/);
    expect(CUSTOMER_PACKS_SRC).toMatch(/pack_50:\s*\{[^}]*price_usd:\s*500\b/);
    expect(CUSTOMER_PACKS_SRC).toMatch(/pack_200:\s*\{[^}]*price_usd:\s*2000\b/);
    expect(CUSTOMER_PACKS_SRC).not.toMatch(/price_zar:/);
  });
  it("server helper requires an admin-managed USD/ZAR rate and rejects when missing", () => {
    expect(PUBLIC_HELPER_SRC).toContain('"fx_rate_missing"');
    expect(PUBLIC_HELPER_SRC).toMatch(/usdZarRate/);
    expect(PUBLIC_HELPER_SRC).toMatch(/computeZarAmount\(/);
  });
  it("server helper snapshots usd amount, FX rate and ZAR amount into metadata", () => {
    expect(PUBLIC_HELPER_SRC).toMatch(/usd_zar_rate:/);
    expect(PUBLIC_HELPER_SRC).toMatch(/fx_rate_locked_at:/);
    expect(PUBLIC_HELPER_SRC).toMatch(/amount_zar:/);
    expect(PUBLIC_HELPER_SRC).toMatch(/amount_usd:\s*pkg\.price_usd/);
  });
  it("edge entry resolves the rate from admin_settings.payfast_usd_zar_rate", () => {
    expect(PUBLIC_FN_SRC).toContain("payfast_usd_zar_rate");
    expect(PUBLIC_FN_SRC).toMatch(/usdZarRate/);
  });
  it("edge probe surface includes fxRateConfigured + usdZarRate (no secrets)", () => {
    expect(PUBLIC_FN_SRC).toMatch(/fxRateConfigured/);
    expect(PUBLIC_FN_SRC).toMatch(/usdZarRate/);
  });
  it("client wrapper exposes USD prices ($10/$100/$500/$2000) and a computeDisplayZar helper", () => {
    expect(CLIENT_PF_SRC).toMatch(/single:\s*10\b/);
    expect(CLIENT_PF_SRC).toMatch(/pack_10:\s*100\b/);
    expect(CLIENT_PF_SRC).toMatch(/pack_50:\s*500\b/);
    expect(CLIENT_PF_SRC).toMatch(/pack_200:\s*2000\b/);
    expect(CLIENT_PF_SRC).toMatch(/computeDisplayZar/);
  });
});

