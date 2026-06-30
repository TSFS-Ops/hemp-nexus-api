/**
 * PayFast customer-facing package registry — USD-primary.
 *
 * Credits are priced in USD. Because PayFast settles in ZAR, the ZAR
 * amount actually sent to PayFast is computed at checkout time from
 * the platform-admin-managed USD/ZAR rate stored in
 * `admin_settings.payfast_usd_zar_rate`. There is NO live FX API call
 * — the rate is set manually by a platform admin and locked into the
 * purchase metadata at checkout-start.
 *
 * SCOPE
 * ─────
 *   • Used ONLY by the customer-facing path
 *     (`payfast-checkout-public` and `_shared/payments/payfast-public-checkout.ts`).
 *   • NOT used by the admin-only live smoke path
 *     (`payfast-checkout-live`), which keeps its own dedicated
 *     admin-smoke package id.
 *
 * NON-GOALS
 * ─────────
 *   • No live FX API. No `_shared/fx.ts` import — ever.
 *   • No mutation of Paystack pricing or behaviour.
 */
export interface PayfastCustomerPackage {
  id: "single" | "pack_10" | "pack_50" | "pack_200";
  credits: number;
  /** Source-of-truth USD price (1 credit = $10, no volume discount). */
  price_usd: number;
  label: string;
}

export const PAYFAST_CUSTOMER_PACKAGES: Readonly<
  Record<PayfastCustomerPackage["id"], PayfastCustomerPackage>
> = Object.freeze({
  single:   { id: "single",   credits: 1,   price_usd: 10,   label: "1 Credit" },
  pack_10:  { id: "pack_10",  credits: 10,  price_usd: 100,  label: "10 Credits" },
  pack_50:  { id: "pack_50",  credits: 50,  price_usd: 500,  label: "50 Credits" },
  pack_200: { id: "pack_200", credits: 200, price_usd: 2000, label: "200 Credits" },
});

export function getPayfastCustomerPackage(
  id: string | null | undefined,
): PayfastCustomerPackage | null {
  if (!id) return null;
  const pkg = (PAYFAST_CUSTOMER_PACKAGES as Record<string, PayfastCustomerPackage>)[id];
  return pkg ?? null;
}

/**
 * Compute the ZAR amount PayFast will charge, given the USD price and
 * the admin-managed USD->ZAR rate. Rounded to 2 decimal places.
 */
export function computeZarAmount(priceUsd: number, usdZarRate: number): number {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return 0;
  if (!Number.isFinite(usdZarRate) || usdZarRate <= 0) return 0;
  return Math.round(priceUsd * usdZarRate * 100) / 100;
}
