# PayFast Phase 2D — Sandbox End-to-End Wiring & Visibility

**Status:** ✅ Complete.
**Date:** 2026-06-27.
**Scope:** Stitch Phase 2C (sandbox checkout initiation) and Phase 2B
(PayFast ITN handler) into one verifiable end-to-end loop, prove the
admin/client purchase-history surface renders PayFast rows correctly,
and confirm — at the source level — that no live customer-facing
PayFast surface exists yet.

---

## 1. What changed

No production code paths were modified in Phase 2D. The phase is a
**verification and visibility** milestone built on the helpers and
edge functions that already shipped in Phases 2A → 2C.

### Files added

- `src/tests/payfast-phase-2d-end-to-end.test.ts`
  Drives the full sandbox loop in-memory:
  `buildPayfastSandboxCheckout()` → pending `token_purchases` row →
  `processPayfastItn()` → wallet credit via
  `atomic_paid_credit_purchase`. Also renders `PurchasesList` with a
  PayFast row + a Paystack row side-by-side.
- `src/tests/payfast-phase-2d-no-regression.test.ts`
  Source-text guard suite asserting: Paystack runtime untouched,
  PayFast not registered live, no FX revival, no customer-facing
  PayFast surface in `src/components` or `src/pages`.
- `docs/payfast-phase-2d-report.md` (this file).

### Files NOT touched in Phase 2D

- `supabase/functions/token-purchase/index.ts` — Paystack live path.
- `supabase/functions/paystack-webhook/index.ts` — Paystack inbound.
- `supabase/functions/_shared/payments/payfast.ts` — Phase 2B helper.
- `supabase/functions/_shared/payments/payfast-checkout.ts` — Phase 2C.
- `supabase/functions/payfast-itn/index.ts` — Phase 2B edge entry.
- `supabase/functions/payfast-checkout-sandbox/index.ts` — Phase 2C edge.
- `src/components/desk/billing/PurchasesList.tsx` — already
  provider-aware after Phase 2A; no further change needed.

---

## 2. End-to-end flow under test

```
┌────────────────────────┐    ┌──────────────────────────┐    ┌────────────────────────────┐
│ buildPayfastSandbox    │───▶│ token_purchases (pending,│───▶│ processPayfastItn (COMPLETE)│
│ Checkout (admin/gate)  │    │  provider='payfast',     │    │  → validate post-back       │
│                        │    │  currency='ZAR')         │    │  → signature + IP + replay  │
└────────────────────────┘    └──────────────────────────┘    │  → atomic_paid_credit_purchase│
                                                              │  → status='completed'        │
                                                              └────────────────────────────┘
```

### Verified test cases

1. **Happy path.** Sandbox checkout produces a pending row, ITN COMPLETE
   matching m_payment_id + amount + custom_str1 → wallet credited
   exactly once (`atomic_paid_credit_purchase` called once with
   `p_org_id`, `p_amount = credits`), purchase row updated to
   `completed`, `credits.purchased` audit row written.
2. **Duplicate ITN.** Same body delivered twice → first credited,
   second rejected with `reason: "replay_detected"`. Only one RPC
   call.
3. **Mismatched ITN.** Same provider_reference but `amount_gross` set
   to `1.00` (expected `180.00`) → `decision: "rejected"`,
   `reason: "amount_mismatch"`, NO RPC call, an
   `admin_risk_items.kind = "payfast_itn_rejected"` row is logged,
   purchase row remains `pending`.
4. **Admin/client visibility.** `PurchasesList` renders a PayFast row
   showing `provider_reference` (the `m_payment_id`, not the namespaced
   `payfast_sandbox::…` placeholder) with `title="Payment provider:
   payfast"`, alongside an unrelated Paystack row that still shows its
   `paystack_reference`.

---

## 3. Test runs

```
src/tests/payfast-phase-2a-provider-identity.test.ts        ✅ pass
src/tests/payfast-helpers-phase-2b.test.ts                  ✅ pass
src/tests/payfast-itn-phase-2b.test.ts                      ✅ pass
src/tests/payfast-phase-2b-no-regression.test.ts            ✅ pass
src/tests/payfast-checkout-phase-2c.test.ts                 ✅ pass
src/tests/payfast-phase-2c-no-regression.test.ts            ✅ pass
src/tests/payfast-phase-2d-end-to-end.test.ts               ✅ pass
src/tests/payfast-phase-2d-no-regression.test.ts            ✅ pass
src/tests/payment-metadata-recovery-payfast-ready.test.ts   ✅ pass
src/tests/batch-c-payment-idempotency.test.ts               ✅ pass
```

All existing payment regression suites continue to pass. The Paystack
inline path (`token-purchase`, `paystack-webhook`) was not edited.

---

## 4. Safety confirmations

| Guarantee                                                | Evidence                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| PayFast still not live                                   | `select.ts` keeps `payfast: undefined`; `PAYFAST_PROVIDER.liveEnabled === false`        |
| No customer-facing PayFast button                        | rg scan of `src/` allowlisted only to `PurchasesList.tsx` + types; no buy/CTA surfaces  |
| Paystack untouched                                       | `token-purchase` still `currency: "USD"`, `fx_basis: "native_usd"`, PAYSTACK_SECRET_KEY |
| No FX code revived                                       | `payfast.ts` and `payfast-checkout.ts` do not import `_shared/fx.ts`                    |
| No secrets touched                                       | Phase 2D added no env vars and no `add_secret` calls                                    |
| Sandbox checkout + valid COMPLETE ITN credits wallet once| End-to-end test §1 — single `atomic_paid_credit_purchase` invocation                    |
| Duplicate ITN does not double-credit                     | End-to-end test §2 — `replay_detected` on second delivery                               |
| Mismatched ITN does not credit and is risk-logged        | End-to-end test §3 — `admin_risk_items.kind = "payfast_itn_rejected"`                   |
| Admin/client purchase history shows PayFast rows         | End-to-end test §4 — PurchasesList renders PayFast + Paystack rows correctly            |

---

## 5. Recommendation for next phase

Phase 2D is the right point to **stop and run a professional QA /
embarrassment-prevention pass** before any live PayFast credential is
introduced. Specifically, before Phase 3 (live enablement):

1. Confirm Izenzo-supplied live ZAR pricing schedule (the sandbox
   prices in `PAYFAST_SANDBOX_PACKAGES` are placeholders).
2. Confirm PayFast live merchant ID, key, passphrase, allowlisted
   notify-URL IPs — these will be added via `add_secret` only at the
   moment Phase 3 begins.
3. QA review the admin-only sandbox edge function
   (`payfast-checkout-sandbox`) for response shape, error codes, and
   audit-log completeness against the Phase 2C report.
4. Schema review: confirm whether `paystack_reference` and `amount_usd`
   NOT NULL constraints should be relaxed (currently bridged with
   `payfast_sandbox::…` and `0` respectively). This is a Phase 3
   migration candidate, not Phase 2D.

No live PayFast work should begin until this QA pass is signed off.
