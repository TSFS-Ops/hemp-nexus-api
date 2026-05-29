# DATA-004 Batch 9A — Cold-storage scheduled dry-run cron snapshot

Captured: 2026-05-29
Source: `SELECT jobid, jobname, schedule, active, command FROM cron.job` against live DB.

## New schedule — MUST be present and dry-run pinned

Query:
```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'cold-storage-archive-dryrun';
```

Result:

| jobid | jobname                       | schedule       | active |
|-------|-------------------------------|----------------|--------|
| 40    | `cold-storage-archive-dryrun` | `40 3 * * 0`   | true   |

Command body (verbatim from `cron.job.command`):

```
SELECT net.http_post(
  url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/cold-storage-archive',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-internal-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERNAL_CRON_KEY' LIMIT 1)
  ),
  body := jsonb_build_object(
    'dry_run', true,
    'limit', 50,
    'source', 'cron:cold-storage-archive-dryrun'
  )
) AS request_id;
```

✅ `dry_run` pinned `true`.
✅ Auth uses `x-internal-key` from `vault.INTERNAL_CRON_KEY` — not anon Bearer.
✅ Target is the Batch 7 edge function `/functions/v1/cold-storage-archive` — not a legacy DB function.
✅ Schedule is weekly Sunday 03:40 UTC, no collision with jobid 25 (03:15), 39 (03:20), 31 (03:30), 37 (03:45), or 3 (03:00).

## Reversibility

```sql
SELECT cron.unschedule('cold-storage-archive-dryrun');
```

## Quarantined jobs — MUST remain absent

Query:
```sql
SELECT jobid, jobname FROM cron.job WHERE jobname IN (
  'purge-email-send-log-daily',
  'email-log-anonymise-daily',
  'account-deletion-sweeper-daily',
  'cold-storage-archive-weekly'
);
```

Result: **0 rows.** ✅

## No live `cold-storage-archive` schedule

Query:
```sql
SELECT jobid, jobname FROM cron.job
WHERE jobname ILIKE '%cold-storage%' AND jobname <> 'cold-storage-archive-dryrun';
```

Result: **0 rows.** ✅

## DATA-004 dry-run + inactive jobs — unchanged

| jobid | jobname                                  | schedule     | active |
|-------|------------------------------------------|--------------|--------|
| 25    | `account-deletion-sweeper-daily-dryrun`  | `15 3 * * *` | true   |
| 39    | `purge-email-send-log-daily-dryrun`      | `20 3 * * *` | true   |
| 7     | `storage-retention-cleanup-job`          | `0 2 * * *`  | false  |

✅ Bodies and schedules match the Batch 8B snapshot; not edited by Batch 9A.

## Verdict

Live cron state matches the DATA-004 Batch 9A contract:

- Exactly one `cold-storage-archive-dryrun` schedule, active, dry-run pinned, internal-key authenticated.
- No live cold-storage-archive schedule.
- No quarantined jobname reappeared.
- Existing dry-run schedules (jobid 25, 39) and inactive jobid 7 are unchanged.
- No live email purge / anonymise / account-deletion schedule introduced.

Operator note: this snapshot is the artifact that satisfies the Batch 9A gate. It must be re-captured (and this file re-dated) before any Batch 9B+ live-schedule approval. The first scheduled tick of `cold-storage-archive-dryrun` will land in `retention_run_evidence` and must be reviewed before any live-archive scheduling discussion.
