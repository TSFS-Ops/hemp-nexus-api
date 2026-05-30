# DATA-004 Closeout Pack

Date: 2026-05-30
Type: Documentation, evidence, guard, and consistency consolidation. **No behaviour, no schedule, no policy, no cron, and no enforcement change.**

This pack closes the loop on DATA-004 before any further retention enforcement expansion. It is the single authoritative reference for: what DATA-004 is, what it is not, what is scheduled live in `cron.job`, what evidence backs each claim, what guards exist (and what they do not cover), and what remains gated.

---

## 1. Final DATA-004 state summary

DATA-004 is **controlled retention governance**, not platform-wide retention enforcement.

It comprises:

| Phase / Batch | Scope | Status |
|---|---|---|
| Phase 1 | Per-org retention policy shell (`org_retention_policies`, `get_effective_retention_days`, atomic set/clear, `admin-org-retention` edge fn, AAL2 on set/clear) | LIVE — shell only, no enforcement |
| Phase 2 | Retention Health / effective-policy evidence surface; guard `check-data-004-phase2-no-enforcement.mjs` forbids per-org consumption by sweepers other than the email-log sweeper | LIVE |
| Phase 3 | `purge-email-send-log-daily` edge sweeper wired with per-org policy + legal-hold + evidence; canonical 5-name audit map; default `dry_run=true` | LIVE — function only |
| Phase 3.1 | Missing-policy evidence + evidence-only lifecycle hardening (lifecycle events on `retention_run_evidence.details.lifecycle_event_name`; only `skipped` persists to `audit_logs`) | LIVE |
| Phase 3.2 | Scheduling readiness for the email-log sweeper; pg_cron NOT scheduled at this phase | LIVE (historical) |
| Phase 4 | Scheduled DRY-RUN of `purge-email-send-log-daily` (jobid 39); live purge NOT scheduled | LIVE — dry-run only |
| Batch 6 | Next-sweeper assessment (cold-storage candidate identified, no implementation) | CLOSED |
| Batch 7 | `cold-storage-archive` rewritten as dry-run-only evidence path; live archive path gated; manual dry-run evidence captured | LIVE — function + evidence |
| Batch 8A | Cron contract breach cleanup; quarantined jobids 14 / 24 / 35 and absent `cold-storage-archive-weekly` | COMPLETE |
| Batch 8B | Live cron-state evidence gate; live `cron.job` audited against the DATA-004 contract; SQL guards declared insufficient on their own | COMPLETE |
| Batch 9A | Scheduled DRY-RUN of `cold-storage-archive` (jobid 40, Sundays 03:40 UTC) | LIVE — dry-run only |
| Batch 9B | Scheduled cold-storage dry-run evidence tick; run_id `51554340-a074-4803-9465-ddf52bdb271f`; 5 evidence rows; no source mutation | PASS |
| Batch 10 | LIVE schedule of `cold-storage-archive-live` (jobid 41, Sundays 04:10 UTC, `dry_run:false`); first live tick run_id `fc63bc96-5aff-4553-b0bc-a3313cdbcc0c`, HTTP 200, candidates=0, no source deletion/mutation | LIVE |

**What DATA-004 is:**
- Per-org policy shell.
- Health / evidence layer.
- Email-log dry-run enforcement path (function + scheduled dry-run only).
- Cold-storage dry-run + live **non-destructive** archive path.
- Quarantine of legacy live destructive cron jobs.

**What DATA-004 is NOT:**
- Not platform-wide live retention enforcement.
- Not a live email purge (legacy `purge_old_email_send_log()` is quarantined; DATA-004 edge path is dry-run only).
- Not live anonymisation.
- Not live account deletion (sweeper remains dry-run only).
- Not storage cleanup.
- Not a sentinel/data-retention enforcement path.

---

## 2. Final live cron posture table

Source: `SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid` — live DB, 2026-05-30.

| jobid | jobname | schedule | active | mode | target | auth | destructive capability | evidence path | rollback SQL | status |
|---|---|---|---|---|---|---|---|---|---|---|
| 7 | `storage-retention-cleanup-job` | `0 2 * * *` | **false** | n/a | (legacy) | n/a | would delete storage objects | none under DATA-004 | `SELECT cron.unschedule('storage-retention-cleanup-job');` | **gated / inactive — allowed in this state only** |
| 25 | `account-deletion-sweeper-daily-dryrun` | `15 3 * * *` | true | **dry-run** | `/functions/v1/account-deletion-sweeper` (dry-run body) | `x-internal-key` (vault) | none (dry-run body, no `auth.admin.deleteUser`) | `retention_run_evidence` (account-deletion dry-run rows) | `SELECT cron.unschedule('account-deletion-sweeper-daily-dryrun');` | allowed |
| 39 | `purge-email-send-log-daily-dryrun` | `20 3 * * *` | true | **dry-run** | `/functions/v1/purge-email-send-log-daily` (`dry_run:true`) | `x-internal-key` (vault) | none in dry-run; legal-hold + per-org policy aware | `retention_run_evidence` + `audit_logs` (skipped only) | `SELECT cron.unschedule('purge-email-send-log-daily-dryrun');` | allowed |
| 40 | `cold-storage-archive-dryrun` | `40 3 * * 0` | true | **dry-run** | `/functions/v1/cold-storage-archive` (`dry_run:true`) | `x-internal-key` (vault) | none in dry-run; no storage uploads, no source mutation | `retention_run_evidence` (would_export / skipped_due_to_duplicate / skipped_due_to_missing_source) | `SELECT cron.unschedule('cold-storage-archive-dryrun');` | allowed |
| 41 | `cold-storage-archive-live` | `10 4 * * 0` | true | **live (non-destructive by contract)** | `/functions/v1/cold-storage-archive` (`dry_run:false`) | `x-internal-key` (vault) | writes JSON exports to cold-storage bucket; **MUST NOT** delete or destructively mutate source records (guard `check-data-004-batch7-cold-storage.mjs` forbids `.delete()` in function source) | `retention_run_evidence` + storage exports | `SELECT cron.unschedule('cold-storage-archive-live');` | allowed |

Quarantined / absent (must remain absent — verified 2026-05-30):
- jobid 14 `purge-email-send-log-daily` (legacy hard-delete) — **ABSENT**
- jobid 24 `account-deletion-sweeper-daily` (live, broken auth) — **ABSENT**
- jobid 35 `email-log-anonymise-daily` — **ABSENT**
- `cold-storage-archive-weekly` (legacy live cold storage) — **ABSENT**

Other active cron jobs in DB (out of DATA-004 scope, listed for completeness, not changed by this pack): jobid 3, 9, 10, 17, 18, 20, 21, 29, 30, 31, 32, 33, 34, 36, 37, 38. Inactive: jobid 2, 22.

---

## 3. Evidence map

| Claim | Evidence artifact | Mode | Destructive? | Source rows deleted/mutated? | Proves | Does NOT prove |
|---|---|---|---|---|---|---|
| Phase 3 sweeper wired with policy + legal hold + evidence | DATA-004 Phase 3 sections in `RELEASE_GATE.md` and `docs/launch-runbook.md`; guards `check-data-004-phase3-enforcement-scope.mjs` and `check-data-004-phase3-audit-names.mjs` | dry-run | non-destructive | no | function-level contract and audit-name SSOT | nothing about live purge approval |
| Phase 3.1 evidence-only lifecycle hardening | Lifecycle events surface on `retention_run_evidence.details.lifecycle_event_name`; `skipped` is the only lifecycle event that persists to `audit_logs` per org | dry-run | non-destructive | no | per-event persistence map | per-org enforcement |
| Batch 7 cold-storage manual dry-run | `RELEASE_GATE.md` Batch 7 section; `retention_run_evidence` rows including `legal_hold_batch` row `run_id 6cea2c51-0f45-4e96-8d5d-4eaabea786ba` | dry-run | non-destructive | no | function refuses to mutate source in dry-run; legal-hold path exercised | scheduled cron pathway |
| Batch 8B cron snapshot | `evidence/data-004-batch-8b-cron-snapshot.md` | n/a (inspection) | n/a | no | live `cron.job` matches contract after 8A quarantine | nothing about future schedules |
| Batch 9A schedule snapshot | `evidence/data-004-batch-9a-cron-snapshot.md` | n/a (inspection) | n/a | no | dry-run schedule installed via migration; body pins `dry_run:true` | live archive approval |
| Batch 9B scheduled tick | `evidence/data-004-batch-9b-scheduled-tick-evidence.md` (run_id `51554340-a074-4803-9465-ddf52bdb271f`, 5 `retention_run_evidence` rows) | dry-run via the scheduled-cron pathway | non-destructive | no | scheduled cron pathway works end-to-end without mutating source | live archive |
| Batch 10 live first tick | `evidence/data-004-batch-10-live-cold-storage-evidence.md` (run_id `fc63bc96-5aff-4553-b0bc-a3313cdbcc0c`, HTTP 200, candidates=0) | live | non-destructive by contract | no | live schedule + auth + function path work; first dispatch wrote no exports because no candidates were eligible | that future ticks with eligible candidates have been observed under live conditions |

---

## 4. Cross-consistency audit

Cross-checked surfaces:
- `RELEASE_GATE.md`
- `docs/launch-runbook.md`
- `docs/deferred-policy-register.md`
- `mem://features/per-org-retention-shell`
- `mem://index.md`
- `src/components/admin/OrgRetentionHealthPanel.tsx` HQ Retention Health copy
- `scripts/check-data-004-*.mjs` + `scripts/check-data-org-retention-audit-names.mjs`
- `evidence/data-004-batch-{8b,9a,9b,10}-*.md`

Contradiction sweep:
- "Unscheduled" vs scheduled cron — none. Cold-storage now correctly described as **dry-run scheduled + live scheduled (non-destructive)**; email-log + account-deletion correctly described as **dry-run scheduled only**; storage-retention-cleanup correctly described as **inactive**.
- "Live not approved" vs live job present — only `cold-storage-archive-live` is live, and Batch 10 sections in `RELEASE_GATE.md` and `docs/launch-runbook.md` explicitly approve it. Live email purge, live email anonymisation, live account-deletion sweeper, storage-retention-cleanup, and any sentinel/data-retention enforcement remain explicitly **not approved**.
- "Shell-only" vs partial enforcement — Phase 1 is described as shell-only; Phase 3 / Batch 7 / Batch 9A / Batch 9B / Batch 10 are described as the controlled, narrowly-scoped enforcement extensions and do not claim platform-wide enforcement.
- "Audit logs persist" vs evidence-only — Phase 3.1 + Batch 7 docs correctly state lifecycle events are evidence-only and only `skipped` persists per-org to `audit_logs`.
- "Per-org policy consumed" — only `purge-email-send-log-daily` consumes `org_retention_policies` / `get_effective_retention_days`; this is pinned by `check-data-004-phase3-enforcement-scope.mjs`. No other sweeper claims per-org policy consumption.
- "Legal hold coverage" — claimed only for the email-log sweeper (`assertNoLegalHold`) and for the account-deletion sweeper guards (legal_hold + platform_admin + active POIs/trade_requests/non-terminal matches/in-flight WaDs/billing/refund-chargeback dependency_unverified/compliance/disputes-either-side). Cold-storage skips legal-held rows via `discover_cold_storage_archive_candidates` and the `skipped_due_to_legal_hold` evidence path (Batch 7 row `6cea2c51-…`).
- Rollback SQL — present in `RELEASE_GATE.md` Batch 9A / 9B / 10 sections, consolidated below in section 7.
- Approval gates — `docs/deferred-policy-register.md` items 15 / 16 / 17 carry the gated items and required evidence; consolidated below in section 6.

**No contradictions found that require code edits.** This closeout pack itself is the cross-consistency artefact.

---

## 5. Guard inventory

| Script | Blocks | Allows | Limitations | Scope |
|---|---|---|---|---|
| `check-data-org-retention-audit-names.mjs` | inline or renamed per-org retention audit actions | the two canonical names `data.org_retention_policy.set` / `data.org_retention_policy.cleared` emitted via `ORG_RETENTION_AUDIT_NAMES` | code only | edge fn source |
| `check-data-004-phase2-no-enforcement.mjs` | per-org policy consumption by `storage-retention-cleanup`, `account-deletion-sweeper`, `cold-storage-archive`, `email-log-anonymise` | dry-run wiring without policy consumption | code only | edge fn source |
| `check-data-004-phase3-enforcement-scope.mjs` | any sweeper other than `purge-email-send-log-daily` importing `_shared/retention-decision.ts` or referencing `org_retention_policies` / `get_effective_retention_days` | the email-log sweeper consuming per-org policy | code only | edge fn source |
| `check-data-004-phase3-audit-names.mjs` | drift in the 5 canonical `data.retention_job.email_send_log.*` audit names or in their persistence map | the pinned vocabulary and persistence map | code only | edge fn source |
| `check-data-004-phase3-2-no-schedule.mjs` | any migration that schedules `purge-email-send-log-daily` live; drift phrasing implying live purge is scheduled | the scheduled DRY-RUN entry and required documentation phrases | migrations + docs | migrations + docs |
| `check-data-004-batch7-cold-storage.mjs` | `.delete()` in `cold-storage-archive` function; per-org policy consumption by cold-storage; sweepers scheduling under unauthorized names; missing Batch 7 docs | dry-run + live cold-storage schedules under the approved jobnames | migrations + docs + edge fn source | migrations + docs + code |
| `check-data-004-batch-8a-cron-quarantine.mjs` | any migration re-introducing quarantined jobnames (`purge-email-send-log-daily`, `account-deletion-sweeper-daily`, `email-log-anonymise-daily`, `cold-storage-archive-weekly`) | dry-run jobnames and the approved cold-storage live name | migrations + docs | migrations + docs |
| `check-data-004-batch9a-cold-storage-schedule.mjs` | drift between docs and migration for the cold-storage schedule pair | the dry-run and live cold-storage schedules | migrations + docs | migrations + docs |

**Critical limitation (carry-forward from Batch 8B and Batch 8A):**
> SQL/static guards inspect migrations and source files only. They **cannot** see live `cron.job` state. Live cron may have been edited out-of-band. Before any future live-schedule batch (Batch 11+, live email purge replacement, live anonymisation, live account deletion, live storage cleanup) operators MUST query live `cron.job` directly and attach the snapshot as evidence. This pack’s section 2 is the most recent such snapshot.

---

## 6. Deferred / gated register (consolidated)

All items below remain **gated** and require a separate explicit batch with its own approval and fresh live-cron snapshot.

| Item | Current state | Why gated | Risk category | Required evidence before approval | Likely safest next step |
|---|---|---|---|---|---|
| Live `email_send_log` purge via DATA-004 edge path | function exists, scheduled DRY-RUN only (jobid 39); legacy `purge_old_email_send_log()` quarantined (Batch 8A) | live path would hard-delete `email_send_log` rows; needs per-org policy + legal-hold + retention evidence parity proven under scheduled-cron pathway | destructive | scheduled DRY-RUN tick evidence run end-to-end with policy + legal-hold + skipped rows; second approval; fresh `cron.job` snapshot | "DATA-004 Live Email Purge Replacement Assessment" — paper-only assessment, no implementation |
| `email-log-anonymise` | function exists, **unscheduled**; not touched by this pack | destructive mutation of email metadata; lacks DATA-004 wiring (per-org policy, legal-hold, evidence parity) | destructive | full DATA-004 wiring + scheduled DRY-RUN tick evidence + second approval | defer until live email purge replacement decision is made |
| Live account-deletion sweeper | DRY-RUN only (jobid 25); broadened guards live (legal_hold + platform_admin + active POIs/trade_requests/non-terminal matches/in-flight WaDs/billing/refund-chargeback dependency_unverified/compliance/disputes-either-side) | live path deletes auth users; broadened guards must be observed under scheduled dry-run for an extended period first | destructive | repeated dry-run tick evidence over weeks with zero false-positive deletions; second approval; fresh `cron.job` snapshot; explicit legal/compliance sign-off | continue dry-run; gather guard-skip evidence |
| `storage-retention-cleanup` | inactive (jobid 7) | would delete storage objects; no DATA-004 wiring | destructive | full DATA-004 wiring (per-org policy, legal-hold, evidence parity) and scheduled DRY-RUN tick evidence | defer; scope a separate Batch |
| `data-retention` sentinel paths | gated | no DATA-004 wiring | destructive | full DATA-004 wiring + DRY-RUN tick evidence | defer |
| Per-org policy enforcement beyond the email-log sweeper | not implemented | every additional sweeper requires its own guard relaxation, audit-name pin, evidence map, and approval | depends on sweeper | per-sweeper guard relaxation + tests + DRY-RUN tick evidence | none until a specific sweeper is approved |
| Org-admin mutation of retention policies | not implemented | retention floors and policies are platform-admin only (AAL2 on set/clear); allowing org-admin mutation requires a new governance gate | governance | governance proposal; new AAL2 gate; tests; audit-name additions | defer indefinitely |

---

## 7. Rollback and emergency controls

Unschedule cron jobs (single statements; safe to run independently):

```sql
-- Live cold-storage archive (Batch 10)
SELECT cron.unschedule('cold-storage-archive-live');

-- Dry-run cold-storage archive (Batch 9A)
SELECT cron.unschedule('cold-storage-archive-dryrun');

-- Dry-run email-log purge (Phase 4)
SELECT cron.unschedule('purge-email-send-log-daily-dryrun');

-- Dry-run account-deletion sweeper
SELECT cron.unschedule('account-deletion-sweeper-daily-dryrun');
```

Verify rollback:

```sql
-- 1. Confirm the unscheduled jobname is gone
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;

-- 2. Confirm no quarantined jobnames have reappeared
SELECT jobid, jobname FROM cron.job
WHERE jobname IN (
  'purge-email-send-log-daily',
  'account-deletion-sweeper-daily',
  'email-log-anonymise-daily',
  'cold-storage-archive-weekly'
);
-- expected: 0 rows

-- 3. Latest retention evidence (no new rows should appear after unschedule)
SELECT run_id, job_name, dry_run, lifecycle_event_name, created_at
FROM public.retention_run_evidence
ORDER BY created_at DESC
LIMIT 20;
```

HQ Retention Health verification:
- HQ → Retention Health panel should continue to render effective-policy rows.
- After unscheduling a job, the "last run" column for that job will stop advancing.
- The panel must never claim a live destructive enforcement that is not actually scheduled.

What NOT to do during rollback:
- Do **not** delete the underlying edge function (rollback should only affect scheduling).
- Do **not** drop `org_retention_policies`, `retention_run_evidence`, or any audit table.
- Do **not** re-schedule under the legacy/quarantined jobnames (`purge-email-send-log-daily`, `account-deletion-sweeper-daily`, `email-log-anonymise-daily`, `cold-storage-archive-weekly`); the Batch 8A guard will fail the build.
- Do **not** flip `dry_run` on the live cold-storage job to alter behaviour outside an approved batch; instead unschedule and re-add under a new batch.

---

## 8. Final acceptance gate

This Closeout Pack is complete because:
- Docs (`RELEASE_GATE.md`, `docs/launch-runbook.md`, `docs/deferred-policy-register.md`) and memory (`mem://features/per-org-retention-shell`, `mem://index.md`) agree with live `cron.job` state as captured in section 2 (verified 2026-05-30).
- Final cron table (section 2) is accurate against a fresh live snapshot.
- Evidence artefacts are referenced in section 3 with mode + destructive-capability + source-mutation columns.
- Rollback SQL is present in section 7 for every DATA-004 schedule.
- Deferred items are clearly gated in section 6 with required evidence per item.
- Guards inventory (section 5) documents the static-only limitation explicitly.
- **No enforcement behaviour changed** by this pack.
- **No schedule changed** by this pack.
- **No new cron job added** by this pack.
- **No destructive path introduced** by this pack.
- HQ Retention Health copy in `OrgRetentionHealthPanel.tsx` remains consistent with the docs (effective-policy + last-run surface; no claim of live destructive enforcement beyond cold-storage archive).
- Live `cron.job` audited fresh on 2026-05-30 — see section 2.

---

## 9. Output / handoff

**Files changed by this pack:**
- created `evidence/data-004-closeout-pack.md` (this file)
- edited `RELEASE_GATE.md` (added Closeout Pack pointer section)
- edited `docs/launch-runbook.md` (added Closeout Pack pointer section)
- edited `docs/deferred-policy-register.md` (added Closeout Pack cross-reference)
- updated `mem://features/per-org-retention-shell` and `mem://index.md`

**Evidence files referenced (unchanged):**
- `evidence/data-004-batch-8b-cron-snapshot.md`
- `evidence/data-004-batch-9a-cron-snapshot.md`
- `evidence/data-004-batch-9b-scheduled-tick-evidence.md`
- `evidence/data-004-batch-10-live-cold-storage-evidence.md`

**Guard / test status:** No guard logic changed. All DATA-004 guards in section 5 remain in force unchanged.

**Final live cron table:** See section 2.

**Unresolved risks:**
- Static guards cannot enforce live `cron.job` state. Operators must continue auditing live `cron.job` before any future live-schedule batch.
- Batch 10 live first tick had `candidates=0`. No live tick with eligible candidates has yet been observed.
- Live email purge / live anonymisation / live account deletion / storage-retention-cleanup / sentinel paths remain gated; risk of drift between docs and live state grows the longer they sit without periodic re-audit.

**Recommended next batch (do NOT start):**
- Preferred: **DATA-004 Next Controls Review** — paper-only review of guard coverage, periodic live-cron audit cadence, and HQ Retention Health drift detection. No enforcement change.
- Acceptable alternative: **DATA-004 Live Email Purge Replacement Assessment** — paper-only scoping of how the DATA-004 edge path would replace legacy `purge_old_email_send_log()` if approved. No implementation.

**Principle:** Close the loop before adding more power. DATA-004 has enough moving parts that the next enterprise-grade step is making the state impossible to misread.
