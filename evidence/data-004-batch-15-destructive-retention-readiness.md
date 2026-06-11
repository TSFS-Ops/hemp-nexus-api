# DATA-004 Batch 15 — Destructive Retention Readiness Assessment

**Type:** Readiness assessment (planning artifact, read-only)
**Date:** 2026-06-11
**Scope:** Remaining destructive retention paths gated behind DATA-004
**Status:** Planning only. No code, cron, schedules, policies, or enforcement scope changed by this batch.

---

## 1. Executive Summary

Batches 1–14 of DATA-004 established the per-org retention foundation, the legal-hold gate, the shared `decideRetention` helper, the `retention_run_evidence` lifecycle SSOT, and proved one wired retention sweeper end-to-end (`purge-email-send-log-daily`, dry-run only on schedule) plus one wired live destructive path with row-level legal-hold gating proven on `matches` (`cold-storage-archive`, scheduled live tick + Batch 14 row-hold manual proof).

Five destructive retention paths remain **GATED** and unscheduled in their destructive modes. This document inventories each path, scores readiness against a fixed nine-point gate checklist, ranks blast radius, and proposes the safest order in which they should be brought under DATA-004 in future batches. **It does not approve, schedule, or modify any destructive behaviour.**

The core principle from the wider memory remains binding:

> *"If the platform cannot prove a critical governance event, it must not complete that critical event."*

For destructive retention this translates to: **a job that cannot prove per-org policy resolution, legal-hold gating, and evidence emission must remain dry-run-only.**

---

## 2. Inventory — Remaining Destructive Paths

| # | Path | Edge function | Destructive action | Current live posture |
|---|------|---------------|--------------------|----------------------|
| 1 | Live email purge | `purge-email-send-log-daily` | `DELETE` rows from `email_send_log` | **Scheduled DRY-RUN only** (jobid 39). Destructive mode exists in code but not scheduled. |
| 2 | Email anonymisation | `email-log-anonymise` | Permanent PII mask (replaces `recipient_email`) on old `email_send_log` rows via SECURITY DEFINER SQL | **Code is destructive-capable** (`p_dry_run` default false). Legacy auth (INTERNAL_CRON_KEY/service_role) + record-group legal-hold gate. **Not consuming `org_retention_policies`.** Not scheduled under DATA-004 governance. |
| 3 | Live account deletion | `account-deletion-sweeper` | `auth.admin.deleteUser()` of pending_deletion profiles >30d old | **Scheduled DRY-RUN only.** 10-guard fail-closed checklist already in place. Destructive cron intentionally NOT scheduled (Phase 1 closeout). |
| 4 | Storage cleanup | `storage-retention-cleanup` | Deletes storage objects from `storage_deletion_queue` | INTERNAL_CRON_KEY-gated, record_group legal-hold gate present. **Not consuming `org_retention_policies`.** Schedule status: legacy quarantined (Batch 8A). |
| 5 | Data-retention sentinel paths | `data-retention` | Flags/queues records for retention workflow (writes to `retention_flags`) | Mostly non-destructive (flagging), but it is the input feeder for any downstream destructive consumer. **Not consuming `org_retention_policies`.** |

(`cold-storage-archive` is intentionally excluded — already wired live with positive + row-hold evidence in Batches 13 & 14.)

---

## 3. Nine-Point Readiness Gate

Every path must pass all nine gates before destructive scheduling is approved.

1. **Per-org policy consumption.** Resolves retention via `decideRetention` against `org_retention_policies` (no implicit global default).
2. **Legal-hold respected.** Calls `assertNoLegalHold` for org, record_group, and any row-level scope used by the table.
3. **Fail-closed on missing policy.** Missing/disabled/invalid policy → `skipped_due_to_missing_policy|disabled|invalid`, not deletion.
4. **Evidence emission.** Run-level + per-row decisions written to `retention_run_evidence`. Lifecycle SSOT is `retention_run_evidence`, not `audit_logs`.
5. **HQ visibility.** `OrgRetentionHealthPanel` (or equivalent HQ surface) labels the path as `enforcement_wired` with non-zero `record_classes_enforced`.
6. **Dry-run path proven first.** Scheduled dry-run produces ≥1 evidence run with zero destructive side effects before any live tick.
7. **Rollback / reversibility.** Either soft-mode (mask before delete), undo window, or proven restorability. Pure `DELETE` paths must justify why no rollback exists.
8. **Cron schedule approved.** Explicit client sign-off + fresh `cron-drift` snapshot. No silent reuse of legacy `jobid`s.
9. **Bounded blast radius.** Hard caps on `max_orgs` / `max_rows_per_org` / `max_rows`, plus per-run idempotency.

---

## 4. Readiness Matrix

`✓` = met, `~` = partial, `✗` = missing.

| Path | 1 Per-org | 2 Legal hold | 3 Fail-closed | 4 Evidence | 5 HQ | 6 Dry-run proven | 7 Rollback | 8 Cron approved | 9 Blast radius | Overall |
|------|-----------|--------------|---------------|------------|------|------------------|------------|------------------|----------------|---------|
| Live email purge | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (Phase 4 scheduled) | ✗ (hard DELETE) | ✗ live | ✓ (max_orgs/max_rows_per_org) | **Closest to ready** |
| Email anonymisation | ✗ | ~ (record_group only) | ✗ (legacy default-on) | ~ (SQL writes own audit, not `retention_run_evidence`) | ✗ | ✗ under DATA-004 | ✓ (mask not delete) | ✗ | ~ (`p_days` bounded) | Needs Phase-3-parity refactor |
| Live account deletion | ~ (uses 10 guards, not `decideRetention`) | ✓ | ✓ | ~ (dual-writes legacy + canonical `data.*` audits, not `retention_run_evidence`) | ~ | ✓ (sweeper dry-run cron live) | ✗ (irreversible auth deletion) | ✗ | ✓ (`max_rows=25`) | Highest-risk; lowest reversibility |
| Storage cleanup | ✗ | ✓ (record_group) | ~ | ~ | ✗ | ~ (legacy quarantined; no DATA-004 dry-run yet) | ✗ (object delete) | ✗ | ~ | Needs full Phase-3-parity rebuild |
| Data-retention sentinel | ✗ | ~ | ~ | ✗ | ✗ | n/a (flagging only) | n/a | ✗ | ~ | Non-destructive itself; gates the rest |

---

## 5. Blast-Radius Ranking (worst → least)

1. **Live account deletion** — Irreversible removal of `auth.users`. PII, billing trail and identity continuity at stake. Even with 10 fail-closed guards, recovery from a wrong call is effectively impossible.
2. **Storage cleanup** — Deletion of binary evidence objects. The existing `enqueue-storage-cleanup` ACTIVE_EVIDENCE_PROTECTED guard mitigates most cases, but WaD bundles and KYC documents are still in scope.
3. **Live email purge** — Row deletion in `email_send_log`. Loses per-message provenance but aggregate metrics survive in `email_send_state`.
4. **Email anonymisation** — Reversible-in-spirit (mask, not delete), but PII cannot be restored.
5. **Data-retention sentinel** — Non-destructive itself; risk is in what downstream consumers do with the flags.

---

## 6. Recommended Order (subject to client approval)

Each step is a **separate batch with its own sign-off** and its own fresh `cron-drift` snapshot. None of them are approved by this document.

| Order | Batch (proposed) | Path | Why this order |
|-------|------------------|------|----------------|
| Next  | Batch 16 | **Live email purge → live mode** | Already passes 6 of 9 gates. Only gates 7 (rollback) and 8 (cron) remain. Lowest reversible-impact destructive deletion to graduate to live and prove the full live-scheduled pattern end-to-end. |
| Then  | Batch 17 | **Email anonymisation → DATA-004 parity refactor (dry-run only)** | Refactor to consume `decideRetention`, write `retention_run_evidence`, and surface in HQ. Stay dry-run until parity proven. |
| Then  | Batch 18 | **Storage cleanup → DATA-004 parity refactor (dry-run only)** | Same parity work as anonymisation, plus row-level (`record` scope) legal-hold checks for WaD/KYC bundles. |
| Then  | Batch 19 | **Data-retention sentinel → policy-aware flagging** | Wire `decideRetention` so flags carry the resolving policy id; this de-risks every downstream destructive consumer. |
| Last  | Batch 20+ | **Live account deletion → live mode** | Highest blast radius and lowest reversibility. Must be last and must include independent legal sign-off and a documented restore-from-backup runbook before any live tick. |

---

## 7. Evidence Required Before Each Live Approval

For any of the above to graduate from gated → live, the corresponding batch must produce:

- **A.** A scheduled dry-run evidence run in `retention_run_evidence` covering ≥1 candidate org and ≥1 of each decision class (`eligible_for_purge`, `retained_not_expired`, `skipped_due_to_*`).
- **B.** A positive-control live manual invocation (`dry_run:false`, `x-internal-key`) with bounded fixtures, proving destructive behaviour matches the dry-run prediction for the same inputs.
- **C.** A row-level legal-hold fixture proving the hold blocks the destructive action (parity with Batch 14 for cold-storage on `matches`).
- **D.** A duplicate / idempotency fixture proving re-execution does not double-delete.
- **E.** A fresh `cron-drift` PASS snapshot covering all live retention jobids.
- **F.** Explicit client sign-off referenced by file path, e.g. `evidence/data-004-batch-NN-<path>-live-evidence.md`.
- **G.** Updates to `mem://index.md` reflecting the new live posture for the path, leaving all other paths explicitly listed as GATED.

Absent any of A–G, the path must remain dry-run or unscheduled.

---

## 8. Known Cross-Cutting Gaps

- `email-log-anonymise`, `storage-retention-cleanup`, `account-deletion-sweeper`, and `data-retention` all **predate** `decideRetention` and `retention_run_evidence`. They each carry bespoke audit semantics that must be reconciled against the canonical Phase 3 contract before they can be considered DATA-004-compliant.
- `audit_logs.org_id` is NOT NULL — any platform-system lifecycle event for a non-org-scoped path must be written to `retention_run_evidence`, not `audit_logs`. This is already the Phase 3 rule for `purge-email-send-log-daily` and must be the rule for every future wired sweeper.
- The `data-retention` sentinel writes to `retention_flags` (22 columns) but does not feed `retention_run_evidence`. Without that bridge, HQ cannot see what is being flagged.
- No path other than `cold-storage-archive` currently has a proven row-level legal-hold fixture. Batch 14's `matches`-on-`scopeType="match"` pattern is the reference design.

---

## 9. What This Batch Does Not Do

This batch does **not**:

- turn on live email purge
- turn on live email anonymisation
- turn on live account deletion
- turn on live storage cleanup
- change any cron job, schedule, or jobid
- modify any edge function
- modify any retention policy row
- broaden enforcement scope
- wire any new sweeper
- approve any of the future batches listed in §6

It is a planning artifact only. The next destructive change of any kind requires its own dedicated batch and explicit client approval.

---

## 10. Files Produced By This Batch

- `evidence/data-004-batch-15-destructive-retention-readiness.md` (this file)

No other files were created, modified, or deleted.

---

**Final result: PASS — readiness assessment complete. All five destructive retention paths remain GATED. Recommended next batch: Batch 16 (live email purge → live mode), pending explicit client approval.**
