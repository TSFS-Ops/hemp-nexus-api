# C6 — lifecycle-scheduler pg_net timeout remediation

**Date:** 2026-06-30
**Status:** `LIFECYCLE_SCHEDULER_CRON_INVOKE_TIMEOUT_REMEDIATION_DEPLOYED_PENDING_TICK`
**Predecessor finding:** `LIFECYCLE_SCHEDULER_HEARTBEAT_FALSE_NEGATIVE_DUE_TO_PG_NET_5S_TIMEOUT`
**Scope:** Targeted. One DB function extended with an optional
parameter; one cron command (jobid 3) repointed to use it. Nothing else
touched.

## Why this remediation

The lifecycle scheduler edge function is not failing. The 2026-06-30
03:00 UTC tick wrote a `failed` heartbeat purely because `cron_invoke`
called `net.http_post` with pg_net's 5000 ms default timeout, while the
function legitimately ran for ~11.3 seconds end-to-end.

`public.audit_logs` for the same window proves successful completion:

| time (UTC)       | action                          |
|------------------|---------------------------------|
| 03:00:08.903     | notification_skipped (×8)       |
| 03:00:08.927     | notification.dispatched         |
| 03:00:08.958     | engagement.admin_alert_sent     |
| 03:00:11.716     | lifecycle.scheduler.completed   |
| 03:00:11.735     | lifecycle_scheduler.run_summary |

5 seconds is too short for this specific job. A global timeout
increase was rejected because (a) most other cron callers complete
well under 5s and we do not want to mask real slowness for them, and
(b) widening every job's window changes the semantics of every
heartbeat at once. A per-job opt-in is the smallest surface that fixes
the false negative.

## What changed

### Migration

`supabase/migrations/20260630150548_fbb7d440-9f77-4aa3-bff9-eabc4437c878.sql`

1. Extends `public.cron_invoke` with a new defaulted parameter:

   ```
   p_timeout_milliseconds integer DEFAULT 5000
   ```

   - Default preserved at 5000 ms — every existing 3-arg call is
     unchanged.
   - Value clamped to `[1000, 30000]` via
     `GREATEST(1000, LEAST(30000, COALESCE(...)))`.
   - Forwarded to `net.http_post(... timeout_milliseconds := v_timeout)`.
   - Body merge unchanged:
     `COALESCE(p_body,'{}'::jsonb) || jsonb_build_object('cron_run_id', v_run_id, 'cron_job_name', p_job_name)`.
   - Heartbeat upsert / correlation metadata unchanged; the chosen
     `timeout_milliseconds` is recorded in `last_metadata` for audit.
   - Auth / header handling unchanged
     (`x-internal-key` from `vault.decrypted_secrets`).
   - Existing 3-arg signature dropped first (CREATE OR REPLACE cannot
     add a new parameter) and recreated with the defaulted 4th arg;
     `SECURITY DEFINER`, `search_path`, and return type preserved.

2. `cron.alter_job(job_id := 3, command := ...)` — repoints **only**
   `lifecycle-scheduler-job` to call:

   ```sql
   SELECT public.cron_invoke(
     'lifecycle-scheduler',
     'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/lifecycle-scheduler',
     jsonb_build_object('time', now(), 'source', 'cron:lifecycle-scheduler-job'),
     15000
   );
   ```

   Schedule (`0 3 * * *`), active state (`true`), URL, payload,
   jobname (`lifecycle-scheduler-job`), and heartbeat name
   (`lifecycle-scheduler`) all preserved.

### Why 15000 ms

- Observed wall-clock: ~11.3 s.
- 15 s gives ~30 % headroom without approaching the 30 s clamp ceiling
  or the edge runtime budget.

## Verification (post-deploy, pre-tick)

`cron.job` row for jobid 3 reads back as expected:

```
jobid    | 3
jobname  | lifecycle-scheduler-job
schedule | 0 3 * * *
active   | true
command  | SELECT public.cron_invoke(
              'lifecycle-scheduler',
              'https://.../functions/v1/lifecycle-scheduler',
              jsonb_build_object('time', now(), 'source', 'cron:lifecycle-scheduler-job'),
              15000
            );
```

No other cron job command contains `15000` — confirmed via:

```sql
SELECT jobid, jobname FROM cron.job WHERE jobid <> 3 AND command LIKE '%15000%';
-- []
```

## Tests / guards

- `src/tests/c6-lifecycle-scheduler-timeout-remediation.test.ts` — pins:
  - `p_timeout_milliseconds integer DEFAULT 5000`
  - clamp `GREATEST(1000, LEAST(30000, …))`
  - `timeout_milliseconds := v_timeout` forwarded to `net.http_post`
  - body merge / correlation payload unchanged
  - heartbeat `ON CONFLICT (job_name)` + `'pending'` semantics intact
  - only jobid 3 touched (single `15000` occurrence in the entire
    migration — guards against a global timeout increase)
  - no `cron.schedule` / `cron.unschedule`
  - no schedule / jobname / URL change
  - no edge function source edit
  - no business / runtime table mutation (poi_engagements, pois, wads,
    matches, token_ledger, ledger_events, token_balances,
    payment_disputes, refund_requests, acceptance_receipts,
    notification_dispatches, email_send_log, audit_logs,
    pod_milestones, breaches)
  - no embedded `Bearer eyJ...` JWT

- `src/tests/c6-1-lifecycle-scheduler-heartbeat.test.ts` — unchanged;
  remains green against the prior C6.1 migration.

## Explicit non-changes

- ❌ No edit to `supabase/functions/lifecycle-scheduler/index.ts`.
- ❌ No manual invocation of `lifecycle-scheduler` or
  `admin-run-lifecycle`.
- ❌ No notifications sent, no reminders enqueued, no providers called.
- ❌ No mutation of `cron_heartbeats`, `audit_logs`, `breaches`,
  `pod_milestones`, `matches`, `poi_engagements`, `wads`,
  `notification_dispatches`, `email_send_log`, `token_ledger`,
  `payments`, `refunds`, or any other business / runtime table.
- ❌ No change to any other `cron.job` row (verified: no other job
  references `15000`).
- ❌ No change to C6.5 / C6.6 / C6.7 / C7.1 / C7.2 / burn-POI /
  reconciliation deployment items — all still on their natural ticks.
- ❌ No RLS, grants, policies, indexes, or unrelated schema changes.
- ❌ No global pg_net timeout change.

## Runtime verification plan

This batch is **deployed, pending tick**. Do not mark
runtime-confirmed until, after the next natural lifecycle-scheduler
tick (`0 3 * * *` UTC — next at 2026-07-01 03:00 UTC):

1. `cron_heartbeats.lifecycle-scheduler.last_status = 'success'`
2. `cron_heartbeats.lifecycle-scheduler.last_http_status = 200`
3. `cron_heartbeats.lifecycle-scheduler.last_error IS NULL`
4. No `Timeout of \d+ ms reached` for this job's `last_request_id`
   in `net._http_response`.
5. `lifecycle.scheduler.completed` and `lifecycle_scheduler.run_summary`
   audit events still appear (function behaviour unchanged).
6. No duplicate notifications / reminders for the same tick window.
7. No regression in any other cron heartbeat (`outreach-sla-monitor`,
   `infra-alerts-cron`, `sentry-heartbeat-cron`,
   `p5-governance-sla-monitor`, etc. continue with the unchanged 5 s
   default — their failure-mode is a separate, in-scope follow-up).

## Files

- `supabase/migrations/20260630150548_fbb7d440-9f77-4aa3-bff9-eabc4437c878.sql` (created)
- `src/tests/c6-lifecycle-scheduler-timeout-remediation.test.ts` (created)
- `evidence/c6-chron-observability/lifecycle-scheduler-timeout-remediation/README.md` (this file)
