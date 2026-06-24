# C6.2 — outreach-sla-monitor-hourly heartbeat coverage

**Status:** `OUTREACH_SLA_MONITOR_CRON_HEARTBEAT_COVERAGE_DEPLOYED_PENDING_TICK`

## Scope

Converted cron jobid 17 (`outreach-sla-monitor-hourly`) from a raw
`net.http_post` invocation carrying a hard-coded anon bearer JWT to a
`public.cron_invoke()` call. Adds heartbeat coverage visible to the C4
stale/failed alert path. No schedule change, no active-flag change, no
edge-function source edit, no business-table mutation.

## Migration

`supabase/migrations/20260624085422_a35c3f68-75fa-431c-bcde-43280dd84d5f.sql`

Two statements only:

1. Seed/upsert `cron_heartbeats` row:
   - `job_name = 'outreach-sla-monitor'`
   - `expected_interval_seconds = 3600` (hourly)
   - `last_status = 'pending'` on first insert; only `expected_interval_seconds`
     and `updated_at` updated on conflict (historical state preserved).
2. `cron.alter_job(job_id := 17, command := …)` repointing the command to:

   ```sql
   SELECT public.cron_invoke(
     'outreach-sla-monitor',
     'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/outreach-sla-monitor',
     jsonb_build_object('trigger','cron','time', now(), 'source','cron:outreach-sla-monitor-hourly')
   );
   ```

## Preserved

- `jobid = 17`
- `jobname = 'outreach-sla-monitor-hourly'`
- `schedule = '0 * * * *'` (hourly)
- `active = true`
- Target edge function URL
- Payload semantics (`trigger`, `time`) plus added `source` audit tag

## Removed from cron command

- Raw `net.http_post(...)`
- Hard-coded `Authorization: Bearer <anon JWT>` header

`public.cron_invoke()` substitutes `x-internal-key` (from vault) for auth and
stamps `cron_heartbeats` on dispatch.

## Auth precedent

`dispatch-acceptance-receipts` (jobid 20, C5a) runs the identical
`cron_invoke` pattern and has been observed returning HTTP 200 with a valid
JSON body via `net._http_response`. That removed the only residual platform
verify_jwt uncertainty before this conversion.

## No invocation, no business mutation

- The edge function was NOT manually invoked by this change.
- No outreach digests were sent by this migration.
- No `poi_engagements`, `audit_logs`, `admin_audit_logs`, `admin_settings`,
  notification, email, lifecycle, POI, WaD, registry, payment, refund,
  balance, `token_ledger`, or `ledger_events` rows were mutated.
- No edits under `supabase/functions/outreach-sla-monitor/**`.

## Guard test

`src/tests/c6-2-outreach-sla-monitor-heartbeat.test.ts` pins:

- `cron.alter_job(job_id := 17, …)` only; no other jobid referenced
- No `cron.schedule`, no `cron.unschedule`, no `schedule :=`, no `active :=`
- `public.cron_invoke('outreach-sla-monitor', …)` with exact URL
- Payload preserves `trigger`, `time`, `source`
- Heartbeat seed with `expected_interval_seconds = 3600`
- No `Bearer eyJ` literal, no `Authorization` header literal
- No direct `net.http_post(` in the new command
- No `INSERT/UPDATE/DELETE` against business tables

## Runtime verification — PENDING

Next scheduled tick: top of the next hour (UTC). Heartbeat row is expected
to populate with `last_run_at`, `last_request_id`, and (via downstream
status promotion) eventually `last_status='success'`. Tracker is held at
its current values until that tick is observed.
