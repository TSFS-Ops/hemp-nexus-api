# C5a — Acceptance-receipt cron heartbeat coverage

## Scope

- Converted cron jobid 20 (`dispatch-acceptance-receipts`, `*/2 * * * *`,
  active=true) from raw `net.http_post` to `public.cron_invoke()` so the
  Batch V heartbeat reconciler stamps it and the C4
  `cron_heartbeat_failed` / `cron_heartbeat_stale` infra-alerts can
  observe it.
- Pre-seeded `cron_heartbeats('dispatch-acceptance-receipts')` with
  `expected_interval_seconds = 120` so the stale-alert has a non-NULL
  interval before the first cron tick.

## What did NOT change

- Schedule preserved (`*/2 * * * *`).
- Job name preserved (`dispatch-acceptance-receipts`).
- Active state preserved (true).
- Function URL preserved (`…/functions/v1/dispatch-acceptance-receipts`).
- Edge function source code unchanged.
- Jobid 21 (`reconcile-acceptance-notifications`, pure SQL) untouched —
  C5b deferred; pure-SQL job needs a different heartbeat helper than
  `cron_invoke`.
- No emails sent. No backlog flushed. No retries performed.
- The 8 failed acceptance-receipt `notification_dispatches` rows and the
  45 open `admin_risk_items` titled "Acceptance receipt … not notified"
  remain — out of scope for this batch; tracked separately under the
  notification/email parent.
- No mutation of acceptance receipts, notification dispatches,
  email_send_log, payments, refunds, balances, ledgers, POI, WaD,
  registry, lifecycle, reconciliation, reminders, engagement, RLS, or
  grants.

## Reversibility

`SELECT cron.alter_job(20, command := <original raw net.http_post block>);`
restores prior behaviour without losing the jobid or schedule. The
seeded heartbeat row is harmless if rolled back.

## Files

- Migration: `supabase/migrations/20260623202036_fcdd236e-52b3-446a-8350-f79c27684a7e.sql`
- Guard test: `src/tests/c5a-dispatch-acceptance-receipts-heartbeat.test.ts`
