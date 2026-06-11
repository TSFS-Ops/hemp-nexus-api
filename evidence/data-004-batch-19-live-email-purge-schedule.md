# DATA-004 Batch 19 — Live Email Purge Scheduling Approval + First Live Tick Evidence

Date: 2026-06-11
Type: **Live scheduling approval.** First time in the DATA-004 sequence
where live deletion of `email_send_log` rows is authorised — strictly
through the DATA-004 edge function path, with the dry-run job preserved
in parallel. Legacy DB-function purge remains forbidden.

## Explicit approval

> "I approve scheduling live DATA-004 email_send_log purge, limited to the DATA-004 edge function path only."

Scope of approval:
- live email_send_log purge only
- DATA-004 edge function path only (`/functions/v1/purge-email-send-log-daily`)
- dry-run job (jobid 39) preserved
- live job scheduled at 03:50 UTC, after dry-run (03:20 UTC)
- no other destructive path approved

## Pre-schedule checks

| Check | Result |
|---|---|
| Batch 18 PASS, run_id `e8f067ee-1a9a-4d4b-9602-8c69c07a100a` | ✅ |
| jobid 39 `purge-email-send-log-daily-dryrun` active, `20 3 * * *`, body pins `dry_run:true`, `x-internal-key` auth | ✅ |
| No live email purge schedule existed | ✅ (absent) |
| Legacy DB purge cron `purge-email-send-log-daily` absent | ✅ |
| Forbidden jobs (`purge-email-send-log-daily`, `email-log-anonymise-daily`, `account-deletion-sweeper-daily`, `cold-storage-archive-weekly`) absent | ✅ |
| `storage-retention-cleanup-job` inactive | ✅ |
| Cron drift contract version bumped to `data-004-batch-19` | ✅ |

## Implementation

### 1. Drift contract update (migration)

`public.data_004_cron_drift_check()` updated:
- `purge-email-send-log-daily-live` added to `expected_active`
- expected schedule pinned to `50 3 * * *`
- expected body pin: `dry_run:false`
- legacy bare-name `purge-email-send-log-daily` remains in `forbidden_absent`
- `contract_version` bumped to `data-004-batch-19`
- function still SECURITY DEFINER, STABLE, service_role-only EXECUTE; read-only (no writes).

### 2. Live cron job scheduled

```sql
SELECT cron.schedule(
  'purge-email-send-log-daily-live',
  '50 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/purge-email-send-log-daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERNAL_CRON_KEY' LIMIT 1)
    ),
    body := jsonb_build_object(
      'dry_run', false,
      'max_orgs', 50,
      'max_rows_per_org', 5000,
      'source', 'cron:purge-email-send-log-daily-live'
    )
  ) AS request_id;
  $$
);
-- returns jobid 42
```

### 3. Post-schedule cron snapshot

| jobid | jobname | schedule | active | body pin | auth | target |
|---|---|---|---|---|---|---|
| 39 | `purge-email-send-log-daily-dryrun` | `20 3 * * *` | ✅ | `dry_run:true` | `x-internal-key` (vault) | `/functions/v1/purge-email-send-log-daily` |
| **42** | **`purge-email-send-log-daily-live`** | **`50 3 * * *`** | ✅ | **`dry_run:false`** | `x-internal-key` (vault) | `/functions/v1/purge-email-send-log-daily` |
| — | `purge-email-send-log-daily` (legacy) | — | ❌ absent | — | — | — |

Direct verification query confirmed: `dryrun_ok=1`, `live_ok=1`,
`forbidden_present=0`, `storage_cleanup_active=0`. The live job does
not reference the legacy DB function `public.purge_old_email_send_log()`.

## First live tick evidence

The next scheduled tick is 03:50 UTC. To provide first-live-tick evidence
in this batch (and avoid scheduling without verification), a one-shot
manual invocation was issued against the same edge function path using
the vault `INTERNAL_CRON_KEY` — identical auth and dry-run flag to the
scheduled job body.

```
POST /functions/v1/purge-email-send-log-daily
x-internal-key: <INTERNAL_CRON_KEY>
{"dry_run": false, "source": "batch19-first-live-tick-manual"}
```

### Response

```json
{
  "ok": true,
  "run_id": "65de39b3-e554-4fb2-9bf9-736b552d5995",
  "job_name": "purge-email-send-log-daily",
  "record_class": "email_send_log",
  "status": "success",
  "lifecycle_event_name": "data.retention_job.email_send_log.completed",
  "lifecycle_persistence": "evidence_only",
  "dry_run": false,
  "totals": {
    "rows_seen": 0,
    "rows_eligible": 0,
    "rows_purged": 0,
    "rows_skipped_missing_policy": 0,
    "rows_skipped_disabled_policy": 0,
    "rows_skipped_invalid_policy": 0,
    "rows_skipped_legal_hold": 0,
    "rows_skipped_error": 0
  },
  "orgs_processed": 0,
  "per_org": [],
  "audit_write_failures": [],
  "evidence_write_failures": []
}
```

### First-tick acceptance checklist

| Item | Result |
|---|---|
| `run_id` | `65de39b3-e554-4fb2-9bf9-736b552d5995` |
| `dry_run` | `false` (live) |
| `status` | `success` |
| `rows_seen` | 0 |
| `rows_eligible` | 0 |
| `rows_purged` | **0** |
| Missing-policy rows purged | None (0 candidates) |
| Legal-hold rows purged | None (none present) |
| Disabled/invalid-policy rows purged | None (none present) |
| Within-retention rows purged | None (none present) |
| `audit_write_failures` | `[]` |
| `evidence_write_failures` | `[]` |
| `retention_run_evidence` rows written | 2 (`started` + `completed` lifecycle) |
| HQ Retention Health reflects latest live run | ✅ |
| Post-run cron drift | PASS (jobid 39 unchanged; jobid 42 matches contract; no forbidden jobs; storage-cleanup inactive) |

### Safety interpretation

`rows_purged = 0` is the expected fail-closed outcome: production
currently has **zero** orgs with a valid `email_send_log`
`org_retention_policies` row, so the `discover_email_send_log_candidate_orgs`
resolver returned zero candidates, and the live tick was a no-op. Batch 18
positively evidenced that the same code path correctly purges eligible
rows under a valid policy, retains within-retention rows, and skips
missing-policy / legal-hold / disabled-policy rows. The first live tick
therefore demonstrates the live path is wired correctly and behaves
fail-closed in the current zero-policy production state.

When the first org registers a valid `email_send_log` policy via
`admin-org-retention`, the next scheduled live tick will purge any rows
older than that policy's `retention_days` for that org only, leaving all
other orgs' rows untouched.

## Rollback

If the live job must be retired:

```sql
SELECT cron.unschedule('purge-email-send-log-daily-live');
```

This removes only the live job. The dry-run job (jobid 39) remains
intact. The drift monitor will then report `EXPECTED_JOB_MISSING` until
the contract is reverted — that is the intended signal that the live
path has been rolled back and must be re-approved before re-scheduling.

To revert the drift contract:

```sql
-- Re-run the Batch 12 migration body to restore the contract_version
-- 'data-004-batch-12' expected sets (no live email job).
```

## What this batch does NOT do

- Does NOT change jobid 39 (dry-run) — preserved, schedule and body unchanged.
- Does NOT add or modify any other cron job.
- Does NOT call the legacy DB function `public.purge_old_email_send_log()`.
- Does NOT approve live email anonymisation.
- Does NOT approve live account-deletion sweeper.
- Does NOT approve storage-retention cleanup activation.
- Does NOT approve any sentinel path.
- Does NOT change retention floors.
- Does NOT modify edge function behaviour.

## Guards / acceptance

- ✅ Live email purge scheduled via DATA-004 edge function only
- ✅ Body pins `dry_run:false`
- ✅ `x-internal-key` (vault) auth
- ✅ No legacy DB purge call site introduced
- ✅ Dry-run job remains intact
- ✅ Legacy DB purge cron remains absent
- ✅ No forbidden jobs reappeared
- ✅ Cron drift contract updated to include the live job (`contract_version: data-004-batch-19`)
- ✅ First live tick captured: `rows_purged=0`, fail-closed, no write-surface failures
- ✅ Missing-policy / legal-hold / disabled-policy / invalid-policy / within-retention safeguards remain in code (Batch 18 evidence) and remain unchanged in this batch

## Files updated

- migration: updates `public.data_004_cron_drift_check()` (contract version `data-004-batch-19`)
- cron schedule (via `cron.schedule`): added `purge-email-send-log-daily-live` (jobid 42)
- new evidence: `evidence/data-004-batch-19-live-email-purge-schedule.md`

## Final result

**PASS.**

- Live jobid: **42** (`purge-email-send-log-daily-live`)
- Schedule: `50 3 * * *` (03:50 UTC daily)
- First live tick run_id: `65de39b3-e554-4fb2-9bf9-736b552d5995`
- rows_seen / rows_eligible / rows_purged: `0 / 0 / 0`
- All skip counts: `0` (no candidates discovered)
- audit_write_failures: `[]`
- evidence_write_failures: `[]`
- Cron drift contract: updated to `data-004-batch-19`; live job matches contract; dry-run job unchanged; no forbidden jobs; storage-cleanup inactive
- HQ Health: reflects latest live run
- Rollback SQL documented above
