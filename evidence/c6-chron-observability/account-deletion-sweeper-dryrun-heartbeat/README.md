# C6.4 — account-deletion-sweeper-daily-dryrun heartbeat coverage

**Status:** `C6_4_ACCOUNT_DELETION_SWEEPER_DRYRUN_HEARTBEAT_DEPLOYED_PENDING_TICK`

## Scope

Adds heartbeat observability to the daily dry-run account-deletion sweeper
(jobid 25) by converting it from raw `net.http_post` to `public.cron_invoke`,
preserving the existing dry-run payload exactly. No edge-function source edits,
no destructive flags, no manual invocation, no account/user/profile/org
mutations.

## Original cron row

| field    | value                                              |
| -------- | -------------------------------------------------- |
| jobid    | 25                                                 |
| jobname  | account-deletion-sweeper-daily-dryrun              |
| schedule | `15 3 * * *` (daily 03:15 UTC)                     |
| active   | true                                               |
| command  | raw `net.http_post` → `/functions/v1/account-deletion-sweeper` with `x-internal-key`, body `{dry_run:true, max_rows:50, source:"cron:account-deletion-sweeper-daily-dryrun"}` |

## Dry-run safety facts (server-enforced, unchanged)

- Edge function defaults to **dry-run** unless `dry_run === false`.
- Destructive path additionally requires `confirm:"HARD_DELETE"`.
- Cron payload sends `dry_run:true` and **no** `confirm`.
- Dry-run writes only to `admin_audit_logs` and `audit_logs`. No
  deletion / anonymisation / deactivation / archive / PII scrub.

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

- Builds the HTTP body using `COALESCE(p_body, '{}'::jsonb) || jsonb_build_object(...)`. ✅
- Arbitrary payload keys in `p_body` are **preserved**. ✅
- `dry_run:true`, `max_rows:50`, `source:'cron:account-deletion-sweeper-daily-dryrun'`,
  `trigger:'cron'`, and `time` are **forwarded** unchanged to the edge function. ✅
- Only `cron_run_id` and `cron_job_name` are **added** by the wrapper. ✅
- Wrapper does **not** strip or overwrite `dry_run`, `max_rows`, or `source`. ✅
- (Note: PostgreSQL `||` on jsonb is right-wins on conflict. Since we do not
  send `cron_run_id` or `cron_job_name` in the cron payload, no collision is
  possible.)

Result: **SAFE TO PROCEED**.

## New cron command (post-apply)

```sql
SELECT public.cron_invoke(
  'account-deletion-sweeper',
  'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/account-deletion-sweeper',
  jsonb_build_object(
    'dry_run', true,
    'max_rows', 50,
    'source', 'cron:account-deletion-sweeper-daily-dryrun',
    'trigger', 'cron',
    'time', now()
  )
);
```

`jobid`, `jobname`, `schedule`, and `active` are all preserved.

## Heartbeat seed

```
job_name                     | last_status | expected_interval_seconds
account-deletion-sweeper     | pending*    | 86400
```

\* `pending` only on first insert. On conflict the seed only refreshes
`expected_interval_seconds=86400` and `updated_at`, preserving any prior
heartbeat history.

## Confirmations

- Edge function source is **unchanged**.
- Edge function was **not** invoked manually by this migration.
- **No** account / user / profile / organisation row was mutated.
- **No** POI / WaD / registry / payment / refund / balance / token_ledger /
  notification / email_send_log / acceptance receipt / lifecycle / retention /
  purge / archive / provider / audit / admin-risk row was mutated.
- Schedule `15 3 * * *` preserved.
- `active = true` preserved.
- `jobid = 25`, `jobname = account-deletion-sweeper-daily-dryrun` preserved.
- No `confirm` key in payload. No `HARD_DELETE`. No `dry_run:false`.
- No `Authorization` header. No `Bearer eyJ` JWT. No anon JWT.
- No other `cron.job` row was touched (jobid 18, 3, 20, 21 untouched).
- No edge function deployed, no provider called.

## Tests

`src/tests/c6-4-account-deletion-sweeper-dryrun-heartbeat.test.ts` pins all
of the above.

Run set:
- C6.4 (new)
- C6.3
- C6.2 (outreach-sla-monitor)
- C6.1 (lifecycle-scheduler)

## Runtime verification — PENDING

Next scheduled tick: **next 03:15 UTC**. Promote to runtime-confirmed only
once the next tick confirms:

- `cron_heartbeats.account-deletion-sweeper.last_status = 'success'`,
- `last_run_at` advanced to the tick time,
- `last_correlation_id` populated,
- edge-side audit row shows `dry_run = true` (no destructive path entered),
- no row was anonymised / deleted / deactivated.
