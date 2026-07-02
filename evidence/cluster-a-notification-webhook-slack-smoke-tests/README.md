# Cluster A — Notification / Webhook / Slack observability local smoke tests

Status: `CLUSTER_A_NOTIFICATION_WEBHOOK_SLACK_SMOKE_TEST_COMPLETE`

## Tracker items covered

| # | Area | Coverage kind |
|---|---|---|
| **#23** | Customer webhook auto-disabled notification (`webhook_record_failure` RPC + `webhook-retry` wiring) | Migration-body + `webhook-retry` source guard (RPC is Postgres-side; cannot be exercised from Deno without a live DB, and doing so would violate the "no DB mutation" constraint). |
| **#29** | `infra-alerts` admin alert / Slack failure path | Source guard — Slack fetch wrapped in try/catch with canonical `console.error("Slack dispatch failed", …)` marker; response stays 200; new Batch G windows for `webhook_auto_disabled` and `dispatcher_unavailable` are still wired. |
| **#69** | `notification-dispatch` Slack / notification failure observability | Runtime coverage of the shared helper `recordNotificationSkipped` (audit row shape, dedup, no-throw on insert failure, both `dispatcher_unavailable` and `slack_not_configured` shapes) + source guard proving `notification-dispatch/index.ts` calls it from both Slack-failure branches and flips `slackStatus = "failed"`. |

## Files added

- `supabase/functions/notification-dispatch/g_slack_webhook_observability_smoke_test.ts`
  — 9 Deno tests; uses a fetch tripwire and an in-memory stub Supabase
  client; reads source/migration bodies for wiring assertions.

## Test seams added

**None.** No production code was edited. The shared helper
(`_shared/notification-skip-audit.ts`) already accepts an injected
`SupabaseClient`, so the runtime tests drive it directly with a stub.
The rest of the wiring is proven by reading committed source and the
Batch G migration body.

## Exact markers asserted

Runtime (`recordNotificationSkipped`, `audit_logs` insert):

- `action = "notification_skipped"`
- `entity_type = "notification"`
- `metadata.reason ∈ { "dispatcher_unavailable", "slack_not_configured" }`
- `metadata.channel = "slack"`
- `metadata.source_function = "notification-dispatch"`
- `metadata.source_event_type` populated from caller
- `metadata.http_status` propagated via `extra`
- Same-day dedupe: existence check on `audit_logs` gated by
  `action = notification_skipped`, `entity_id`, `reason`,
  `source_function`, `channel` — hit → no insert
- Insert failures are swallowed (never throws)

Source (`notification-dispatch/index.ts`):

- Slack failure branches call `recordNotificationSkipped` with
  `channel: "slack"`, `reason: "dispatcher_unavailable"`
- `slackStatus = "failed"` on failure; `"skipped_not_configured"` when
  no webhook is configured
- Typed envelope
  `"sent" | "skipped_not_configured" | "failed" | "not_requested"`

Source (`infra-alerts/index.ts`):

- Slack fetch is inside `try { … } catch (err) { … "Slack dispatch failed" … }`
- Batch G windows present:
  - `Webhook Auto-Disable (1 hr)` → `.eq("kind", "webhook_auto_disabled")`
  - `Slack Dispatcher Unavailable (1 hr)` → `.eq("reason", "dispatcher_unavailable")`

Migration (Batch G `webhook_record_failure`):

- Writes `audit_logs.action = 'webhook.endpoint.auto_disabled'`
- Writes `admin_risk_items.kind = 'webhook_auto_disabled'` with
  `ON CONFLICT (dedup_key) DO NOTHING`
- Writes `notifications` scoped to `role = 'platform_admin'`
- ≥ 3 `EXCEPTION WHEN OTHERS THEN` guards so counter/trip contract
  survives observability-write failure
- No raw payload leakage (`payload_body|request_body|response_body`
  strings absent)

Source (`webhook-retry/index.ts`):

- `webhook_record_failure` RPC called from both failure branches
  (non-OK response, network-error catch)
- `p_threshold: 10` preserved
- `[CIRCUIT BREAKER] Tripped` warn present

## Commands run and results

```
$ deno test --allow-read --allow-env \
    supabase/functions/notification-dispatch/g_slack_webhook_observability_smoke_test.ts
running 9 tests …
ok | 9 passed | 0 failed (87ms)

$ bunx vitest run src/tests/batch-g-notification-webhook-reliability.test.ts
Test Files  1 passed (1)
     Tests  25 passed (25)
```

## Confirmations

- No Slack POST attempted (fetch tripwire installed; 0 fetch calls
  recorded across all tests).
- No email, no notification dispatch, no provider call.
- No real Supabase client instantiated; all writes are in-memory stub
  inserts.
- No secrets required (`--allow-env` only used because Deno's std
  library imports touch env; no `Deno.env.get` in the test file).
- No DB mutation, no migration applied, no edge function deployed,
  no config/secrets changed, no cron run.
- No client-decision items touched.
- No production runtime behaviour changed — tests only.

## Recommended tracker status

| # | Previous | New |
|---|---|---|
| #23 | `DEPLOYED_PENDING_NATURAL_RUNTIME_EVENT` | `DEPLOYED_AND_LOCAL_SMOKE_TESTED` |
| #29 | Source guard only | `DEPLOYED_AND_LOCAL_SMOKE_TESTED` |
| #69 | Source guard only | `DEPLOYED_AND_LOCAL_SMOKE_TESTED` |

Full production closure of #23 still awaits a natural runtime trip of
`webhook_record_failure` observed via `admin_risk_items` /
`audit_logs` in production; the trip itself remains best exercised by
real endpoint failures rather than a synthetic Deno probe.

## Final status

`CLUSTER_A_NOTIFICATION_WEBHOOK_SLACK_SMOKE_TEST_COMPLETE`
