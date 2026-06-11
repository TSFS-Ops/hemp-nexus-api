# DATA-004 Batch 16 — Live Email Purge Replacement Assessment / Design

**Type:** Design + approval pack (planning artifact, read-only)
**Date:** 2026-06-11
**Scope:** Replacing the quarantined legacy live `email_send_log` purge with the DATA-004-controlled live path
**Status:** Planning only. **No code, cron, schedules, policies, edge functions, or destructive behaviour changed by this batch.**

> Binding principle: *"If the platform cannot prove a critical governance event, it must not complete that critical event."*
> For live email purge this means: **no live destructive tick is approved until every gate in §3 is satisfied with fresh evidence.**

---

## 1. Current Email Purge State

| Aspect | Current value |
|---|---|
| Edge function (DATA-004 path) | `supabase/functions/purge-email-send-log-daily` |
| Scheduled dry-run cron | `purge-email-send-log-daily-dryrun` — jobid **39**, schedule `20 3 * * *`, active, body pins `dry_run:true`, auth via `INTERNAL_CRON_KEY` (vault) |
| Scheduled live cron | **Not scheduled.** No live jobid for live email purge exists. |
| Legacy live cron | **Quarantined in Batch 8A** (was jobid 14, `purge-email-send-log-daily`). Confirmed absent in `evidence/data-004-batch-8b-cron-snapshot.md`. |
| Policy lookup | `_shared/retention-decision.ts::decideRetention()` against `org_retention_policies` for `record_class='email_send_log'` (platform floor 90 days). |
| Missing-policy behaviour | Fail-closed → row decision `skipped_due_to_missing_policy` with `policy_source='missing'`. **No deletion.** |
| Disabled / invalid policy | `skipped_due_to_disabled_policy` / `skipped_due_to_invalid_policy`. **No deletion.** |
| Legal-hold behaviour | `assertNoLegalHold` over org scope + record_group `email_send_log_anonymise`. Active hold → `skipped_due_to_legal_hold`. Lookup error → `skipped_due_to_error` (fail-closed). |
| Newer-than-retention behaviour | `retained_not_expired` per-row decision. **No deletion.** |
| Evidence path | `retention_run_evidence` (run-level + per-row decisions). Lifecycle is **evidence-only** (no `audit_logs.retention.*` writes for row purge). |
| Failure-array surfacing | Run record exposes `audit_write_failures` / `evidence_write_failures` arrays. Empty on clean ticks. |
| HQ Health visibility | `EmailRetentionHealth` (`src/components/admin/EmailRetentionHealth.tsx`) via RPC `get_email_retention_health`; `OrgRetentionHealthPanel` labels path as `enforcement_wired`. |

**Net posture:** the DATA-004 dry-run path is live, observable, fail-closed, and producing evidence. The destructive code branch (`dry_run:false`) exists in the edge function but is **not** reachable from any scheduled cron.

---

## 2. Why the Legacy DB-Function Path Must Remain Quarantined

The pre-Batch-8A legacy purge (DB function invoked by jobid 14) is **not** acceptable as a live path and must remain absent because:

1. **Global retention only** — applied a hard-coded 90-day cutoff regardless of `org_retention_policies`.
2. **No per-org policy** — could not honour an org's explicit retention extension or contractual overrides.
3. **No legal-hold protection** — did not call `assertNoLegalHold`; would delete rows under active org / record_group / row-level holds.
4. **No DATA-004 evidence** — wrote nothing to `retention_run_evidence`; per-row decisions were unobservable.
5. **Destructive physical delete** — single SQL `DELETE` with no fail-closed branches and no idempotency.
6. **Wrong audit path** — used legacy `audit_logs` rows instead of the DATA-004 lifecycle SSOT (`retention_run_evidence`).
7. **Bypassed the edge function entirely** — no `x-internal-key` enforcement, no shared guards, no rate limit, no run id.

**Rule:** the live email purge replacement MUST route exclusively through the edge function `purge-email-send-log-daily` with `dry_run:false`. Re-introducing the legacy DB function under any jobname is forbidden.

---

## 3. Live Purge Readiness Gate

Live scheduling of email purge is **blocked** until every item below is satisfied **with fresh evidence** captured in the 24h preceding approval:

1. ☐ **Live cron drift PASS** — fresh `cron-drift` snapshot. Jobids 7/25/39/40/41 unchanged. No unexpected jobnames.
2. ☐ **Latest scheduled dry-run evidence clean** — most recent jobid-39 tick yields `retention_run_evidence` run with `audit_write_failures=[]` and `evidence_write_failures=[]`.
3. ☐ **Missing-policy skip counts reviewed** — operator reviewed the `skipped_due_to_missing_policy` rows from the last dry-run tick; expected orgs accounted for; no surprise orgs.
4. ☐ **Legal-hold skip counts reviewed** — operator reviewed the `skipped_due_to_legal_hold` rows; active holds expected and documented.
5. ☐ **Failure arrays empty or explicitly waived** — any non-empty `*_failures` array is documented with a written waiver in the approval message; otherwise live is blocked.
6. ☐ **HQ Health shows latest dry-run** — `EmailRetentionHealth` surfaces the most recent run; `healthy=true`; `hours_since_last_run < 26`.
7. ☐ **Per-org policy coverage accepted** — operator has reviewed the `org_retention_policies` rows for `record_class='email_send_log'` and explicitly accepted that orgs without a policy will be **skipped**, not purged.
8. ☐ **Rollback SQL documented** — `cron.unschedule('<live-jobname>')` statement pre-written and pasted in the approval thread.
9. ☐ **Explicit approval for live email purge** — client message must use the literal phrase "approve live email purge scheduling". Implicit approval is insufficient.
10. ☐ **First live tick evidence required after scheduling** — operator commits to running and uploading the Batch 17 first-live-tick evidence before the second tick fires.

Any single unchecked item means **live is not approved**.

---

## 4. Proposed Live Schedule

**Recommendation: keep dry-run AND add a separate live job. Do not replace dry-run.**

| Job | Jobname (proposed) | Schedule (UTC) | `dry_run` | Auth | Notes |
|---|---|---|---|---|---|
| Dry-run (existing) | `purge-email-send-log-daily-dryrun` | `20 3 * * *` (03:20) | `true` | `INTERNAL_CRON_KEY` (vault) | **Unchanged.** Stays scheduled. |
| Live (proposed) | `purge-email-send-log-daily-live` | `50 3 * * *` (03:50) | `false` | `INTERNAL_CRON_KEY` (vault) | **Runs AFTER dry-run.** Same UTC day. Allows operators to detect anomalies in the dry-run before the live tick fires. |

Rationale:
- **Dry-run remains the canary.** If something changes (new org without policy, new legal hold, schema drift), the dry-run will surface it 30 minutes before the live tick.
- **Separate jobids** preserve clean cron drift accounting (live vs dry-run are independently observable).
- **30-minute gap** is wide enough for an operator to review and `cron.unschedule()` the live job if the dry-run looks wrong, but tight enough that they are part of the same operational window.
- **No replacement** — replacing the dry-run with the live job would erase the canary and break the Batch-15 rule that "dry-run path proven first".

---

## 5. Safety Rules for Live Purge

The live tick MUST:

- Route via the DATA-004 edge function `purge-email-send-log-daily` only.
- Authenticate via `x-internal-key` resolved from the `INTERNAL_CRON_KEY` vault secret.
- Pin `dry_run:false` in the cron job body (literal, not parameterised).
- Purge **only** `email_send_log` rows whose per-row decision is `eligible_for_purge`.
- Never purge rows for orgs with no policy (`skipped_due_to_missing_policy`).
- Never purge rows under an active legal hold (`skipped_due_to_legal_hold`).
- Never purge rows newer than the resolved retention window (`retained_not_expired`).
- Write a run-level + per-row decisions record to `retention_run_evidence`.
- Expose `audit_write_failures` and `evidence_write_failures` on the run record.
- Keep lifecycle as **evidence-only** unless a deliberate, separately-approved batch changes that.
- Fail closed on any policy lookup error or legal-hold lookup error (per-row decision `skipped_due_to_error`).
- Bound blast radius with `max_orgs` / `max_rows_per_org` / `max_rows` caps (carry over the values used in the dry-run path).
- Be idempotent: a duplicate invocation in the same minute must not double-delete (use the existing run-id / candidate-set semantics).

---

## 6. First-Live-Tick Operator Evidence Checklist (Batch 17)

After live scheduling, before any second tick fires:

1. ☐ **Pre-cron drift PASS** — snapshot captured within the same UTC day, before the first live tick.
2. ☐ **Fixture or real candidate review** — operator confirms the set of candidate rows the live tick will see (from the prior dry-run).
3. ☐ **Scheduled live tick run_id** — captured from `retention_run_evidence`.
4. ☐ **`rows_purged` count** — exact integer, matches `eligible_for_purge` from the paired dry-run within tolerance.
5. ☐ **Per-org evidence rows** — one evidence row per org touched, with policy_id + retention_days + decision counts.
6. ☐ **Missing-policy rows retained** — explicit count; rows still present in `email_send_log` for those orgs.
7. ☐ **Legal-hold rows retained** — explicit count; rows still present for held orgs / record_group.
8. ☐ **HQ Health latest run** — `EmailRetentionHealth` updated; `healthy=true`.
9. ☐ **Post-cron drift PASS** — snapshot captured after the live tick, jobids 7/25/39/40/41 + new live jobid only.
10. ☐ **Rollback readiness** — pre-written `cron.unschedule('purge-email-send-log-daily-live')` confirmed runnable.

Evidence artifact for Batch 17 will be: `evidence/data-004-batch-17-live-email-purge-first-tick.md` (filename reserved, not created).

---

## 7. Guard / Test Requirements Before Live Scheduling

The following must be true (and ideally guarded by prebuild scripts) before Batch 17:

| # | Requirement | Suggested guard |
|---|---|---|
| G1 | Live cron job targets the edge function URL, not any DB function | New `scripts/check-data-004-batch16-live-email-purge-target.mjs` reading `cron.job` |
| G2 | Live cron job body pins `dry_run:false` literally | Same script as G1 |
| G3 | Live cron job uses `x-internal-key` header from vault | Same script |
| G4 | Legacy DB purge job remains absent | Extension of `check-data-004-batch-8a-cron-quarantine.mjs` |
| G5 | Missing-policy evidence path present in edge function code | `rg "skipped_due_to_missing_policy" supabase/functions/purge-email-send-log-daily` |
| G6 | Legal-hold skip path present in edge function code | `rg "skipped_due_to_legal_hold"` same path |
| G7 | Dry-run schedule (jobid 39) intact and active | `check-data-004-batch-12-cron-drift-readonly.mjs` (extend if needed) |
| G8 | No other destructive job has reappeared (anonymise, account-deletion, storage-cleanup, cold-storage-live changes) | `check-data-004-batch-8a-cron-quarantine.mjs` + cron-drift |
| G9 | `decideRetention` not imported by any sweeper outside the approved enforcement scope | `check-data-004-phase3-enforcement-scope.mjs` (existing) |

None of these guards is wired by this batch. They are recommended for Batch 17 prep.

---

## 8. Rollback Plan

If a live tick produces an unexpected outcome:

```sql
-- Immediate stop
SELECT cron.unschedule('purge-email-send-log-daily-live');

-- Verify
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'purge-email-send-log-daily%';
-- Expect: only the dryrun jobid (39) remains.
```

Hard data-loss rollback is **not available** — `email_send_log` rows are physically deleted on a live tick. This is the structural reason §3 gates require:
- per-org policy coverage explicitly accepted,
- legal-hold skip counts reviewed,
- failure arrays empty,
- bounded blast radius caps applied.

Soft recovery options if needed:
- Restore from PITR backup (operator-only, out-of-band).
- Re-derive from upstream provider logs (Resend) for any rows lost in error.

These are explicitly **not** part of the live-tick happy path.

---

## 9. Out of Scope for Batch 16

This batch deliberately does **not**:

- Schedule any live email purge.
- Remove or modify the dry-run schedule.
- Touch `email-log-anonymise`, `account-deletion-sweeper`, `storage-retention-cleanup`, `data-retention`, or any sentinel path.
- Change `org_retention_policies`, platform floors, or `decideRetention`.
- Wire any new sweeper.
- Change destructive behaviour anywhere.
- Modify `RELEASE_GATE.md`, `docs/launch-runbook.md`, `docs/deferred-policy-register.md`, or `mem://features/per-org-retention-shell` body (per the user's "do not change" list, those docs/memories are not edited in this batch; the `mem://index.md` Per-Org Retention entry may be appended in a follow-up batch if explicitly approved).
- Modify any code, edge function, or migration.

---

## 10. Verdict

**PASS — design/approval pack complete.**

- Live email purge replacement path is **designed and gated**.
- Old legacy purge remains **quarantined**.
- Live email purge approval gate (§3) is **explicit and binary**.
- Proposed schedule (§4) is **dry-run + separate live, dry-run first**.
- Rollback plan (§8) is **explicit**.
- First-live-tick evidence checklist (§6) is **explicit**.

**Next batch options:**
- **Batch 17 — Live Email Purge Scheduling**, only if all §3 gates pass with fresh evidence AND the user explicitly approves with the phrase "approve live email purge scheduling".
- Otherwise: capture additional dry-run evidence ticks until §3 is satisfied.

Live email purge, live anonymise, live account deletion, storage-retention-cleanup, and sentinel paths remain **GATED**.
