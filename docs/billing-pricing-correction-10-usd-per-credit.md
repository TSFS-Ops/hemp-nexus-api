# Billing pricing correction — $10 per credit

Client direction (David, 2026-06): **unit price per credit must be USD $10**.
Flat per-credit, no volume discount tiers.

## Final status

`BILLING_PRICING_CORRECTION_BLOCKED_ON_ZAR_CONFIRMATION`

USD update is applied and live. PayFast public (customer) checkout is
**paused** at the UI layer until the matching fixed ZAR table is
confirmed by the client. ITN crediting, webhooks, Paystack and FX
posture are unchanged.

## Pricing inspection (where prices live)

| Layer | File | Notes |
|---|---|---|
| Backend USD registry (source of truth for charge amount) | `supabase/functions/token-purchase/index.ts` → `TOKEN_PACKAGES` | Drives the Paystack `amount` field. |
| Frontend billing page | `src/pages/Billing.tsx` → `CREDIT_PACKAGES` | Must mirror backend or wrong amount is charged. |
| Desk billing overview | `src/components/desk/billing/BillingOverview.tsx` → `PACKAGES` | Visible inside `/desk/billing`. |
| Settings token tab | `src/components/desk/settings/TokenBalanceTab.tsx` → `PACKAGES` | Profile/settings entry point. |
| Match credit provisioning panel | `src/components/desk/match/CreditProvisioningPanel.tsx` → `TIERS` | In-flow top-up. |
| Public pricing page | `src/pages/Pricing.tsx` | Hero price + tier list. |
| Developer integration PDF | `src/components/developer/IntegrationGuidePdf.ts` | Burn-rate copy. |
| Public live-test script | `public/docs/live-test-script.md` (line 758) | Demo wording. |
| PayFast fixed ZAR (customer) | `src/lib/credit-checkout-payfast.ts` → `PAYFAST_ZAR_PRICES` and `supabase/functions/_shared/payments/payfast-customer-packages.ts` | **Not yet updated — awaiting client sign-off.** |
| PayFast fixed ZAR (sandbox/admin) | `supabase/functions/_shared/payments/payfast-checkout.ts` | Admin-only sandbox; left as-is. |
| Registry API burn engine | `src/lib/registry-api-artefact-pricing.ts` | Already $10/credit; no change needed. |

Purchase logic uses **the same source per provider**: Paystack reads
the backend `TOKEN_PACKAGES`; PayFast reads `payfast-customer-packages`.
Frontend lists are display mirrors and were updated to match.

## USD changes applied (flat $10/credit, no discount)

| pack | credits | old USD | new USD |
|---|---|---|---|
| single | 1 | $1 | **$10** |
| pack_10 | 10 | $10 | **$100** |
| pack_50 | 50 | $45 (10% off) | **$500** |
| pack_200 | 200 | $160 (20% off) | **$2,000** |

Backend `TOKEN_PACKAGES.price_usd` updated; `pricePerCredit` set to
`"10.00"` on every tier; the `saving` field removed from the headline
copy. Customer-facing "10% saving" / "20% saving" / "$0.90 / credit" /
"$0.80 / credit" wording was removed from every UI listed above.

## PayFast ZAR — NOT changed, customer path paused

`PAYFAST_ZAR_PRICES` and `payfast-customer-packages.ts` still show the
old table (R20 / R190 / R850 / R3,000). Per the brief, these are NOT
changed until the client confirms the new fixed ZAR amounts.

To stop customers buying at the old ZAR amounts while we wait, the
customer-facing PayFast button is hidden behind a single client-side
constant:

```ts
// src/components/desk/billing/PaymentMethodPicker.tsx
const PAYFAST_PUBLIC_PRICING_CONFIRMED = false;
```

Effect: Paystack (now $10/credit USD) is the only visible customer
button. The PayFast option is hidden until the constant flips to `true`
*and* the ZAR table is updated to match the new commercial decision.

**Untouched (as instructed):**

- `payfast-checkout-public` master env gate (`PAYFAST_PUBLIC_ENABLED`).
- `payfast-itn` verified-signature crediting path.
- Paystack webhook + crediting path.
- No FX import added; `_shared/fx.ts` not reintroduced.
- Return / cancel pages remain read-only.
- Admin-only PayFast sandbox/live smoke buttons remain admin-only.
- Purchase-history provider badges unchanged.

## Proposed ZAR table (awaiting client confirmation)

If the working assumption is a clean R20 = $1 with no volume discount:

| pack | credits | USD | proposed ZAR |
|---|---|---|---|
| single | 1 | $10 | R200 |
| pack_10 | 10 | $100 | R2,000 |
| pack_50 | 50 | $500 | R10,000 |
| pack_200 | 200 | $2,000 | R40,000 |

Flip `PAYFAST_PUBLIC_PRICING_CONFIRMED` to `true` and update
`PAYFAST_ZAR_PRICES` + `payfast-customer-packages.ts` once confirmed.

## Stale wording sweep

Searched the codebase for the strings the brief listed:

- `$1`, `$10`, `$45`, `$160` — customer surfaces now show **$10 / $100
  / $500 / $2,000**. Remaining matches live only in admin/dev metadata
  panels (`AdminRevenuePanel`, dev docs JSON samples) where the literal
  is documenting the ledger field shape, not a current price.
- `R20`, `R190`, `R850`, `R3,000` — present only in the (untouched)
  PayFast registry and its tests; not surfaced to customers because the
  PayFast button is hidden.
- "Live Smoke Test" — only in admin smoke tooling; never rendered on
  customer surfaces.
- "1 credit" / "small credit pack" — pricing copy updated to "$10.00 /
  credit". No customer-facing "small credit pack" wording remained.

## Tests run

```
bunx vitest run \
  src/tests/billing-availability-guard.test.tsx \
  src/tests/payfast-phase-2j-customer-rollout.test.ts \
  src/tests/billing-navigation-usability.test.ts
→ 3 files, 42/42 tests passed
```

(The two "Unhandled Rejection" lines in the log are the pre-existing
`supabase.from(...).select(...).eq(...).eq` mock chain issue inside
`PendingPurchaseNotice`; they are unrelated to pricing and present on
main.)

## Recommendation

1. Confirm the proposed ZAR table with David (or supply alternative
   numbers).
2. Once confirmed, update `PAYFAST_ZAR_PRICES`,
   `payfast-customer-packages.ts` (and adjust the
   `payfast-phase-2j-customer-rollout` test expectations), then flip
   `PAYFAST_PUBLIC_PRICING_CONFIRMED` to `true`.
3. Re-run the Phase 2J pre-flight QA and email the client.
