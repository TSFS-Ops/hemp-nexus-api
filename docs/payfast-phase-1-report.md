# PayFast Integration — Phase 1 Report

**Status:** ✅ Phase 1 complete. Scaffolding only. Zero behaviour change.
**Date:** 2026-06-27
**Scope of this phase:** Prepare the codebase to host more than one payment provider without touching Paystack's live request path, wallet, ledger, audit trail, idempotency, or reconciliation behaviour.

---

## 1. Files changed

All new files. **No existing file was modified.**

| Path | Purpose |
| --- | --- |
| `supabase/functions/_shared/payments/provider.ts` | `PaymentProvider` interface, `PaymentProviderId` (`"paystack" \| "payfast"`), `ProviderCurrency` (`"USD" \| "ZAR"`). |
| `supabase/functions/_shared/payments/paystack.ts` | Paystack provider descriptor (`PAYSTACK_PROVIDER`), `readPaystackSecret()`, pure `verifyPaystackSignature()` helper. Façade only — not wired into the live path. |
| `supabase/functions/_shared/payments/select.ts` | Provider registry + `selectProvider()`, `defaultProvider()`, `listLiveProviders()`. PayFast is intentionally `undefined` so any accidental call throws. |
| `supabase/functions/_shared/payments/reference.ts` | Provider-agnostic metadata helpers: `buildProviderMetadata()`, `readProviderReference()`, `readProviderId()`. Canonical keys: `metadata.provider`, `metadata.provider_reference`. |
| `src/tests/payments-provider-abstraction-phase1.test.ts` | 13 unit tests on the new scaffolding. |
| `src/tests/payments-paystack-no-regression-phase1.test.ts` | 16 source-text guards proving Paystack inline behaviour is unchanged and that the new scaffolding is **not** wired into the live path yet. |

## 2. Files inspected but not changed

| Path | Notes |
| --- | --- |
| `supabase/functions/token-purchase/index.ts` (2 703 lines) | Canonical Paystack handler. Initiation, `/verify`, `/webhook`, `/packages`, `/entity` routes — all left untouched. Continues to read `PAYSTACK_SECRET_KEY`, post to `https://api.paystack.co/transaction/initialize`, verify via `…/transaction/verify/{ref}`, validate HMAC-SHA512 on webhooks, write `provider: "paystack"` to metadata, key `token_purchases` by `paystack_reference`, settle in USD with `fx_basis: "native_usd"`, credit via `atomic_paid_credit_purchase`, and gate on `get_billing_availability`. |
| `supabase/functions/paystack-webhook/index.ts` (120 lines) | Dedicated Paystack webhook entry point. Still verifies HMAC-SHA512 and forwards to `…/functions/v1/token-purchase/webhook`. |
| `supabase/functions/transaction-reconciliation/index.ts` | Reconciliation cron — unchanged. Still calls `atomic_paid_credit_purchase` with `p_reference_id: purchase.paystack_reference` and `p_endpoint: "payment:paystack:reconciliation"`. |
| `src/lib/credit-checkout.ts` | Client-side Paystack helper — unchanged. Already provider-agnostic at the response shape level (`providerStatus`, `verifyInconclusive`). |
| `supabase/functions/token-purchase/index.ts` (lines 1100–1310) | Missing-metadata recovery already searches `metadata->>provider_reference` in addition to `paystack_reference` and `metadata->>payment_reference` — so the forward-compatible key is already part of recovery. |

## 3. Tests added

29 new tests across 2 files. All pass.

```
✓ src/tests/payments-paystack-no-regression-phase1.test.ts  (16 tests)
✓ src/tests/payments-provider-abstraction-phase1.test.ts    (13 tests)
```

## 4. Tests run

Re-ran the new tests plus every existing payment-system guard:

```
✓ payments-provider-abstraction-phase1                   13/13
✓ payments-paystack-no-regression-phase1                 16/16
✓ payment-metadata-recovery-payfast-ready                15/15
✓ paystack-webhook-missing-metadata-containment           9/9
✓ paystack-init-rejection-releases-idempotency            5/5
✓ token-purchase-billing-availability-source              5/5
────────────────────────────────────────────────────────────
TOTAL                                                    63/63 PASS
```

## 5. Behaviour confirmations

- ✅ **Paystack behaviour unchanged.** No live file edited. Initiation, verify, webhook signature verification, idempotency, `atomic_paid_credit_purchase` crediting, USD settlement, billing-availability guard and reconciliation all confirmed by source-text guards.
- ✅ **No PayFast live path exposed.** `PAYFAST_*` env vars are not referenced anywhere. No `payfast-itn` route exists. `selectProvider("payfast")` throws.
- ✅ **No secrets touched.** No `add_secret`, `set_secret`, `generate_secret` calls. No PayFast credentials added.
- ✅ **No migrations created.** Phase 2 recommendation below — not executed.
- ✅ **FX helper not revived.** `supabase/functions/_shared/fx.ts` is not imported anywhere in `token-purchase/index.ts` (guarded by test).
- ✅ **Customer-facing PayFast checkout not visible.** No UI changes.

## 6. Duplicate webhook receiver inspection

There are two Paystack-related receivers today, and **both are live and intentional**:

| Function | Route | Role | Recommendation |
| --- | --- | --- | --- |
| `token-purchase/index.ts` | `POST /functions/v1/token-purchase/webhook` | **Canonical handler.** All business logic lives here: signature verify, replay guard, initiation-mismatch validation, `atomic_paid_credit_purchase`, missing-metadata recovery, dispute / refund flows. | **Keep.** Source of truth. |
| `paystack-webhook/index.ts` | `POST /functions/v1/paystack-webhook` | **Thin façade.** Verifies HMAC-SHA512 then forwards the unchanged body + signature to `token-purchase/webhook`. Exists so Paystack can be pointed at a clean provider-named URL and so `verify_jwt = false` has a smaller blast radius. | **Keep.** Not stale. |

Both URLs are valid Paystack webhook targets. Whichever URL is configured in the Paystack dashboard today is correct — the downstream behaviour is identical because `paystack-webhook` forwards verbatim. Confirming which one is registered is an operator task (Paystack dashboard → Settings → API Keys & Webhooks); not a code question.

**No deletion or merge is recommended in Phase 1.** A future cleanup phase (post-PayFast) could optionally collapse `paystack-webhook` into a re-export, but doing so now would couple cleanup risk to PayFast rollout risk. Leave them as-is.

## 7. Phase 2 migration recommendation (not executed)

When Phase 2 begins, the recommended database change for `public.token_purchases` is:

```sql
-- Phase 2 (DRAFT — DO NOT RUN YET)
ALTER TABLE public.token_purchases
  ADD COLUMN provider           TEXT,
  ADD COLUMN provider_reference TEXT;

-- Backfill historical rows as Paystack — every existing row predates PayFast.
UPDATE public.token_purchases
   SET provider           = 'paystack',
       provider_reference = paystack_reference
 WHERE provider IS NULL;

ALTER TABLE public.token_purchases
  ALTER COLUMN provider           SET NOT NULL,
  ALTER COLUMN provider_reference SET NOT NULL;

-- Cross-provider uniqueness (replaces the implicit Paystack-only uniqueness
-- with a provider-scoped one). Keep the original UNIQUE(paystack_reference)
-- in place — it continues to protect historical Paystack rows.
CREATE UNIQUE INDEX IF NOT EXISTS token_purchases_provider_reference_uniq
  ON public.token_purchases (provider, provider_reference);
```

**Key rules for Phase 2 DB work:**

1. **`paystack_reference` MUST be kept.** Every historical paid customer row is keyed on it; the reconciliation cron, the missing-metadata recovery path, the dispute path, and `src/lib/credit-checkout.ts` all read it. Dropping or renaming it would break history. The new `provider_reference` column is **additive**, not a replacement.
2. **Backfill is safe** because PayFast is not live — every existing row is a Paystack row.
3. **The new unique index is `(provider, provider_reference)`** so PayFast can reuse the same reference shape as Paystack without collision risk, while still rejecting same-provider duplicates.
4. **No `provider` enum.** Keep it as `TEXT` with an application-level allow-list (`'paystack' | 'payfast'`) so adding a third provider does not require a migration.
5. **No data deletion. No column rename. No drop of `UNIQUE(paystack_reference)`.** History stays intact.

## 8. Phase 2 next step (preview, not actioned)

Phase 2 will:

- Register the `PayfastProvider` in `select.ts` with `liveEnabled: false` until sandbox is signed off.
- Add a separate `supabase/functions/payfast-itn/` function with PayFast's own signature/post-back/replay-guard pipeline (different format from Paystack — must not share the Paystack webhook code path).
- Credit through the same `atomic_paid_credit_purchase` RPC with `p_provider: "payfast"` and `p_reference_id: <pf_payment_id>`.
- Run the migration above before any ITN row is written.
- Stay sandbox-only until ITN replay, duplicate-delivery, and crash-mid-credit cases are proven in tests.

**Phase 2 is not started.** This phase ends here.

---

## Acceptance criteria — final check

| Criterion | Status |
| --- | --- |
| All existing payment tests pass | ✅ 34/34 |
| New provider-abstraction tests pass | ✅ 29/29 |
| Paystack remains the only active provider | ✅ `listLiveProviders() === ["paystack"]` |
| No customer-facing PayFast checkout visible | ✅ No UI changes |
| No live payment state changed | ✅ No edits to live files |
| No FX code revived | ✅ Guarded by test |
| No Paystack historical record handling broken | ✅ `paystack_reference` untouched |
