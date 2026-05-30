# DATA-004 Next Controls Review (paper-only)

Date: 2026-05-30
Type: Governance / control review. **No code, no migrations, no cron, no edge function, no policy, no destructive behaviour changed.**

Inputs:
- `evidence/data-004-closeout-pack.md` (2026-05-30)
- `evidence/data-004-batch-10-live-cold-storage-evidence.md`
- `evidence/data-004-batch-9b-scheduled-tick-evidence.md`
- `evidence/data-004-batch-9a-cron-snapshot.md`
- `evidence/data-004-batch-8b-cron-snapshot.md`
- Live `cron.job` snapshot 2026-05-30 (jobids 7, 25, 39, 40, 41 as documented; quarantined 14/24/35 and `cold-storage-archive-weekly` absent)
- `mem://features/per-org-retention-shell`

---

## 1. Control adequacy review

| Area | Classification | Notes |
|---|---|---|
| Policy governance (`org_retention_policies`, atomic set/clear, AAL2 on set/clear, platform_admin only) | **sufficient** | Floors frozen at DB CHECK; service-role-only EXECUTE on atomic RPCs. |
| Legal-hold enforcement | **sufficient with caveat** | Email-log sweeper calls `assertNoLegalHold` per org; cold-storage skips legal-held rows via `discover_cold_storage_archive_candidates` + `skipped_due_to_legal_hold` evidence path. Caveat: row-level vs batch-level legal hold coverage depends on the source table's relationship to `legal_holds`; only the email_send_log + cold-storage candidates path is proven. |
| Evidence completeness (`retention_run_evidence`, audit/evidence failure arrays) | **sufficient with caveat** | Lifecycle SSOT on `retention_run_evidence.details.lifecycle_event_name`; `audit_write_failures[]` / `evidence_write_failures[]` surfaced inline. Caveat: append-only enforcement at the DB layer is not verified by this review. |
| Cron-state integrity | **sufficient with caveat** | Static guards block migration drift; live `cron.job` re-audited 2026-05-30. Caveat: no continuous drift monitor exists; out-of-band `cron.schedule` calls between manual audits are undetected. |
| Operator rollback | **sufficient** | Per-job `cron.unschedule(...)` SQL pinned in RELEASE_GATE.md, launch-runbook.md, and the Closeout Pack. |
| HQ visibility | **sufficient with caveat** | `OrgRetentionHealthPanel` surfaces effective policy, last-run evidence, scheduling status, dry-run/live schedule listings, rollback SQL, and a destructive-red `LIVE_UNEXPECTED` callout. Caveat: there is no HQ tile that diffs live `cron.job` against the documented contract continuously. |
| Auditability | **sufficient** | Canonical name maps pinned by `check-data-004-phase3-audit-names.mjs` and `check-data-org-retention-audit-names.mjs`; persistence map distinguishes `audit_logs` vs `evidence_only`. |
| Dry-run / live separation | **sufficient** | `dry_run=true` default at function level; `dry_run` pinned in every scheduled body; live cold-storage schedule is non-destructive by function contract. |
| Destructive-path gating | **sufficient with caveat** | All destructive sweepers (email purge, anonymise, account deletion, storage cleanup, sentinel) are gated. Caveat: legacy `purge_old_email_send_log()` DB function still exists even though cron invocation was quarantined. |
| Memory / docs consistency | **sufficient** | Closeout Pack section 4 cross-consistency audit found no contradictions. |
| Tenant-boundary safety | **sufficient** | RLS on `org_retention_policies` and `retention_run_evidence` (platform_admin SELECT only; service_role inserts); per-org sweeper iterates explicit candidate-discovery RPC. |
| Service-role / internal-key safety | **sufficient with caveat** | Atomic RPCs are service_role EXECUTE only; cron auth uses `x-internal-key` from `vault.INTERNAL_CRON_KEY` (never anon Bearer). Caveat: no documented `INTERNAL_CRON_KEY` rotation drill. |
| Production readiness | **sufficient with caveat** | The DATA-004 shell, dry-run paths, and the non-destructive live cold-storage path are production-ready. Caveat: live cold-storage has only been observed with `candidates=0`. |

No area is classified `insufficient` or `unknown`.

---

## 2. Remaining risk register

Severity: S1 (critical), S2 (high), S3 (moderate), S4 (low). Likelihood: H/M/L.

| # | Risk | Sev | Lik | Current mitigation | Required next control | Blocks future enforcement? |
|---|---|---|---|---|---|---|
| R1 | Live email purge remains gated; eventual replacement must achieve evidence parity | S3 | M | dry-run schedule (jobid 39) writes evidence daily; legacy quarantined | Repeated clean dry-run ticks + assessment doc + second approval | Yes, for live email purge specifically |
| R2 | Legacy DB function `public.purge_old_email_send_log()` still exists | S3 | L | cron invocation quarantined (Batch 8A); `check-data-004-batch-8a-cron-quarantine.mjs` blocks re-introduction via migration | Deferred Register entry already in place; consider drop migration after live replacement is approved | No |
| R3 | `email-log-anonymise` had live cron before Batch 8A; remains unscheduled but function unchanged | S3 | L | jobid 35 quarantined; Batch 7/8A guards block re-introduction; function has no DATA-004 wiring | Full DATA-004 rewrite assessment before any re-scheduling | Yes, for anonymisation |
| R4 | Account deletion live cron (jobid 24) was previously scheduled with broken auth | S2 | L | jobid 24 quarantined; dry-run-only jobid 25 in place with broadened guards | Extended dry-run period; rollback drill; second approval | Yes, for live account deletion |
| R5 | Cold-storage live first tick had `candidates=0` — export-write path not yet observed under live cron | S3 | M | Live function contract pins `.delete()` absent; Batch 7 manual + Batch 9B scheduled dry-run exercised candidate-positive paths | Live tick with positive candidates + diff snapshot vs Batch 9B dry-run | No (already approved, but evidence gap) |
| R6 | Row-level legal-hold coverage for cold-storage may not extend to every future source table | S3 | M | `discover_cold_storage_archive_candidates` SQL is the choke point; `skipped_due_to_legal_hold` evidence row exists | If new source tables added to cold-storage, re-verify legal-hold join | Yes, for any new source-table inclusion |
| R7 | Static guards cannot detect live `cron.job` mutations made outside migrations | S2 | M | Manual `cron.job` re-audit each batch; Closeout Pack section 5 calls out the limitation; pre-batch operator checklist | Continuous live-cron drift monitor (proposed) | No |
| R8 | `retention_run_evidence` append-only assumption not DB-enforced by this review | S3 | L | Service-role-only inserts; no UPDATE/DELETE policy granted to anon/authenticated | Verify no UPDATE/DELETE policy and no trigger mutates rows; document as evidence | No |
| R9 | `INTERNAL_CRON_KEY` rotation not drilled | S2 | L | Key sourced from `vault.decrypted_secrets`; never echoed; not in migrations | Documented rotation drill + verification SQL | No |
| R10 | Retention policy missing/disabled/invalid behaviour relies on per-sweeper handling | S3 | L | Email-log sweeper fail-closed (`_shared/retention-decision.ts`); Phase 3.1 surfaces missing-policy orgs in evidence | Same contract must be reasserted for every future sweeper | Yes, per future sweeper |
| R11 | Org-admin read-only visibility into own retention policy/evidence not yet expanded | S4 | L | Platform_admin-only by design | Optional org-admin read-only HQ surface (not write) | No |
| R12 | Per-org policy is NOT consumed by `cold-storage-archive` (by Phase 3 single-consumer rule) | S4 | L | Pinned by `check-data-004-phase2-no-enforcement.mjs` and `check-data-004-phase3-enforcement-scope.mjs`; intentional | Re-affirm in any future cold-storage broadening proposal | Yes, if per-org rules ever desired for cold-storage |
| R13 | Source bucket residual cleanup / `protect_delete` constraints not in DATA-004 scope | S3 | L | `storage-retention-cleanup-job` (jobid 7) remains inactive | Full DATA-004 wiring assessment before re-activation | Yes, for storage object deletion |

---

## 3. Future enforcement candidate ranking

Ranked by safety (highest first). "Assessment-only" means paper-only scoping; "implementation" means code + migration + new evidence.

| Rank | Candidate | Purpose | Risk | Evidence required | Allowed mode |
|---|---|---|---|---|---|
| 1 | **Live cron drift monitor** | Detect out-of-band `cron.job` changes between manual audits (addresses R7) | Low (read-only) | Read-only RPC + HQ tile diffing live `cron.job` against pinned contract | Implementation acceptable in a future batch |
| 2 | **Retention evidence dashboard hardening** | Surface evidence anomalies (missing run, lifecycle gaps, failure arrays non-empty) | Low (read-only) | UI-only; consumes `retention_run_evidence` already present | Implementation acceptable in a future batch |
| 3 | **Cold-storage positive-candidate live evidence** | Observe live cold-storage with eligible candidates (addresses R5) | Low (function already non-destructive by contract) | One live tick with positive candidates + diff vs Batch 9B dry-run | Evidence batch only; no code change |
| 4 | **Internal-key / vault rotation drill** | Document rotation (addresses R9) | Low (planned drill) | Drill plan + post-drill verification SQL | Assessment first, then drill batch |
| 5 | **Operator rollback drill** | Verify every `cron.unschedule` works and HQ Health flips correctly | Low | Drill plan + per-job rollback evidence | Assessment first |
| 6 | **Org-admin read-only retention visibility** | Org admins see own policy and last-run evidence (addresses R11) | Low | UI scoping doc; explicit RLS read for own org only; no write | Assessment first |
| 7 | **DATA-004 live email purge replacement assessment** | Scope what a live email-purge cutover would require (addresses R1) | Medium (paper) | Scope doc + gate definition + repeated dry-run ticks reference | Assessment-only |
| 8 | **`email-log-anonymise` rewrite assessment** | Scope a DATA-004-compliant replacement (addresses R3) | Medium (paper) | Scope doc + per-org policy + legal-hold + evidence parity plan | Assessment-only |
| 9 | **`account-deletion-sweeper` live assessment** | Scope conditions for converting jobid 25 from dry-run to live (addresses R4) | High | Long dry-run history + legal/compliance sign-off + rollback drill | Assessment-only |
| 10 | **Scheduled live email purge through DATA-004 edge path** | Replace legacy purge (addresses R1) | High (destructive) | Candidate 7 PASS + second explicit approval + fresh `cron.job` snapshot | NOT allowed in next batch |
| 11 | **`storage-retention-cleanup` assessment** | Scope conditions for re-activating jobid 7 (addresses R13) | High (destructive) | Full DATA-004 wiring scope | Assessment-only |
| 12 | **`data-retention` sentinel assessment** | Scope sentinel-driven enforcement (addresses gated paths) | High | Full DATA-004 wiring scope | Assessment-only |

---

## 4. Specific recommendation

**Recommended next batch:** **DATA-004 Live Cron Drift Monitor** (candidate #1).

Rationale:
- Addresses the highest-likelihood unmitigated risk (R7) that static guards cannot cover.
- Read-only by design; no destructive path, no policy mutation, no new sweeper.
- Closes the loop on the Closeout Pack's section 5 explicit limitation ("SQL/static guards inspect migrations and source files only").
- Provides a continuous control that strengthens every subsequent live-schedule decision.

Acceptable alternative (if drift monitor is not prioritised): **DATA-004 Cold-Storage Positive-Candidate Live Evidence** (candidate #3) — pure evidence batch with no code change, observes the already-approved live path under non-zero candidate conditions.

**Live email purge is NOT recommended for the next batch.** Controls are not yet "clearly sufficient" — R1 + R2 + R7 must be addressed first.

---

## 5. Approval boundaries

**No approval — under any circumstance in the next batch:**
- Live email purge (`purge-email-send-log-daily` with `dry_run:false`)
- `email-log-anonymise` scheduling or invocation
- Live account-deletion sweeper (`account-deletion-sweeper-daily` with `dry_run:false`)
- Storage object deletion (`storage-retention-cleanup-job` re-activation)
- Physical source-record deletion anywhere in DATA-004
- Sentinel/data-retention scheduling
- Org-admin mutation of retention windows or floors

**Potentially approvable with evidence (in a future, explicit, separate batch):**
- Live cron drift monitor (read-only)
- Retention evidence dashboard improvements (read-only)
- Cold-storage positive-candidate live evidence (no code change)
- Operator rollback drill (procedural)
- Internal-key / vault rotation drill (procedural)
- DATA-004 live email purge replacement **assessment only** (paper)
- Org-admin read-only retention visibility (no write)

---

## 6. Output / handoff

**Artifact path:** `evidence/data-004-next-controls-review.md` (this file).

**Files changed by this review:**
- created `evidence/data-004-next-controls-review.md`

**No other file, code, migration, cron, edge function, policy, or memory was changed by this review.**

**Confirmation:**
- No code changed.
- No migration added.
- No cron schedule added, removed, or modified.
- No edge function behaviour changed.
- No destructive path introduced.
- No retention policy or floor changed.
- Live `cron.job` state remains as captured in the Closeout Pack section 2 (verified 2026-05-30).
- Live email purge, `email-log-anonymise`, live account-deletion sweeper, `storage-retention-cleanup`, and sentinel paths remain GATED.

**Recommended next batch (do NOT start without explicit approval):** DATA-004 Live Cron Drift Monitor (read-only, addresses R7). Acceptable alternative: DATA-004 Cold-Storage Positive-Candidate Live Evidence (no code change, addresses R5).
