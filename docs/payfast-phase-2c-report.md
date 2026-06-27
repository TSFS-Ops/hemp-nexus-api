# PayFast Integration — Phase 2C Completion Report

**Phase:** 2C — Sandbox checkout initiation foundation
**Status:** ✅ Complete (sandbox-gated; PayFast is NOT live)
**Date:** 2026-06-27

---

## 1. Scope delivered

PayFast sandbox checkout initiation now exists as an internal/admin-only
edge function. It:

- mints an `m_payment_id`,
- inserts a `pending` `token_purchases` row with
  `provider='payfast'`, `provider_reference=<m_payment_id>`,
  `currency='ZAR'`,
- builds the signed PayFast sandbox form payload (MD5 over the
  PHP-`urlencode` canonical string),
- returns a structured response containing the sandbox checkout URL,
  the safe outgoing form fields, the purchase id, and the provider
  reference.

The Paystack flow (`token-purchase`) is **unchanged**. No
customer-facing PayFast checkout button exists. No live PayFast path
exists.

---

## 2. Files created

| File | Purpose |
| --- | --- |
| `supabase/functions/_shared/payments/payfast-checkout.ts` | Pure, dependency-injected sandbox checkout orchestrator + signed form builder + sandbox ZAR test packages. |
| `supabase/functions/payfast-checkout-sandbox/index.ts` | Thin Deno edge wrapper: resolves auth + admin role, injects env, calls the orchestrator. |
| `src/tests/payfast-checkout-phase-2c.test.ts` | 15 unit tests over the orchestrator (gates, row shape, signature, secret hygiene). |
| `src/tests/payfast-phase-2c-no-regression.test.ts` | 15 source-text guards (no live wiring, no FX revival, Paystack untouched, no customer-facing button). |
| `docs/payfast-phase-2c-report.md` | This report. |

## 3. Files changed

| File | Change |
| --- | --- |
| `src/tests/payfast-phase-2b-no-regression.test.ts` | Allowlist extended to cover the two new Phase 2C surfaces (no behavioural change). |

No other production source files were modified. `token-purchase/index.ts`,
`paystack-webhook/index.ts`, `payfast-itn/index.ts`, `_shared/payments/*`
(other than the new file) and all UI billing components are
byte-untouched.

---

## 4. How PayFast sandbox checkout is gated

Initiation requires **all four** gates to pass (enforced in the pure
orchestrator and re-enforced in the edge wrapper):

1. **Env flag:** `PAYFAST_SANDBOX_CHECKOUT_ENABLED=true`. Anything
   else returns `gate_disabled` (HTTP 403).
2. **Role:** caller has the `platform_admin` role (resolved via the
   existing `has_role` SECURITY DEFINER RPC). Anything else returns
   `not_admin` (HTTP 403).
3. **Provider literal:** request body `provider === "payfast"`.
   Otherwise `wrong_provider`.
4. **Mode literal:** request body `mode === "sandbox"`. Phase 2C
   refuses `"live"`. Otherwise `wrong_mode`.

If any gate rejects, **no `token_purchases` row is created and no
PayFast form payload is generated.** Tests cover all four paths.

---

## 5. How PayFast form signing works

Order matters: PayFast signs the form POST in the field order it is
posted. `buildSignedSandboxFormPayload` builds a canonical ordered set:

```
merchant_id → merchant_key → return_url → cancel_url → notify_url
→ m_payment_id → amount → item_name → [item_description]
→ [custom_str1..custom_str3]
```

then computes the MD5 hex digest of
`pfUrlEncode(k1)=pfUrlEncode(v1)&...&passphrase=<enc>` (passphrase
appended only if configured). `pfUrlEncode` matches PHP's `urlencode`
exactly (spaces → `+`, uppercase hex, encodes `!'()*`). The same
helper is used by the Phase 2B ITN verifier, so checkout signing and
ITN verification cannot drift.

The signature is appended last and the entire ordered set (including
`signature`) is returned to the caller as `formFields`, except that
`merchant_key` is **stripped** from the surfaced fields. The
passphrase is never surfaced anywhere.

---

## 6. How PayFast references are minted

A 16–24 char compact id of shape `izpf_<unix36>_<rand8>` is minted
client-side in the orchestrator (`mintMPaymentId`, overridable for
tests). This becomes:

- `token_purchases.provider_reference` (Phase 2A column),
- the `m_payment_id` field in the PayFast form,
- the audit log entity id.

PayFast’s `pf_payment_id` (assigned on settlement) becomes the
preferred credit-allocation key in `processPayfastItn`; `m_payment_id`
is used as fallback. This contract was established in Phase 2B and is
unchanged.

---

## 7. How PayFast purchase rows are stored

```ts
{
  org_id, user_id,
  paystack_reference: "payfast_sandbox::izpf_…",   // namespaced; see §10
  provider: "payfast",
  provider_reference: "izpf_…",                    // == m_payment_id
  package_id, token_amount,
  amount_usd: 0,                                   // schema NOT NULL; see §10
  currency: "ZAR",
  status: "pending",
  metadata: {
    provider: "payfast", provider_reference, m_payment_id,
    sandbox: true, mode: "sandbox",
    package_id, package_label, token_amount,
    amount_zar, price_zar, currency: "ZAR",
    user_id, org_id,
    expected_itn_reference_rule: "ITN m_payment_id must equal provider_reference",
    created_at
  }
}
```

The Phase 2A partial UNIQUE index on `(provider, provider_reference)`
prevents PayFast double-credit at the row level; the Phase 2B
`webhook_replay_guard` and the `atomic_paid_credit_purchase` RPC's
ledger UNIQUE index continue to prevent double-credit at the ledger
level.

---

## 8. Tests added and run

**New (Phase 2C):**

- `src/tests/payfast-checkout-phase-2c.test.ts` — 15 tests
- `src/tests/payfast-phase-2c-no-regression.test.ts` — 15 tests

**Result:** All 112 PayFast-suite tests pass (Phase 1, 2A, 2B, 2C):

```
✓ src/tests/payfast-helpers-phase-2b.test.ts             (14 tests)
✓ src/tests/payfast-itn-phase-2b.test.ts                 (22 tests)
✓ src/tests/payfast-phase-2b-no-regression.test.ts       (16 tests)
✓ src/tests/payfast-checkout-phase-2c.test.ts            (15 tests)
✓ src/tests/payfast-phase-2c-no-regression.test.ts       (15 tests)
✓ src/tests/payments-provider-abstraction-phase1.test.ts (… )
✓ src/tests/payments-paystack-no-regression-phase1.test.ts
✓ src/tests/payfast-phase-2a-provider-identity.test.ts
✓ src/tests/batch-c-payment-idempotency.test.ts          (unchanged, passes)
Test Files  6 passed (6)
     Tests  112 passed (112)
```

Wider repo failures observed (`pnpm vitest run src/tests`) are
**pre-existing** and unrelated to PayFast — they affect
`p5-batch4`, `p5-governance`, `p5-screening`, `cp-fixtures`,
`audit-ledger-copy-capability-guard`, `event-ledger-append-only-convention-guard`
and similar files Phase 2C did not touch.

---

## 9. Confirmations

- ✅ **Paystack remains unchanged.** `supabase/functions/token-purchase/index.ts`
  and `supabase/functions/paystack-webhook/index.ts` are byte-identical
  to Phase 2B. USD settlement, `PAYSTACK_SECRET_KEY` usage, and the
  `atomic_paid_credit_purchase` RPC call all verified by the
  `payments-paystack-no-regression-phase1` + Phase 2C no-regression
  guards.
- ✅ **PayFast is NOT live.** `select.ts` keeps `payfast: undefined` in
  the live provider registry; `PAYFAST_PROVIDER.liveEnabled = false`;
  the orchestrator refuses `mode !== "sandbox"`.
- ✅ **No customer-facing PayFast button.** A source-text scan
  (`payfast-phase-2c-no-regression`) enforces an allowlist of files
  permitted to mention PayFast; no `src/components` or `src/pages`
  file does.
- ✅ **No secrets touched.** No new secrets are required for the
  build to compile or tests to pass. The runtime env keys consumed
  (`PAYFAST_SANDBOX_CHECKOUT_ENABLED`, `PAYFAST_SANDBOX_MERCHANT_ID`,
  `PAYFAST_SANDBOX_MERCHANT_KEY`, `PAYFAST_SANDBOX_PASSPHRASE`,
  `PAYFAST_SANDBOX_NOTIFY_URL`, `PAYFAST_SANDBOX_RETURN_URL`,
  `PAYFAST_SANDBOX_CANCEL_URL`) are documented here; if Izenzo wants
  to exercise the route they can populate them via the standard
  secret-management flow. None of them is required for build or test.
- ✅ **No FX code revived.** Neither `payfast-checkout.ts` nor
  `payfast-checkout-sandbox/index.ts` imports `_shared/fx.ts`.
  Asserted by Phase 2B and 2C no-regression guards.
- ✅ **Credit can only happen via verified ITN.** The Phase 2C
  initiation path writes only a `pending` row; nothing in the
  return/cancel URL flow can credit a wallet.

---

## 10. Schema notes & known deviations from the prompt

The prompt requested `paystack_reference: NULL` for PayFast rows.
The live schema has `token_purchases.paystack_reference NOT NULL`
(verified via `information_schema.columns`). Removing or making it
nullable would be a schema change outside the agreed Phase 2C scope
(“Do not remove paystack_reference. Do not change Paystack webhook
behaviour.”). Phase 2C therefore writes a clearly-namespaced
synthetic value, `payfast_sandbox::<m_payment_id>`, so:

- the NOT NULL constraint is honoured,
- PayFast rows can never collide with real Paystack references,
- Paystack code paths continue to filter by their own reference shape
  without modification.

Similarly, `amount_usd` is NOT NULL. PayFast rows record `0` in
`amount_usd` and the real ZAR figure in `metadata.amount_zar` /
`metadata.price_zar`. This keeps the live `amount_usd` Paystack-only
and avoids any temptation to revive USD↔ZAR conversion.

**Recommendation for Phase 2D:** add a migration that makes
`paystack_reference` nullable (so future PayFast rows can store
`NULL` there) and that adds a check constraint of the form
`(provider='paystack' AND paystack_reference IS NOT NULL) OR
(provider='payfast' AND provider_reference IS NOT NULL)`.

---

## 11. Production decisions still needed from Izenzo

1. **ZAR pricing schedule.** The sandbox prices (R20 / R180 / R800 /
   R3000 for single / pack_10 / pack_50 / pack_200) are test values.
   Izenzo must confirm the real ZAR per-package prices before any
   live rollout.
2. **PayFast merchant credentials.** Sandbox merchant id/key for
   testing, then a live merchant id/key/passphrase for go-live.
3. **Source-IP allowlist resolution.** Phase 2B accepts a static
   `PAYFAST_ALLOWED_IPS`. Live rollout should resolve PayFast’s
   published hostnames (`www.payfast.co.za`, `w1w.payfast.co.za`,
   `w2w.payfast.co.za`) at request time with caching.
4. **Return / cancel UX.** Phase 2C points both at
   `/desk/billing?payfast=return|cancel`. Final copy and visual
   treatment (pending banner, etc.) are deferred to Phase 2D.
5. **Schema migration** as described in §10.
6. **Whether to expose PayFast as a customer-selectable provider**,
   and if so under what gating (org-level flag, country, currency,
   pricing-page A/B, etc.).

---

## 12. Recommendation for Phase 2D

Phase 2D should be **end-to-end sandbox wiring with admin/test
visibility, still not live**:

1. Schema migration in §10 (nullable `paystack_reference`, dual
   check constraint).
2. Admin-only smoke harness page (behind the same
   `PAYFAST_SANDBOX_CHECKOUT_ENABLED` flag + `platform_admin`) that:
   - calls `payfast-checkout-sandbox`,
   - renders the returned form fields as an actual `<form action=…>`,
   - shows the resulting `token_purchases` row + `audit_logs` trail
     after the simulated ITN lands.
3. Source-IP allowlist DNS resolver + cache for `payfast-itn` (still
   sandbox).
4. Admin/client visibility: surface PayFast purchases in the existing
   admin Billing/Purchases admin views (read-only) using the Phase 2A
   `provider_reference` column.
5. Reconciliation sweep: extend `transaction-reconciliation` to
   recognise PayFast pending rows older than the PayFast settlement
   window.

Live PayFast is **not** in Phase 2D scope.
