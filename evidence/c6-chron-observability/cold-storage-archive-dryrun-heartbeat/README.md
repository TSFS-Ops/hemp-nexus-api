# C6.7 — cold-storage-archive-dryrun heartbeat coverage

Status after apply: `C6_7_COLD_STORAGE_ARCHIVE_DRYRUN_HEARTBEAT_DEPLOYED_PENDING_TICK`

Runtime confirmation gates on the next scheduled Sunday 03:40 UTC tick of jobid 40.

## Scope

- Apply: jobid 40 only (`cold-storage-archive-dryrun`).
- Untouched: jobid 41 (`cold-storage-archive-live`), jobid 39 (`purge-email-send-log-daily-dryrun`), jobid 42 (`purge-email-send-log-daily-live`), all other cron jobs.
- No edge function source change, no manual invocation, no storage / archive / source-row mutation.

## Original cron registry (pre-apply)

- `jobid`: 40
- `jobname`: `cold-storage-archive-dryrun`
- `schedule`: `40 3 * * 0` (Sunday 03:40 UTC, weekly)
- `active`: `true`
- `command` (raw `net.http_post`):
  - URL: `https://<project>.supabase.co/functions/v1/cold-storage-archive`
  - headers: `Content-Type`, `x-internal-key` from `vault.decrypted_secrets` (`INTERNAL_CRON_KEY`)
  - body: `{ dry_run: true, limit: 50, source: 'cron:cold-storage-archive-dryrun' }`

## Paired live job — NOT TOUCHED

- `jobid`: 41
- `jobname`: `cold-storage-archive-live`
- `schedule`: `10 4 * * 0` (Sunday 04:10 UTC)
- `active`: `true`
- payload: `{ dry_run: false, limit: 50, source: 'cron:cold-storage-archive-live' }`
- Live mode can write archive JSON to the `archived-records` storage bucket and update `retention_flags` bookkeeping; source rows are never deleted by the edge function. C6.7 explicitly excludes this job.

## Dry-run safety facts (edge function `cold-storage-archive`)

- `dry_run` default is **TRUE** server-side; only an explicit `false` opts into live.
- Dry-run writes only `retention_run_evidence` (lifecycle + per-candidate) and, where `flag.org_id` is set, per-org `audit_logs` skip rows.
- No bucket writes, no `retention_flags` updates, no source-table mutation, no deletes in dry-run.
- No emails, no notifications, no provider calls. Idempotent (`already_exported=true` skip + storage `upsert:false`).

## Current candidate count

- `public.retention_flags` total rows: **0** at apply time → zero dry-run candidates; the most recent ticks produced lifecycle evidence rows only.

## Decision — separate heartbeat name

- Heartbeat row used: `cold-storage-archive-dryrun` (dedicated).
- Live row `cold-storage-archive-live` is **not** created.
- No shared `cold-storage-archive` row is created or reused. Dry-run and live retain independent observability rows mirroring the C6.5 / C6.6 split.

## Pre-apply `cron_invoke` payload-preservation check — PASS

`public.cron_invoke(text, text, jsonb)` body construction:

```
v_body := COALESCE(p_body, '{}'::jsonb)
          || jsonb_build_object(
               'cron_run_id',   v_run_id,
               'cron_job_name', p_job_name
             );
```

- `dry_run`, `limit`, `source` are forwarded verbatim from `p_body`.
- Only `cron_run_id` and `cron_job_name` are appended.
- No overwrite, strip, or coercion of `dry_run`.
- Auth: `x-internal-key` from vault, identical to the prior raw invocation; no Authorization/Bearer literal.

Result: safe to convert without behaviour change.

## New cron command (post-apply)

```sql
SELECT public.cron_invoke(
  'cold-storage-archive-dryrun',
  'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/cold-storage-archive',
  jsonb_build_object(
    'dry_run', true,
    'limit', 50,
    'source', 'cron:cold-storage-archive-dryrun'
  )
);
```

Preserved: `jobid=40`, `jobname='cold-storage-archive-dryrun'`, `schedule='40 3 * * 0'`, `active=true`, URL, full payload shape.

## Heartbeat seed

```sql
INSERT INTO public.cron_heartbeats (job_name, last_status, expected_interval_seconds)
VALUES ('cold-storage-archive-dryrun', 'pending', 604800)
ON CONFLICT (job_name) DO UPDATE
  SET expected_interval_seconds = 604800,
      updated_at = now();
```

- `expected_interval_seconds = 604800` (weekly).
- On conflict: only refresh `expected_interval_seconds` and `updated_at`; existing run history is preserved.

## Tests

Added: `src/tests/c6-7-cold-storage-archive-dryrun-heartbeat.test.ts` — pins the migration to: alter only jobid 40; cron_invoke wrapper; correct job name, URL, and payload; separate heartbeat row at 604800s; no schedule/active change; no live row; no Authorization/Bearer/JWT/raw net.http_post; no edits to source tables or edge function.

Existing guards relevant to this change: `src/tests/c6-{1,2,3,4,5}-*.test.ts`, `scripts/check-data-004-batch9a-cold-storage-schedule.mjs` (cold-storage schedule pin).

## Confirmations

- No edge function was invoked manually.
- No storage objects, archive rows, source rows, or business tables were mutated by this apply.
- No schedule or active-state change for jobid 40 or any other job.
- jobid 41 (live), jobid 39, jobid 42, and all other cron jobs were not touched.

## Runtime status

Pending: next scheduled Sunday 03:40 UTC tick of jobid 40 must show:

- `dry_run=true` recorded in `retention_run_evidence.details`;
- no live archive writes (no new `archived-records` storage objects, no `retention_flags.archive_storage_path` updates);
- `public.cron_heartbeats` row `cold-storage-archive-dryrun` updated with `last_status` advancing from `pending` and a fresh `last_correlation_id` / `last_request_id`.

Only then promote to `C6_7_COLD_STORAGE_ARCHIVE_DRYRUN_HEARTBEAT_RUNTIME_CONFIRMED`.
