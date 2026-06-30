# PayFast commercial logic — confirmation

**Final status:** `PAYFAST_COMMERCIAL_LOGIC_CONFIRMED_WITH_ONE_MUST_FIX`

Source code matches James's confirmed commercial model end-to-end.
One historic-data observation (live DB rows from the most recent
customer attempts carry `amount_usd = 0.00`) is **must-fix verification**
— the source already snapshots `amount_usd` correctly; a fresh
end-to-end customer checkout is required to confirm the new rows
carry the USD price column. No code change, no Paystack change, no FX
API revival, no manual crediting, no pricing change made by this
review.

---

## 1. USD pricing — CONFIRMED

`supabase/functions/_shared/payments/payfast-customer-packages.ts`
(`PAYFAST_CUSTOMER_PACKAGES`) and
`src/lib/credit-checkout-payfast.ts` (`PAYFAST_USD_PRICES`):

| pack       | credits | USD     |
| ---------- | ------- | ------- |
| `single`   | 1       | $10     |
| `pack_10`  | 10      | $100    |
| `pack_50`  | 50      | $500    |
| `pack_200` | 200     | $2,000  |

Flat $10/credit, no volume discount.

## 2. FX rate — CONFIRMED

* **Stored at:** `admin_settings.payfast_usd_zar_rate` (JSONB
  `value.rate`).
* **Current value:** `20` (set 2026-06-30 11:16:15 UTC,
  `source: admin_manual`).
* **Write access:** RLS policy `Admins can manage settings` —
  `has_role(auth.uid(), 'platform_admin')` only.
* **AAL2:** `trg_enforce_admin_settings_aal2` requires step-up auth
  for any value change.
* **Audited:** `trg_log_admin_settings_change` writes the change to
  the admin audit log on every update.
* **No live FX:** no `_shared/fx.ts` import in the customer path
  (only the legacy `fx_rate_usd_zar` row exists for the
  non-customer-facing token-purchase fallback — untouched).

## 3. PayFast checkout — CONFIRMED

`supabase/functions/payfast-checkout-public/index.ts` +
`supabase/functions/_shared/payments/payfast-public-checkout.ts`:

* Resolves USD pack price from `PAYFAST_CUSTOMER_PACKAGES`.
* Loads `admin_settings.payfast_usd_zar_rate` (no live FX call). If
  unset → `503 fx_rate_missing`.
* `amountZar = round(price_usd * rate, 2)`; rejects if 0.
* Rate snapshot timestamp `fx_rate_locked_at` captured at
  checkout-start; written to purchase metadata before the PayFast
  redirect.
* `amount` form field sent to PayFast = `amountZar.toFixed(2)` (ZAR).
* UI (`PaymentMethodPicker.tsx`) shows the ZAR amount on the button
  ("Pay R200 via PayFast") and an `$10 · PayFast amount: R200 · Rate
  used: $1 = R20` line under it before the customer clicks.

## 4. Transaction metadata — CONFIRMED IN SOURCE, MUST-FIX VERIFY IN DATA

`token_purchases` columns and metadata written by
`payfast-public-checkout.ts`:

| field                | column                   | metadata key            |
| -------------------- | ------------------------ | ----------------------- |
| USD package price    | `amount_usd`             | `price_usd`, `amount_usd` |
| ZAR amount charged   | (in metadata)            | `amount_zar`, `price_zar` |
| USD/ZAR rate used    | (in metadata)            | `usd_zar_rate`          |
| rate-lock timestamp  | (in metadata)            | `fx_rate_locked_at`     |
| rate source          | (in metadata)            | `fx_rate_source`        |
| provider             | `provider = 'payfast'`   | `provider`              |
| provider reference   | `provider_reference`     | `provider_reference`, `m_payment_id` |
| status               | `status` (pending → completed) | —                 |
| package id           | `package_id`             | `package_id`            |
| credits              | `token_amount`           | `token_amount`          |
| currency             | `currency = 'ZAR'`       | `currency`              |

**Must fix (data-side check):** the two most recent customer PayFast
rows (2026-06-30 00:10 and 00:15 UTC, `customer_facing=true`,
`smoke_test=false`, `package=single`) carry `amount_usd = 0.00` and
no `price_usd`/`amount_usd` key in metadata — they were inserted by
an earlier deploy of the public-checkout module. The current source
sets `amount_usd: pkg.price_usd` and snapshots `price_usd`/
`amount_usd` into metadata, so a single fresh customer checkout will
confirm the new shape lands in the row. **Classification: must fix —
runtime verification only, no code change.**

## 5. Confirmation and crediting — CONFIRMED

* `payfast-itn/index.ts` is the only path that flips a row to
  `completed` and credits the wallet. It calls
  `processPayfastItn` (`supabase/functions/_shared/payments/payfast.ts`)
  which:
  * verifies the ITN signature against the per-mode passphrase,
  * runs PayFast's `validate` postback,
  * enforces IP allowlist in live mode,
  * only on `payment_status = COMPLETE` calls
    `atomic_paid_credit_purchase` (line 939); other statuses mark the
    purchase but do **not** credit (line 795 comment).
* `idempotency_keys` + `webhook_replay_guard` + the unique
  `(provider, provider_reference)` index prevent duplicate credit on
  repeated ITNs; the orchestrator returns `already_credited` on
  re-delivery.
* `PayfastReturn.tsx` / `PayfastCancel.tsx` are read-only — no DB
  writes, no credit issuance.

## 6. Customer UI — CONFIRMED

`PaymentMethodPicker.tsx` for non-admin sessions:

* `PAYSTACK_PUBLIC_ENABLED = false` → Paystack button hidden unless
  `isAdmin`.
* PayFast button rendered only when probe is `available` (gate +
  live mode + merchant creds + URLs + FX rate all present).
* Shows: USD pack price, ZAR PayFast amount, rate used, and an
  explanatory line ("Credits are priced in USD. PayFast charges the
  ZAR amount shown before payment. The rate is set by Izenzo and
  locked when checkout starts.").
* No `[Admin only]`, no sandbox/smoke wording on the customer surface.
* Unit-tested in `src/tests/payfast-customer-only-view.test.tsx`.

## 7. Admin UI — CONFIRMED

* Admin Billing settings expose `admin_settings.payfast_usd_zar_rate`
  edit + audit trail via `trg_log_admin_settings_change`.
* Admins see Paystack button labelled `[Admin only] Pay $X via
  Paystack` (`data-admin-only="true"`).
* Admin purchase-history surface reads `token_purchases` provider,
  `amount_usd`, metadata `amount_zar` / `usd_zar_rate` /
  `provider_reference`, and `status`.

---

## Findings summary

| # | Item | Status | Class |
|---|------|--------|-------|
| 1 | USD pricing matches $10/$100/$500/$2,000 | ✅ | — |
| 2 | FX rate stored in `admin_settings`, value = 20, admin-only, audited, AAL2 | ✅ | — |
| 3 | Checkout uses stored rate, snapshots, sends ZAR to PayFast | ✅ | — |
| 4 | Token purchase metadata schema | ✅ in source | — |
| 4a | Pre-current-deploy rows show `amount_usd=0.00` for customer attempts | ⚠ data | **must fix — runtime verify with one fresh checkout** |
| 5 | ITN-only crediting + idempotency + return/cancel read-only | ✅ | — |
| 6 | Customer UI: PayFast only, USD + ZAR shown, no Paystack/admin/smoke wording | ✅ | — |
| 7 | Admin UI: FX rate edit, full transaction metadata | ✅ | — |

No blockers. One must-fix verification (item 4a) — runtime confirmation
that the next customer PayFast row carries `amount_usd = 10.00`
(and metadata `price_usd = 10`) for a `single` pack. No code change
required to satisfy it.
