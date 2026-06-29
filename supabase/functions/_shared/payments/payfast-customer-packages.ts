/**
 * PayFast customer-facing package registry — Phase 2J.
 *
 * Fixed ZAR prices, declared once. No runtime FX, no rate fetch, no
 * currency conversion. PayFast settles in ZAR; Izenzo prices in USD on
 * the Paystack side. These two price lists are intentionally
 * independent — the customer sees the actual amount each provider will
 * charge.
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
 *   • No FX. No `_shared/fx.ts` import — ever.
 *   • No mutation of Paystack pricing or behaviour.
 */
export interface PayfastCustomerPackage {
  id: "single" | "pack_10" | "pack_50" | "pack_200";
  credits: number;
  price_zar: number;
  label: string;
}

export const PAYFAST_CUSTOMER_PACKAGES: Readonly<
  Record<PayfastCustomerPackage["id"], PayfastCustomerPackage>
> = Object.freeze({
  single: { id: "single", credits: 1, price_zar: 20, label: "1 Credit" },
  pack_10: { id: "pack_10", credits: 10, price_zar: 190, label: "10 Credits" },
  pack_50: { id: "pack_50", credits: 50, price_zar: 850, label: "50 Credits" },
  pack_200: { id: "pack_200", credits: 200, price_zar: 3000, label: "200 Credits" },
});

export function getPayfastCustomerPackage(
  id: string | null | undefined,
): PayfastCustomerPackage | null {
  if (!id) return null;
  const pkg = (PAYFAST_CUSTOMER_PACKAGES as Record<string, PayfastCustomerPackage>)[id];
  return pkg ?? null;
}
