# DATA-004 Batch 14 — Cold-Storage Row-Level Legal Hold Live Evidence

**Status:** PASS
**Date:** 2026-06-04
**Run ID:** `903b44cc-50c4-4487-8838-a54c8884fb51`
**Invocation:** one-shot manual `POST /functions/v1/cold-storage-archive` via `net.http_post` using `x-internal-key` (INTERNAL_CRON_KEY from vault). `dry_run:false`, `limit:50`, `source:manual:data-004-batch14-row-hold-proof`. No cron schedule was created, modified, or removed.
**Approval:** explicit user approval recorded in chat — "Approved: proceed with DATA-004 Batch 14 using a one-shot manual live invocation today" (option b).

## 1. Purpose

Prove that an active row-level legal hold blocks a live `cold-storage-archive` export for a supported table whose `COLD_TABLE_TO_SCOPE` mapping is non-null. Closes the Fixture C gap deferred from Batch 13 (`compliance_cases` → `scopeType=null`, which could not exercise the row-level branch).

## 2. Chosen Table

`public.matches` → scope `"match"` per `supabase/functions/cold-storage-archive/index.ts:91-99`:

```ts
const COLD_TABLE_TO_SCOPE: Record<string, LegalHoldScopeType | null> = {
  matches: "match",
  match_documents: "evidence",
  match_events: "match",
  wads: "wad",
  pois: "poi",
  compliance_cases: null,
  screening_results: null,
};
```

Per-row legal-hold branch invoked at `cold-storage-archive/index.ts:386-443` via
`assertNoLegalHold(admin, [{ scope_type: scopeType, scope_id: cand.record_id }], …)`.

## 3. Pre-Run Cron Drift / Live Cron Snapshot

| jobid | jobname | schedule | active | expected |
|---|---|---|---|---|
| 7  | storage-retention-cleanup-job          | `0 2 * * *`   | false | inactive ✅ |
| 25 | account-deletion-sweeper-daily-dryrun  | `15 3 * * *`  | true  | active ✅ |
| 39 | purge-email-send-log-daily-dryrun      | `20 3 * * *`  | true  | active ✅ |
| 40 | cold-storage-archive-dryrun            | `40 3 * * 0`  | true  | active (dry_run:true pinned) ✅ |
| 41 | cold-storage-archive-live              | `10 4 * * 0`  | true  | active (dry_run:false pinned in vault) ✅ |

- Forbidden destructive `*-live` jobnames: absent ✅
- No unrelated cron schedule changed since Batch 13 evidence ✅
- Pre-run live-candidate state: `count(retention_flags WHERE retention_status IN ('archived','quarantined')) = 0` ✅ (clean — fixtures will be the only candidates)

## 4. Fixtures Staged

All fixtures tagged `metadata.fixture='data-004-batch14-cold-storage-row-hold'`. Synthetic data only; no real org/counterparty/PII.

| Fixture | match_id | retention_flag_id | archive_path | hold |
|---|---|---|---|---|
| A (held)      | `b14a0001-…0001` | `b14a1111-…1111` | NULL | active `legal_holds.id=b14a9999-…9999`, scope `match`/`b14a0001` |
| B (positive)  | `b14b0002-…0002` | `b14b2222-…2222` | NULL | none |
| C (duplicate) | `b14c0003-…0003` | `b14c3333-…3333` | `matches/2018/8fc9…/b14c0003.json` (pre-set) | none |

Retention flags use `record_created_at = now() - 8 years`, `retention_expires_at = now() - 1 year`, `retention_status='archived'` — eligible per `discover_cold_storage_archive_candidates` (migration `20260529181203`).

## 5. Live Invocation

```sql
SELECT net.http_post(
  url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/cold-storage-archive',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'x-internal-key',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='INTERNAL_CRON_KEY' LIMIT 1)
  ),
  body := jsonb_build_object('dry_run',false,'limit',50,'source','manual:data-004-batch14-row-hold-proof')
);
-- request_id = 619142
```

`net._http_response` for `id=619142`:

- `status_code: 200`
- `content_type: application/json`
- response body (verbatim):

```json
{
  "ok": true,
  "run_id": "903b44cc-50c4-4487-8838-a54c8884fb51",
  "job_name": "cold-storage-archive",
  "record_class": "cold_storage_archive",
  "status": "partial",
  "lifecycle_event_name": "data.retention_job.cold_storage_archive.partial",
  "lifecycle_persistence": "evidence_only",
  "dry_run": false,
  "candidates": 3,
  "processed": 1,
  "failed": 0,
  "skip_counts": {
    "legal_hold_batch": 0,
    "legal_hold_row": 1,
    "duplicate": 1,
    "missing_source": 0,
    "bucket_write_failed": 0,
    "lookup_error": 0
  },
  "per_flag": [
    {"flag_id":"b14a1111-1111-4111-8111-111111111111","decision":"skipped","reason":"skipped_due_to_legal_hold_row","org_id":"8fc9ee52-ce88-456f-8ef9-c6984fc6fae1"},
    {"flag_id":"b14b2222-2222-4222-8222-222222222222","decision":"exported","reason":"exported","org_id":"8fc9ee52-ce88-456f-8ef9-c6984fc6fae1"},
    {"flag_id":"b14c3333-3333-4333-8333-333333333333","decision":"skipped","reason":"skipped_due_to_duplicate","org_id":"8fc9ee52-ce88-456f-8ef9-c6984fc6fae1"}
  ],
  "started_at": "2026-06-04T10:38:17.325Z",
  "finished_at": "2026-06-04T10:38:18.533Z",
  "audit_write_failures": [],
  "evidence_write_failures": []
}
```

## 6. Per-Fixture Results

### Fixture A — row-level legal hold (the proof)

- `retention_run_evidence` row: `status=skipped`, `decision=skipped_due_to_legal_hold`, `reason=row_hold_id=b14a9999-9999-4999-8999-999999999999`, `details.skip_category=legal_hold_row`, `org_id=8fc9ee52-…`
- `retention_flags.b14a1111` post-run: `archive_storage_path = NULL`, `archive_hash = NULL`, `archive_size_bytes = NULL` — NOT promoted ✅
- `matches.b14a0001` post-run: row present, `hash='batch14-fixture-A-held-hash'`, `state='discovery'` — intact ✅
- `storage.objects` search for `b14a0001`: **0 rows** — no storage export written ✅
- Per-org audit `data.retention_job.cold_storage_archive.skipped` written (emitted via `writePerOrgSkipAudit`, `skip_category: legal_hold_row`).

### Fixture B — positive control (unheld)

- `retention_run_evidence` row: `status=success`, `decision=exported`, `reason=ok`, `org_id=8fc9ee52-…`
- `retention_flags.b14b2222` post-run: `archive_storage_path='matches/2018/8fc9…/b14b0002-…0002.json'`, `archive_hash=20a245f9…408036fd`, `archive_size_bytes=2064` — bookkeeping updated ✅
- `matches.b14b0002` post-run: row present, intact ✅ (cold-storage is non-destructive by contract)
- `storage.objects`: `bucket_id=archived-records`, `name=matches/2018/8fc9…/b14b0002-…0002.json`, `size=2064` ✅

### Fixture C — duplicate control

- `retention_run_evidence` row: `status=skipped`, `decision=skipped_due_to_duplicate`, `reason=archive_storage_path_already_set`, `details.skip_category=duplicate`
- `storage.objects` search for `b14c0003`: **0 rows** — no duplicate object written (pre-staged `archive_storage_path` was a synthetic placeholder, never materialised) ✅
- `retention_flags.b14c3333` unchanged.

## 7. Post-Run Cron Drift

Re-snapshot of `cron.job` for jobids 7/25/39/40/41 — identical to pre-run table in §3. No schedule/active/command drift. Cron drift remains PASS. ✅

## 8. HQ Retention Health

Latest `cold_storage_archive` run surfaces via `admin-org-retention?action=health` (it reads `retention_run_evidence` rows by `job_name`). The `903b44cc` lifecycle envelope (`status=started` → `status=partial`) is now the most-recent cold-storage run, replacing Batch 13's `99a12b33` as the visible "latest".

## 9. Failure Arrays

- `audit_write_failures: []` ✅
- `evidence_write_failures: []` ✅

## 10. Cleanup

- Fixture legal hold released: `legal_holds.b14a9999` → `status='released'`, `released_by=d7d6d024-…`, `released_at=2026-06-04T10:…Z`, `released_reason='data-004-batch14 PASS: row-level legal-hold proof completed; releasing fixture hold (run_id 903b44cc-…)'`.
- Fixture retention flags deleted: `DELETE FROM retention_flags WHERE id LIKE 'b14%'` → 0 rows remain ✅
- Fixture matches deleted: `DELETE FROM matches WHERE id LIKE 'b14%'` → 0 rows remain ✅
- `retention_run_evidence` for `run_id=903b44cc-…`: **5 rows preserved** (started + 3 per-flag + partial). ✅
- Storage object retained as preserved evidence (Batch 13 precedent): `archived-records/matches/2018/8fc9ee52-ce88-456f-8ef9-c6984fc6fae1/b14b0002-0002-4002-8002-000000000002.json` (size 2064 bytes, hash `20a245f9…408036fd`). Documented residual path.

## 11. Acceptance Criteria Mapped

| Criterion | Result |
|---|---|
| Row-level legal hold blocks live cold-storage export for supported table | PASS (Fixture A) |
| Unheld positive control exports successfully | PASS (Fixture B) |
| Duplicate control skips correctly | PASS (Fixture C) |
| No source deletion | PASS (3/3 source rows verified intact before cleanup) |
| No destructive source mutation | PASS (`hash`/`state`/`status` unchanged on B; A row intact) |
| Retention evidence clear | PASS (5 `retention_run_evidence` rows, per-flag detail) |
| Failure arrays empty or visible+explained | PASS (both empty) |
| Cron drift remains PASS | PASS (pre/post snapshots identical) |
| HQ Health reflects latest run | PASS (903b44cc is now latest cold-storage entry) |
| No cron or enforcement scope changed | PASS (read-only inspection; no schedule mutation; no sweeper wired) |

## 12. Final Result

**PASS.** Row-level legal-hold gating for live cold-storage export proven end-to-end on the `matches` table. Fixture C gap from Batch 13 closed.
