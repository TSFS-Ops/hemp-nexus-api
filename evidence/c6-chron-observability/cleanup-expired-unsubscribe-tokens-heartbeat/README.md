# C6.3 — cleanup-expired-unsubscribe-tokens heartbeat coverage

**Status:** `C6_3_CLEANUP_EXPIRED_UNSUBSCRIBE_TOKENS_HEARTBEAT_DEPLOYED_PENDING_TICK`

## Scope

Adds heartbeat observability to the daily SQL-only cleanup job (jobid 18).
No edge function involved. No business behaviour change. No token deletion
performed by this migration.

## Original cron row

| field    | value                                              |
| -------- | -------------------------------------------------- |
| jobid    | 18                                                 |
| jobname  | cleanup-expired-unsubscribe-tokens                 |
| schedule | `15 3 * * *` (daily 03:15 UTC)                     |
| active   | true                                               |
| command  | `SELECT public.cleanup_expired_unsubscribe_tokens();` |

## Cleanup criteria (unchanged)

`public.cleanup_expired_unsubscribe_tokens()` deletes exclusively from
`public.email_unsubscribe_tokens` where `expires_at < now() AND used_at IS NULL`.
The wrapper does **not** re-implement or widen this criteria — it calls the
existing function exactly once.

## Why a SQL wrapper instead of cron_invoke

The job is direct SQL with no HTTP/edge-function surface. `cron_invoke` is the
right pattern for edge-function jobs (C6.1, C6.2). For pure-SQL jobs the
correct precedent is `public.run_reconcile_acceptance_notifications_with_heartbeat`
(C5b). C6.3 mirrors that shape with one deliberate difference (see "Failure
behaviour" below).

## Migration

`supabase/migrations/20260627205915_e8f709b7-793e-4f4d-929e-fc7730a2d2aa.sql`

Three steps:

1. **Create wrapper** `public.run_cleanup_expired_unsubscribe_tokens_with_heartbeat()`
   — SECURITY DEFINER, `SET search_path = public`, RETURNS integer.
   - Calls `public.cleanup_expired_unsubscribe_tokens()` exactly once, captures
     the deleted-row integer.
   - On success: UPSERT `cron_heartbeats` for
     `job_name='cleanup-expired-unsubscribe-tokens'` with
     `last_status='success'`, `last_run_at=now()`,
     `expected_interval_seconds=86400`, `last_error=NULL`,
     `last_http_status=NULL`, `last_request_id=NULL`,
     `last_metadata = { wrapper, deleted_count }`. Returns the integer.
   - On exception: UPSERT same row with `last_status='failed'`,
     `last_error=SQLERRM`, `last_metadata = { wrapper, error }`, then `RAISE;`.
2. **Seed heartbeat row** for the job (`last_status='pending'` only on first
   insert; `ON CONFLICT (job_name) DO UPDATE` only refreshes
   `expected_interval_seconds=86400` and `updated_at`, preserving any
   historical `last_run_at`, `last_status`, `last_error`, `last_request_id`,
   `last_correlation_id`, `last_metadata`).
3. **`cron.alter_job(job_id := 18, command := 'SELECT public.run_cleanup_expired_unsubscribe_tokens_with_heartbeat();')`**.
   `jobid`, `jobname`, `schedule`, `active` are all preserved.

## Failure behaviour and rationale

Unlike the C5b precedent (which swallows and returns JSON), this wrapper
re-raises the exception after stamping `failed`. Rationale: the job currently
surfaces failures in `cron.job_run_details.status='failed'`. Swallowing would
*regress* pg-level cron failure visibility. Re-raising preserves the current
posture and adds heartbeat coverage on top. Admin risk for stale/failed is
opened by C4 from `cron_heartbeats`, not by this wrapper.

## Heartbeat seed (verified post-apply)

```
job_name                            | last_status | expected_interval_seconds | last_run_at
cleanup-expired-unsubscribe-tokens  | pending     | 86400                     | NULL
```

## Confirmations

- Cleanup function source is **unchanged**.
- Cleanup was **not** invoked manually by this migration.
- **No tokens were deleted** by this migration (pending count of expired-and-unused tokens at apply time was 0).
- Schedule `15 3 * * *` preserved.
- `active = true` preserved.
- `jobid = 18`, `jobname = cleanup-expired-unsubscribe-tokens` preserved.
- New cron command (verified): `SELECT public.run_cleanup_expired_unsubscribe_tokens_with_heartbeat();`
- No other `cron.job` row was touched.
- No edge function deployed, no provider called.
- No RLS, grants, policies, indexes, or other schema altered.

## Guard test

`src/tests/c6-3-cleanup-expired-unsubscribe-tokens-heartbeat.test.ts` pins:

- Wrapper exists with correct name and `RETURNS integer`, SECURITY DEFINER,
  `search_path = public`.
- Wrapper calls `cleanup_expired_unsubscribe_tokens(` exactly once.
- Wrapper does NOT contain `DELETE FROM ... email_unsubscribe_tokens` nor the
  `expires_at < now() AND used_at IS NULL` clause (no re-implementation).
- Success branch and failed branch UPSERT `cron_heartbeats`.
- Exception block contains a bare `RAISE;`.
- Heartbeat seed uses `job_name='cleanup-expired-unsubscribe-tokens'` and
  `expected_interval_seconds=86400`.
- `cron.alter_job(job_id := 18, …)` only — no other jobid touched.
- New command is exactly the wrapper call.
- No `cron.schedule`, no `cron.unschedule`, no `schedule :=`, no `active :=`.
- No `cron_invoke`, no `net.http_post`, no `Authorization`, no `Bearer eyJ`,
  no `/functions/v1/` URL.
- No mutation against business tables (POI/WaD/registry/payment/refund/
  balance/ledger/notification/email_send_log/audit/admin-risk).

## Runtime verification — PENDING

Next scheduled tick: **next 03:15 UTC**. Expected post-tick observation in
`cron_heartbeats` for `cleanup-expired-unsubscribe-tokens`:

- `last_status = 'success'`
- `last_run_at` advanced to the tick time
- `last_error IS NULL`
- `last_metadata.wrapper = 'run_cleanup_expired_unsubscribe_tokens_with_heartbeat'`
- `last_metadata.deleted_count` = integer

Tracker remains at `C6_3_..._DEPLOYED_PENDING_TICK` until the next scheduled
03:15 UTC tick is observed and shows the expected heartbeat state.
