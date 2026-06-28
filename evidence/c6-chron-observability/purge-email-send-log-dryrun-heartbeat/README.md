# C6.5 — purge-email-send-log-daily-dryrun heartbeat coverage

**Status:** `C6_5_PURGE_EMAIL_SEND_LOG_DRYRUN_HEARTBEAT_DEPLOYED_PENDING_TICK`

## Scope

Adds heartbeat observability to the daily dry-run email-send-log purge
(jobid 39) by converting it from raw `net.http_post` to `public.cron_invoke`,
preserving the existing dry-run payload exactly. The paired live job (jobid
42) is explicitly NOT touched.

## Original cron rows

| field    | jobid 39 (in scope)                                | jobid 42 (NOT touched)                             |
| -------- | -------------------------------------------------- | -------------------------------------------------- |
| jobname  | purge-email-send-log-daily-dryrun                  | purge-email-send-log-daily-live                    |
| schedule | `20 3 * * *`                                       | `50 3 * * *`                                       |
| active   | true                                               | true                                               |
| command  | raw `net.http_post` → `/functions/v1/purge-email-send-log-daily` with `x-internal-key`, body `{dry_run:true, max_orgs:50, max_rows_per_org:5000, source:"cron:purge-email-send-log-daily-dryrun"}` | unchanged — raw `net.http_post` with `dry_run:false` |

Post-apply verification (`SELECT ... FROM cron.job WHERE jobid IN (39,42)`)
confirms jobid 42's command, schedule, and active flag are unchanged.

## Dry-run safety facts (server-enforced, unchanged)

- Edge function defaults to dry-run unless `dry_run === false`.
- In dry-run it only writes to `retention_run_evidence` and `audit_logs`
  (lifecycle + per-org `skipped`). No `DELETE FROM email_send_log`.
- Live deletion is gated by `!dryRun && counts.rows_eligible > 0`.
- Cron payload sends `dry_run:true`; no `confirm`, no `HARD_DELETE`.

## Decision: separate dry-run heartbeat name

Both crons share the same edge function name `purge-email-send-log-daily`,
but their safety profiles differ. To keep dry-run and live independently
observable, C6.5 uses a **distinct** heartbeat row:

- `job_name = 'purge-email-send-log-daily-dryrun'`

A future C6.x can seed `purge-email-send-log-daily-live` separately.

## Pre-apply cron_invoke payload-preservation check — PASSED

Live definition of `public.cron_invoke(text, text, jsonb)` inspected before
applying. Relevant fragment:

```sql
v_body := COALESCE(p_body, '{}'::jsonb)
          || jsonb_build_object(
               'cron_run_id',   v_run_id,
               'cron_job_name', p_job_name
             );
```

Conclusions:

- Arbitrary payload keys in `p_body` are **preserved**. ✅
- `dry_run:true`, `max_orgs:50`, `max_rows_per_org:5000`,
  `source:'cron:purge-email-send-log-daily-dryrun'`, `trigger:'cron'`, and
  `time` are **forwarded unchanged** to the edge function. ✅
- Only `cron_run_id` and `cron_job_name` are appended by the wrapper. ✅
- We do not send those keys, so no `||` right-wins collision is possible. ✅
- Wrapper does **not** strip or coerce `dry_run`. ✅

Result: **SAFE TO PROCEED**.

## New cron command (post-apply)

```sql
SELECT public.cron_invoke(
  'purge-email-send-log-daily-dryrun',
  'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/purge-email-send-log-daily',
  jsonb_build_object(
    'dry_run', true,
    'max_orgs', 50,
    'max_rows_per_org', 5000,
    'source', 'cron:purge-email-send-log-daily-dryrun',
    'trigger', 'cron',
    'time', now()
  )
);
```

`jobid=39`, `jobname=purge-email-send-log-daily-dryrun`, `schedule=20 3 * * *`,
`active=true` are all preserved.

## Heartbeat seed

```
job_name                              | last_status | expected_interval_seconds
purge-email-send-log-daily-dryrun     | pending*    | 86400
```

\* `pending` only on first insert. On conflict, only
`expected_interval_seconds=86400` and `updated_at` are refreshed, preserving
any prior heartbeat history.

Confirmed via `SELECT job_name, expected_interval_seconds, last_status FROM
public.cron_heartbeats WHERE job_name LIKE 'purge-email-send-log%'` →
single row `purge-email-send-log-daily-dryrun, 86400, pending`. No
`purge-email-send-log-daily-live` row created.

## Confirmations

- Edge function source is **unchanged** (no `supabase/functions/...` edits).
- Edge function was **not** invoked manually by this migration.
- **No** row in `email_send_log` was inserted, updated, or deleted.
- **No** mutation to notification / user / profile / org / audit / admin
  risk / retention evidence / POI / WaD / registry / payment / refund /
  balance / ledger / lifecycle / purge / archive / provider tables.
- Schedule `20 3 * * *` preserved. `active=true` preserved.
- `jobid=39`, `jobname=purge-email-send-log-daily-dryrun` preserved.
- `jobid=42` (live) **not touched** — verified post-apply.
- No `confirm`, no `HARD_DELETE`, no `dry_run:false` in the new command.
- No `Authorization` header. No `Bearer eyJ` JWT.
- No provider calls.

## Migration

`supabase/migrations/20260628131231_b156043b-02d0-415b-805f-d47891783cef.sql`

## Tests

`src/tests/c6-5-purge-email-send-log-dryrun-heartbeat.test.ts` pins all of
the above.

Run set: C6.5 (new), C6.4, C6.3, C6.2, C6.1.

## Runtime verification — PENDING

Next scheduled tick: **next 03:20 UTC**. Promote to runtime-confirmed only
once the next tick confirms:

- `cron_heartbeats.purge-email-send-log-daily-dryrun.last_status = 'success'`
  (or at minimum `last_http_status = 200`),
- `last_run_at` advanced to the tick time,
- `last_correlation_id` populated,
- `retention_run_evidence` row for the tick shows `dry_run=true` and
  `rows_purged=0`,
- no `email_send_log` rows were deleted in the tick window.
