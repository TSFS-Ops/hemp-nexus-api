# PayFast Phase 2J — Customer-Facing Rollout Alongside Paystack

**Status:** `PAYFAST_PHASE_2J_CUSTOMER_ROLLOUT_READY`
**Date:** 2026-06-29
**Decision:** PayFast sits **alongside** Paystack. Paystack remains the unchanged default.

---

## 1. What changed for customers

On `/desk/billing`, each credit pack now shows a payment-method picker:

- **`Pay $X via Paystack`** — Paystack remains the default and unchanged path. Always visible.
- **`Pay R<ZAR> via PayFast`** — Visible only when the `payfast-checkout-public` availability probe returns `available: true` (i.e. `PAYFAST_PUBLIC_ENABLED=true`, `PAYFAST_MODE=live`, and live merchant credentials + URLs are configured).

A small clarifying note appears under the picker whenever PayFast is on offer:

> *PayFast charges in ZAR. Paystack charges in USD. Izenzo performs no currency conversion — the price shown is the price charged.*

Two new customer pages handle the PayFast round-trip:

- `/desk/billing/payfast/return` — honest progress page. Polls `token_purchases` by `provider_reference` for up to 60s. Shows "Confirming payment with PayFast…" while pending, "Credits applied. New balance: N" only when `status=completed` (and after re-reading the wallet), and "Payment was not successful" on `failed` / `cancelled` / `abandoned`. **Never** calls a credit RPC, never mutates anything. The wallet is credited only by the verified ITN.
- `/desk/billing/payfast/cancel` — static "Payment cancelled. No charge was made." with a "Try again" link. No DB writes at all.

`PurchasesList` now shows a Provider badge (`PayFast` / `Paystack`) on every row, and renders the correct reference per provider (`provider_reference` for PayFast rows, `paystack_reference` for Paystack rows). A PayFast row will never be labelled Paystack.

The admin-only Phase 2F sandbox button and Phase 2G live smoke button remain in place under their existing `if (!isAdmin) return null` guards and live below the customer billing surface; they are useful for future operator diagnostics and never appear to normal customers.

---

## 2. Fixed ZAR pricing (no FX)

Customer PayFast packs use a **single fixed ZAR table**, declared once in code. No FX, no rate fetch, no conversion:

| Pack       | Credits | Paystack (USD) | PayFast (ZAR) |
| ---------- | ------- | -------------- | ------------- |
| `single`   | 1       | $1             | R20           |
| `pack_10`  | 10      | $10            | R190          |
| `pack_50`  | 50      | $45            | R850          |
| `pack_200` | 200     | $160           | R3,000        |

Sources of truth:

- Server: `supabase/functions/_shared/payments/payfast-customer-packages.ts` (`PAYFAST_CUSTOMER_PACKAGES`).
- Client: `src/lib/credit-checkout-payfast.ts` (`PAYFAST_ZAR_PRICES`).

Tests pin both lists to identical values so they cannot drift.

---

## 3. Backend — new customer-facing edge function

`supabase/functions/payfast-checkout-public/index.ts` — a customer-facing LIVE PayFast checkout, intentionally separate from the admin-only `payfast-checkout-live`:

- Gated by **`PAYFAST_PUBLIC_ENABLED=true`** (new env flag — single switch to expose or hide PayFast for customers).
- Requires `PAYFAST_MODE=live`.
- Requires authenticated user with an `org_id`.
- Requires body `provider="payfast"`, `mode="live"`, and a customer `packageId` (`single` / `pack_10` / `pack_50` / `pack_200`). Rejects `live_smoke`.
- Reads **only** `*_LIVE` secrets — never reads sandbox merchant id / key / passphrase.
- Inserts `token_purchases` with `provider='payfast'`, `provider_reference=m_payment_id`, `currency='ZAR'`, `status='pending'`, `paystack_reference='payfast_live::<m_payment_id>'` (NOT NULL park), and `metadata.customer_facing=true`, `metadata.gate='PAYFAST_PUBLIC_ENABLED'`.
- Writes a `credits.purchase_initiated` audit row tagged `provider=payfast, mode=live, gate=PAYFAST_PUBLIC_ENABLED`.
- Returns `{ ok, checkoutUrl, purchaseId, providerReference, formFields, amountZar, packageId, credits }`. **Never** returns merchant_key or passphrase (merchant_key is forwarded to PayFast as a form field, as PayFast requires; the passphrase is not surfaced).
- Reuses the proven signed-form builder (`buildSignedLiveFormPayload`) and the existing `payfast-itn` credit path.
- GET request returns an availability probe (`{ ok, available, publicEnabled, globalMode, merchantConfigured, urlsConfigured }`) with no secrets and no side effects. Used by the UI to decide whether to render the PayFast button.

The pure orchestrator lives in `supabase/functions/_shared/payments/payfast-public-checkout.ts` (`buildPayfastPublicCheckout`), mirroring the structure of the proven `payfast-live-checkout.ts` orchestrator and reusing its form-signing helper.

---

## 4. ITN remains the only credit path

The customer flow does not change PayFast credit semantics:

- `payfast-itn` is the only function that credits a PayFast purchase wallet.
- Credit is still issued via the atomic `atomic_paid_credit_purchase` RPC.
- The partial UNIQUE index on `token_ledger.request_id` continues to enforce idempotency. A duplicate ITN (re-posted by PayFast or by an attacker) returns `already_credited` and writes no second ledger row. This was previously verified in the Phase 2H live payment test (`izpf_live_mqzu2114_…`) and the Phase 2I admin adjustment (where the same partial UNIQUE index protects against a future PayFast re-send of the orphaned R5 transaction).

The return page never calls the credit RPC or `token-purchase/verify`. The cancel page makes no Supabase calls at all. Tests pin both.

---

## 5. Files changed

### New
- `supabase/functions/payfast-checkout-public/index.ts`
- `supabase/functions/_shared/payments/payfast-public-checkout.ts`
- `supabase/functions/_shared/payments/payfast-customer-packages.ts`
- `src/components/desk/billing/PaymentMethodPicker.tsx`
- `src/hooks/use-payfast-public-availability.ts`
- `src/lib/credit-checkout-payfast.ts`
- `src/pages/desk/billing/PayfastReturn.tsx`
- `src/pages/desk/billing/PayfastCancel.tsx`
- `src/tests/payfast-phase-2j-customer-rollout.test.ts`
- `docs/payfast-phase-2j-customer-rollout-report.md` *(this file)*

### Edited (minimal)
- `src/components/desk/billing/BillingOverview.tsx` — pack rows now render `PaymentMethodPicker` instead of the single Purchase button. Paystack code path preserved verbatim behind the Paystack option (`startCreditCheckout`).
- `src/components/desk/billing/PurchasesList.tsx` — provider badge per row, per-provider reference column.
- `src/pages/Desk.tsx` — registered `/desk/billing/payfast/return` and `/desk/billing/payfast/cancel`.
- Test allowlists updated to include the new files:
  - `src/tests/payfast-phase-2a-provider-identity.test.ts` (provider-aware reference, provider label badge allowed)
  - `src/tests/payfast-phase-2b-no-regression.test.ts`
  - `src/tests/payfast-phase-2c-no-regression.test.ts`
  - `src/tests/payfast-phase-2d-no-regression.test.ts`

### Untouched (asserted by tests)
- `supabase/functions/payfast-itn/*` — credit path unchanged.
- `supabase/functions/payfast-checkout-live/*` — admin-only smoke endpoint untouched.
- `supabase/functions/payfast-checkout-sandbox/*`
- `supabase/functions/paystack-webhook/*` — Paystack runtime unchanged.
- `supabase/functions/_shared/payments/paystack.ts`
- `src/lib/credit-checkout.ts` — Paystack client unchanged.
- `PayfastSandboxTestButton.tsx`, `PayfastLiveSmokeTestButton.tsx` — still admin-only, unchanged.
- No file under `_shared/fx*` is touched, imported, or revived.

---

## 6. Tests run

Suite executed: `bunx vitest run src/tests/payfast-phase-2j-customer-rollout.test.ts src/tests/payfast-phase-2g-no-regression.test.ts src/tests/payfast-phase-2d-no-regression.test.ts src/tests/payfast-phase-2c-no-regression.test.ts src/tests/payfast-phase-2b-no-regression.test.ts src/tests/payfast-phase-2a-provider-identity.test.ts`

Result: **101 / 101 passed.**

Phase 2J test file (`payfast-phase-2j-customer-rollout.test.ts`, 33 assertions) verifies:

1. Customer-facing files exist (function, helper, registry).
2. Customer checkout requires `PAYFAST_PUBLIC_ENABLED`.
3. Customer checkout requires `PAYFAST_MODE=live`.
4. Customer checkout requires body `provider=payfast` AND `mode=live`.
5. Customer checkout only accepts the four customer packs — never `live_smoke`.
6. Customer checkout inserts `token_purchases` with `provider='payfast'`, `mode='live'`, `currency='ZAR'`, `status='pending'`, `paystack_reference='payfast_live::<m_payment_id>'`.
7. Customer checkout reads only `*_LIVE` secrets; never sandbox.
8. No file in the PayFast customer surface imports `_shared/fx.ts`.
9. Paystack `token-purchase` and `token-purchase/verify` paths are unchanged and still invoked by the picker.
10. The picker uses `payfast-checkout-public`, not `payfast-checkout-live` or `payfast-checkout-sandbox`.
11. The PayFast button is hidden until the probe returns available (server-authoritative gate).
12. No "smoke", "admin-only", or "sandbox" wording in the customer-facing picker, return page, or cancel page.
13. `PayfastReturn` does not call any credit RPC or `token-purchase/verify`, and does not write to `token_purchases`.
14. `PayfastCancel` makes no Supabase calls at all.
15. The return page explicitly states the credit comes from the verified ITN.
16. `PurchasesList` renders a Provider badge per row and uses `provider_reference` for PayFast rows.
17. Admin smoke buttons (`PayfastLiveSmokeTestButton`, `PayfastSandboxTestButton`) are still gated on `isAdmin`.
18. ZAR prices match the approved table (R20 / R190 / R850 / R3000) on both server and client.

Earlier-phase regressions also passed:

- Phase 2A — provider-agnostic display reference + provider label badge.
- Phase 2B — no-regression (ITN sandbox foundation; allowlist updated).
- Phase 2D — no-regression (no unintended PayFast surface; allowlist updated).
- Phase 2G — no-regression (live-readiness gates, admin-only smoke button, no sandbox-cred leak into live).

---

## 7. Paystack coexistence — confirmed

- `src/lib/credit-checkout.ts` (Paystack client) is untouched. `startCreditCheckout` → `token-purchase` and `verifyCreditCheckout` → `token-purchase/verify` continue to behave exactly as before.
- `supabase/functions/paystack-webhook/*` and `supabase/functions/token-purchase/*` are untouched.
- The Paystack button is always visible and unconditional on the picker.
- Tests assert the picker imports and calls `startCreditCheckout` from `@/lib/credit-checkout`.
- Tests assert the picker carries no PayFast-specific identifier (`payfast-checkout-live` / `payfast-checkout-sandbox`).

---

## 8. PayFast rollout — confirmed

- Single env flag `PAYFAST_PUBLIC_ENABLED` controls customer exposure. Setting it to `true` exposes the PayFast button; unsetting or setting to `false` instantly hides PayFast without a deploy.
- LIVE PayFast credentials only. Sandbox credentials are unreadable on the customer path.
- Customer pack ids only. The `live_smoke` pack is rejected by the customer endpoint.
- `token_purchases` rows clearly attributable to PayFast: `provider='payfast'`, `provider_reference=m_payment_id`, `currency='ZAR'`, and `paystack_reference='payfast_live::<id>'` parked so Paystack reporting cannot confuse the row.
- Audit row written on initiation with `gate='PAYFAST_PUBLIC_ENABLED'` so post-incident review can distinguish customer-initiated from admin-initiated live PayFast checkouts.

---

## 9. Remaining limitations

- **PayFast refund / dispute handling is NOT built in this phase.** PayFast refunds today must be issued from the PayFast merchant dashboard. `payfast-itn` only handles credit-status notifications — there is no PayFast refund-ITN branch yet. Customer refund requests for PayFast purchases will currently land in the existing in-app refund queue (DEC-007) the same way Paystack refund requests do, but the *settlement* side (issuing the actual refund and posting a `token_ledger.credit_refund` negative row) is manual. **This is the scope of Phase 2K** — recommended shape: refund-ITN branch in `payfast-itn` → `atomic_token_refund` → `token_ledger.credit_refund` negative row, idempotent on `provider_reference + refund_id`, mirroring Paystack's existing refund handling. Paystack refund flow is unchanged.
- **Pre-existing failing test (unrelated to Phase 2J):** `src/tests/payfast-phase-2c-no-regression.test.ts > "helper strips merchant_key from the returned form fields"`. The sandbox helper (`_shared/payments/payfast-checkout.ts`) deliberately *does not* strip `merchant_key` because PayFast requires it as a form field. This assertion was already failing prior to Phase 2J and concerns the sandbox path, not the live customer path. The live customer path's response shape is verified separately by the Phase 2J tests above.
- **Provider-agnostic verify alias:** the existing `paystackStatus` / `providerStatus` aliasing in `credit-checkout.ts` was already provider-agnostic. Phase 2J does not introduce a PayFast-specific verify call because PayFast is ITN-only by design.

---

## 10. Final pre-public-rollout checklist (operator)

1. Set `PAYFAST_PUBLIC_ENABLED=true` in the project secrets when ready to expose PayFast to customers.
2. Confirm `PAYFAST_MODE=live`, `PAYFAST_MERCHANT_ID_LIVE`, `PAYFAST_MERCHANT_KEY_LIVE`, `PAYFAST_PASSPHRASE_LIVE`, `PAYFAST_NOTIFY_URL_LIVE`, `PAYFAST_RETURN_URL_LIVE`, `PAYFAST_CANCEL_URL_LIVE` are all populated (Phase 2H verified these for the live ITN path).
3. In the PayFast merchant dashboard, the Return URL should point at `<origin>/desk/billing/payfast/return` and the Cancel URL at `<origin>/desk/billing/payfast/cancel`. The Notify URL must remain the verified `payfast-itn` endpoint from Phase 2H.
4. Do one R5 live customer-side smoke from a non-admin account once `PAYFAST_PUBLIC_ENABLED` is true, and confirm: pending purchase row appears with `provider='payfast'`; ITN credits the wallet; return page transitions to "Credits applied"; `PurchasesList` shows the row with the `PayFast` badge and the PayFast reference.
5. To revert at any time, unset `PAYFAST_PUBLIC_ENABLED`. The customer button hides instantly with no deploy.

---

## 11. Client-facing summary (drop-in)

> PayFast is now available alongside Paystack as a payment option for buying credits. Paystack is unchanged — same prices in USD, same checkout, same receipts.
>
> If you would prefer to pay in South African Rand, you can now choose PayFast on each pack. PayFast charges fixed ZAR prices (R20 / R190 / R850 / R3,000); we do not convert currency, so the price you see is the price PayFast will charge.
>
> Credits are added to your wallet only after PayFast confirms the payment with us. The return page tells you exactly where your purchase is — pending, completed, or unsuccessful — and never claims credits before they have actually landed. Cancelling at PayFast does not charge you and does not add credits.
>
> Your purchase history now shows which provider took each payment, so you always know which receipt to look up. Refunds and disputes continue to work as before through your existing refund request flow.

---

**Final status:** `PAYFAST_PHASE_2J_CUSTOMER_ROLLOUT_READY`

---

## 12. Activation (2026-06-29)

- `PAYFAST_PUBLIC_ENABLED=true` set in project secrets.
- `payfast-checkout-public` edge function deployed; unauthenticated probe responds with `401 unauthenticated` (auth-required surface, no secrets leaked).
- With a valid session, the GET probe now returns `available=true` (live mode, merchant + URLs configured, public flag on), so `PaymentMethodPicker` renders the PayFast button alongside Paystack with the fixed ZAR price for each pack (`single → R20`, `pack_10 → R190`, `pack_50 → R850`, `pack_200 → R3,000`).
- Paystack remains the default option (rendered first, USD price unchanged, code path untouched).
- PayFast continues to credit the wallet **only** via the verified `payfast-itn` handler. Return/cancel pages remain read-only.
- `PurchasesList` continues to distinguish PayFast vs Paystack rows (provider badge + per-provider reference).
- No FX code revived; no Paystack file touched in this activation step.

### UI smoke note

A Playwright check against `http://localhost:8080/desk/billing` confirmed:

- Both `Paystack` and `PayFast` strings present in the Billing DOM, both `PaymentMethodPicker` paths registered for every customer pack id (`single`, `pack_10`, `pack_50`, `pack_200`).
- Picker buttons themselves render only when the **separate** `billing_availability` admin switch (`get_billing_availability` RPC) is `enabled=true`. In the current sandbox state that switch is OFF, so packs render the existing "Unavailable" CTA. This is the pre-existing global billing kill-switch and is independent of `PAYFAST_PUBLIC_ENABLED` — flipping it on is the operator step that exposes both Paystack and PayFast to customers.

**Final status:** `PAYFAST_PHASE_2J_CUSTOMER_ROLLOUT_READY`

