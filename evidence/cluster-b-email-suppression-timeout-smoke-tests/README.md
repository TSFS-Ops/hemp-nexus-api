# Cluster B — Email suppression + worker timeout local smoke tests

Status: `CLUSTER_B_EMAIL_SUPPRESSION_TIMEOUT_SMOKE_TEST_COMPLETE`

## Tracker items covered

| # | Area | Coverage kind |
|---|---|---|
| **#22** | Batch J3 auth email suppression split (`_shared/auth-email-suppression.ts` consumed by `auth-email-hook` and `process-email-queue`) | Runtime coverage of the shared decision helper + disclaimer injectors, plus source-scan wiring guards at both call-sites. |
| **#47** | Batch H email worker send timeout (`process-email-queue`) | Runtime coverage of the `withSendTimeout` / `SendTimeoutError` race pattern (bounded hang, `send_timeout` marker, non-swallowed non-timeout errors, timer cleanup), plus source-scan proving `sendLovableEmail(...)` is wrapped by `withSendTimeout(..., SEND_TIMEOUT_MS)`. |
| **#18** (adjacent, verified as preserved) | Batch H auth DLQ observability | Source-scan proving `email.dead_lettered` audit + `auth_email_dead_lettered` risk item + idempotency guards + recipient masking + infra-alerts windows are all intact. |

## Files added

- `supabase/functions/handle-email-suppression/j3_auth_email_suppression_split_smoke_test.ts`
  — 11 Deno tests. Uses a fetch tripwire and an in-memory `suppressed_emails` stub; imports the real `_shared/auth-email-suppression.ts` helper.
- `supabase/functions/process-email-queue/h_email_worker_timeout_smoke_test.ts`
  — 9 Deno tests. Re-declares the exact `SEND_TIMEOUT_MS` / `SendTimeoutError` / `withSendTimeout` pattern from source, exercises it at runtime, and source-scans the production edge function to prove parity.

## Test seams added

**None.** No production runtime code was edited. The J3 helper already accepts an injected Supabase-shaped client, so the stub drives it directly. The queue-worker timeout pattern is exercised via a local copy of the same three declarations (`SEND_TIMEOUT_MS`, `SendTimeoutError`, `withSendTimeout`), with a source-scan test pinning the production file to that identical pattern.

## Exact markers asserted

Runtime (`_shared/auth-email-suppression.ts`):

- Non-critical + suppressed → `disposition = "suppress"`, `recipientSuppressed = true`, `isSecurityCritical = false`, `suppressionReason` propagated.
- Security-critical + suppressed → `disposition = "send_with_disclaimer"`, `isSecurityCritical = true`; `injectSecurityDisclaimerHtml/Text` inject `AUTH_SECURITY_DISCLAIMER_TEXT` exactly once and are idempotent on a second pass.
- Non-suppressed (any template) → `disposition = "send"`, `recipientSuppressed = false`, `suppressionReason = null`, no disclaimer text present.
- Lookup error → security-critical fails open (`send`), non-critical fails closed (`suppress`).
- Marker constants pinned to exact strings:
  - `AUDIT_ACTION_AUTH_SUPPRESSED === "email.auth_suppressed"`
  - `AUDIT_ACTION_AUTH_SECURITY_SENT_WITH_DISCLAIMER === "email.auth_security_sent_with_disclaimer"`
  - `RISK_KIND_AUTH_EMAIL_TO_SUPPRESSED_RECIPIENT === "auth_email_to_suppressed_recipient"`

Runtime (`withSendTimeout` pattern):

- `SEND_TIMEOUT_MS = 20_000 < 30_000` (pgmq VT).
- `new SendTimeoutError().message === "send_timeout"` verbatim.
- Hung provider promise is rejected within the deadline (elapsed < 500 ms in-test); `SendTimeoutError` propagates with message `send_timeout`.
- Fast-resolving promise resolves normally; no rejection surfaces after the (cancelled) timer would have fired.
- Non-timeout provider error (e.g. `rate_limited`) propagates unchanged and is NOT an instance of `SendTimeoutError`.

Source (`supabase/functions/auth-email-hook/index.ts`):

- Imports the helper from `../_shared/auth-email-suppression.ts`.
- References `evaluateAuthEmailSuppression`, `injectSecurityDisclaimerHtml`, `injectSecurityDisclaimerText`.
- Writes `audit_logs` rows with `action: AUDIT_ACTION_AUTH_SUPPRESSED` and `action: AUDIT_ACTION_AUTH_SECURITY_SENT_WITH_DISCLAIMER`.
- Writes `admin_risk_items` rows with `kind: RISK_KIND_AUTH_EMAIL_TO_SUPPRESSED_RECIPIENT`.

Source (`supabase/functions/process-email-queue/index.ts`):

- Same imports and markers as above.
- Contains verbatim: `const SEND_TIMEOUT_MS = 20_000`, `const SEND_TIMEOUT_MARKER = 'send_timeout'`, `class SendTimeoutError`, `super(SEND_TIMEOUT_MARKER)`.
- `sendLovableEmail(...)` is wrapped by `withSendTimeout(...)` and the wrapper is called with `SEND_TIMEOUT_MS`.
- Non-critical suppressed queue messages are removed via `delete_email` (never DLQ'd).
- Batch H #18 DLQ observability preserved:
  - `action: 'email.dead_lettered'` audit row.
  - `kind: 'auth_email_dead_lettered'` admin_risk_items row.
  - Idempotency guards `alreadyAudited` + `alreadyRisked`.
  - Recipient masking via `maskEmail(` / `recipient_email_masked`.
  - Existing DLQ path preserved (`status: 'dlq'`, `rpc('move_to_dlq'`).
  - Observability writes wrapped in `try { ... } catch (obsErr)`.

Source (`supabase/functions/infra-alerts/index.ts`):

- Retains the `Auth Email Dead-Letter (1 hr)` and `Email Send Timeout (1 hr)` windows referencing `'send_timeout'`.

## Commands run and results

```
$ cd supabase/functions && \
    deno test --allow-read --allow-env \
      handle-email-suppression/j3_auth_email_suppression_split_smoke_test.ts \
      process-email-queue/h_email_worker_timeout_smoke_test.ts
running 11 tests from ./handle-email-suppression/j3_auth_email_suppression_split_smoke_test.ts …
running  9 tests from ./process-email-queue/h_email_worker_timeout_smoke_test.ts …
ok | 20 passed | 0 failed (202ms)

$ bunx vitest run src/tests/batch-j3-auth-email-suppression-split.test.ts \
                  src/tests/batch-h-email-reliability.test.ts
Test Files  2 passed (2)
     Tests  39 passed (39)
```

## Confirmations

- Fetch tripwire installed in both suites; 0 fetch calls recorded across all 20 tests.
- No real Supabase client, no email provider call, no email sent, no Slack POST, no DB mutation, no migration applied, no edge function deployed, no config or secrets changed, no cron run.
- No secrets required (`--allow-env` only enabled because Deno std imports touch env; no `Deno.env.get` in the tests themselves).
- No client-decision items touched. No changes to payment, token, refund, credit, WaD, POI, storage, lifecycle, reconciliation, retention, or legal-hold code.
- No production runtime behaviour changed — tests only.

## Recommended tracker status

| # | Previous | New |
|---|---|---|
| #22 | `DEPLOYED_PENDING_VERIFICATION` (source guards only) | `DEPLOYED_AND_LOCAL_SMOKE_TESTED` |
| #47 | `DEPLOYED_PENDING_VERIFICATION` (source guards only) | `DEPLOYED_AND_LOCAL_SMOKE_TESTED` |

Batch H #18 remains `DEPLOYED_AND_LOCAL_SMOKE_TESTED` — its wiring is re-verified as intact by the new #47 suite's source-scan tests.

## Final status

`CLUSTER_B_EMAIL_SUPPRESSION_TIMEOUT_SMOKE_TEST_COMPLETE`
