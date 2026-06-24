# C6.1 — lifecycle-scheduler-job heartbeat coverage

**Status:** `LIFECYCLE_SCHEDULER_CRON_HEARTBEAT_COVERAGE_DEPLOYED_PENDING_TICK`

## Scope

Single-job cron observability conversion. No other cron, no schema, no
RLS/grants, no business state, no provider calls, no manual invocation.

## What changed

- **Migration:** `supabase/migrations/20260624083049_c65d2d90-84fe-493e-8a6f-1f409a50b214.sql`
  - Pre-seeds `public.cron_heartbeats` row for `job_name = 'lifecycle-scheduler'`
    with `expected_interval_seconds = 86400` and `last_status = 'pending'`
    (idempotent `ON CONFLICT (job_name) DO UPDATE` — does not overwrite
    historical run state).
  - Repoints `cron.job` jobid 3 (`lifecycle-scheduler-job`) command from a
    raw `net.http_post` to:
    ```sql
    SELECT public.cron_invoke(
      'lifecycle-scheduler',
      'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/lifecycle-scheduler',
      jsonb_build_object('time', now(), 'source', 'cron:lifecycle-scheduler-job')
    );
    ```

## Preserved

| Field    | Before                | After                 |
| -------- | --------------------- | --------------------- |
| jobid    | 3                     | 3                     |
| jobname  | lifecycle-scheduler-job | lifecycle-scheduler-job |
| schedule | `0 3 * * *`           | `0 3 * * *`           |
| active   | true                  | true                  |
| function URL | `…/functions/v1/lifecycle-scheduler` | `…/functions/v1/lifecycle-scheduler` |

## Not changed

- Lifecycle scheduler edge function source — untouched.
- Lifecycle state, reminders, engagements — not read or mutated by the migration.
- Payments / PayFast / refunds / token_ledger / balances / POI / WaD / registry
  / acceptance receipts / notification dispatches / email send log — untouched.
- Any other `cron.job` row — untouched.
- RLS, grants, policies, indexes, columns — untouched.
- Scheduler was **not** invoked manually.

## Tests / guards

- `src/tests/c6-1-lifecycle-scheduler-heartbeat.test.ts` — pins
  `cron.alter_job(job_id := 3, …)`, `cron_invoke('lifecycle-scheduler', …)`,
  heartbeat seed (`86400` / `lifecycle-scheduler`), absence of
  `cron.schedule` / `cron.unschedule` / schedule alteration / `net.http_post` /
  raw JWT / business-table mutation / other jobids.

## Runtime verification

Pending the next scheduled tick at **2026-06-25 03:00 UTC**.

Expected post-tick observation:
- `cron_heartbeats.lifecycle-scheduler.last_status = 'success'`
- `last_run_at` advanced
- `last_http_status = 200`
- `last_error IS NULL`

Tracker remains unchanged until the next successful scheduled tick is observed.

## Recommended next batches (not applied here)

- C6.2 `outreach-sla-monitor-hourly` — cron_invoke conversion (retires hard-coded anon JWT).
- C6.3 `cleanup-expired-unsubscribe-tokens` — SQL heartbeat wrapper.
- C6.4 `account-deletion-sweeper-daily-dryrun` — cron_invoke.
- C6.5 `purge-email-send-log-daily-dryrun` + `cold-storage-archive-dryrun` — paired conversion.
- Live destructive variants and the inactive `data-retention-job` remain
  client-decision / deferred per prior inspection.
