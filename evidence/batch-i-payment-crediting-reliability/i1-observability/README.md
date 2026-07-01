# Batch I1 — Payment Provider Observability

Status: `BATCH_I1_PAYMENT_OBSERVABILITY_DEPLOYED_PENDING_VERIFICATION`

## Scope

Observability only. **No** provider calls, **no** balance/ledger mutation,
**no** refund or settlement logic, **no** cron schedule / RLS / grant /
schema / policy changes, **no** emails/notifications. Items #61 and #67 are
explicitly out of scope.

## Tracker items addressed

| # | Gap | Repair |
|---|-----|--------|
| **#56** | Missing `PAYSTACK_SECRET_KEY` returned only `500`/console error. | New `audit_logs.action='payment.provider_secret_missing'` row + deduped `admin_risk_items.kind='paystack_secret_missing'` (severity `critical`) written from `paystack-webhook`, `token-purchase` (checkout + webhook branches), and `transaction-reconciliation`. Response status preserved. |
| **#78** | Invalid Paystack webhook signature returned only `401`/console error. | New `audit_logs.action='payment.webhook_signature_invalid'` row from `paystack-webhook` and `token-purchase/webhook`. `401` response preserved; no success acknowledgement; no crediting; no raw body/signature stored. |
| **#46 / #54 residual** | `repair_skeletal_paid_credit` errors were captured in `results.skeletal_paid_credit_error` only. | Also writes `audit_logs.action='payment.ledger_label_repair_failed'` and deduped `admin_risk_items.kind='payment_ledger_label_repair_failed'` (severity `high`). Balances are not changed by this repair path. |

## Already-safe items confirmed by inspection (no change)

`#12`, `#30`, `#37`, `#38`, `#59` — closed as already safe by Batch I inspection.

## Deferred (untouched)

- `#61` — verify-path audit parity → Batch I2.
- `#67` — settlement mismatch resolution → client decision required.

## Files changed

- `supabase/functions/_shared/payment-observability.ts` (new)
- `supabase/functions/paystack-webhook/index.ts`
- `supabase/functions/token-purchase/index.ts`
- `supabase/functions/transaction-reconciliation/index.ts`
- `supabase/functions/infra-alerts/index.ts` (checks 19, 20, 21 added, each `try/catch`-wrapped)
- `src/tests/batch-i1-payment-observability.test.ts` (new)

## Guards / tests

`bunx vitest run src/tests/batch-i1-payment-observability.test.ts` →
`18 passed`. Asserts:

- Missing-secret path writes `payment.provider_secret_missing` in every
  in-scope function and upserts `paystack_secret_missing`.
- Invalid-signature path writes `payment.webhook_signature_invalid` and
  still returns `401`. Helper never persists raw body or signature.
- Skeletal repair error writes `payment_ledger_label_repair_failed`
  while keeping the existing `results.skeletal_paid_credit_error` string.
- `infra-alerts` contains all three new windows with the required
  thresholds, each in its own `try/catch`.
- No provider `fetch(...)`, no `atomic_paid_credit_purchase`,
  `atomic_token_credit`, `atomic_token_burn`, `token_balances`, or
  `token_ledger` touched in the new helper.
- No settlement-mismatch or `refund_settlement` / `mark_refund` logic
  introduced in the helper.

## Confirmations

- No real Paystack/PayFast provider calls made or added.
- No token balance or ledger mutation.
- No changes to `atomic_paid_credit_purchase`, checkout/verify/webhook
  crediting, settlement validation, idempotency, reconciliation crediting,
  refund logic, or cron schedules.
- No RLS, grant, policy, schema, storage, WaD, POI, lifecycle, or legal
  hold changes.
- No emails or notifications dispatched by the new code (infra-alerts
  reuses its pre-existing dispatch pipeline; new checks only emit rows to
  the same `alerts` array).

## Deployment

`paystack-webhook`, `transaction-reconciliation`, `infra-alerts` deployed
via on-demand deploy. `token-purchase` bundling hit a transient
`deno.land/x/zod` fetch timeout during on-demand deploy; the source edit
is committed to disk and will bundle on the next auto-deploy pass. No
runtime behaviour is degraded — the added lines are additive
observability that no-op silently on any transient DB write failure.

## Final status

`BATCH_I1_PAYMENT_OBSERVABILITY_DEPLOYED_PENDING_VERIFICATION`
