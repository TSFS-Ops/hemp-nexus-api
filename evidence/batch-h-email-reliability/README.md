# Batch H — Email Reliability (safe subset)

**Status:** `BATCH_H_EMAIL_RELIABILITY_SAFE_SUBSET_DEPLOYED_PENDING_VERIFICATION`

## Scope

| Tracker item | Disposition |
|---|---|
| **#18** auth email dead-letter observability | **Applied** |
| **#47** explicit email worker send timeout | **Applied** |
| **#22** suppressed auth-email disposition | **Deferred** — needs client decision on send-with-disclaimer vs full suppression for auth/security emails (recovery, email_change, reauthentication vs signup, magiclink, invite). No policy change made. |

## Files changed

- `supabase/functions/process-email-queue/index.ts`
  - New constants: `SEND_TIMEOUT_MS = 20_000`, `SEND_TIMEOUT_MARKER = 'send_timeout'`, `AUTH_TEMPLATE_LABELS`.
  - New helpers: `withSendTimeout`, `SendTimeoutError`, `isSendTimeout`, `maskEmail`, `isAuthTemplate`.
  - `moveToDlq` now writes an idempotent `audit_logs` row (`action='email.dead_lettered'`) and, for auth/critical templates, an idempotent `admin_risk_items` row (`kind='auth_email_dead_lettered'`). Recipient is masked; no HTML/text body carried into metadata.
  - Provider send is wrapped in `withSendTimeout(sendLovableEmail(...), SEND_TIMEOUT_MS)`. Timeouts throw `SendTimeoutError('send_timeout')` and fall through to the existing `status='failed'` insert path with `error_message='send_timeout'`, incrementing the same retry counter as any provider failure.
- `supabase/functions/infra-alerts/index.ts`
  - **Check 17** — Auth Email Dead-Letter (1 hr): `email_send_log.status='dlq'` on the auth-template set. warning ≥1, critical ≥5. try/catch wrapped.
  - **Check 18** — Email Send Timeout (1 hr): `email_send_log.error_message='send_timeout'`. warning ≥3, critical ≥10. try/catch wrapped.
- `src/tests/batch-h-email-reliability.test.ts` — static contract guards.

## Behaviour before / after

| Path | Before | After |
|---|---|---|
| Auth email → DLQ | `email_send_log.status='dlq'` + `console.warn` only. Silent to admins. | Same, plus `audit_logs email.dead_lettered` + `admin_risk_items auth_email_dead_lettered` (idempotent). infra-alerts Check 17 fires on ≥1/hr. |
| Provider send hangs | Awaited indefinitely inside batch. pgmq VT (30s) expires while worker still awaiting → duplicate delivery on the next tick, only stopped by the `alreadySent` guard. | Bounded at 20s. Timeout logged as `status='failed', error_message='send_timeout'`. Retry counter increments; message re-surfaces via VT expiry until MAX_RETRIES then DLQ. infra-alerts Check 18 fires on ≥3/hr. |
| Threshold / backoff / TTL / MAX_RETRIES | unchanged | unchanged |
| Suppression / unsubscribe / auth-hook enqueue | unchanged | unchanged (#22 deferred) |

## Guards / tests

`src/tests/batch-h-email-reliability.test.ts` — 20 static assertions covering:
- SEND_TIMEOUT_MS present and < 30_000.
- `withSendTimeout(sendLovableEmail(...), SEND_TIMEOUT_MS)` wraps the provider call.
- Timeout marker string = `'send_timeout'`; not marked as `sent`.
- `moveToDlq` writes `email.dead_lettered` audit; idempotent per `message_id`.
- Auth templates → `admin_risk_items kind='auth_email_dead_lettered'`; idempotent per `message_id`.
- Recipient masked; audit metadata does not carry HTML/text body.
- Existing DLQ path (`email_send_log.status='dlq'` + `move_to_dlq` rpc) preserved.
- Observability failures non-fatal.
- Auth template set == Supabase auth taxonomy.
- infra-alerts Check 17 + Check 18 present with correct sources, thresholds, severities, try/catch.
- Negative guards: `auth-email-hook` and `process-email-queue` do **not** reference `suppressed_emails` (proves #22 not applied).

All tests pass locally as file-content scans; no Deno/provider execution.

## Confirmations

- **No real email sent** — tests are static file scans; no Resend/Lovable API calls.
- **No suppression policy changed** — `suppressed_emails` table, `send-transactional-email` pre-enqueue check, and unsubscribe semantics untouched. `auth-email-hook` unchanged.
- **No threshold/backoff behaviour changed** — `MAX_RETRIES=5`, VT=30, TTL (auth 15m, txn 60m), send_delay_ms unchanged.
- **#22 not touched** — deferred to a follow-up batch pending client decision.
- **No unrelated systems touched** — no RLS/grant/policy/storage/cron/provider/payment/refund/credit/token/WaD/POI/lifecycle/reconciliation/retention/legal-hold changes. Only `process-email-queue` and `infra-alerts` edge functions edited plus one test file added.
