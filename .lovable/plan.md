## P-5 Batch 5 — Finality, Memory & Outcome History

Batch 5 is a governed record layer, not a status field. This plan proposes a phased delivery and flags two hard preconditions before any code lands.

### Preconditions (must clear first)

1. **C6.2 still pending tick.** `CRON_INVOKE_CORRELATION_HARDENING_PHASE_1_DEPLOYED_PENDING_TICK` is unresolved. Batch 5 will add new cron-eligible surfaces (memory pause sweeps, dispute SLA, supersession reconciliation). I recommend waiting for the post-hardening outreach tick to confirm before adding any new scheduled jobs in Batch 5.
2. **Existing overlaps to reconcile, not duplicate:**
  - `public.p5_batch4_finality_records` (15 cols) already exists. Batch 5's `finality_records` must **extend** this table or sit alongside it with a documented relationship — not be a parallel table.
  - `public.basic_memory_records` has a v1 closed vocab (3 triggers / 3 outcomes / 3 reasons) protected by `scripts/check-basic-memory-vocab-drift.mjs`. Batch 5 expands this to 11 outcomes + memory_status enum + dispute/correction trail. The drift guard, TS SSOT (`src/lib/basic-memory/outcomes.ts`) and DB CHECK constraints must all move together in one migration or the build fails.
  - `p5_batch4_audit_events`, `p5_batch4_blockers`, `p5_batch4_evidence_items`, `p5_batch4_execution_milestones`, `p5_batch4_funder_releases` already cover much of the readiness → finality pipeline. Batch 5 should build the **Memory + supersession + dispute + API-safe** layers on top, not re-implement readiness.

### Phased delivery (six phases, each independently reviewable)

**Phase 1 — Schema SSOT + vocab expansion (migration + TS only, no UI)**

- Extend `basic_memory_records` vocab (or create `memory_records_v2` if v1 must stay frozen) to the 11 Batch 5 outcome codes, `memory_status`, `dispute_status`, `correction_status`, `provider_dependency_status`, `evidence_completeness_status`.
- Add `finality_status` enum (`none`, `ready_for_finality`, `final`, `under_dispute`, `corrected`, `superseded`, `invalid_test`).
- Extend `p5_batch4_finality_records` with: snapshot JSON columns (evidence/rating/compliance/funder/approvals/waivers/exceptions/provider/payment/webhook/reconciliation), `is_current_effective_record`, `superseded_by_finality_record_id`, `audit_hash_reference`, `hash_chain_reference`, `schema_version`, `outcome_code_version`.
- Lock policy: `UPDATE` blocked by trigger after `finality_status='final'` except for the controlled `is_current_effective_record` / `superseded_by_finality_record_id` columns.
- Update `src/lib/basic-memory/outcomes.ts` SSOT + the drift-guard script in lockstep.
- GRANTs + RLS per project rules.

**Phase 2 — Correction / Dispute / Supersession records**

- New tables: `finality_corrections`, `finality_disputes`, `finality_supersessions`, `finality_administrative_reclassifications`.
- Append-only; original always retained; before/after JSON snapshots.
- Server-side RPCs: `p5b5_add_correction`, `p5b5_mark_under_dispute`, `p5b5_resolve_dispute`, `p5b5_supersede_finality`, `p5b5_reclassify_finality`. All security-definer, role-gated via `has_role`, audit-emitting.
- Cascade: marking dispute flips `memory_status` to `paused`; resolution writes corrected memory or restores active.

**Phase 3 — Memory writer + exclusion rules (pure logic + RPC)**

- Pure module `src/lib/p5-batch5/memory-writer.ts` mirroring section 7 (what feeds) and section 8 (exclusions).
- DB-side writer `p5b5_write_memory_from_finality` invoked from finality RPC; idempotent on `finality_record_id`.
- Repeated-pattern detector gated by the 2-event / 1-compliance-approved threshold.
- Defence-in-depth strip of forbidden fields (extends `P5B4_MEMORY_FORBIDDEN_FIELDS`).

**Phase 4 — Permission matrix + API-safe projection**

- `src/lib/p5-batch5/permissions.ts` for the 9 roles in section 9 with the 14 capability flags in section 15.
- `src/lib/p5-batch5/api-safe.ts` projection function — strict allowlist of the 12 fields in section 12.1; all other fields stripped.
- Blocked-state response shapes (`permission_denied`, `memory_paused_due_to_dispute`, etc.).
- `schema_version` + `outcome_code_version` constants.

**Phase 5 — UI surfaces (admin + org + funder + counterparty + memory panel)**

- `src/pages/admin/p5-batch5/FinalityMemory.tsx` — admin list + actions (Create Finality, Add Correction, Mark Dispute, Supersede, Reclassify, Export, API-safe preview).
- `src/pages/desk/p5-batch5/` — organisation finality view.
- `src/pages/funder/p5-batch5/` — funder lane view.
- `src/components/p5-batch5/MemoryHistoryPanel.tsx` — permission-aware timeline with filters, banners (Under Dispute / Corrected / Superseded / Excluded / Provider Failure / Test/Invalid), drill-down.
- Reasoned-action dialogs reused from Batch 1 pattern.
- Wording guard: extend `P5_FORBIDDEN_WORDS` with the 14 banned terms in section 13.2 and add copy tests.

**Phase 6 — Tests + acceptance + evidence**

- Vitest suites covering sections 17.1–17.8 (finality creation gates, all 11 outcome codes, evidence linkage, correction/dispute/supersession, memory writer + exclusions, 9-role permission matrix, API scoping, blocked states, wording guard).
- Append `evidence/p5-batch5-finality-memory-outcome-history/README.md` with acceptance walkthrough per section 18.
- No new cron jobs unless C6.2 is runtime-confirmed first.

### Technical details

- **Lock enforcement:** trigger `prevent_finality_mutation()` raises on any UPDATE/DELETE of a `final`-status row except whitelisted columns; same for correction/dispute/supersession rows (append-only).
- **Audit:** every RPC writes to `p5_batch4_audit_events` (already exists, 21 cols) with `event_type` prefixed `p5b5.*`, including `before_state`/`after_state`/`hash_reference`.
- **Memory pause semantics:** `memory_status='paused'` is read by all scoring / matching / readiness consumers via a single `is_memory_reliance_allowed(finality_record_id)` SQL function — single chokepoint to enforce.
- **Hash chain:** continue the existing `audit_hash_reference` pattern; no new chain.
- **API versioning:** `schema_version='p5b5.v1'`, `outcome_code_version='p5b5-outcomes.v1'` as constants in `src/lib/p5-batch5/version.ts`.

### What I will NOT do without explicit go-ahead

- Touch C6 cron jobs (still paused per your last instruction).
- Replace `p5_batch4_finality_records` — I will extend it.
- Break the `basic_memory_records` v1 drift guard silently — vocab expansion will move SSOT + DB + guard in one migration.
- One-shot all six phases. Each phase is a separate apply batch with its own approval.

### Open questions before Phase 1

1. **Memory table strategy:** extend `basic_memory_records` v1 vocab (and bump the drift guard to v2), or create `p5_batch5_memory_records` as a parallel v2 table and leave v1 frozen?
2. **Finality table strategy:** extend `p5_batch4_finality_records` in place, or create `p5_batch5_finality_records` and migrate Batch 4 rows forward?
3. **Auto-finality:** section 4 mentions "approved auto-finality rule" as an exception. Is any auto-finality in scope for Batch 5, or human-only this batch?
4. **C6.2 gate:** do I wait for the post-hardening outreach tick before starting Phase 1, or proceed with Phase 1 (schema only, no cron) now?

I will not start Phase 1 until these four are answered and the plan is approved.  
  
Yes — this is a strong plan. I would approve it with a few firm decisions so Lovable is not left choosing architecture.

Here are the answers I would give before Phase 1.

---

## **Approval position**

Approved, with one important constraint:

**Proceed with Phase 1 now only because it is schema / SSOT / guard work and does not introduce new cron jobs. Do not add scheduled jobs until C6.2 is runtime-confirmed.**

The plan is correct to treat Batch 5 as a governed record layer, not a simple status field. It also correctly identifies the two main risks: accidentally duplicating Batch 4 finality infrastructure, and breaking the existing `basic_memory_records` vocabulary guard.

---

# **Answers to the four open questions**

## **1. Memory table strategy**

**Decision: create** `p5_batch5_memory_records` **as the v2 Memory table. Do not overload** `basic_memory_records`**.**

Reason:

`basic_memory_records` already has a protected v1 closed vocabulary and a drift guard. Batch 5 is materially more advanced: it introduces finality-backed Memory, correction trails, dispute pause semantics, supersession, provider dependency history, API-safe reliance status and role-scoped visibility.

That is too much to force into a “basic” table without turning the table into something it was not designed to be.

Recommended approach:

- Keep `basic_memory_records` intact for existing/basic Memory behaviour.
- Add `p5_batch5_memory_records` for governed Memory.
- Update the SSOT to clearly distinguish:
  - `basic_memory_records` = basic v1 Memory;
  - `p5_batch5_memory_records` = governed finality-backed Memory.
- Do not silently expand the old guard. Instead, add a new Batch 5 guard:
  - `scripts/check-p5-batch5-memory-vocab-drift.mjs`
- Keep the old guard intact unless there is a direct dependency requiring a shared outcome list.

This is cleaner, safer and easier to audit.

**Instruction to Lovable:**

Create a new governed Memory table for Batch 5. Do not mutate `basic_memory_records` beyond what is strictly necessary for compatibility. Maintain v1 guard stability and add a Batch 5-specific SSOT and drift guard.

---

## **2. Finality table strategy**

**Decision: extend** `p5_batch4_finality_records` **in place. Do not create a competing finality table.**

Reason:

Batch 4 already introduced finality infrastructure. Creating `p5_batch5_finality_records` would split the source of truth and create confusion across dashboards, audit, API responses and Memory writes.

Batch 5 should be the governed expansion of Batch 4 finality, not a replacement.

Recommended approach:

- Extend `p5_batch4_finality_records`.
- Add Batch 5 columns for:
  - locked snapshots;
  - outcome-code version;
  - schema version;
  - Memory write status;
  - dispute status;
  - correction status;
  - provider dependency status;
  - hash/audit references;
  - supersession link;
  - current effective record marker.
- Add clear comments in the migration stating that Batch 5 extends the Batch 4 table as the canonical finality table.
- Do not create a duplicate `p5_batch5_finality_records` table.

**Instruction to Lovable:**

Treat `p5_batch4_finality_records` as the canonical finality table. Batch 5 must extend it, not replace it.

---

## **3. Auto-finality**

**Decision: no auto-finality in Batch 5. Human-only finality for this batch.**

Reason:

The client’s answers allow the system to automatically mark a case as `Ready for Finality`, but the actual final outcome selection and finality creation require authorised human approval unless a specific approved auto-finality rule exists. There is no client-approved auto-finality rule yet.  

So for Batch 5:

- system may propose `Ready for Finality`;
- system may show the readiness checklist;
- system may pre-fill snapshots;
- system may recommend the eligible outcome options;
- but finality creation must require authorised human confirmation.

Auto-finality can be left as a future extension point, but it should not be implemented now.

**Instruction to Lovable:**

Build support for the concept of an approved auto-finality rule, but set it to disabled / not implemented for Batch 5. All Batch 5 finality creation must be human-approved.

---

## **4. C6.2 gate**

**Decision: proceed with Phase 1 now, but do not create or modify cron jobs until C6.2 is runtime-confirmed.**

Reason:

Phase 1 is schema, SSOT and guard work only. It does not need scheduled execution. Waiting for C6.2 before doing schema work would unnecessarily block progress.

However, anything involving:

- memory pause sweeps;
- dispute SLA jobs;
- supersession reconciliation jobs;
- scheduled reminders;
- scheduled cleanup;
- cron-based state correction;

must wait until the post-hardening tick confirms the cron invocation path.

**Instruction to Lovable:**

Phase 1 may proceed now. No new cron jobs, scheduled functions or scheduled reconciliation tasks may be added until C6.2 is confirmed by a successful runtime tick.

---

# **Final approved direction to send back to Lovable**

You can paste the following directly.

Approved, with the following decisions and constraints.

1. Memory table strategy

Create a new governed Batch 5 Memory table, preferably `p5_batch5_memory_records`.

Do not force the expanded Batch 5 vocabulary into `basic_memory_records` unless there is a hard existing dependency. `basic_memory_records` should remain the basic v1 Memory surface. Batch 5 Memory is materially more advanced because it includes finality-backed Memory, dispute pause semantics, correction records, supersession, provider dependency history, API-safe reliance status and role-scoped visibility.

Keep the existing `basic_memory_records` drift guard intact. Add a new Batch 5-specific SSOT and drift guard, for example:

- `src/lib/p5-batch5/outcomes.ts`
- `src/lib/p5-batch5/version.ts`
- `scripts/check-p5-batch5-memory-vocab-drift.mjs`

The v1 guard must not be broken silently.

2. Finality table strategy

Extend `public.p5_batch4_finality_records` in place.

Do not create a competing `p5_batch5_finality_records` table. Batch 4 already introduced the finality surface, so Batch 5 must expand that canonical table rather than splitting the source of truth.

Add the Batch 5 fields required for locked snapshots, finality status, outcome code version, schema version, Memory write status, dispute status, correction status, provider dependency status, supersession linkage, current effective record marker and audit/hash references.

The migration should clearly document that `p5_batch4_finality_records` remains the canonical finality table and that Batch 5 extends it.

3. Auto-finality

No auto-finality in Batch 5.

The system may automatically calculate and propose `Ready for Finality`, show the readiness checklist and prepare the finality snapshot, but actual finality creation must require authorised human approval.

Build only an extension point for future approved auto-finality rules. Do not activate auto-finality now.

For Batch 5, the final outcome selection and `Create Finality Record` action must be human-approved.

4. C6.2 gate

Proceed with Phase 1 now because it is schema / SSOT / guard work only.

Do not add, modify or enable any new cron jobs until C6.2 is runtime-confirmed by a successful post-hardening tick.

This means no scheduled jobs yet for Memory pause sweeps, dispute SLA checks, supersession reconciliation or any other Batch 5 scheduled process. Those can be planned but must not land until the cron hardening confirmation is complete.

5. General implementation rule

Batch 5 must build on top of the existing Batch 4 readiness/finality infrastructure. It must not re-implement Batch 4 readiness, blockers, evidence items, execution milestones or audit events.

Use the existing Batch 4 tables where appropriate, especially:

- `p5_batch4_finality_records`
- `p5_batch4_audit_events`
- `p5_batch4_blockers`
- `p5_batch4_evidence_items`
- `p5_batch4_execution_milestones`
- `p5_batch4_funder_releases`

Batch 5 should add the governed Memory, correction, dispute, supersession and API-safe reliance layers on top.

6. Approval

Phase 1 is approved on the basis above.

Please proceed only with Phase 1 as a separate apply batch. Do not one-shot all six phases. Each phase must remain independently reviewable, with tests and evidence for that phase before moving to the next.