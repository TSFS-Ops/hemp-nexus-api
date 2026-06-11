# DATA-004 — Final Enterprise Status Pack

Date: 2026-06-11
Status: **CLOSEOUT — documentation/evidence only.** No code, cron, schedules, edge functions, policies, floors, sweepers, anonymisation, account deletion, storage cleanup, sentinel paths, or destructive behaviour changed by this pack.

---

## 1. Final DATA-004 status (plain English)

DATA-004 now provides:

- **Per-org retention governance.** Each organisation has a controlled retention policy row in `org_retention_policies`; effective windows are resolved via `get_effective_retention_days`. Writes are AAL2-gated through the `admin-org-retention` edge function (`list` / `set` / `clear` / `health`).
- **Legal-hold protection.** Active legal holds (org-scope and row-scope) block destructive retention actions. The `email_send_log` purge edge function and the `cold-storage-archive` edge function both consult holds before any destructive or export action.
- **Retention evidence.** Every retention job run writes to `retention_run_evidence` (run-level + per-candidate rows). Audit and evidence write failures are surfaced explicitly and never swallowed.
- **Cron drift monitoring.** A read-only `data_004_cron_drift_check()` RPC (Batch 12, contract `data-004-batch-19`) compares live `cron.job` against the approved DATA-004 contract and is surfaced in HQ → Per-Org Retention → "Live cron drift monitor".
- **Controlled email log purge.** `email_send_log` purge is wired through a single edge function (`purge-email-send-log-daily`). A dry-run schedule (jobid 39) writes evidence daily; a live schedule (jobid 42) executes destructive purges only for orgs with valid, enabled, non-held retention policies. The legacy DB-side `purge_old_email_send_log()` cron path is absent and the bare-name jobname is forbidden.
- **Controlled cold-storage archive.** `cold-storage-archive` is wired through a single edge function with a dry-run schedule (jobid 40) and a live schedule (jobid 41). The live path has been positively exercised against staged fixtures (Batch 13) and row-level legal-hold gating has been proven on `matches` (Batch 14). Cold-storage is non-destructive of source rows.
- **Destructive paths beyond `email_send_log` remain gated.** Live email anonymisation, live account-deletion sweeper, `storage-retention-cleanup-job`, sentinel paths, per-org enforcement beyond `email_send_log`, and org-admin mutation of retention windows each require their own explicit approval + fresh live-cron snapshot.

---

## 2. Final cron posture table

| jobid | jobname | schedule (UTC) | mode | target | auth | evidence | destructive? | rollback |
|------:|---------|---------------|------|--------|------|----------|--------------|----------|
| 25 | `account-deletion-sweeper-daily-dryrun` | `30 2 * * *` | dry-run | `/functions/v1/account-deletion-sweeper` | `x-internal-key` (vault `INTERNAL_CRON_KEY`) | `retention_run_evidence` + DATA-002 audits | No — dry-run only; no auth.users deletion | `SELECT cron.unschedule('account-deletion-sweeper-daily-dryrun');` |
| 39 | `purge-email-send-log-daily-dryrun` | `20 3 * * *` | dry-run | `/functions/v1/purge-email-send-log-daily` | `x-internal-key` (vault) | `retention_run_evidence` (daily) | No — `dry_run:true` pinned in body | `SELECT cron.unschedule('purge-email-send-log-daily-dryrun');` |
| 40 | `cold-storage-archive-dryrun` | `40 3 * * 0` (Sun) | dry-run | `/functions/v1/cold-storage-archive` | `x-internal-key` (vault) | `retention_run_evidence` (weekly) | No — `dry_run:true` pinned; no storage writes | `SELECT cron.unschedule('cold-storage-archive-dryrun');` |
| 41 | `cold-storage-archive-live` | `10 4 * * 0` (Sun) | LIVE | `/functions/v1/cold-storage-archive` | `x-internal-key` (vault) | `evidence/data-004-batch-13-cold-storage-positive-live-evidence.md`, `evidence/data-004-batch-14-cold-storage-row-hold-live-evidence.md` | Non-destructive export: writes storage objects + flags; never deletes/mutates source rows | `SELECT cron.unschedule('cold-storage-archive-live');` |
| 42 | `purge-email-send-log-daily-live` | `50 3 * * *` | LIVE | `/functions/v1/purge-email-send-log-daily` | `x-internal-key` (vault) | `evidence/data-004-batch-19-live-email-purge-schedule.md` (run `65de39b3-…` — fail-closed no-op) | Yes — DELETEs `email_send_log` rows only for orgs with valid+enabled+non-held policy past retention | `SELECT cron.unschedule('purge-email-send-log-daily-live');` |
| 7 | `storage-retention-cleanup-job` | (inactive) | inactive | — | — | — | (would be destructive) | n/a — already inactive |

**Quarantined / absent (must remain absent):**

| jobname | status | reason | evidence |
|---------|--------|--------|----------|
| `purge-email-send-log-daily` (legacy bare-name, DB-side `purge_old_email_send_log()`) | Absent — quarantined Batch 8A; superseded by Batch 19 edge path | Did not consume `org_retention_policies`, did not enforce `assertNoLegalHold`, no `retention_run_evidence` parity | `evidence/data-004-batch-8a-cron-quarantine.md`, `docs/deferred-policy-register.md` §15 |
| `email-log-anonymise-daily` (legacy live) | Absent — quarantined Batch 8A | Irreversible PII masking with no per-org policy lookup or evidence parity | `docs/deferred-policy-register.md` §17 |
| `account-deletion-sweeper-daily` (legacy live) | Absent — quarantined Batch 8A | Body was dry-run but auth referenced an unset GUC; correctly authenticated dry-run (jobid 25) preserved | `docs/deferred-policy-register.md` §16 |
| `cold-storage-archive-weekly` (legacy) | Absent | Pre-DATA-004 schedule; replaced by jobids 40 (dry-run) + 41 (live) | Batch 9A / Batch 10 records |

Cron-drift contract `data-004-batch-19` enforces this exact set: jobids 25/39/40/41/42 active, jobid 7 inactive, the four jobnames above forbidden.

---

## 3. Evidence map

- **Batch 12 — Live Cron Drift Monitor.** `data_004_cron_drift_check()` SECURITY DEFINER, STABLE, read-only. Proves: live `cron.job` is reconciled against the approved DATA-004 contract on every health call. Does not prove: that the contract itself is exhaustive of future schedules; the monitor reports, it does not self-heal.
- **Batch 13 — Cold-Storage Positive-Candidate Live Evidence** (run `99a12b33-4bcf-43f4-a201-ef93a306062d`). Proves: live `cold-storage-archive` exports eligible rows, skips duplicates, surfaces missing-source as a non-swallowed failure, writes `retention_run_evidence` parity, and does not delete source rows. Does not prove: row-level legal-hold gating on a scope-mapped table (deferred to Batch 14).
- **Batch 14 — Cold-Storage Row-Level Legal Hold Live Evidence** (run `903b44cc-50c4-4487-8838-a54c8884fb51`, table `matches`, scope `"match"`). Proves: an active row-level `legal_holds` row blocks live cold-storage export with `decision=skipped_due_to_legal_hold`, no storage object, source intact; an unheld positive control exports successfully; a duplicate is skipped. Does not prove: row-level legal-hold gating for any future table mapped after 2026-06-04.
- **Batch 18 — Email Purge Positive-Control Dry-Run Evidence** (run `e8f067ee-1a9a-4d4b-9602-8c69c07a100a`). Proves: end-to-end handling of every decision branch for the `email_send_log` record class — eligible / within-retention / missing-policy / legal-hold / disabled-policy — using synthetic fixtures and the `discover_email_send_log_candidate_orgs` resolver via `metadata->>'org_id'`. Does not prove: live deletion of real production rows.
- **Batch 19 — Live Email Purge Scheduling + First Live Tick Evidence** (run `65de39b3-e554-4fb2-9bf9-736b552d5995`). Proves: live schedule exists with `dry_run:false`, `x-internal-key` vault auth, and edge-only target; first live tick is a fail-closed no-op because production has 0 valid `email_send_log` policies; no missing-policy / legal-hold / disabled-policy / within-retention rows were touched; cron-drift PASS pre/post; rollback SQL captured. Does not prove: live destructive purge of a real candidate row in production (none existed at first tick).
- **Batch 15 — Destructive Retention Readiness (pre-flight).** Proves: governance readiness assessment for any future destructive retention work was completed; lists required acceptance criteria. Does not prove: any individual destructive path is approved.
- **Batch 16 — Live Email Purge Design.** Proves: the design contract for the live email purge path (edge-only, vault auth, `dry_run:false` body pinning, evidence parity, fail-closed when policy missing). Does not prove: it has been built (Batch 19 built it).
- **Batch 17 — Pre-Approval Evidence.** Proves: documented readiness recommendation prior to live scheduling; explicitly limited to recommendation, not approval. Does not prove: approval to schedule (that came as Batch 19's explicit approval).
- **Closeout Pack (2026-05-30).** Cross-references DATA-004 deferred/gated register and consolidates evidence for the pre-Batch-15 state. Does not supersede Batches 18–19.
- **Live cron snapshots (Batch 8B, Batch 12 readings, post-Batch-19).** Proves: at capture time, the live `cron.job` table matched the contract exactly. Does not prove: continuous matching between snapshots — operators must re-run the drift monitor before any new live schedule.

---

## 4. Remaining gated paths

| Path | Current state | Why gated | Required before opening |
|------|---------------|-----------|-------------------------|
| Live email anonymisation (`email-log-anonymise`) | Edge function exists; no live schedule; legacy `email-log-anonymise-daily` quarantined Batch 8A | PII masking is irreversible; needs per-org policy lookup, `retention_run_evidence` parity, legal-hold enforcement, positive-control dry-run | Readiness assessment (parallel to Batch 15/17), positive-control dry-run (parallel to Batch 18), explicit live scheduling approval (parallel to Batch 19) |
| Live account-deletion sweeper | Dry-run (jobid 25) active; legacy live job (`account-deletion-sweeper-daily`) quarantined Batch 8A; DATA-002 Phase 2 sign-off required | Account deletion is irreversible; governance decision, not retention only | DATA-002 Phase 2 sign-off from Compliance + Legal; broadened guard review; explicit approval + fresh live-cron snapshot |
| `storage-retention-cleanup-job` (jobid 7) | Inactive | Pre-DATA-004 design did not include legal-hold awareness or per-org policy lookup | Legal-hold upgrade assessment; `retention_run_evidence` parity; positive-control dry-run; explicit approval |
| Sentinel paths | Not implemented | Reserved for future detective controls (out-of-policy retention drift, orphaned legal-hold rows, evidence-row gaps) | Design + ownership decision; not currently required for enterprise readiness |
| Per-org enforcement beyond `email_send_log` | Only `email_send_log` is wired (enforced by `scripts/check-data-004-phase3-enforcement-scope.mjs`) | Each record class needs its own resolver, decision matrix, fixtures, positive-control evidence, and approval | Per-record-class repeat of Batches 16 → 17 → 18 → 19 |
| Org-admin mutation of retention windows | Blocked — only platform_admin + AAL2 via `admin-org-retention` may write | Org-admin self-service would broaden destructive surface; governance decision | Governance decision + AAL2 gate review + audit-name additions + explicit approval |

---

## 5. Rollback / emergency controls

Rollback SQL (apply selectively — each statement is independent):

```sql
-- Live destructive email purge (Batch 19)
SELECT cron.unschedule('purge-email-send-log-daily-live');

-- Email purge dry-run (Phase 4) — evidence accumulation stops if unscheduled
SELECT cron.unschedule('purge-email-send-log-daily-dryrun');

-- Live non-destructive cold-storage export (Batch 10)
SELECT cron.unschedule('cold-storage-archive-live');

-- Cold-storage dry-run (Batch 9A) — evidence accumulation stops if unscheduled
SELECT cron.unschedule('cold-storage-archive-dryrun');

-- Account-deletion sweeper dry-run (DATA-002 Phase 1)
SELECT cron.unschedule('account-deletion-sweeper-daily-dryrun');
```

Post-rollback verification (mandatory):

1. **Live `cron.job` snapshot** — `SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;`. Confirm the unscheduled jobname is absent.
2. **Retention Health** — HQ → Per-Org Retention → "Live cron drift monitor". The drift monitor will surface the change as `warn` or `fail` until the contract is updated.
3. **`retention_run_evidence`** — `SELECT job_name, max(created_at) FROM retention_run_evidence GROUP BY job_name;`. Confirm no new rows are written for the unscheduled job after the rollback timestamp.

**Do not delete `retention_run_evidence`, `audit_logs`, `event_store`, or any preserved cold-storage objects as part of rollback.** Rollback is about stopping further runs; the historical evidence remains the record of what occurred.

---

## 6. Enterprise-readiness statement

- DATA-004 is **NOT** full platform-wide retention enforcement.
- DATA-004 **IS** enterprise-grade for the approved paths:
  - `email_send_log` retention path (dry-run + live, fail-closed by policy + legal-hold)
  - `cold-storage-archive` path (dry-run + live, non-destructive, row-level legal-hold proven on `matches`)
  - cron-drift visibility (read-only monitor, contract `data-004-batch-19`)
  - per-org retention policy shell (`org_retention_policies` + AAL2-gated `admin-org-retention`) and Retention Health surface
- Remaining destructive paths (email anonymisation, account deletion, storage cleanup, sentinel paths, per-org enforcement beyond `email_send_log`, org-admin mutation) require **separate explicit approval** + **fresh live-cron snapshot** before any opening.

---

## 7. Cross-consistency checklist

| Source | Reflects Batch 19 closeout? | Reflects gated set? | Notes |
|--------|------------------------------|---------------------|-------|
| `RELEASE_GATE.md` | Yes (DATA-004 Batch 19 section appended) | Yes | Carries rollback SQL and out-of-scope list |
| `docs/launch-runbook.md` | Yes (DATA-004 Batch 19 section appended) | Yes | Carries cron entry, protection invariants, rollback SQL |
| `docs/deferred-policy-register.md` | Yes (§15 updated to "Quarantined and superseded") | Yes (§16, §17 unchanged) | Legacy DB purge marked superseded by Batch 19 |
| `mem://features/per-org-retention-shell` | Yes (Batch 18 + Batch 19 entries appended) | Yes | Lists remaining gated set verbatim |
| `mem://index.md` | Yes (single-line summary replaced) | Yes | Same gated set surfaced at index level |
| Live `cron.job` | Matches contract `data-004-batch-19` (jobids 25/39/40/41/42 active, jobid 7 inactive, forbidden absent) | n/a | Verify before any future live schedule |
| HQ Retention Health → Live cron drift monitor | PASS at last reading | n/a | Read-only; investigate any `warn`/`fail` |
| Evidence files | Batch 13/14/18/19 + Closeout Pack present | n/a | This pack at `evidence/data-004-final-enterprise-status-pack.md` |

---

## 8. Final recommendation

Stop DATA-004 implementation here unless there is a specific enterprise requirement to open one of the remaining gated paths.

If a future enterprise requirement opens DATA-004 again, the recommended next assessments (assessment only, not live activation) are:

- **Email anonymisation readiness** — repeat the Batch 15 → 16 → 17 sequence for `email-log-anonymise`, ending with a recommendation, not approval.
- **`storage-retention-cleanup-job` legal-hold upgrade assessment** — review the legacy job against current legal-hold + per-org policy + evidence parity requirements; produce a design contract recommendation, not approval.

Neither assessment should schedule, broaden, or activate any destructive path on its own. Live activation continues to require its own explicit approval + fresh live-cron snapshot, per the DATA-004 contract.
