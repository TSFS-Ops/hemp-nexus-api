# P-5 Batch 4 — Execution, Milestones & Project Tracking

This is a very large, governed batch. Following the Batch 3 pattern (Stages 1–6 with sign-off and isolation guards between each), I will deliver Batch 4 in **7 stages**. Each stage is independently testable, has its own isolation guard, and does not touch Batch 1/2/3 or trade/payment areas.

I will not start coding until you confirm this plan.

---

## Guiding principles (apply to every stage)

- All objects prefixed `p5_batch4_*` (tables, RPCs, scripts, tests, components, routes).
- No Batch 1/2/3 rewiring; no trade/payment/ledger mutations.
- All mutations go through `SECURITY DEFINER` RPC wrappers — no direct table writes from UI.
- Status / milestone / blocker / overdue / role vocabularies live in a single SSOT module; UI, API, audit and reports read from it.
- Provider-dependent items must never render as "verified" / "compliant" / "bankable" / "live-provider verified". Enforced by a wording guard reused from Batch 2/3.
- Audit table is append-only (no UPDATE/DELETE policies); finality rows lock on insert.
- Memory feed strips raw bank/ID/tax/UBO/personal-evidence fields.
- Every stage adds a `scripts/check-p5-batch4-stage{N}-isolation.mjs` guard and updates the cumulative guard.
- Funder UI reads only via the safe summary edge function (reuse Batch 3 pattern where possible); funder actions limited to a small whitelist of permitted wrappers.

---

## Stage 1 — Foundation: SSOT, enums, tables, RLS, GRANTs

- Create the SSOT module `src/lib/p5-batch4/constants.ts` with controlled vocabularies for:
  - process types, execution statuses, readiness statuses, milestone keys, blocker keys, warning keys, overdue labels, role keys, evidence statuses, funder release statuses, finality outcomes.
- Migration creating all Batch 4 tables exactly as listed in the brief:
  - `p5_batch4_execution_cases`, `p5_batch4_execution_milestones`, `p5_batch4_evidence_items`, `p5_batch4_blockers`, `p5_batch4_tasks`, `p5_batch4_funder_releases`, `p5_batch4_finality_records`, `p5_batch4_audit_events`.
- Each table: `CREATE TABLE` → `GRANT` (authenticated + service_role; no anon) → `ENABLE RLS` → `CREATE POLICY` (admin-read by default; per-table scoping for owner/org/funder where required).
- Audit table: insert-only policy; no UPDATE/DELETE policy.
- Finality table: insert-only + locked-after-insert trigger.
- Stage 1 tests: enum drift, table presence, RLS presence, GRANT presence, audit immutability, finality lock.
- Stage 1 isolation guard.

## Stage 2 — Pure-TS engine modules (no DB, no UI)

Twelve pure-logic modules under `src/lib/p5-batch4/`:

- `milestones.ts` — milestone path generator per process type, mandatory/conditional/optional flags, completion rules.
- `evidence-rules.ts` — checklist generation, terminal-status rules, Evidence-Received roll-up.
- `blockers.ts` — hard vs soft, trigger conditions, override eligibility, safe external labels.
- `overdue.ts` — Due Soon / Overdue / Escalated / Blocked classification per milestone class with the brief's exact day counts.
- `readiness.ts` — roll-up of milestones + blockers into Readiness Confirmed.
- `roles.ts` — role → allowed-action matrix (admin/operator/org user/counterparty/funder viewer/reviewer/approver/API/system).
- `permissions.ts` — server-style check helpers.
- `wording-guard.ts` — reuse Batch 2/3 forbidden-wording catalogue.
- `finality.ts` — finality eligibility evaluator (no DB).
- `memory-summary.ts` — safe summary builder + raw-evidence stripper.
- `case-reference.ts` — deterministic case-ref formatter.
- `api-fields.ts` — safe-field whitelist for API responses.

Stage 2 tests: ~40+ pure-logic tests. Stage 2 isolation guard.

## Stage 3 — RPC wrappers + internal-safe summary edge function

- Migration adding `SECURITY DEFINER` RPCs (all `search_path = public`):
  - `p5b4_open_case_v1`, `p5b4_confirm_scope_v1`, `p5b4_generate_checklist_v1`, `p5b4_request_evidence_v1`, `p5b4_submit_evidence_v1`, `p5b4_review_evidence_v1`, `p5b4_waive_evidence_v1`, `p5b4_open_blocker_v1`, `p5b4_resolve_blocker_v1`, `p5b4_override_blocker_v1`, `p5b4_complete_milestone_v1`, `p5b4_record_governance_decision_v1`, `p5b4_record_compliance_decision_v1`, `p5b4_release_funder_pack_v1`, `p5b4_revoke_funder_access_v1`, `p5b4_record_funder_decision_v1`, `p5b4_record_final_approval_v1`, `p5b4_record_finality_v1`, `p5b4_close_case_v1`, `p5b4_reopen_case_v1`, `p5b4_record_audit_event_v1`.
- Every RPC: role-gated, reason-required where the brief mandates it, writes an audit row, never deletes audit.
- Edge function `supabase/functions/p5-batch4-execution-summary/` returning admin-safe summaries (internal only, not a public funder API).
- `src/lib/p5-batch4/rpc.ts` typed client wrappers (admin set vs funder set vs org-user set).
- SQL proof script (`BEGIN … ROLLBACK`) validating RPC contracts and audit immutability.
- Stage 3 isolation guard.

## Stage 4 — Admin UI

Routes under `/admin/p5-batch4/*` (all wrapped in existing platform-admin guard):

- `execution-dashboard`, `execution-cases`, `execution-cases/:caseId`, `evidence-review`, `blockers`, `funder-release`, `finality-queue`, `reports`, `audit`.

Shared components: `P5B4StatusBadge`, `P5B4MilestoneTimeline`, `P5B4BlockerCard`, `P5B4EvidenceChecklist`, `P5B4MaskedField`, `P5B4ProviderSafeLabel`, `P5B4ReasonedActionDialog`.

All mutations go through Stage 3 wrappers. No `supabase.from('p5_batch4_*')` calls in pages. Stage 4 isolation guard enforces this.

## Stage 5 — Organisation / counterparty user surface

Routes under `/desk/p5-batch4/*`:

- `my-cases`, `my-cases/:caseId`, `evidence-upload/:caseId`.

User checklist UI showing only: status, current milestone, progress bar, due date, next action, missing items, allowed upload/replace/respond actions. No internal notes, no other orgs, no full audit, no other counterparties.

Static guard forbidding admin-only RPCs and direct table reads from org-user pages.

## Stage 6 — Funder UI (released-only)

Routes under `/funder/p5-batch4/*`:

- `index`, `case/:caseId`, `pack/:releaseId`, `requests`, `outcomes`.

Reads only via the Stage 3 safe summary edge function. Funder actions limited to a 4-RPC whitelist: `p5b4SubmitFunderQuestion`, `p5b4RequestMoreInformation`, `p5b4RecordFunderDecision`, `p5b4RecordPackView`.

Wording/masking guarded; "Provider-Dependent" rendered with the safe label rule.

## Stage 7 — Notifications, overdue cron, reports, finality bridge & final consistency

- `src/lib/p5-batch4/notifications.ts` — reminders, escalations, due-soon, overdue, funder-review-due, finality-pending. Internal vs external audience split.
- `src/lib/p5-batch4/sla-rules.ts` — idempotent SLA intents using the Stage 1 exact day counts.
- Cron-style monitor edge function `supabase/functions/p5-batch4-stage7-monitor/` (internal-key gated, not public).
- Report builders for the 9 reports in the brief (dashboard + CSV; PDF stubbed safely).
- `finality-bridge.ts` (opt-in, `is_final: false as const` unless admin records finality).
- `readiness-bridge.ts` → Memory summary intent stripped of raw sensitive evidence.
- `scripts/check-p5-batch4-final-consistency.mjs` validating: route guards, no raw evidence in funder/user pages, centralised vocab, finality admin-only, audit-write coverage, Memory exclusions.
- Full Batch 4 + Batch 2/3 combined suite must stay green.

---

## Technical guard summary

After each stage I will report:

- files created/changed; modules / RPCs / edge functions added;
- new tests + cumulative Batch 4 test result; Batch 2+3+4 combined if run;
- isolation guard result;
- confirmation Batch 1/2/3 and trade/payment areas were untouched;
- explicit confirmation the next stage has not started;
- stage completion marker (`P5_BATCH_4_STAGE_{N}_COMPLETE`).

Final markers on Stage 7 sign-off: `P5_BATCH_4_STAGE_7_COMPLETE` and `P5_BATCH_4_COMPLETE`.

---

## What I will start with after approval

Stage 1 only — SSOT + tables + RLS + GRANTs + Stage 1 isolation guard + Stage 1 tests. I will stop and report for sign-off before starting Stage 2.  
  
Yes — I would **approve this plan**, with a few small tightening instructions before Stage 1 starts.

The proposed 7-stage delivery is sensible because Batch 4 is not just UI; it is workflow, permissions, evidence logic, funder visibility, finality, audit and Memory. The client’s answers support exactly this kind of staged execution: they asked for one configurable P-5 Execution Engine with shared rules for owner, milestones, evidence, blockers, approvals, audit, readiness and finality.  

The plan is also well aligned to the client’s requirement that milestones, statuses, role actions and evidence rules are fixed and buildable. Their answers define mandatory milestones, provider-dependent wording, role-based permissions, evidence completion rules, hard blockers, soft warnings, overdue behaviour, dashboard layout and user journey.  

The only things I would tighten are:

1. **Stage 1 should not overbuild RLS guesses.** It should create safe admin-first policies and only add user/funder scoping where the linked organisation/funder model is already known in the codebase. If the existing org/funder ID model differs, Stage 1 should adapt to the live schema rather than inventing parallel identity fields.
2. **Stage 3 edge function wording needs care.** The plan says “internal-safe summary edge function” and later says the funder UI reads via the safe summary edge function. That is fine, but make the distinction explicit: one safe summary function can serve different audiences only if it enforces audience-specific field filtering. Otherwise create separate admin-safe and funder-safe summary modes.
3. **RPC count is high.** That is acceptable for this governed batch, but every RPC must be tested for audit write, permission gate and reason-required behaviour. No “wrapper exists but logic is thin” shortcuts.
4. **Finality bridge must remain non-final until admin action.** The plan already says `is_final: false as const` unless admin records finality. Keep that as a hard guard.
5. **Reports can be stubbed safely, but not misleadingly.** CSV/dashboard can be functional first. PDF can be a safe placeholder only if labelled clearly as not yet a full generated PDF export.

Here is the message I would send back:

Approved — please proceed with Stage 1 only.

This staged approach is appropriate for Batch 4 because the execution/milestone layer touches workflow logic, evidence rules, blockers, permissions, funder visibility, finality, audit and Memory. Please keep the Batch 3-style discipline: one stage at a time, tests and isolation guard per stage, and no Batch 1/2/3 or trade/payment rewiring.

A few conditions before you begin Stage 1:

1. Keep the SSOT strict. Statuses, milestones, blocker names, overdue labels, role keys, evidence statuses, funder statuses and finality outcomes must all come from the central Batch 4 constants module.
2. Do not invent identity or organisation/funder scoping if the existing schema already has a model for it. Adapt Batch 4 RLS to the live codebase’s existing user/org/funder structure.
3. Audit must be append-only from the start. No update/delete policies on audit rows.
4. Finality must be locked from the start. No finality row may be silently changed after insert.
5. Provider-dependent wording must be guarded from Stage 1 onward. Nothing provider-dependent may render as verified, compliant, bankable or live-provider verified.
6. Memory must never receive raw bank, ID, tax, UBO, personal document or unrestricted sensitive evidence fields.
7. Stage 1 should stop after SSOT, tables, RLS, GRANTs, finality lock, audit immutability, tests and the Stage 1 isolation guard. Do not start Stage 2 until Stage 1 is reported and signed off.

Please proceed with Stage 1 and report back with files changed, test results, isolation guard result, confirmation that Batch 1/2/3 and trade/payment areas were untouched, and the marker:

P5_BATCH_4_STAGE_1_COMPLETE

That is a professional approval and keeps the developer tightly boxed into the stage discipline.