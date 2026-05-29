# DATA-004 Batch 9B — `cold-storage-archive-dryrun` scheduled-cron pathway evidence

Captured: 2026-05-29
Scope: scheduled dry-run only. No live archive. No schedule change. No new cron.

## 1. Pre-tick cron snapshot

Query:
```sql
SELECT jobid, jobname, schedule, active FROM cron.job
WHERE jobname ILIKE '%cold-storage%'
   OR jobname IN (
     'purge-email-send-log-daily-dryrun',
     'account-deletion-sweeper-daily-dryrun',
     'storage-retention-cleanup-job'
   )
ORDER BY jobid;
```

Result:

| jobid | jobname                                    | schedule       | active |
|-------|--------------------------------------------|----------------|--------|
| 7     | `storage-retention-cleanup-job`            | `0 2 * * *`    | false  |
| 25    | `account-deletion-sweeper-daily-dryrun`    | `15 3 * * *`   | true   |
| 39    | `purge-email-send-log-daily-dryrun`        | `20 3 * * *`   | true   |
| 40    | `cold-storage-archive-dryrun`              | `40 3 * * 0`   | true   |

Quarantined jobnames (Batch 8A): `purge-email-send-log-daily`,
`email-log-anonymise-daily`, `account-deletion-sweeper-daily`,
`cold-storage-archive-weekly` — all absent (0 rows). ✅

Active schedule command body (verbatim from `cron.job.command`):

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

- `dry_run` pinned `true` ✅
- `x-internal-key` sourced from `vault.INTERNAL_CRON_KEY` — not anon Bearer ✅
- Target = `/functions/v1/cold-storage-archive` edge function ✅

## 2. Fixture setup (`is_demo=true` org only)

Seeded directly into the demo org `aaaa0004-0004-0004-0004-aaaaaaaaaaaa`
(`D4P3 Fixture Org A`, `is_demo=true`) via insert-only psql:

| Candidate | flag_id (`b9b0f1a0-…`) | record_id (`b9b00001-…`) | screening_results | archive_storage_path | Expected decision         |
|-----------|------------------------|--------------------------|-------------------|----------------------|---------------------------|
| A         | `…0001`                | `…0001`                  | present           | NULL                 | `would_export` / dry_run  |
| C         | `…0003`                | `…0003`                  | present           | already set          | `skipped_due_to_duplicate`|
| D         | `…0004`                | `…00bd`                  | absent            | NULL                 | `skipped_due_to_missing_source` |

Fixture B (per-row legal hold) intentionally omitted: `screening_results`
maps to `null` in `COLD_TABLE_TO_SCOPE`
(`supabase/functions/cold-storage-archive/index.ts:98`), so per-row
legal-hold buckets are unreachable for this table by design. The
`legal_hold_batch` skip category is already covered by the Batch 7
manual-run evidence row `run_id 6cea2c51-0f45-4e96-8d5d-4eaabea786ba`
(`details.batch_hold_blocked=true`, all 3 candidates skipped with
`details.skip_category='legal_hold_batch'`) and is not re-exercised
here to avoid mutating live `legal_holds`.

## 3. Scheduled-cron pathway tick (simulated, schedule untouched)

Triggered with the exact body and auth header the scheduled job uses —
no `cron.schedule` / `cron.unschedule` calls:

```
curl -X POST \
  -H 'Content-Type: application/json' \
  -H "x-internal-key: $INTERNAL_CRON_KEY" \
  -d '{"dry_run":true,"limit":50,"source":"cron:cold-storage-archive-dryrun"}' \
  https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/cold-storage-archive
```

Response:

```json
{
  "ok": true,
  "run_id": "51554340-a074-4803-9465-ddf52bdb271f",
  "job_name": "cold-storage-archive",
  "record_class": "cold_storage_archive",
  "status": "partial",
  "lifecycle_event_name": "data.retention_job.cold_storage_archive.partial",
  "lifecycle_persistence": "evidence_only",
  "dry_run": true,
  "candidates": 3,
  "processed": 1,
  "failed": 0,
  "skip_counts": {
    "legal_hold_batch": 0,
    "legal_hold_row": 0,
    "duplicate": 1,
    "missing_source": 1,
    "bucket_write_failed": 0,
    "lookup_error": 0
  },
  "per_flag": [
    { "flag_id": "b9b0f1a0-…0001", "decision": "would_export", "reason": "dry_run", "org_id": "aaaa0004-…" },
    { "flag_id": "b9b0f1a0-…0003", "decision": "skipped",      "reason": "skipped_due_to_duplicate", "org_id": "aaaa0004-…" },
    { "flag_id": "b9b0f1a0-…0004", "decision": "skipped",      "reason": "skipped_due_to_missing_source", "org_id": "aaaa0004-…" }
  ],
  "audit_write_failures": [],
  "evidence_write_failures": []
}
```

### `retention_run_evidence` rows for this run

```sql
SELECT status, decision, rows_seen, rows_eligible, rows_skipped_legal_hold,
       details->>'skip_category', details->>'dry_run'
FROM public.retention_run_evidence
WHERE run_id='51554340-a074-4803-9465-ddf52bdb271f'
ORDER BY started_at, id;
```

| status   | decision                          | rows_seen | rows_eligible | skip_category   | dry_run |
|----------|-----------------------------------|-----------|---------------|-----------------|---------|
| started  | (nil)                             | 0         | 0             | (nil)           | true    |
| skipped  | `would_export`                    | 0         | 1             | (nil)           | true    |
| skipped  | `skipped_due_to_duplicate`        | 0         | 0             | `duplicate`     | true    |
| skipped  | `skipped_due_to_missing_source`   | 0         | 0             | `missing_source`| true    |
| partial  | (nil)                             | 3         | 1             | (nil)           | true    |

✅ Five evidence rows written.
✅ Every row carries `details.dry_run=true`.
✅ `audit_write_failures=[]` and `evidence_write_failures=[]`.
✅ `lifecycle_persistence=evidence_only` (no destructive lifecycle write).

## 4. Post-tick fixture / source state (proves no deletion / mutation)

Immediately after the tick, before cleanup:

```sql
SELECT
  (SELECT COUNT(*) FROM public.retention_flags WHERE flag_type='data-004-batch9b-fixture') AS flags_remaining,
  (SELECT COUNT(*) FROM public.screening_results WHERE metadata->>'fixture'='data-004-batch9b-cold-storage-scheduled-tick') AS sources_remaining,
  (SELECT COUNT(*) FROM public.retention_flags WHERE flag_type='data-004-batch9b-fixture' AND archive_storage_path IS NOT NULL) AS flags_with_archive_path;
```

| flags_remaining | sources_remaining | flags_with_archive_path |
|-----------------|-------------------|--------------------------|
| 3               | 2                 | 1                        |

- All 3 retention_flags present (none deleted).
- Both seeded screening_results present (none deleted).
- Only the pre-seeded duplicate flag (C) carried `archive_storage_path`;
  the eligible flag (A) was **not** mutated to set
  `archive_storage_path` (dry-run did not promote it to exported).

✅ No source deletion. ✅ No destructive source mutation.

## 5. Post-tick cron snapshot (schedule still dry-run only)

Same query as §1. Result identical to the pre-tick snapshot:

| jobid | jobname                                    | schedule       | active |
|-------|--------------------------------------------|----------------|--------|
| 7     | `storage-retention-cleanup-job`            | `0 2 * * *`    | false  |
| 25    | `account-deletion-sweeper-daily-dryrun`    | `15 3 * * *`   | true   |
| 39    | `purge-email-send-log-daily-dryrun`        | `20 3 * * *`   | true   |
| 40    | `cold-storage-archive-dryrun`              | `40 3 * * 0`   | true   |

✅ No live cold-storage schedule appeared.
✅ No quarantined jobname reappeared.
✅ Existing dry-run schedules (25, 39) and inactive jobid 7 unchanged.

## 6. HQ Retention Health surfacing

`admin-org-retention?action=health` continues to expose the active
`cold-storage-archive-dryrun` schedule under `cold_storage_archive`
→ `dry_run_schedules` (jobid 40, `40 3 * * 0`) with `live_schedules`
empty and the documented `cron.unschedule` rollback string. The new
`retention_run_evidence` row from this tick is visible in the latest
cold-storage block (most recent `started_at`).

## 7. Cleanup

Performed via migration
`supabase/migrations/<timestamp>_data_004_batch9b_fixture_cleanup.sql`:

```sql
DELETE FROM public.retention_flags
WHERE flag_type='data-004-batch9b-fixture'
  AND id IN ('b9b0f1a0-…0001','b9b0f1a0-…0003','b9b0f1a0-…0004');

DELETE FROM public.screening_results
WHERE id IN ('b9b00001-…0001','b9b00001-…0003')
  AND provider='fixture' AND is_demo=true;
```

Post-cleanup verification:

| flags_remaining | sources_remaining | evidence_rows_preserved |
|-----------------|-------------------|--------------------------|
| 0               | 0                 | 5                        |

- All fixture retention_flags removed.
- All fixture screening_results removed.
- The 5 append-only `retention_run_evidence` rows for this run are
  preserved (audit integrity).
- No legal_hold rows seeded (per-row hold path not reachable for
  `screening_results`); nothing to release.
- Fixture org `aaaa0004-…` retained — it is a long-lived demo org also
  used by other DATA-004 fixtures.

## Verdict — PASS

- Pre-checks pass: schedule is dry-run pinned, internal-key
  authenticated, targets the Batch 7 edge function, and the quarantined
  jobnames remain absent.
- The scheduled-cron pathway, invoked with the exact body and auth the
  scheduler uses, wrote 5 `retention_run_evidence` rows covering
  eligible (`would_export`), `duplicate`, and `missing_source`
  candidates with `dry_run=true`, no failure-array contents, and
  `lifecycle_persistence=evidence_only`.
- The `legal_hold_batch` skip-category is already proved by the
  prior Batch 7 evidence row `6cea2c51-…`; the `legal_hold_row`
  bucket is unreachable for `screening_results` by design.
- No source rows were deleted or destructively mutated.
- HQ Retention Health reflects the latest scheduled dry-run.
- Cron state after the tick is identical to before the tick.

## Carry-forward — DO NOT skip

- Batch 9B is **evidence-only**. It does **not** approve live
  cold-storage scheduling.
- Live cold-storage scheduling remains gated behind a separate,
  explicit **Batch 10** approval and a fresh live-cron snapshot.
- The first real scheduled tick will land Sunday 2026-05-31 03:40 UTC;
  this evidence file documents the exact pathway it will exercise.
