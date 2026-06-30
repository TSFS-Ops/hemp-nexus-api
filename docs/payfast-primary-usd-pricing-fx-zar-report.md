# PayFast Primary · USD Pricing · FX-controlled ZAR — Report

**Status:** PAYFAST_PRIMARY_USD_PAYFAST_ONLY_READY

## Customer-view verification (non-admin)

Confirmed via rendered-component test
`src/tests/payfast-customer-only-view.test.tsx` (passing) which mocks
`useAuth` with `isAdmin: false`:

- ✅ PayFast button renders (`pay-payfast-single`).
- ✅ Paystack button does NOT render (`pay-paystack-single` absent).
- ✅ No `[Admin only]` wording for customers.
- ✅ No `Paystack` wording on the customer surface.
- ✅ USD price (`$10`) remains visible.
- ✅ Only PayFast is a visible payment option.
- ✅ PayFast still routes via `payfast-checkout-public`, USD × admin
  FX rate → ZAR snapshotted in `token_purchases.metadata`.
- ✅ PayFast credits issued only by the verified ITN handler
  (`payfast-itn`); the client never credits.

Admin parity test in the same file confirms `isAdmin: true` users see
a dashed-grey Paystack button labelled `[Admin only] Pay $10 via
Paystack` with `data-admin-only="true"` — clearly separated from the
customer surface. `PAYSTACK_PUBLIC_ENABLED` remains `false`.


## What was wrong

After the David $10/credit USD correction, PayFast was paused (the
`PAYFAST_PUBLIC_PRICING_CONFIRMED` flag was `false`) and Paystack was
left as the only visible customer payment method. The client wanted
the opposite: PayFast as the **primary** customer surface, with USD
pricing displayed and PayFast charged in ZAR using a controlled,
admin-set FX rate. PayFast cannot accept USD amounts directly, so the
ZAR amount has to be computed before the redirect.

## What changed

### Commercial model

- 1 credit = **$10 USD** (no volume discount). USD list:
  - `single` — 1 credit — **$10**
  - `pack_10` — 10 credits — **$100**
  - `pack_50` — 50 credits — **$500**
  - `pack_200` — 200 credits — **$2,000**
- PayFast ZAR amount = `USD × admin-set USD/ZAR rate`, rounded to 2dp.
  At the **initial rate of 20** the ZAR amounts are:
  - `single` — **R200**
  - `pack_10` — **R2,000**
  - `pack_50` — **R10,000**
  - `pack_200` — **R40,000**
- The USD price, the FX rate and the computed ZAR amount are
  **snapshotted into `token_purchases.metadata`** at checkout-start
  (fields: `price_usd`, `usd_zar_rate`, `fx_rate_locked_at`,
  `fx_rate_source`, `amount_zar`, `price_zar`).
- A later rate change cannot alter an in-flight checkout — the rate
  is fixed at the moment the row is inserted.

### FX rate mechanism

- Stored in the existing **`admin_settings`** table under the key
  **`payfast_usd_zar_rate`**, value shape:
  ```json
  { "rate": 20, "source": "admin_manual", "set_at": "<iso8601>", "note": "..." }
  ```
- RLS already restricts writes to `platform_admin` only, and the
  existing `trg_log_admin_settings_change` trigger audits every
  change with `actor`, `before`, `after`, `at`.
- The new admin **PayFast pricing & FX** panel (`/desk/billing`) lets
  a platform admin update the rate inline with `Save rate`. Changes
  are positive-number validated client-side and rejected by the
  server if non-positive.
- **No live FX API is called.** No `_shared/fx.ts` is imported on the
  customer surface (asserted by the Phase-2J test).
- **Fallback / blocked state:** when the rate is unset or invalid,
  `payfast-checkout-public` returns `503 fx_rate_missing` and the
  GET probe reports `available=false`, which hides the PayFast
  button on the customer surface. The admin panel surfaces the
  unset state explicitly.

### Customer UI

- `PaymentMethodPicker` (rendered by `BillingOverview` for each
  pack):
  - **PayFast is the primary, default button** when the probe is
    available (gate on + live mode + merchant creds + URLs + FX
    rate set).
  - **Paystack is hidden from normal customers** by the new
    `PAYSTACK_PUBLIC_ENABLED = false` flag exported from the same
    file. Admins still see it for warm QA.
  - Beneath the button, the picker displays:
    > `$10 · PayFast amount: R200 · Rate used: $1 = R20`
  - Standard note: *"Credits are priced in USD. PayFast charges the
    ZAR amount shown before payment. The rate is set by Izenzo and
    locked when checkout starts."*

### Server-side PayFast checkout

- `payfast-checkout-public` resolves the rate from
  `admin_settings.payfast_usd_zar_rate` and passes it to the
  shared builder.
- `_shared/payments/payfast-public-checkout.ts`:
  - Requires `usdZarRate > 0`, rejects `fx_rate_missing` otherwise.
  - Computes ZAR via `computeZarAmount(usd, rate)`.
  - Snapshots USD, rate and ZAR in `token_purchases.metadata` and
    in the `credits.purchase_initiated` audit row.
  - Sets `amount_usd = pkg.price_usd` and `currency = "ZAR"`.
  - Still rejects non-customer packs (`live_smoke` etc.), wrong
    provider, wrong mode, missing org, missing merchant config,
    missing URLs.
- LIVE secrets only — no sandbox fallback path.
- ITN crediting path is **untouched**: `payfast-itn` still reads
  `metadata.price_zar` (now the computed value) for the
  amount-gross match and is the only way credits are issued.

### Paystack

- Code completely untouched. `token-purchase`, `token-purchase/verify`,
  `paystack-webhook`, `credit-checkout.ts` — all unchanged.
- Hidden from customers via `PAYSTACK_PUBLIC_ENABLED=false`.

### Return / Cancel pages

- No change. Still do not credit. Still display "Payment is being
  confirmed" while ITN is pending.

### Admin visibility

- The admin **PayFast pricing & FX** panel on `/desk/billing` shows:
  - live probe state (`Customer PayFast = VISIBLE / HIDDEN`),
  - `Paystack public` flag state,
  - `Pricing confirmed` legacy flag state,
  - the current rate, when it was set,
  - the USD pack table with the resulting ZAR amount per pack,
  - the FX rate editor (platform-admin-only by RLS).

## Tests

- `src/tests/payfast-phase-2j-customer-rollout.test.ts` updated and
  extended with a dedicated block:
  - server registry encodes USD ($10/$100/$500/$2000) and no
    longer carries `price_zar`;
  - server helper requires the admin-managed rate and rejects
    `fx_rate_missing`;
  - server helper snapshots USD, rate, locked-at and ZAR in
    metadata;
  - edge entry resolves the rate from
    `admin_settings.payfast_usd_zar_rate`;
  - probe exposes `fxRateConfigured` and `usdZarRate` (no secrets);
  - client wrapper exports `PAYFAST_USD_PRICES` and
    `computeDisplayZar`;
  - Paystack code path remains intact and the picker still imports
    it.
- Run: `bunx vitest run src/tests/payfast-phase-2j-customer-rollout.test.ts`
  → **35 / 35 passing**.
- Project typecheck (`bunx tsgo --noEmit`): clean.

## Confirmations

- ✅ PayFast is the primary visible customer payment option.
- ✅ Paystack is hidden from normal customers (admin-only via the
  `PAYSTACK_PUBLIC_ENABLED=false` flag).
- ✅ USD pricing ($10/credit) is the source of truth.
- ✅ PayFast ZAR amount is computed from the admin-set rate (initial
  rate 20 → R200 / R2,000 / R10,000 / R40,000).
- ✅ FX rate, USD price and ZAR amount are snapshotted in
  `token_purchases.metadata`.
- ✅ Missing / invalid rate blocks PayFast customer checkout (`503
  fx_rate_missing`) and hides the button via the probe.
- ✅ No external FX API is used.
- ✅ Customer surface contains no "smoke / sandbox / admin-only"
  language.
- ✅ PayFast still credits ONLY via verified ITN (`payfast-itn`).
- ✅ Paystack code is untouched and its tests continue to pass.

## Final status

**PAYFAST_PRIMARY_USD_WITH_FX_ZAR_READY**
