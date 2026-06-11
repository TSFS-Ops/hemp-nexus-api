# DATA-004 Batch 17 — Live Email Purge Pre-Approval Evidence Gate

Date: 2026-06-11
Type: **Read-only evidence collection.** No code, cron, schedule, edge function, retention policy, floor, or destructive behaviour was changed. No live email purge was scheduled. Legacy DB purge remains absent. Dry-run schedule remains intact.

Predecessor: `evidence/data-004-batch-16-live-email-purge-replacement-design.md` (design + §3 readiness checklist).

---

## 1. Cron drift & schedule state

Live `cron.job` snapshot (jobid, jobname, schedule, active) captured via `supabase--read_query` on 2026-06-11:

| jobid | jobname                                  | schedule        | active | DATA-004 expectation |
|-------|------------------------------------------|-----------------|--------|----------------------|
| 7     | storage-retention-cleanup-job            | `0 2 * * *`     | false  | inactive ✅ |
| 25    | account-deletion-sweeper-daily-dryrun    | `15 3 * * *`    | true   | active dry-run ✅ |
| 39    | purge-email-send-log-daily-dryrun        | `20 3 * * *`    | true   | active dry-run ✅ |
| 40    | cold-storage-archive-dryrun              | `40 3 * * 0`    | true   | active dry-run ✅ |
| 41    | cold-storage-archive-live                | `10 4 * * 0`    | true   | active live ✅ |

Forbidden / quarantined jobnames (`purge-email-send-log-daily`, `email-log-anonymise-daily`, `account-deletion-sweeper-daily`, `cold-storage-archive-weekly`) — **0 rows.** Legacy DB-function email purge **absent.** No live `purge-email-send-log-daily` schedule exists.

Body inspection of jobid 39:
```
url:  /functions/v1/purge-email-send-log-daily
auth: x-internal-key from vault.decrypted_secrets('INTERNAL_CRON_KEY')
body: { dry_run: true, max_orgs: 50, max_rows_per_org: 5000,
        source: 'cron:purge-email-send-log-daily-dryrun' }
```
✅ `dry_run` pinned `true`, `x-internal-key` auth pattern, DATA-004-compliant.

**Cron drift verdict: PASS.** All approved DATA-004 jobs present with expected schedules and bodies; all forbidden jobs absent; inactive job remains inactive. (Operator should still refresh HQ → Retention Health to confirm the live `data_004_cron_drift_check` RPC returns `status=pass`.)

---

## 2. Latest scheduled dry-run evidence

Source: `retention_run_evidence WHERE job_name='purge-email-send-log-daily'`, most recent completed tick.

| field                          | value |
|--------------------------------|-------|
| run_id                         | `da48b588-023a-4aeb-9480-2007af8aa02e` |
| started_at                     | 2026-06-11 03:20:01.285 UTC |
| finished_at                    | 2026-06-11 03:20:01.559 UTC |
| status                         | `success` |
| dry_run                        | `true` ✅ |
| rows_seen                      | 0 |
| rows_eligible                  | 0 |
| rows_purged                    | **0** ✅ |
| rows_skipped_missing_policy    | 0 |
| rows_skipped_disabled_policy   | 0 |
| rows_skipped_invalid_policy    | 0 |
| rows_skipped_legal_hold        | 0 |
| rows_skipped_error             | 0 |
| orgs_processed                 | 0 |
| audit_write_failures           | `[]` ✅ |
| evidence_write_failures        | `[]` ✅ |
| lifecycle_event_name           | `data.retention_job.email_send_log.completed` |
| lifecycle_persistence          | `evidence_only` |

Prior tick (`f8c1fc6c-…`, 2026-06-10 03:20) identical: zero counters, zero failures, success.

Both `started`+`success` rows persisted per evidence pattern. No failures.

---

## 3. Policy coverage review

Live counts on 2026-06-11:

| metric                                                    | count |
|-----------------------------------------------------------|------:|
| `email_send_log` rows total                               | 698 |
| rows older than 30 days                                   | 356 |
| rows older than 90 days                                   | 0 |
| rows older than 365 days                                  | 0 |
| `org_retention_policies` rows total                       | **0** |
| `org_retention_policies` for `record_class='email_send_log'` | **0** |
| `legal_holds` active (`released_at IS NULL`)              | 1 |

Interpretation:
- **No org currently has an `email_send_log` retention policy configured.** Per DATA-004 fail-closed contract, every org with `email_send_log` rows is currently in the *missing-policy* bucket and protected from any purge — including the live path if scheduled today.
- Latest dry-run reports `orgs_processed=0` / `rows_seen=0`, which is consistent with the fail-closed enumeration: the function walks orgs with valid policies, finds zero, and exits cleanly without iterating rows.
- Schema observation: `email_send_log` has no `org_id` column (verified via `information_schema.columns`). Org derivation for this record class therefore depends on the edge function's own resolver (presumably via `metadata` / recipient routing). This does **not** block live activation, but it means the policy-coverage path cannot be exercised end-to-end until at least one org has a valid `email_send_log` policy AND the resolver attributes ≥1 candidate row to it.

**Missing-policy rows remain protected.** Zero rows would be deleted by a live tick today.

---

## 4. Legal-hold proof

- 1 active legal hold exists on the platform (table `legal_holds`, `released_at IS NULL`).
- Latest dry-run reports `rows_skipped_legal_hold=0`, which is correct given `rows_seen=0`: no candidate row was inspected, so no legal-hold skip was triggered.
- **No row-level legal-hold positive control for `email_send_log` has been demonstrated yet.** Cold-storage's row-level legal-hold proof (Batch 14, fixture A on `matches`) is the only DATA-004 path with a live row-level hold fixture today.
- Per the user's instruction, **no legal-hold fixture was created in this batch.** Operator may decide before Batch 18 whether to (a) accept "no-op live" risk because zero rows are eligible regardless, or (b) require a synthetic `email_send_log` row + org policy + row-level hold fixture as a positive control. This is a §3 decision, not a Batch-17 action.

---

## 5. HQ Retention Health

(Operator visual verification required; data already confirmed via DB.) The HQ → Retention & Holds → Retention Health panel reads from `retention_run_evidence` and from `data_004_cron_drift_check`. With the snapshot above the panel must show:

- Latest `email_send_log` dry-run: `2026-06-11 03:20 UTC, success`.
- `rows_purged = 0`, all skip counters 0, `audit_write_failures=[]`, `evidence_write_failures=[]`.
- Cron drift: `pass`.
- No copy implying live email purge is active. (`EmailRetentionHealth.tsx` currently surfaces the 90-day retention banner — operator should re-confirm wording still reads "dry-run / scheduled" and not "Enforced" for the live path.)

This is a *visual confirmation* step for the operator; no code change is in scope here.

---

## 6. First-live-tick readiness checklist (Batch 16 §3)

| #  | Gate (Batch 16 §3)                                                                 | Result | Note |
|----|------------------------------------------------------------------------------------|--------|------|
| 1  | Fresh cron-drift PASS captured                                                     | PASS   | §1 above |
| 2  | Latest scheduled dry-run `success` with `dry_run=true` and `rows_purged=0`          | PASS   | run_id `da48b588…` |
| 3  | `audit_write_failures=[]` and `evidence_write_failures=[]`                          | PASS   | §2 |
| 4  | `skipped_missing_policy` reviewed and treated as protected                          | PASS   | 0 today; protection mechanism in force |
| 5  | `skipped_legal_hold` reviewed                                                       | PASS (vacuous) | 0 because `rows_seen=0` |
| 6  | Row-level legal-hold positive control on `email_send_log`                           | **NOT DEMONSTRATED** | No fixture created (out of scope this batch) |
| 7  | Duplicate / idempotency fixture for live path                                       | **NOT DEMONSTRATED** | No fixture created |
| 8  | Live edge function pins `dry_run:false` + `x-internal-key` + `purge-email-send-log-daily` body | NOT APPLICABLE | live job not yet scheduled — body to be set at Batch 18 |
| 9  | Documented rollback SQL (`cron.unschedule('purge-email-send-log-daily')`)           | PASS   | Batch 16 §5 |
| 10 | Explicit operator approval phrase "approve live email purge scheduling"            | **PENDING** | Not given in Batch 17 |
| 11 | HQ Retention Health visual confirmation                                             | PASS (data) / operator visual pending | §5 |
| 12 | Legacy DB-function purge + forbidden jobs absent                                    | PASS   | §1 |

---

## 7. Final recommendation

**Status: READY FOR APPROVAL WITH ONE CAVEAT.**

- All technical/cron/policy gates pass.
- A live tick today would be a **no-op**: zero orgs have `email_send_log` retention policies, so the fail-closed enumeration would purge zero rows. This is *safe by construction* — the destructive code path cannot harvest rows without a valid policy.
- The caveat is that this also means a live tick will not exercise the destructive code path against real data and will not produce a positive-control proof comparable to Batch 13 / 14 (cold-storage). Operator must choose:
  - **Option A — schedule live anyway.** Acceptable because the worst-case effect is "nothing happens, evidence row written". Positive-control proof would only appear once a real org configures an `email_send_log` policy and rows age past it.
  - **Option B — defer Batch 18 until either (i) at least one production org has a valid `email_send_log` policy AND aged rows, or (ii) a synthetic positive-control fixture is approved (separate batch).** This is the higher-evidence path and matches the Batch 13/14 precedent.
- Recommendation (advisory only — operator decides): **Option B**. The cold-storage path was promoted to live only after positive-control rows were exported in Batch 13 and the row-level legal-hold fixture passed in Batch 14. Holding `email_send_log` to the same bar means Batch 18 should require a positive-control fixture (synthetic email rows + org policy + row-level hold) before flipping the live schedule on. Until then, no harm is done by leaving the live schedule absent.

If operator chooses Option A, the explicit approval phrase **"approve live email purge scheduling"** must be given before any cron change.

---

## 8. What this batch did NOT do

- Did **not** schedule live email purge.
- Did **not** remove or modify the dry-run cron (jobid 39).
- Did **not** change any cron job, schedule, body, or auth pattern.
- Did **not** edit any edge function (`purge-email-send-log-daily`, `lifecycle-scheduler`, `admin-org-retention`, etc.).
- Did **not** create, modify, or delete any `org_retention_policies`, `legal_holds`, or `email_send_log` rows.
- Did **not** create a legal-hold or duplicate fixture.
- Did **not** touch `email-log-anonymise`, `account-deletion-sweeper`, `storage-retention-cleanup`, `cold-storage-archive`, or the `data-retention` sentinel.
- Did **not** modify `RELEASE_GATE.md`, `docs/launch-runbook.md`, or the live cron contract — none of those gates required updates for an evidence-only batch.

---

## 9. Files added

- `evidence/data-004-batch-17-live-email-purge-preapproval-evidence.md` (this file).

No other files changed. Live email purge, live anonymise, live account deletion, storage-retention-cleanup, and sentinel paths remain **GATED**.
