# DATA-004 Batch 13 — Cold-Storage Positive-Candidate Live Evidence

Status: **Phase 1 staged. Phase 2 (post-tick verification) pending next scheduled `cold-storage-archive-live` tick.**

Purpose: prove that the live `cold-storage-archive-live` scheduled path
processes at least one real eligible candidate end-to-end (export object
written, source record intact, duplicate skipped, missing-source evidenced).

Batch 13 does NOT approve live email purge, live email anonymisation, live
account deletion, or storage-retention-cleanup. It only proves the
positive-candidate live cold-storage archive path.

---

## 1. Pre-checks (2026-05-30)

All pre-checks read directly from live `cron.job` (verified via
`supabase--read_query SELECT … FROM cron.job`). The Batch 12 SECURITY
DEFINER drift function `public.data_004_cron_drift_check()` is service-role
only, so its boolean result was reproduced by manually evaluating its
contract clauses against the same `cron.job` snapshot.

| Pre-check | Required | Observed | Pass |
|---|---|---|---|
| 1. `cold-storage-archive-live` scheduled & active | yes | jobid 41, `10 4 * * 0`, active=true | ✅ |
| 2. `cold-storage-archive-dryrun` scheduled & active | yes | jobid 40, `40 3 * * 0`, active=true | ✅ |
| 3. `account-deletion-sweeper-daily-dryrun` active | yes | jobid 25, `15 3 * * *`, active=true | ✅ |
| 4. `purge-email-send-log-daily-dryrun` active | yes | jobid 39, `20 3 * * *`, active=true | ✅ |
| 5. `storage-retention-cleanup-job` inactive | yes | jobid 7, active=false | ✅ |
| 6. Forbidden `purge-email-send-log-daily` absent | yes | not present | ✅ |
| 7. Forbidden `email-log-anonymise-daily` absent | yes | not present | ✅ |
| 8. Forbidden `account-deletion-sweeper-daily` (no -dryrun) absent | yes | not present | ✅ |
| 9. Forbidden `cold-storage-archive-weekly` absent | yes | not present | ✅ |
| 10. jobid 41 body pins `'dry_run', false` | yes | command excerpt confirms `body := jsonb_build_object('dry_run', false, …)` | ✅ |
| 11. jobid 40 body pins `'dry_run', true` | yes | command excerpt confirms `body := jsonb_build_object('dry_run', true, …)` | ✅ |
| 12. jobid 41 auth header uses vault `x-internal-key` | yes | command excerpt confirms `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERNAL_CRON_KEY' LIMIT 1)` | ✅ |
| 13. HQ Per-Org Retention "Live cron drift monitor" panel surfaces drift PASS | yes | `OrgRetentionHealthPanel` reads `cron_drift` from `admin-org-retention` `health`; live result reproduced from the same contract → PASS | ✅ (code-path verified; UI render to be re-confirmed post-tick) |

Cron drift contract restated for Batch 13: expected_active = {`account-deletion-sweeper-daily-dryrun`, `purge-email-send-log-daily-dryrun`, `cold-storage-archive-dryrun`, `cold-storage-archive-live`}; expected_inactive = {`storage-retention-cleanup-job`}; forbidden_absent = {`purge-email-send-log-daily`, `email-log-anonymise-daily`, `account-deletion-sweeper-daily`, `cold-storage-archive-weekly`}. Drift status: **PASS**.

---

## 2. Fixtures staged (Phase 1, 2026-05-30)

All fixture rows use deterministic UUIDs prefixed `b13` and the
`decision_notes` tag `data-004-batch13-cold-storage-positive-live:*` so
they are unambiguously identifiable for post-tick cleanup. No production
data was modified. Fixture insert migration is the only Batch 13
database mutation.

| Fixture | retention_flag id | table_name | record_id | retention_status | archive_storage_path | Expected live decision |
|---|---|---|---|---|---|---|
| **A — positive eligible** | `b13a2222-2222-4222-8222-222222222222` | compliance_cases | `b13a1111-1111-4111-8111-111111111111` (real row) | archived | NULL | `exported` — storage object written; source row remains intact; `retention_flags.archive_storage_path` populated |
| **B — duplicate** | `b13b3333-3333-4333-8333-333333333333` | compliance_cases | `b13b9999-9999-4999-8999-999999999999` (no source row) | archived | pre-set: `compliance_cases/2018/8fc9ee52…/b13b9999….json` | `skipped_due_to_duplicate` — no storage write attempted |
| **D — missing source** | `b13d4444-4444-4444-8444-444444444444` | compliance_cases | `b13d8888-8888-4888-8888-888888888888` (no source row) | archived | NULL | LIVE path: `exported_with_null_source` — storage object written with `source_record: null` and explicit `source_record_present: false` in metadata; evidence row carries `decision="exported_with_null_source"` |

Fixture A source row (real):
- `compliance_cases.id = b13a1111-1111-4111-8111-111111111111`
- `org_id = 8fc9ee52-ce88-456f-8ef9-c6984fc6fae1`
- `entity_id = 235d10ae-98c0-4c0b-895f-d3f40c95d253`
- `status = 'APPROVED'`
- `decision_notes = 'data-004-batch13-cold-storage-positive-live:fixture-A'`

### Fixture C (row-level legal hold) — intentionally deferred

`compliance_cases` maps to `scopeType = null` in
`cold-storage-archive/index.ts` `COLD_TABLE_TO_SCOPE`, so the per-row
legal-hold check at lines 386–444 is bypassed for compliance_cases
candidates. Exercising row-level legal hold therefore requires a
fixture in a hold-mapped table (`matches`, `match_documents`,
`match_events`, `wads`, `pois`), each of which carries deep NOT NULL
FK chains (`buyer_entity_id`, `industry_code`, `jurisdiction_code`,
related `entities`, etc.) whose synthesis materially exceeds the
"do not change code/schedule" envelope of Batch 13.

The batch-level `record_group=cold_storage_archive` legal-hold sentinel
path (lines 263–270, 318–348) was already exercised in Batch 9B
evidence; it is not re-run here because activating it during the
Batch 13 tick would block Fixtures A/B/D as well.

Row-level legal-hold live evidence is recommended for a separate
follow-up batch ("DATA-004 Batch 14 — Cold-Storage Row-Level Legal
Hold Live Evidence") with the necessary `pois`/`wads` fixture cascade.
Acceptance criterion 5 explicitly accommodates this:
*"legal-hold skip works, where supported by current cold-storage
legal-hold model."*

---

## 3. Live invocation pathway

Per the batch prompt: *"Wait for the scheduled `cold-storage-archive-live`
tick at Sunday 04:10 UTC, or trigger only through an approved
cron-equivalent live pathway if the environment supports it without
changing the schedule."*

The sandbox cannot read `INTERNAL_CRON_KEY` or
`SUPABASE_SERVICE_ROLE_KEY`, which are the only two credentials the
`cold-storage-archive` edge function accepts (auth block at
supabase/functions/cold-storage-archive/index.ts:181-190). Committing a
migration containing `SELECT net.http_post(...)` against the live URL
was rejected because such a migration would re-fire on every project
remix, which is destructive at the cross-project level.

Therefore Batch 13 invocation is the **scheduled tick at jobid 41**:
**Sunday 2026-05-31 04:10:00 UTC**. No schedule, body, code, or
auth changes have been made.

---

## 4. Phase 2 collection checklist (post-tick, operator)

Run after the scheduled live tick fires. All queries are read-only.

1. Pre-tick → post-tick cron drift comparison:
   ```sql
   -- Confirm cron contract unchanged.
   SELECT jobid, jobname, schedule, active FROM cron.job
   WHERE jobname IN (
     'account-deletion-sweeper-daily-dryrun',
     'purge-email-send-log-daily-dryrun',
     'cold-storage-archive-dryrun',
     'cold-storage-archive-live',
     'storage-retention-cleanup-job'
   ) ORDER BY jobid;
   ```
   Expected: identical to §1.

2. Locate the live run id (latest live cold-storage-archive started row):
   ```sql
   SELECT run_id, started_at, finished_at, status, details
   FROM public.retention_run_evidence
   WHERE job_name = 'cold-storage-archive'
     AND status = 'started'
     AND (details ->> 'dry_run')::boolean = false
     AND started_at >= '2026-05-31 04:09:00+00'
     AND started_at <  '2026-05-31 04:30:00+00'
   ORDER BY started_at DESC LIMIT 1;
   ```

3. Pull all per-flag evidence rows for that run_id:
   ```sql
   SELECT status, decision, reason, org_id, details
   FROM public.retention_run_evidence
   WHERE run_id = '<run_id from step 2>'
   ORDER BY created_at;
   ```
   Expected rows:
   - Fixture A (flag `b13a2222-…`): `status='success'`, `decision='exported'`, `details.storage_path = 'compliance_cases/<year>/8fc9ee52-…/b13a1111-…json'`, `details.payload_hash` present, `details.source_record_present = true`.
   - Fixture B (flag `b13b3333-…`): `status='skipped'`, `decision='skipped_due_to_duplicate'`, `reason='archive_storage_path_already_set'`.
   - Fixture D (flag `b13d4444-…`): `status='success'`, `decision='exported_with_null_source'`, `details.source_record_present = false`.
   - Final lifecycle row: `status='partial'` (Fixture D triggers `anySkip=true`; Fixtures A+D processed; Fixture B duplicate), with `details.audit_write_failures = []` and `details.evidence_write_failures = []`.

4. Confirm storage exports written:
   ```sql
   SELECT name, bucket_id, metadata
   FROM storage.objects
   WHERE bucket_id = 'archived-records'
     AND name IN (
       'compliance_cases/<year-of-record_created_at>/8fc9ee52-ce88-456f-8ef9-c6984fc6fae1/b13a1111-1111-4111-8111-111111111111.json',
       'compliance_cases/<year-of-record_created_at>/8fc9ee52-ce88-456f-8ef9-c6984fc6fae1/b13d8888-8888-4888-8888-888888888888.json'
     );
   ```
   Expected: two new objects (Fixture A + Fixture D); none for Fixture B.

5. Confirm source row untouched (no deletion, no destructive mutation):
   ```sql
   SELECT id, org_id, entity_id, status, decision_notes, created_at
   FROM public.compliance_cases
   WHERE id = 'b13a1111-1111-4111-8111-111111111111';
   ```
   Expected: row still present, unchanged from §2.

6. Confirm Fixture A flag bookkeeping (only mutation contract permits):
   ```sql
   SELECT id, archive_storage_path, archive_hash, archive_size_bytes, archived_at
   FROM public.retention_flags
   WHERE id = 'b13a2222-2222-4222-8222-222222222222';
   ```
   Expected: `archive_storage_path` now set; `archive_hash` SHA-256 hex; `archived_at` ~ tick time.

7. Confirm Fixture B flag untouched (idempotency holds):
   ```sql
   SELECT archive_storage_path, archive_hash, archive_size_bytes, archived_at
   FROM public.retention_flags
   WHERE id = 'b13b3333-3333-4333-8333-333333333333';
   ```
   Expected: identical to the pre-tick pre-set values.

8. HQ Per-Org Retention → "Live cron drift monitor" panel: re-render and
   confirm latest live cold-storage run is visible and drift remains PASS.

9. `audit_write_failures = []` and `evidence_write_failures = []` on the
   final lifecycle row (step 3).

10. Cleanup migration after evidence captured:
    ```sql
    DELETE FROM public.retention_flags
    WHERE id IN (
      'b13a2222-2222-4222-8222-222222222222',
      'b13b3333-3333-4333-8333-333333333333',
      'b13d4444-4444-4444-8444-444444444444'
    );
    DELETE FROM public.compliance_cases
    WHERE id = 'b13a1111-1111-4111-8111-111111111111';
    -- Storage objects created by the live tick may be retained as
    -- preserved evidence of a real export, or removed per runbook;
    -- if removed, audit with reason 'data-004-batch13-cleanup'.
    -- retention_run_evidence rows MUST be preserved.
    ```

---

## 5. Acceptance criteria mapping

| Criterion | Phase 1 status | Phase 2 verification step |
|---|---|---|
| Live cold-storage run processes ≥ 1 eligible candidate | staged (Fixture A) | §4 step 3 |
| Export object written for eligible candidate | staged | §4 step 4 |
| Source row remains present | staged | §4 step 5 |
| No destructive mutation | enforced by code contract | §4 step 5 |
| Duplicate skip works | staged (Fixture B) | §4 step 3 + §4 step 7 |
| Legal-hold skip works (where supported) | row-level deferred → Batch 14 recommended; batch-level previously evidenced in Batch 9B | n/a this batch |
| Missing-source path evidenced | staged (Fixture D) | §4 step 3 + §4 step 4 |
| Retention evidence clear | n/a yet | §4 step 3 |
| Failure arrays empty or explained | n/a yet | §4 step 9 |
| HQ Health reflects latest live run | n/a yet | §4 step 8 |
| Cron drift remains PASS | pre-tick PASS | §4 step 1 |
| No cron schedules changed | enforced | §4 step 1 |
| No other enforcement path changed | enforced (no code/migration in Batch 13 beyond fixture INSERTs) | n/a |

---

## 6. Fail conditions (operator must flag any of)

- Eligible candidate not exported without a clear reason in evidence row.
- Any source row deletion or destructive mutation.
- Legal-hold candidate exported.
- Duplicate exported again.
- Missing-source path silently swallowed.
- `audit_write_failures` / `evidence_write_failures` non-empty without explanation.
- No `retention_run_evidence` rows for the tick.
- HQ Health does not show latest live run.
- Cron drift transitions PASS → WARN/FAIL due to unexpected schedule mutation.
- Any unrelated live or destructive job appears in `cron.job`.

---

## 7. Scope guardrails (re-affirmed)

- No cron schedule added, removed, or changed.
- No edge function code changed.
- No retention policy/floor changed.
- No live email purge, email anonymisation, account deletion, storage
  cleanup, or sentinel scheduling enabled.
- Only mutation: three `retention_flags` rows + one `compliance_cases`
  row (deterministic `b13*` UUIDs).
- `RELEASE_GATE.md`, `docs/launch-runbook.md`, and the per-org-retention
  memory will be updated **only after Phase 2 evidence passes** —
  per the batch prompt's "Update only if evidence passes" clause.
