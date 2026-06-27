# PayFast Integration — Phase 2E Professional QA / Readiness Audit

**Date:** 2026-06-27
**Auditor mode:** Inspection + test only. No live wiring, no secrets, no customer surface added.
**Result:** ✅ **PASS — Ready for controlled sandbox dashboard configuration.**

---

## 1. Scope

End-to-end readiness audit across Phases 1, 2A, 2B, 2C and 2D before any
PayFast live credentials, live mode, or customer-facing checkout is introduced.

No new migrations were authored. No edge function source was modified.
No secret was touched.

---

## 2. Files inspected

### Edge functions / shared payment code
- `supabase/functions/_shared/payments/provider.ts`
- `supabase/functions/_shared/payments/select.ts`
- `supabase/functions/_shared/payments/paystack.ts`
- `supabase/functions/_shared/payments/payfast.ts`
- `supabase/functions/_shared/payments/payfast-checkout.ts`
- `supabase/functions/_shared/payments/reference.ts`
- `supabase/functions/payfast-itn/index.ts`
- `supabase/functions/payfast-checkout-sandbox/index.ts`
- `supabase/functions/token-purchase/index.ts`
- `supabase/functions/paystack-webhook/index.ts`
- `supabase/functions/list-org-purchases/index.ts`
- `supabase/functions/transaction-reconciliation/index.ts`

### Frontend
- `src/components/desk/billing/PurchasesList.tsx`
- `src/components/desk/billing/PendingPurchaseNotice.tsx`
- `src/components/desk/billing/PaymentReferenceStatus.tsx`
- `src/components/desk/billing/CheckoutErrorNotice.tsx`

### Migrations & guards
- `supabase/migrations/20260627115024_*.sql` (Phase 2A provider columns + partial unique index)
- `scripts/check-fx-no-importers.mjs`

### Tests
- All `src/tests/payfast-*` files (8 suites)
- All payment / billing / refund / reconciliation suites listed in §4

---

## 3. Files changed

**None.** This phase was inspection-only. No defect rose to the threshold of a
within-scope fix.

---

## 4. Tests run

Command:

```
bunx vitest run \
  src/tests/payfast \
  src/tests/payment \
  src/tests/batch-c-payment-idempotency \
  src/tests/batch-h-refund-fx-legacy \
  src/tests/dec-007-pay-009-billing \
  src/tests/billing-availability-guard \
  src/tests/billing-auth-guard \
  src/tests/purchases-list-resolved-refunds \
  src/tests/refund-settlement-status-ssot \
  src/tests/admin-refund-wiring \
  src/tests/admin-refund-mark-settled-wiring \
  src/tests/admin-payment-dispute-wiring \
  src/tests/p010-stub-provider-labelling \
  src/tests/p5-batch2-provider-wording \
  src/tests/token-purchase-billing-availability-source \
  src/tests/r2-refund-request-ui-wiring \
  src/tests/phase1-demo-isolation-billing
```

Result: **28 files, 379 tests passed, 0 failed.**

Additional static checks:
- `node scripts/check-fx-no-importers.mjs` → **OK** — no live importer of `_shared/fx.ts`.

Note: two pre-existing unhandled-rejection warnings surface from
`billing-availability-guard.test.tsx` because the test mock for
`supabase.from(...).select().eq().eq().order().limit()` is not fully chained
for the secondary `audit_logs` lookup performed by `PendingPurchaseNotice`.
These are warnings only — all 379 assertions pass — and they exist
independently of any PayFast work. Logged as **deferred, non-blocking**.

---

## 5. Audit findings (by category)

### 5.1 Provider architecture — ✅ PASS
| Check | Evidence |
|---|---|
| Paystack is the only live provider | `select.ts` registry: `payfast: undefined` |
| PayFast descriptor exists but `liveEnabled: false` | `payfast.ts` |
| `selectProvider("payfast")` throws | `select.ts` lines 33–39 |
| Provider IDs canonical (`paystack` \| `payfast`) | `provider.ts` |
| No hard-coded "paystack" label on PayFast rows | `PurchasesList.tsx` reads `row.provider` |
| Paystack rows still write `paystack_reference` | `token-purchase/index.ts` unchanged |
| PayFast rows use `provider_reference` | Phase 2A column + Phase 2B/D handlers |

### 5.2 Database / idempotency — ✅ PASS
| Check | Evidence |
|---|---|
| `token_purchases.provider` + `provider_reference` columns present | migration `20260627115024_*` |
| Partial unique index on `(provider, provider_reference)` | same migration, `WHERE provider_reference IS NOT NULL` |
| Historical Paystack rows backfilled | same migration `UPDATE … SET provider = 'paystack' WHERE provider IS NULL` |
| Duplicate PayFast `pf_payment_id` cannot create duplicate purchases | unique index + Phase 2B replay guard |
| Duplicate ITNs cannot double-credit | `payfast-itn-phase-2b.test.ts` → `replay_detected` |
| `token_ledger.request_id` still protects credit path | unchanged from pre-PayFast |
| `atomic_paid_credit_purchase` is the only paid-credit allocation RPC | grep confirms single call site per provider |
| PayFast rows do **not** require `paystack_reference` | column remains nullable; reads fall back |

### 5.3 PayFast checkout safety — ✅ PASS
| Check | Evidence |
|---|---|
| Sandbox-only literal | `payfast-checkout.ts`: `input.mode !== "sandbox"` rejects |
| Gate-off ⇒ no row created | edge fn returns before any insert when `PAYFAST_SANDBOX_CHECKOUT_ENABLED` ≠ `"true"` |
| Non-admin/non-test cannot initiate | `has_role(auth.uid(), 'platform_admin')` check in edge wrapper |
| Cannot run in live mode | provider literal + missing live registry entry |
| ZAR-only | `currency: "ZAR"` literal, no FX path |
| No `_shared/fx.ts` import | `scripts/check-fx-no-importers.mjs` green |
| Form signing uses final outgoing fields | helper signs the projection, then strips `merchant_key` from the response |
| Passphrase never returned/logged/persisted | grep on helper + edge confirms no echo of `PAYFAST_PASSPHRASE` |

### 5.4 PayFast ITN safety — ✅ PASS
| Check | Evidence |
|---|---|
| Form-encoded body parsing | `payfast.ts` `parseItnBody` |
| Signature verification tested | `payfast-helpers-phase-2b.test.ts` |
| Validate post-back tested for VALID / INVALID / timeout / network | `payfast-itn-phase-2b.test.ts` |
| Source-IP allowlist shape present, not bypassed in prod | `payfast.ts` allowlist + ITN edge uses `x-forwarded-for`; tests override only via injection |
| Invalid signature → no credit | covered |
| Invalid source IP → no credit | covered |
| Invalid validate → no credit | covered |
| Missing purchase → no credit | covered |
| Missing provider reference → no credit | covered |
| Amount / currency / package / org / user mismatch → no credit + risk-logged | `payfast-phase-2d-end-to-end.test.tsx` mismatch case + `admin_risk_items` row |
| FAILED / CANCELLED / PENDING never credit | enum gate in handler |
| Only `COMPLETE` credits after all checks | same handler |
| Handler returns 200 except hard 405 to avoid retry storms | asserted in `payfast-phase-2b-no-regression.test.ts` |

### 5.5 End-to-end flow — ✅ PASS
Covered by `payfast-phase-2d-end-to-end.test.tsx`:
sandbox checkout → pending row → COMPLETE ITN → wallet credited once →
ledger row carries PayFast `provider_reference` → audit row tagged
`provider: payfast`. Duplicate ITN rejected as `replay_detected`.
Mismatched ITN logged to `admin_risk_items` and does not mutate purchase.
Return / cancel URLs do not credit (no credit path wired to them).

### 5.6 Admin / client visibility — ✅ PASS
`PurchasesList.tsx` reads `provider_reference || paystack_reference ||
metadata.provider_reference` and displays the provider label from
`row.provider`. PayFast sandbox rows are visually distinguishable
because their reference is prefixed `sandbox-pf-…` and no live PayFast
row can yet exist. No customer-facing PayFast CTA exists in `src/`
(allowlist enforced by `payfast-phase-2d-no-regression.test.ts`).

### 5.7 Paystack no-regression — ✅ PASS
- `token-purchase/index.ts` still asserts `currency: "USD"` and
  `fx_basis: "native_usd"`; still reads `PAYSTACK_SECRET_KEY`; still
  calls `atomic_paid_credit_purchase`.
- `paystack-webhook/index.ts` HMAC SHA-512 signature path unchanged.
- Neither Paystack file imports any `_shared/payments/payfast*` module.
- Refund / dispute / reconciliation suites all green.

### 5.8 Security & secrets — ✅ PASS
- No `PAYFAST_*` secret is **required** by any test (tests inject fakes).
- No secret is hard-coded.
- Passphrase never printed, returned, or persisted.
- Source-IP allowlist enforced in prod; only the test harness can
  inject an override (via dependency-injected `verifySourceIp`).
- No live PayFast endpoint enabled (`select.ts` `payfast: undefined`).
- No env toggle silently flips PayFast to live; live wiring requires a
  future, explicit code change to `select.ts`.

---

## 6. Defects

| ID | Severity | Description | Disposition |
|----|----------|-------------|-------------|
| 2E-01 | informational | `billing-availability-guard.test.tsx` emits 2 unhandled-rejection warnings (mock chain for secondary `audit_logs` query is incomplete). All assertions still pass. | **Deferred** — pre-existing, unrelated to PayFast, no production impact. |

No blockers. No must-fix-before-customer-facing-sandbox items.
No items fixed in this phase.

---

## 7. Confirmations

- ✅ PayFast is **not** live (registry entry `payfast: undefined`).
- ✅ No customer-facing PayFast button exists (`src/` allowlist enforced).
- ✅ No secrets were touched.
- ✅ No FX code was revived (`check-fx-no-importers` green).
- ✅ Paystack behaviour unchanged (USD, `PAYSTACK_SECRET_KEY`, HMAC SHA-512).
- ✅ Wallet crediting remains idempotent (`atomic_paid_credit_purchase` +
  `token_ledger.request_id` + partial unique index on
  `(provider, provider_reference)` + Phase 2B replay guard).

---

## 8. Recommendation

The system is **ready for controlled PayFast sandbox dashboard
configuration work** (Phase 2F): obtain PayFast sandbox merchant
credentials, register them under sandbox-scoped secret names
(`PAYFAST_SANDBOX_MERCHANT_ID`, `PAYFAST_SANDBOX_MERCHANT_KEY`,
`PAYFAST_SANDBOX_PASSPHRASE`), set the sandbox ITN URL to the
already-deployed `payfast-itn` function, and exercise one live-network
sandbox round-trip through the admin-gated sandbox checkout. Live
customer-facing PayFast remains explicitly out of scope until a later,
separately-approved phase.
