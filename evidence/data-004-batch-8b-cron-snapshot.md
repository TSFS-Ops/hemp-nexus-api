# DATA-004 Batch 8B — Live cron-state evidence snapshot

Captured: 2026-05-29
Source: `SELECT jobid, jobname, schedule, active FROM cron.job` against live DB.

## Quarantined jobs — MUST NOT be present

Query:
```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'purge-email-send-log-daily',
  'email-log-anonymise-daily',
  'account-deletion-sweeper-daily',
  'cold-storage-archive-weekly'
);
```

Result: **0 rows.** ✅

All four quarantined jobnames are absent from live `cron.job`. This confirms the Batch 8A `cron.unschedule()` calls for jobids 14, 24, 35, and 8 persisted.

## DATA-004 dry-run jobs — MUST be present and active

Query:
```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'purge-email-send-log-daily-dryrun',
  'account-deletion-sweeper-daily-dryrun'
);
```

Result:

| jobid | jobname                                  | schedule     | active |
|-------|------------------------------------------|--------------|--------|
| 25    | account-deletion-sweeper-daily-dryrun    | `15 3 * * *` | true   |
| 39    | purge-email-send-log-daily-dryrun        | `20 3 * * *` | true   |

✅ Both jobs scheduled, active, and on the expected cadence. Bodies pin `dry_run:true` / `p_dry_run:true` with `INTERNAL_CRON_KEY` via vault (verified at Batch 8A capture; not re-edited since).

## storage-retention-cleanup-job — MUST remain inactive

Query:
```sql
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'storage-retention-cleanup-job';
```

Result:

| jobid | jobname                          | schedule     | active |
|-------|----------------------------------|--------------|--------|
| 7     | storage-retention-cleanup-job    | `0 2 * * *`  | false  |

✅ Inactive, untouched.

## cold-storage-archive — MUST NOT be scheduled

Query:
```sql
SELECT jobid, jobname FROM cron.job WHERE jobname ILIKE '%cold-storage%';
```

Result: **0 rows.** ✅ Batch 7 contract preserved.

## Verdict

Live cron state matches the DATA-004 contract after Batch 8A:

- No unauthorized live/destructive cron jobs (jobids 14, 24, 35 removed; jobid 8 removed).
- Both DATA-004 dry-run jobs intact (25, 39).
- `storage-retention-cleanup-job` (7) inactive.
- `cold-storage-archive` unscheduled.

This evidence file is the artifact that satisfies the Batch 8B gate. It must be re-captured (and this file dated) before any future Batch 9+ live-schedule approval.
