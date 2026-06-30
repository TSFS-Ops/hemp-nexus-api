# lifecycle-scheduler failure triage (inspect-only)

**Date:** 2026-06-30
**Status:** `LIFECYCLE_SCHEDULER_HEARTBEAT_FALSE_NEGATIVE_DUE_TO_PG_NET_5S_TIMEOUT`
**Classification:** Observability false-negative, not a function failure.
**Scope:** Read-only inspection. No fix applied. No code, migration, cron,
function, or business-state change in this batch.

## Symptom

`public.cron_heartbeats` row for `job_name = 'lifecycle-scheduler'` shows
`last_status = 'failed'` after the 2026-06-30 03:00 UTC tick:

```
last_run_at         | 2026-06-30 03:00:00.439628+00
last_http_status    | NULL
last_status         | failed
last_error          | Timeout of 5000 ms reached. Total time: 5001.179000 ms
                      (DNS time: 5001.179000 ms, TCP/SSL handshake time: 0,
                       HTTP Request/Response time: 0.000000 ms)
last_request_id     | 1026347
last_correlation_id | c1a2227b-119a-4e10-b8f4-d6a52ac4859b
```

## Why this is observability, not a real failure

The lifecycle-scheduler function actually ran and completed successfully
inside the edge runtime. `public.audit_logs` for the same tick window:

| time (UTC)                | action                           |
|---------------------------|----------------------------------|
| 03:00:08.903769           | notification_skipped (×8)        |
| 03:00:08.927960           | notification.dispatched          |
| 03:00:08.958186           | engagement.admin_alert_sent      |
| 03:00:11.716660           | lifecycle.scheduler.completed    |
| 03:00:11.735980           | lifecycle_scheduler.run_summary  |

Function wall-clock ≈ **11.3 seconds**.

`public.cron_invoke()` (the wrapper used by `lifecycle-scheduler-job`)
calls `net.http_post(url, headers, body)` **without** a
`timeout_milliseconds` override, so pg_net falls back to its **5000ms
default**. pg_net gave up at 5s, the cron-heartbeat reconciler saw a
NULL `status_code` plus a timeout `error_msg`, and stamped the row
`failed`. The edge runtime continued executing for another ~6.3s and
finished cleanly.

## System-wide pattern (context, not in-scope to fix here)

`net._http_response` over the last ~6 hours of retention: **19 / 404
responses** are timeouts. Shared shape: status NULL, error
`Timeout of 5000 ms reached…`. Affected callers observed in the same
window include `lifecycle-scheduler`, `outreach-sla-monitor`,
`infra-alerts-cron`, `sentry-heartbeat-cron`,
`p5-governance-sla-monitor`. All use `cron_invoke` → `net.http_post`
with the 5000ms default. Any cron-invoked function whose work exceeds
~5s will exhibit the same false-negative.

The C2 NOT_FOUND_FUNCTION_BLOB 404s (balance-drift, burn-poi,
side-effect reconciliation, account-deletion-sweeper,
purge-email-send-log-daily-dryrun, engagement-reminder-daily) are a
**different** failure mode (status 404, no timeout). Those are tracked
separately under the reconciliation deployment repair and the C2
function-blob registration work; not addressed here.

## Explicit non-changes in this triage

- ❌ No edit to `public.cron_invoke`.
- ❌ No change to pg_net timeout (no `timeout_milliseconds` added).
- ❌ No `cron.alter_job` / `cron.schedule` / `cron.unschedule`.
- ❌ No edit to `supabase/functions/lifecycle-scheduler/index.ts`.
- ❌ No manual invocation of `lifecycle-scheduler` or
  `admin-run-lifecycle`.
- ❌ No DB migration.
- ❌ No mutation of `cron_heartbeats`, `audit_logs`, `breaches`,
  `pod_milestones`, `matches`, `poi_engagements`, `wads`,
  `admin_risk_items`, `ai_proposed_matches`, `notification_dispatches`,
  `email_send_log`, `token_ledger`, `payments`, `refunds`, `balances`,
  or any other business / runtime table.
- ❌ No emails, no provider calls, no credits burned.
- ❌ Reconciliation deployment repair, burn-poi source repair, C7.2
  admin-alert migration, C6.5 / C6.7 dry-run heartbeats — all
  untouched, still pending their natural ticks.

## Candidate remediation (not applied)

Options, ordered least-invasive first, all deferred pending a separate
buildable instruction:

1. **Lift pg_net timeout for cron_invoke** to e.g. 30s by passing
   `timeout_milliseconds := 30000` to `net.http_post`. Smallest
   surface, fixes every cron caller in one place. Reversible.
2. **Per-job timeout parameter** on `cron_invoke(p_job_name, p_url,
   p_body, p_timeout_ms default 30000)` so individual jobs can tune.
3. **Treat NULL `status_code` + timeout `error_msg` as `unknown`**, not
   `failed`, in the heartbeat reconciler, and require a subsequent
   tick or an audit-trail probe before raising
   `cron_heartbeat_failed`. Most informative but largest change.

None of these are buildable from this batch — they require client sign-off
because they alter the meaning of cron observability signals.

## Files

- This README only.
