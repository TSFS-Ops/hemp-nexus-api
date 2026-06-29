# Phase 2J — Customer-facing PayFast alongside Paystack

## Decision recorded

PayFast sits **alongside** Paystack, not replacing it. Paystack stays the default; both providers credit through the existing verified ITN/webhook paths.

## Critical no-FX policy

Izenzo prices credits in USD on the existing packs. PayFast settles in ZAR. With FX explicitly forbidden, the cleanest answer is a **fixed ZAR price list per pack**, declared once in code (no runtime conversion, no rate fetch). Proposed ZAR prices (drop-in for the existing packs):


| Pack       | Credits | USD  | ZAR (fixed) |
| ---------- | ------- | ---- | ----------- |
| `single`   | 1       | $1   | R20         |
| `pack_10`  | 10      | $10  | R190        |
| `pack_50`  | 50      | $45  | R850        |
| `pack_200` | 200     | $160 | R3,000      |


These are static constants — operator-tunable later via a single registry edit, never via FX. If you want different numbers I'll use yours instead before building.

## Scope (what changes)

### 1. New backend: `payfast-checkout-public` edge function

A second live-only PayFast checkout endpoint, separate from the existing admin-only `payfast-checkout-live`:

- Gated by `**PAYFAST_PUBLIC_ENABLED=true**` (new env flag, independent of `PAYFAST_LIVE_SMOKE_ENABLED`).
- Requires `PAYFAST_MODE=live`.
- Requires authenticated user with an `org_id`.
- Accepts only the customer pack ids (`single` / `pack_10` / `pack_50` / `pack_200`); rejects `live_smoke`.
- Reuses the proven signed-form builder (`buildSignedLiveFormPayload`) and live merchant creds.
- Inserts `token_purchases` with `provider='payfast'`, `provider_reference=m_payment_id`, `currency='ZAR'`, `status='pending'`, `paystack_reference='payfast_live::<id>'` (existing NOT NULL parking pattern, isolated from Paystack reporting), `package_id` set to the customer pack id, ZAR price in `metadata.price_zar`.
- Writes a `credits.purchase_initiated` audit row tagged `mode:live, provider:payfast, gate:PAYFAST_PUBLIC_ENABLED`.
- Returns `{ checkoutUrl, purchaseId, providerReference, amountZar, packageId, credits }` — never returns merchant_key or passphrase.

Existing `payfast-checkout-live` (admin smoke) and `payfast-itn` are not touched.

### 2. Customer payment-method picker UI

In `BillingOverview.tsx`, replace the single "Purchase" button per pack with a method picker that appears only after the user clicks the pack:

- **Paystack (USD)** — default, unchanged path via `startCreditCheckout`.
- **PayFast (ZAR)** — visible only when `PAYFAST_PUBLIC_ENABLED` probe returns available.

Each pack row shows both prices side by side so the customer sees the actual amount each provider will charge: "$10 via Paystack · R190 via PayFast". A small note states: *"PayFast charges in ZAR. Paystack charges in USD. Izenzo performs no currency conversion — the price you see is the price charged."*

A new tiny hook `usePayfastPublicAvailability()` calls a GET probe on the new function (no secrets returned, just `{ available: boolean }`).

### 3. PayFast return / cancel routes

Two new lightweight routes:

- `**/desk/billing/payfast/return**` — polls `token_purchases` by `provider_reference` for up to ~60s. Shows:
  - "Confirming payment with PayFast…" while `status='pending'` (no credit claim).
  - "Credits applied. New balance: N" only when `status='completed'` and the wallet reflects the credit.
  - "Payment was not successful" if `status` becomes `failed` / `cancelled`.
  - Never calls the credit RPC. Never mutates anything. The wallet is only credited by `payfast-itn`.
- `**/desk/billing/payfast/cancel**` — static "Payment cancelled. No charge was made." with a "Try again" link back to `/desk/billing`. No DB writes.

### 4. `PurchasesList` provider columns

Add a "Provider" column showing `Paystack` / `PayFast` badges and pick the reference field per provider (`paystack_reference` for Paystack rows, `provider_reference` for PayFast rows). Status stays the existing `pending / completed / cancelled / failed / abandoned` set. No PayFast row will ever render as Paystack.

### 5. Admin visibility

The existing admin billing dashboards already join `token_purchases` and `audit_logs`. Add a small `provider` + `mode` chip to the admin purchase row view so admins can distinguish at a glance. No new admin pages.

### 6. Admin-only smoke buttons

- `PayfastSandboxTestButton` — keep, still gated by `isAdmin` and the sandbox availability probe.
- `PayfastLiveSmokeTestButton` — keep, still gated by `isAdmin` + `PAYFAST_LIVE_SMOKE_ENABLED`. It now lives next to (not instead of) the customer flow. Useful for future operator diagnostics.
- Neither button can render for non-admins; we keep the existing `if (!isAdmin) return null` guard verbatim and add a Vitest that snapshots it.

### 7. Tests (Vitest)

New file `src/tests/payfast-phase-2j-customer-rollout.test.ts(x)` proving:

1. Paystack `startCreditCheckout` path is unchanged (regression against `payments-paystack-no-regression-phase1.test.ts` baseline).
2. PayFast customer button is hidden when `PAYFAST_PUBLIC_ENABLED` probe is unavailable.
3. PayFast customer button is shown when the probe is available and the user is non-admin.
4. The customer PayFast click posts to `payfast-checkout-public` with `provider:"payfast"`, `mode:"live"`, customer `packageId`, and never to `payfast-checkout-live`.
5. `payfast-checkout-public` rejects `packageId="live_smoke"`.
6. `payfast-checkout-public` rejects when `PAYFAST_PUBLIC_ENABLED!=true`.
7. `payfast-checkout-public` rejects when `PAYFAST_MODE!=live`.
8. Return route does not call any credit RPC and does not flip purchase status.
9. Cancel route writes nothing.
10. `PurchasesList` renders PayFast rows with provider `PayFast` and the PayFast reference, not the Paystack one.
11. Admin smoke buttons return null for non-admins (snapshot).
12. No FX import: grep guard test ensures `_shared/fx.ts` is not imported anywhere under `supabase/functions/payfast-*` or the new customer files.
13. `payfast-itn` idempotency unchanged — duplicate ITN returns `already_credited:true` and writes no second ledger row (existing test, re-asserted as part of the suite).

### 8. Secrets / config (request only — no values pasted in chat)

A single new env flag:

- `PAYFAST_PUBLIC_ENABLED` — set to `true` to expose the customer PayFast button. Default is unset/false. Toggling this off instantly removes PayFast from the customer surface without code changes.

All other PayFast secrets already exist (live merchant id / key / passphrase / URLs / `PAYFAST_ALLOWED_IPS`).

## Files

**New**

- `supabase/functions/payfast-checkout-public/index.ts`
- `supabase/functions/_shared/payments/payfast-public-checkout.ts` (pure orchestrator; tested)
- `supabase/functions/_shared/payments/payfast-customer-packages.ts` (the fixed ZAR table)
- `src/components/desk/billing/PayfastPublicCheckoutButton.tsx`
- `src/components/desk/billing/PaymentMethodPicker.tsx`
- `src/hooks/use-payfast-public-availability.ts`
- `src/pages/desk/billing/PayfastReturn.tsx`
- `src/pages/desk/billing/PayfastCancel.tsx`
- `src/lib/credit-checkout-payfast.ts` (client wrapper that calls the new function)
- `src/tests/payfast-phase-2j-customer-rollout.test.tsx`
- `docs/payfast-phase-2j-customer-rollout-report.md`

**Edited (minimal)**

- `src/components/desk/billing/BillingOverview.tsx` — pack rows now render `PaymentMethodPicker` instead of a single Purchase button. Existing Paystack code path preserved verbatim behind the Paystack option.
- `src/components/desk/billing/PurchasesList.tsx` — add Provider column + per-provider reference.
- `src/App.tsx` (or router) — register `/desk/billing/payfast/return` and `/desk/billing/payfast/cancel`.

**Untouched (asserted by tests)**

- `supabase/functions/payfast-itn/*`
- `supabase/functions/payfast-checkout-live/*`
- `supabase/functions/payfast-checkout-sandbox/*`
- `supabase/functions/paystack-webhook/*`
- `supabase/functions/_shared/payments/paystack.ts`
- `src/lib/credit-checkout.ts` (Paystack path)
- `PayfastSandboxTestButton.tsx`, `PayfastLiveSmokeTestButton.tsx` — still admin-only.
- Anything FX. No file under `_shared/fx*` is touched, imported, or revived.

## Refund / dispute readiness (reported, not built)

PayFast refunds are issued from the PayFast merchant dashboard. Today, `payfast-itn` only handles credit notifications — there is no PayFast refund-ITN branch yet. Phase 2J **does not** build refund handling. The report will state this explicitly as a known limitation, with the recommended Phase 2K shape (refund-ITN branch → `token_ledger.credit_refund` negative row, idempotent on `provider_reference + refund_id`, mirroring Paystack's existing refund handling). Existing Paystack refund flow is unchanged.

## Final status options in the report

- `PAYFAST_PHASE_2J_CUSTOMER_ROLLOUT_READY` — when all the tests above pass and `PAYFAST_PUBLIC_ENABLED` is set true by an operator.
- `PAYFAST_PHASE_2J_BLOCKED` — if any guard test fails or if you reject the fixed-ZAR price table proposed above.

## What I need from you before building

1. **Approve or override the fixed ZAR prices** above (R20 / R190 / R850 / R3000). Without your numbers I'll use those.
2. **Confirm the new env flag name `PAYFAST_PUBLIC_ENABLED**` is acceptable.

Once approved I'll build, run the Vitest suite, write the report, and end with the final status line.  
  
Approve both.

The proposed fixed ZAR prices are sensible and keep us safely away from FX. `PAYFAST_PUBLIC_ENABLED` is also a clear flag name.

Send Lovable this:

Approved.

1. Fixed ZAR prices approved:

- `single` — 1 credit — R20
- `pack_10` — 10 credits — R190
- `pack_50` — 50 credits — R850
- `pack_200` — 200 credits — R3,000

These are fixed ZAR prices, not FX conversions.

Do not add runtime FX.  
Do not fetch rates.  
Do not revive FX code.

2. Env flag approved:

`PAYFAST_PUBLIC_ENABLED`

Use this as the single switch for exposing the customer-facing PayFast option.

Proceed with Phase 2J exactly as scoped:

- PayFast alongside Paystack;
- Paystack remains default and unchanged;
- PayFast charges fixed ZAR prices;
- PayFast credits only through verified ITN;
- return/cancel pages do not credit;
- purchase history clearly shows PayFast vs Paystack;
- admin smoke buttons remain admin-only;
- no FX;
- no Paystack changes.

Please build, run the full relevant Vitest suite and guards, write:

`docs/payfast-phase-2j-customer-rollout-report.md`

Final status should be:

`PAYFAST_PHASE_2J_CUSTOMER_ROLLOUT_READY`

unless a real blocker is found.