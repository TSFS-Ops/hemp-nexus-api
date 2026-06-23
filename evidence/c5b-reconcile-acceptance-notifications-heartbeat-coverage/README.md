# C5b — reconcile-acceptance-notifications heartbeat coverage

## Scope

- Cron jobid 21 (`reconcile-acceptance-notifications`, `*/2 * * * *`, pure
  SQL) is now invoked via a dedicated SQL wrapper
  `public.run_reconcile_acceptance_notifications_with_heartbeat()` that
  stamps `cron_heartbeats('reconcile-acceptance-notifications')` on every
  tick. The C4 `cron_heartbeat_failed` / `cron_heartbeat_stale` alerts
  now observe this job.
- Pre-seeded `cron_heartbeats` with `expected_interval_seconds = 120`
  so the stale-alert has a baseline before the first tick.

## Wrapper shape

- `RETURNS jsonb`, `LANGUAGE plpgsql`, `SECURITY DEFINER`,
  `SET search_path = public`.
- Calls `public.reconcile_acceptance_notifications()` exactly once.
- On success: UPSERTs heartbeat with `last_status='ok'`, returns the
  underlying reconciliation jsonb.
- On exception: catches, UPSERTs heartbeat with `last_status='failed'`
  and `last_error=SQLERRM`, returns `{status:'failed', error:SQLERRM}`.
  **Swallow-and-stamp** is intentional: re-raising would roll back the
  failed-heartbeat write inside the cron transaction and the C4
  failed-cron alert would never fire.

## What did NOT change

- Reconciliation business logic
  (`public.reconcile_acceptance_notifications()` unchanged).
- Cron schedule (`*/2 * * * *`), job name, jobid 21, active state.
- Jobid 20 (C5a, `dispatch-acceptance-receipts`).
- No emails sent. No providers called. No dispatch retries.
- No mutation of `notification_dispatches`, `acceptance_receipts`,
  `email_send_log`, payments, refunds, balances, token_ledger, POI,
  WaD, registry, lifecycle, reminders, engagement, RLS, or grants.

## C5 status

- **C5a** (`dispatch-acceptance-receipts`): heartbeat via `cron_invoke()`
  edge-function wrapper. ✅
- **C5b** (`reconcile-acceptance-notifications`): heartbeat via dedicated
  SQL wrapper. ✅
- Both acceptance-receipt cron jobs are now visible to C4 alerts.

## Acceptance-receipt backlog (out of scope)

- 8 failed backfill dispatches — contained, no retry.
- 1 malformed pending dispatch — contained.
- 12 unmatched/pre-backfill receipts — admin review.
- Manual resend — client decision.

## Reversibility

```sql
SELECT cron.alter_job(
  job_id := 21,
  command := 'SELECT public.reconcile_acceptance_notifications();'
);
DROP FUNCTION IF EXISTS public.run_reconcile_acceptance_notifications_with_heartbeat();
```
The seeded heartbeat row is harmless if rolled back.

## Files

- Migration: `supabase/migrations/20260623232434_925be919-aa3c-4853-9005-76d35e63d979.sql`
- Guard test: `src/tests/c5b-reconcile-acceptance-notifications-heartbeat.test.ts`
