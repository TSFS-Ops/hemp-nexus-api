# DATA-004 Batch 12 — Live Cron Drift Monitor (evidence)

Date: 2026-05-30
Type: New read-only control. **No cron schedule changed, no cron added/removed, no edge function destructive behaviour changed, no policy/floor changed.**

## What was added

1. **DB function** `public.data_004_cron_drift_check()` (migration `20260530060055_*`)
   - `SECURITY DEFINER`, `STABLE`, `SET search_path = public, cron`.
   - `REVOKE ALL` from `public`, `anon`, `authenticated`; `GRANT EXECUTE` to `service_role` only.
   - Performs **zero writes** — no `INSERT`/`UPDATE`/`DELETE`, no `cron.schedule()`, no `cron.unschedule()`, no `net.http_post()`.
   - Returns JSONB with: `status` (pass/warn/fail), `read_only: true`, `last_checked`, `contract_version`, `expected_active`, `expected_inactive`, `forbidden_absent`, `expected_schedule`, `expected_dry_run`, `actual[]`, `findings[]`, `summary{critical,high,medium,low,total}`.

2. **Edge function** `admin-org-retention` (existing, platform_admin-only)
   - `health` action additionally calls `admin.rpc("data_004_cron_drift_check")` and returns the report under `cron_drift`.
   - No new write surface, no new mutation path, no AAL2 change.

3. **HQ UI** `OrgRetentionHealthPanel.tsx`
   - New "Live cron drift monitor" alert with pass/warn/fail badge, last-checked timestamp, contract version, findings list (severity + code + jobname + detail + recommended action), and expandable expected-vs-actual.
   - Explicit copy: "READ-ONLY MONITOR — does not modify cron state, never auto-remediates."

4. **Prebuild guard** `scripts/check-data-004-batch-12-cron-drift-readonly.mjs`
   - Asserts migration is SECURITY DEFINER + STABLE + explicit search_path + service_role-only EXECUTE.
   - Asserts migration body has zero cron-mutation verbs.
   - Asserts edge function calls the drift RPC and never references `cron.schedule` / `cron.unschedule`.
   - Asserts `RELEASE_GATE.md` and `docs/launch-runbook.md` carry the Batch 12 section with the verbatim phrases "read-only" and "does not modify cron state".

## Approved DATA-004 cron contract (encoded in the RPC)

- **Expected active**: `account-deletion-sweeper-daily-dryrun`, `purge-email-send-log-daily-dryrun`, `cold-storage-archive-dryrun`, `cold-storage-archive-live`.
- **Expected inactive**: `storage-retention-cleanup-job`.
- **Forbidden / must be absent**: `purge-email-send-log-daily`, `email-log-anonymise-daily`, `account-deletion-sweeper-daily`, `cold-storage-archive-weekly`.
- **Expected schedules**: `15 3 * * *`, `20 3 * * *`, `40 3 * * 0`, `10 4 * * 0`, and `0 2 * * *` for the inactive job.
- **Expected dry_run body pins**: dry-run jobs must pin `"dry_run": true`; the live cold-storage job must pin `"dry_run": false`.
- **Auth pattern**: every DATA-004 cron body must use `x-internal-key`.

## Drift rules → severity

| Code | Severity | Trigger |
|---|---|---|
| `FORBIDDEN_JOB_PRESENT` | critical | a quarantined jobname reappears in `cron.job` |
| `INACTIVE_JOB_BECAME_ACTIVE` | critical | `storage-retention-cleanup-job` flips to active |
| `DRY_RUN_BODY_DRIFT` | critical | an approved dry-run body loses `"dry_run":true` (or pins false) |
| `LIVE_BODY_DRIFT` | critical | `cold-storage-archive-live` loses `"dry_run":false` (or pins true) |
| `AUTH_PATTERN_DRIFT` | critical | a DATA-004 body drops the `x-internal-key` auth header |
| `EXPECTED_JOB_MISSING` | high | an approved jobname is absent from `cron.job` |
| `EXPECTED_JOB_INACTIVE` | high | an approved jobname exists but is not active |
| `SCHEDULE_DRIFT` | high | an approved jobname's schedule differs from the contract |
| `UNEXPECTED_DATA_004_JOB` | high | a job referencing DATA-004 keywords is not in the approved set |

`fail` if any critical OR high finding is present; `warn` if only medium; `pass` otherwise.

## Live result (2026-05-30, post-deploy)

The migration applied successfully. Direct invocation by a non-service-role caller returns `permission denied for function data_004_cron_drift_check` — confirming service_role lockdown. The function is consumed only via `admin-org-retention` (platform_admin-only). Operator should refresh the HQ Retention Health panel to observe the first live `cron_drift` payload — expected `status: pass` given the cron snapshot in the Closeout Pack.

## Limitations (explicit)

- The drift monitor reads `cron.job` only. It does not read `cron.job_run_details`, so it cannot detect job-execution failures (those continue to be surfaced via `retention_run_evidence`).
- Body inspection uses whitespace-stripped substring matches for `"dry_run":true` / `"dry_run":false` and `x-internal-key`. Operators must not reformat cron bodies into unusual whitespace patterns.
- The monitor flags drift only; it never auto-remediates. Every non-pass finding requires explicit operator review and a separate approved batch to fix.
- The prebuild guard cannot inspect live `cron.job`. The drift monitor itself is the runtime control for live cron state — the guard only ensures the monitor exists, is read-only, and is documented.

## Operator instructions

1. Open HQ → Retention & Holds → Retention Health.
2. Refresh; observe the "Live cron drift monitor" alert.
3. If `status=pass`, no action.
4. If `status=warn` or `status=fail`:
   - Read each finding's `recommended_action` (e.g. `SELECT cron.unschedule('<jobname>');`).
   - Do NOT execute remediation without a separate approved batch.
   - Capture a fresh `SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;` snapshot as evidence.
   - Open a new batch (e.g. "DATA-004 Cron Drift Remediation — <date>") for the correction.

## What this batch does NOT do

- Does **not** change any cron schedule.
- Does **not** add or remove any cron job.
- Does **not** convert any dry-run job to live.
- Does **not** approve live email purge, live email anonymisation, live account deletion, or storage cleanup.
- Does **not** modify any retention policy or floor.
- Does **not** change any edge function destructive behaviour.

## Files added / changed

- new migration: `supabase/migrations/20260530060055_*_data_004_batch12_cron_drift_check.sql` (function `public.data_004_cron_drift_check`).
- edited `supabase/functions/admin-org-retention/index.ts` (health response now includes `cron_drift`).
- edited `src/components/admin/OrgRetentionHealthPanel.tsx` (new read-only drift alert).
- new guard `scripts/check-data-004-batch-12-cron-drift-readonly.mjs`.
- new evidence: `evidence/data-004-batch-12-cron-drift-monitor.md` (this file).
- doc updates: `RELEASE_GATE.md`, `docs/launch-runbook.md`.
- memory updates: `mem://features/per-org-retention-shell`, `mem://index.md`.
