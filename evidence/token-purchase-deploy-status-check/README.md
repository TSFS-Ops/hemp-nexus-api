# token-purchase deployment status check

Status: `TOKEN_PURCHASE_DEPLOY_STATUS_REDEPLOYED_CURRENT`

## Scope

Verify-only sweep to confirm the live `token-purchase` edge function
carries the Batch I1 and I2 observability changes. No source edits,
migrations, RLS/grant/policy/schema/cron/config changes, provider calls,
payments, data mutations, or notifications were performed.

## Committed source status

`supabase/functions/token-purchase/index.ts` contains all Batch I1/I2
markers:

| Marker | Line | Batch |
|---|---:|---|
| `recordVerifyPostCreditAuditFailed` import | 44 | I2 |
| `recordVerifyPostCreditEventFailed` import | 45 | I2 |
| `recordVerifyRevenueNotificationFailed` import | 46 | I2 |
| verify post-credit audit-failure call | 466 | I2 |
| `source_function: "token-purchase/verify"` event write | 491 | I2 |
| verify post-credit event-failure call | 518 | I2 |
| revenue notification try/catch call | 573 | I2 |

`supabase/functions/_shared/payment-observability.ts` exports the three
I2 helpers and the pre-existing I1 helpers
(`payment.provider_secret_missing`, `payment.webhook_signature_invalid`,
`payment.ledger_label_repair_failed`) that `token-purchase` consumes on
its checkout and webhook branches.

## Deploy result

Redeployed `token-purchase` (and only `token-purchase`) via the
platform's on-demand deploy action. Result:

```
Successfully deployed edge functions: token-purchase
```

Previous transient `deno.land/x/zod` fetch timeout noted in
`evidence/batch-i-payment-crediting-reliability/i1-observability/README.md`
is resolved — bundle now completes.

## Impact on affected tracker items

| # | Batch | Before | After |
|---|---|---|---|
| #56 | I1 — missing payment secret observability | pending (deploy caveat) | live code contains I1 helpers; deploy verified. Runtime confirmation still requires a real missing-secret event to fire. |
| #78 | I1 — invalid signature observability | pending (deploy caveat) | live code contains I1 helpers; deploy verified. Runtime confirmation still requires a real invalid-signature event to fire. |
| #61 | I2 — verify-path audit parity | pending (deploy caveat) | live code contains I2 verify-branch helpers, event write, and try/catch. Runtime confirmation still requires a real verify-path invocation. |

The deploy caveat is cleared. All three items remain in
`DEPLOYED_PENDING_VERIFICATION` awaiting a natural runtime event (not a
new deploy).

## Confirmations

- No source edits.
- No migrations, RLS, grants, policies, schema, triggers, cron, or
  config changes.
- No payments initiated, no provider calls made.
- No data mutation, no emails, no notifications.
- Only `token-purchase` redeployed; no other function touched.

## Final status

`TOKEN_PURCHASE_DEPLOY_STATUS_REDEPLOYED_CURRENT`
