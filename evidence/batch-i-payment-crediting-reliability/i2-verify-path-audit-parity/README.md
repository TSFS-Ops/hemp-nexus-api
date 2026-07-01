# Batch I2 — Verify-Path Post-Credit Audit/Event Parity

Status: `BATCH_I2_PAYMENT_VERIFY_PATH_AUDIT_PARITY_DEPLOYED_PENDING_VERIFICATION`

## Tracker item

**#61** — Post-credit audit/event inserts in `token-purchase` verify/return
path were best-effort or absent, leaving admins blind when credit landed
but downstream writes failed.

## Gap (from I2 inspection)

After `atomic_paid_credit_purchase` succeeded in the verify branch:

- Hard `credits.purchased` audit failures **threw** and returned 500 to
  the customer, despite credit already applied. No `admin_risk_items`.
- `payment.event_created` was **not written at all** by the verify path
  — only the webhook path wrote it. When the webhook is missing/late
  (the exact reason verify-fallback exists), the canonical governance
  event row could be permanently absent.
- `emitRevenueNotification` was `await`-ed without try/catch — an error
  could 500 the customer after credit landed.

## Repair (additive, observability only)

Extended `supabase/functions/_shared/payment-observability.ts` with three
new helpers, each using the existing `safeAudit` + deduped
`safeUpsertRisk` primitives:

| Helper | Audit action | Risk kind | Severity |
|---|---|---|---|
| `recordVerifyPostCreditAuditFailed` | `payment.verify_post_credit_audit_failed` | `payment_verify_post_credit_audit_failed` | high |
| `recordVerifyPostCreditEventFailed` | `payment.verify_post_credit_event_failed` | `payment_verify_post_credit_event_failed` | high |
| `recordVerifyRevenueNotificationFailed` | `payment.verify_revenue_notification_failed` | `payment_verify_revenue_notification_failed` | medium |

Dedup key = `<kind>:<reference>` so duplicate verify-fallback retries or
webhook↔verify races do not spam risk items.

`supabase/functions/token-purchase/index.ts` verify branch changes:

1. **`credits.purchased` audit**: `23505` still tolerated. Any other
   error now calls `recordVerifyPostCreditAuditFailed` and continues —
   customer still gets `{ success: true }` because credit is real.
2. **New `payment.event_created` write** via `writeCriticalEventWithPosture`
   with `source_function: "token-purchase/verify"` and
   `idempotency_extra: reference`. Duplicate/idempotent conflicts
   (webhook won) are tolerated silently. Hard failures call
   `recordVerifyPostCreditEventFailed` and continue.
3. **`emitRevenueNotification` wrapped in try/catch**. On error,
   `recordVerifyRevenueNotificationFailed` is called and the handler
   still returns success.

Webhook branch, reconciliation branch, `atomic_paid_credit_purchase`
call signature, refund/settlement logic, provider fetch URLs,
idempotency semantics, RLS/grants/schema/cron: **unchanged**.

## Files changed

- `supabase/functions/_shared/payment-observability.ts` (added 3 helpers)
- `supabase/functions/token-purchase/index.ts` (verify branch only)
- `src/tests/batch-i2-verify-path-audit-parity.test.ts` (new — 13 tests)
- `src/tests/batch-i1-payment-observability.test.ts` (guard updated to
  ignore English description strings when scanning for balance mutation
  markers; behaviour unchanged)

## Behaviour before → after (verify path)

| Scenario | Before | After |
|---|---|---|
| Credit OK, audit `23505` | 200 success, no risk (correct) | 200 success, no risk (unchanged) |
| Credit OK, audit non-23505 error | **500 to customer**, no risk item | **200 success**, `payment_verify_post_credit_audit_failed` (high) risk item |
| Credit OK, event write missing | — (path did not write event) | writes `payment.event_created`; on failure, `payment_verify_post_credit_event_failed` (high) risk item |
| Credit OK, event duplicate/idempotent | — | tolerated silently (webhook won) |
| Credit OK, revenue notification throws | **500 to customer**, no risk item | **200 success**, `payment_verify_revenue_notification_failed` (medium) risk item |
| Credit fails (RPC error) | 500, no credit | 500, no credit (unchanged) |

## Tests / guards

```
bunx vitest run src/tests/batch-i1-payment-observability.test.ts \
                src/tests/batch-i2-verify-path-audit-parity.test.ts
Test Files  2 passed (2)
     Tests  31 passed (31)
```

Guards asserted by Batch I2:

- All three new helpers exported with correct kind/severity/dedup keys.
- `token-purchase` imports the three helpers.
- Verify branch writes `payment.event_created` with
  `source_function: "token-purchase/verify"` and `idempotency_extra: reference`.
- Verify branch no longer contains `throw auditErr` after successful credit.
- Verify branch tolerates duplicate/idempotent event conflicts.
- Verify branch wraps `emitRevenueNotification` in try/catch with
  `catch (notifyErr)` and calls the notification-failure helper.
- `atomic_paid_credit_purchase` verify-path call signature byte-equal
  (p_org_id, p_amount, p_reference_id, p_endpoint).
- Webhook branch still fail-closes: `AUDIT_WRITE_FAILED` +
  `GOV_AUDIT_WRITE_FAILED` throws still present; still uses
  `source_function: "token-purchase/webhook"`.
- No new Paystack provider URLs beyond the two existing
  (`transaction/initialize`, `transaction/verify/{ref}`).
- Helper contains no `refund`, `settlement_mismatch`,
  `atomic_paid_credit_purchase`, `atomic_token_credit`,
  `atomic_token_burn`, `token_balances`, or `token_ledger` in
  executable code.

## Confirmations

- No changes to `atomic_paid_credit_purchase`, token balance / ledger
  mutation, refund logic, settlement-mismatch handling, idempotency,
  checkout init, provider verify semantics, webhook crediting, or
  reconciliation crediting.
- No provider fetch URLs added; no real Paystack/PayFast call made.
- No real payment initiated, no real credits mutated, no real emails
  sent (unit tests only inspect source; no network).
- No RLS, grants, policies, schema, cron, storage, WaD, POI, lifecycle,
  legal-hold, or pending-verification changes.

## Deployment

`token-purchase` deployed on-demand (see run log).

## Final status

`BATCH_I2_PAYMENT_VERIFY_PATH_AUDIT_PARITY_DEPLOYED_PENDING_VERIFICATION`
