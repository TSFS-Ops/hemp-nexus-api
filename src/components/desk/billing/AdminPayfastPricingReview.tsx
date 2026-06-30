/**
 * AdminPayfastPricingReview — admin-only review panel.
 *
 * Renders the *current* fixed ZAR table that PayFast would charge
 * customers, the *proposed* ZAR table that matches the $10/credit USD
 * correction (David, 2026-06), and the live state of the customer
 * pause flag `PAYFAST_PUBLIC_PRICING_CONFIRMED`.
 *
 * Read-only: this panel does not change pricing, does not unpause
 * customer purchases, and does not touch ITN/webhook crediting.
 * Reviewers approve the numbers; an engineer then updates the
 * registries and flips the flag.
 *
 * Caller MUST gate on `isAdmin`. The component itself does no auth.
 */
import {
  PAYFAST_ZAR_PRICES,
  type PayfastCustomerPackageId,
} from "@/lib/credit-checkout-payfast";
import { PAYFAST_PUBLIC_PRICING_CONFIRMED } from "./PaymentMethodPicker";

interface Row {
  id: PayfastCustomerPackageId;
  credits: number;
  usd: number;
  proposedZar: number;
}

// Proposed table = clean R20 per USD $1, no volume discount, matching
// the corrected USD list ($10 / $100 / $500 / $2,000).
const ROWS: Row[] = [
  { id: "single",   credits: 1,   usd: 10,   proposedZar: 200 },
  { id: "pack_10",  credits: 10,  usd: 100,  proposedZar: 2000 },
  { id: "pack_50",  credits: 50,  usd: 500,  proposedZar: 10000 },
  { id: "pack_200", credits: 200, usd: 2000, proposedZar: 40000 },
];

function fmtZar(n: number): string {
  return `R${n.toLocaleString("en-ZA")}`;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export function AdminPayfastPricingReview() {
  return (
    <section
      data-testid="admin-payfast-pricing-review"
      className="rounded-sm border border-amber-300/60 bg-amber-50/60 p-4 sm:p-5 space-y-3"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-800">
          Admin · pricing review
        </span>
        <span
          data-testid="admin-payfast-flag-state"
          className={`font-mono text-[10px] uppercase tracking-[0.14em] rounded-sm px-2 py-0.5 border ${
            PAYFAST_PUBLIC_PRICING_CONFIRMED
              ? "border-emerald-400 text-emerald-800 bg-emerald-50"
              : "border-amber-400 text-amber-900 bg-amber-100"
          }`}
        >
          PAYFAST_PUBLIC_PRICING_CONFIRMED ={" "}
          {String(PAYFAST_PUBLIC_PRICING_CONFIRMED)}
        </span>
      </header>

      <p className="text-xs text-amber-900/90 leading-relaxed">
        Customer-facing PayFast checkout is{" "}
        <strong>
          {PAYFAST_PUBLIC_PRICING_CONFIRMED ? "VISIBLE" : "HIDDEN"}
        </strong>
        . Compare the current vs proposed ZAR table below. Approve the
        proposed numbers before an engineer updates the registries and
        flips the flag. ITN crediting and Paystack are unchanged.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-left text-amber-900/80 border-b border-amber-300/60">
              <th className="py-1.5 pr-3">Pack</th>
              <th className="py-1.5 pr-3">Credits</th>
              <th className="py-1.5 pr-3">USD (live)</th>
              <th className="py-1.5 pr-3">ZAR — current (live)</th>
              <th className="py-1.5 pr-3">ZAR — proposed</th>
              <th className="py-1.5 pr-3">Δ</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const current = PAYFAST_ZAR_PRICES[r.id];
              const delta = r.proposedZar - current;
              const match = delta === 0;
              return (
                <tr
                  key={r.id}
                  data-testid={`admin-payfast-pricing-row-${r.id}`}
                  className="border-b border-amber-200/60 last:border-0"
                >
                  <td className="py-1.5 pr-3">{r.id}</td>
                  <td className="py-1.5 pr-3">{r.credits}</td>
                  <td className="py-1.5 pr-3">{fmtUsd(r.usd)}</td>
                  <td className="py-1.5 pr-3">{fmtZar(current)}</td>
                  <td className="py-1.5 pr-3 font-semibold text-amber-950">
                    {fmtZar(r.proposedZar)}
                  </td>
                  <td
                    className={`py-1.5 pr-3 ${
                      match ? "text-emerald-700" : "text-amber-900"
                    }`}
                  >
                    {match ? "match" : `${delta > 0 ? "+" : ""}${fmtZar(delta)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-amber-900/80">
        Working assumption: flat R20 per USD $1, no volume discount —
        mirrors the corrected USD list. Source of truth on apply:
        <code className="mx-1">src/lib/credit-checkout-payfast.ts</code>
        and
        <code className="mx-1">
          supabase/functions/_shared/payments/payfast-customer-packages.ts
        </code>
        .
      </p>
    </section>
  );
}
