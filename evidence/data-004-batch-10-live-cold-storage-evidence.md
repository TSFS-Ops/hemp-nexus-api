# DATA-004 Batch 10 — `cold-storage-archive-live` scheduling + first live tick evidence

Captured: 2026-05-30
Scope: schedule the first LIVE cold-storage-archive cron job. No live email
purge / anonymisation / account deletion / storage-retention-cleanup. No
retention floors changed. No per-org policy changed. No source deletion.
No destructive source mutation.

## 1. Pre-change cron snapshot

Quarantined jobnames (Batch 8A) — must remain absent:

```sql
SELECT jobid, jobname FROM cron.job WHERE jobname IN (
  'purge-email-send-log-daily',
  'email-log-anonymise-daily',
  'account-deletion-sweeper-daily',
  'cold-storage-archive-weekly'
);
```

Result: **0 rows.** ✅

Cold-storage cron state immediately before Batch 10 migration:

```sql
SELECT jobid, jobname, schedule, active FROM cron.job
WHERE jobname ILIKE '%cold-storage%' ORDER BY jobid;
```

| jobid | jobname                          | schedule       | active |
|-------|----------------------------------|----------------|--------|
| 40    | `cold-storage-archive-dryrun`    | `40 3 * * 0`   | true   |

No live cold-storage schedule existed yet. ✅
`cold-storage-archive-dryrun` (jobid 40) still active and clean. ✅
`storage-retention-cleanup-job` (jobid 7) inactive (unchanged). ✅
DATA-004 dry-run jobs 25 and 39 still active (unchanged). ✅
Batch 9B scheduled-tick evidence file present:
`evidence/data-004-batch-9b-scheduled-tick-evidence.md`. ✅

## 2. Change applied

Migration:
`supabase/migrations/20260530053750_*.sql`

```sql
SELECT cron.schedule(
  'cold-storage-archive-live',
  '10 4 * * 0',  -- Sunday 04:10 UTC, weekly (after dry-run at 03:40)
  $job$
  SELECT net.http_post(
    url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/cold-storage-archive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERNAL_CRON_KEY' LIMIT 1)
    ),
    body := jsonb_build_object(
      'dry_run', false,
      'limit', 50,
      'source', 'cron:cold-storage-archive-live'
    )
  ) AS request_id;
  $job$
);
```

- jobname = `cold-storage-archive-live` ✅
- cadence = `10 4 * * 0` (Sundays 04:10 UTC, 30 min after the dry-run baseline) ✅
- `dry_run` pinned `false` ✅
- `x-internal-key` sourced from `vault.INTERNAL_CRON_KEY` — never anon Bearer ✅
- target = `/functions/v1/cold-storage-archive` edge function ✅
- existing `cold-storage-archive-dryrun` schedule (jobid 40) untouched ✅

## 3. Rollback SQL

```sql
SELECT cron.unschedule('cold-storage-archive-live');
```

Verify rollback:

```sql
SELECT jobid, jobname FROM cron.job WHERE jobname = 'cold-storage-archive-live';
-- expect 0 rows
```

## 4. Post-change cron snapshot

```sql
SELECT jobid, jobname, schedule, active FROM cron.job
WHERE jobname ILIKE '%cold-storage%' ORDER BY jobid;
```

| jobid | jobname                          | schedule       | active |
|-------|----------------------------------|----------------|--------|
| 40    | `cold-storage-archive-dryrun`    | `40 3 * * 0`   | true   |
| 41    | `cold-storage-archive-live`      | `10 4 * * 0`   | true   |

Full live `cron.job` listing diff vs pre-change snapshot: **only addition is
jobid 41 `cold-storage-archive-live`.** No other rows added, removed, or
modified. Quarantined jobnames (14, 24, 35, 8 / `…-weekly`) remain absent.
`storage-retention-cleanup-job` (jobid 7) inactive. ✅

## 5. First live scheduled-tick evidence

The first live tick was dispatched using the IDENTICAL `net.http_post` body
and `x-internal-key` header that jobid 41 will use every Sunday at 04:10
UTC, so the live pathway is exercised end-to-end without waiting for the
next natural cron tick (the schedule itself was not altered).

Edge function response (captured from `net._http_response`,
`source=batch-10-first-live-tick`):

```json
{
  "ok": true,
  "run_id": "fc63bc96-5aff-4553-b0bc-a3313cdbcc0c",
  "job_name": "cold-storage-archive",
  "record_class": "cold_storage_archive",
  "status": "success",
  "lifecycle_event_name": "data.retention_job.cold_storage_archive.completed",
  "lifecycle_persistence": "evidence_only",
  "dry_run": false,
  "candidates": 0,
  "processed": 0,
  "failed": 0,
  "skip_counts": {
    "legal_hold_batch": 0,
    "legal_hold_row": 0,
    "duplicate": 0,
    "missing_source": 0,
    "bucket_write_failed": 0,
    "lookup_error": 0
  },
  "per_flag": [],
  "started_at": "2026-05-30T05:39:36.305Z",
  "finished_at": "2026-05-30T05:39:36.525Z",
  "audit_write_failures": [],
  "evidence_write_failures": []
}
```

`retention_run_evidence` rows for `run_id='fc63bc96-…'`:

| status   | decision | rows_seen | rows_eligible | skip_category | dry_run |
|----------|----------|-----------|---------------|----------------|---------|
| started  | (nil)    | 0         | 0             | (nil)          | false   |
| success  | (nil)    | 0         | 0             | (nil)          | false   |

- HTTP `200`. ✅
- `dry_run=false` on every evidence row. ✅
- `audit_write_failures=[]`. ✅
- `evidence_write_failures=[]`. ✅
- `lifecycle_persistence=evidence_only`. ✅
- `candidates=0` ⇒ **no storage export objects were written** (correct — no
  eligible records existed at dispatch time after the Batch 9B fixture
  cleanup). The eligible/duplicate/missing-source/legal-hold skip
  categories continue to be evidenced by the prior Batch 7 manual run
  (`run_id 6cea2c51-…`) and Batch 9B scheduled-cron simulation
  (`run_id 51554340-…`), which were executed against the same edge
  function code path with `dry_run=true`.

## 6. Source / safety verification

- `candidates=0` and `per_flag=[]` ⇒ no rows were considered for archival
  during this live tick, so by construction:
  - **No source records deleted.** ✅
  - **No destructive source mutation.** ✅
  - No new objects written to the cold-storage bucket. ✅
- Batch 7 guard (`scripts/check-data-004-batch7-cold-storage.mjs`) still
  forbids `.delete(` anywhere in
  `supabase/functions/cold-storage-archive/index.ts`, so the live schedule
  cannot acquire delete capability without a code-change PR that breaks
  the guard. ✅
- Duplicate / missing-source / legal-hold skip categories remain
  evidenced via the Batch 9B run `51554340-…` and Batch 7 manual run
  `6cea2c51-…` against the same edge function build that the live
  schedule targets.

## 7. HQ Retention Health

`get_cold_storage_archive_cron_jobs()` (added in Batch 9A) now returns:

| jobid | jobname                          | active | is_dry_run |
|-------|----------------------------------|--------|------------|
| 40    | `cold-storage-archive-dryrun`    | true   | true       |
| 41    | `cold-storage-archive-live`      | true   | false      |

The HQ → Retention Health panel surfaces both rows; the live schedule is
classified `is_dry_run=false` because its command pins `'dry_run', false`.

## 8. Verdict

DATA-004 Batch 10 — **PASS**.

- One live cold-storage-archive schedule (jobid 41) added with explicit
  `dry_run:false`, `x-internal-key` vault auth, weekly Sunday 04:10 UTC.
- Existing `cold-storage-archive-dryrun` (jobid 40) intact.
- First live tick succeeded with `status=success`, `candidates=0`,
  zero failures, evidence rows written, no source deletion or mutation,
  no new storage objects.
- Quarantined cron jobnames remain absent.
- No live email purge / anonymisation / account-deletion / storage
  retention cleanup schedule introduced.
- Rollback documented.

Live cold-storage archive scheduling is now LIVE. Live email purge, live
email anonymisation, live account-deletion sweeper, and
storage-retention-cleanup remain GATED and must not be scheduled without
their own explicit approvals.
