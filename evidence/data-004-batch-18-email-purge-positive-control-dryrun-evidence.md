# DATA-004 Batch 18 — Email Purge Positive-Control Dry-Run Evidence

Date: 2026-06-11
Type: Evidence batch only. **No live purge scheduled. No cron changed. No
destructive behaviour changed. No edge function logic changed. No retention
floor changed. Dry-run only.**

## Purpose

Prove the DATA-004 `email_send_log` purge path correctly handles real
candidate rows across the five decision categories before any live
scheduling decision is taken. Batch 17 was "READY WITH CAVEATS" because
the production dataset contained zero eligible rows and no live policies,
so none of the positive-control paths had been exercised end-to-end.

## Pre-checks

| Check | Result |
|---|---|
| Live cron drift monitor (snapshot at run-time, see "Cron snapshot" below) | PASS |
| jobid 39 `purge-email-send-log-daily-dryrun` active | ✅ active, schedule `20 3 * * *` |
| jobid 39 pins `dry_run:true` in body | ✅ |
| Live email purge schedule exists (`purge-email-send-log-daily`) | ❌ absent (correct) |
| Legacy DB purge cron present | ❌ absent (correct) |
| Forbidden destructive jobs (`email-log-anonymise-daily`, `account-deletion-sweeper-daily`, `cold-storage-archive-weekly`) | ❌ absent (correct) |
| jobid 7 `storage-retention-cleanup-job` | ✅ inactive (correct) |
| HQ Retention Health surfaces only the dry-run job | ✅ |

### Cron snapshot (pre- and post-run, unchanged)

```
 2  data-retention-job                       0 2 * * *     active=false
 3  lifecycle-scheduler-job                  0 3 * * *     active=true
 7  storage-retention-cleanup-job            0 2 * * *     active=false
 9  infra-alerts-5min                        */5 * * * *   active=true
10  process-email-queue                      5 seconds     active=true
17  outreach-sla-monitor-hourly              0 * * * *     active=true
18  cleanup-expired-unsubscribe-tokens       15 3 * * *    active=true
20  dispatch-acceptance-receipts             */2 * * * *   active=true
21  reconcile-acceptance-notifications       */2 * * * *   active=true
22  clip-on-subscription-bill-daily          30 2 * * *    active=false
25  account-deletion-sweeper-daily-dryrun    15 3 * * *    active=true
29  webhook-retry-job                        */5 * * * *   active=true
30  engagement-reminder-daily                0 6 * * *     active=true
31  burn-poi-reconciliation-daily            30 3 * * *    active=true
32  infra-alerts-cron                        */5 * * * *   active=true
33  cron-heartbeat-reconcile                 * * * * *     active=true
34  sentry-heartbeat-cron                    */15 * * * *  active=true
36  balance-drift-reconciliation-daily       15 3 * * *    active=true
37  side-effect-reconciliation-daily         45 3 * * *    active=true
38  transaction-reconciliation-job           */15 * * * *  active=true
39  purge-email-send-log-daily-dryrun        20 3 * * *    active=true   body pins "dry_run": true
40  cold-storage-archive-dryrun              40 3 * * 0    active=true
41  cold-storage-archive-live                10 4 * * 0    active=true   body pins "dry_run": false
```

No new cron job was created during this batch. jobid 39 was untouched.

## Fixture setup

All synthetic rows tagged `metadata.fixture = 'data-004-batch18-email-purge-positive-control'`.

| Letter | Org ID | Policy | Legal hold | Row age | Expected decision |
|---|---|---|---|---|---|
| A | `0e2a4ab5-0cf9-46ee-a956-920b5d96f035` | valid (`retention_days=90`) | none | 120 d | `eligible_for_purge` |
| B | `c93f1f59-0e7c-490d-87c3-5e4676d9171e` | valid (`retention_days=90`) | none | 10 d | `retained_not_expired` |
| C | `1de34688-ce32-47e8-9ba7-5aa11cd9665e` | **no policy** | none | 120 d | `skipped_due_to_missing_policy` |
| D | `df04cc60-5b94-4e5e-8cf8-1c304730d896` | valid (`retention_days=90`) | active `scope_type=org` | 120 d | `skipped_due_to_legal_hold` |
| E | `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` | `retention_days=90`, `metadata.enabled=false` | none | 120 d | `skipped_due_to_disabled_policy` |

5 `email_send_log` rows were inserted per fixture (25 total), each with
`metadata.org_id = <fixture org>` so the
`discover_email_send_log_candidate_orgs` resolver picks them up.

## Execution

Single manual dry-run invocation via service-role-pattern (`x-internal-key`
header matching `INTERNAL_CRON_KEY`):

```
POST /functions/v1/purge-email-send-log-daily
x-internal-key: <INTERNAL_CRON_KEY>
{"dry_run": true}
```

`run_id`: **`e8f067ee-1a9a-4d4b-9602-8c69c07a100a`**

## Function response (per-fixture)

```json
{
  "ok": true,
  "run_id": "e8f067ee-1a9a-4d4b-9602-8c69c07a100a",
  "status": "partial",
  "dry_run": true,
  "totals": {
    "rows_seen": 25,
    "rows_eligible": 5,
    "rows_purged": 0,
    "rows_skipped_missing_policy": 5,
    "rows_skipped_disabled_policy": 5,
    "rows_skipped_invalid_policy": 0,
    "rows_skipped_legal_hold": 5,
    "rows_skipped_error": 0
  },
  "orgs_processed": 5,
  "audit_write_failures": [],
  "evidence_write_failures": []
}
```

| Fixture | Org | Decision | Reason | rows_seen | rows_eligible | rows_purged |
|---|---|---|---|---|---|---|
| A | `0e2a4ab5…` | `eligible_for_purge` | `policy_resolved_and_age_exceeded` | 5 | 5 | 0 |
| B | `c93f1f59…` | `retained_not_expired` | `row_age_days(10) < retention_days(90)` | 5 | 0 | 0 |
| C | `1de34688…` | `skipped_due_to_missing_policy` | `no_explicit_policy_for_org_record_class` | 5 | 0 | 0 |
| D | `df04cc60…` | `skipped_due_to_legal_hold` | `Deletion/anonymisation is blocked because an active legal hold exists for this scope.` | 5 | 0 | 0 |
| E | `aaaaaaaa…` | `skipped_due_to_disabled_policy` | `policy.metadata.enabled === false` | 5 | 0 | 0 |

**All five decision branches matched expectation. `rows_purged=0` across the board. No audit-write failures. No evidence-write failures.**

## retention_run_evidence rows

7 rows written for `run_id = e8f067ee-1a9a-4d4b-9602-8c69c07a100a`:

- 1 × `status=started` (lifecycle, `org_id=null`)
- 1 × `status=partial` (lifecycle finalisation, aggregated totals)
- 5 × per-org rows (one per fixture), each carrying `decision`, `reason`, `rows_seen`, `rows_eligible`, `rows_purged=0`, and the appropriate `rows_skipped_*` bucket.

Lifecycle rows correctly persist as `evidence_only`; per-org skip rows
also wrote canonical `data.retention_job.email_send_log.skipped` rows to
`audit_logs` (per the function's documented persistence contract).

## Resolver proof

`discover_email_send_log_candidate_orgs` returned 5 org rows — exactly
the five fixture orgs — confirming that:

1. `email_send_log` rows are attributed to their owning org via
   `metadata->>'org_id'`.
2. Orgs without `org_retention_policies` rows (Fixture C) are still
   surfaced as candidates and explicitly skipped with
   `skipped_due_to_missing_policy`, rather than being silently protected
   by absence-from-iteration.
3. The eligible-rows count step in the function
   (`metadata->>'org_id' = <orgId>` + `created_at < cutoff`) correctly
   located Fixture A's 5 rows and ignored Fixture B's in-window rows.

## HQ Retention Health

Reflects the latest dry-run (`rows_purged=0`, partial status, dry-run
copy intact). No copy implies live purge is active. Cron drift monitor
still reports PASS.

## Cleanup

| Action | Result |
|---|---|
| `DELETE` synthetic `email_send_log` fixture rows | 25 → 0 remaining |
| Release synthetic `legal_holds` row with audited `released_reason` | active=0, released=1 |
| `DELETE` synthetic `org_retention_policies` rows | 4 → 0 remaining |
| Preserve `retention_run_evidence` for `run_id` | 7 rows retained |
| Preserve per-org `audit_logs` skip rows | retained |
| Cron state | unchanged |

## What this batch does NOT do

- Does **not** schedule live email purge.
- Does **not** change any cron schedule, add, or remove any cron job.
- Does **not** alter `purge-email-send-log-daily` edge function logic.
- Does **not** modify any retention floor.
- Does **not** touch `email-log-anonymise`, account deletion sweeper,
  storage cleanup, cold storage, or any sentinel path.
- Does **not** approve live email purge.

## Acceptance — checklist

- [x] Eligible rows are counted in dry-run (Fixture A: 5 eligible)
- [x] Within-retention rows are retained (Fixture B)
- [x] Missing-policy rows are explicitly skipped (Fixture C)
- [x] Legal-hold rows are explicitly skipped (Fixture D)
- [x] Disabled-policy rows are explicitly skipped (Fixture E)
- [x] Resolver behaviour proven (metadata→org mapping correct for all 5)
- [x] `rows_purged = 0` across all fixtures
- [x] `audit_write_failures = []`
- [x] `evidence_write_failures = []`
- [x] `retention_run_evidence` rows written and preserved
- [x] Cron drift remains PASS, jobid 39 unchanged, no live schedule
- [x] No destructive behaviour occurred

## Final recommendation

**READY for separate Batch 19 live scheduling approval.**

All five decision branches of the DATA-004 `email_send_log` purge path
are now positively evidenced end-to-end on real candidate rows with
correct org attribution. The remaining safety gates (dry-run-only cron,
fail-closed missing/disabled/invalid policy handling, fail-closed legal
hold, audit + evidence write surfaces) all behaved correctly.

Batch 19, if approved, should:
1. Re-run the live cron drift monitor immediately before scheduling and
   confirm PASS unchanged.
2. Schedule a new live cron job (e.g. `purge-email-send-log-daily-live`)
   with `dry_run:false` pinned in the body and `x-internal-key` auth,
   leaving jobid 39 in place as the dry-run sentinel.
3. Capture first-tick live evidence (expected `rows_purged > 0` for any
   org that has accrued a valid `email_send_log` policy AND eligible
   rows; today no production org has both, so the first tick is likely
   to remain a no-op until a real policy is registered).
4. Re-snapshot cron and update the drift contract / RELEASE_GATE / launch
   runbook to reflect the new live job.

Batch 19 must be a separate, explicit approval decision. This batch does
not authorise it.
