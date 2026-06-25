# P-5 Batch 5 — Finality, Memory and Outcome History

**Status:** `P5_BATCH5_PHASE_1_DEPLOYED` (schema + SSOT + drift guard only)

## Phase 1 scope

Schema, SSOT and drift guard. **No UI, no RPCs, no Memory writer, no cron jobs.**

### Decisions (locked by approved plan)

1. **Memory table:** new `p5_batch5_memory_records` table. `basic_memory_records` v1 vocab + drift guard untouched.
2. **Finality table:** extend `public.p5_batch4_finality_records` in place. This remains the canonical finality table; no parallel `p5_batch5_finality_records` was created.
3. **Auto-finality:** not in scope this batch. Human-only finality creation in later phases.
4. **C6.2 gate:** Phase 1 introduces no scheduled jobs. No new cron until `CRON_INVOKE_CORRELATION_HARDENING_PHASE_1_DEPLOYED_PENDING_TICK` is runtime-confirmed.

## Files

- Migration: `supabase/migrations/*p5_batch5_phase_1*.sql` (latest)
- SSOT: `src/lib/p5-batch5/outcomes.ts`, `src/lib/p5-batch5/version.ts`
- Drift guard: `scripts/check-p5-batch5-vocab-drift.mjs`

## Schema changes

### Enums (new)

- `p5b5_finality_status` — 7 values
- `p5b5_final_outcome_code` — 11 values (matches brief section 3.2 exactly)
- `p5b5_memory_status` — 6 values
- `p5b5_dispute_status` — 7 values
- `p5b5_correction_status` — 4 values
- `p5b5_provider_dependency_status` — 7 values
- `p5b5_evidence_completeness_status` — 4 values

### `p5_batch4_finality_records` extensions

Added columns (all nullable or defaulted, backward compatible):
- Status enums: `p5b5_finality_status`, `p5b5_final_outcome_code`, `p5b5_memory_status`, `p5b5_dispute_status`, `p5b5_correction_status`, `p5b5_provider_dependency_status`, `p5b5_evidence_completeness_status`
- Locked snapshots (jsonb): `evidence_relied_on_snapshot`, `evidence_rating_snapshot`, `compliance_decision_snapshot`, `kyb_kyc_decision_snapshot`, `funder_review_outcome_snapshot`, `approvals_snapshot`, `waivers_snapshot`, `exceptions_snapshot`, `provider_dependency_state_snapshot`, `payment_state_snapshot`, `webhook_state_snapshot`, `reconciliation_state_snapshot`
- Supersession + audit: `is_current_effective_record`, `superseded_by_finality_record_id` (self-FK), `audit_hash_reference`, `hash_chain_reference`
- Versioning: `schema_version` (default `p5b5.v1`), `outcome_code_version` (default `p5b5-outcomes.v1`)

Indexes:
- `p5b4_finality_records_p5b5_status_idx`
- `p5b4_finality_records_current_effective_idx` (partial, on case_id where `is_current_effective_record`)
- `p5b4_finality_records_superseded_by_idx`

### Lock trigger

`p5b5_prevent_finality_mutation()` (BEFORE UPDATE OR DELETE):
- Blocks DELETE on any row with `p5b5_finality_status='final'`.
- Blocks UPDATE of identity, snapshot, actor, audit, hash and version fields once `p5b5_finality_status='final'`.
- Allows controlled mutation of: `p5b5_finality_status`, `p5b5_memory_status`, `p5b5_dispute_status`, `p5b5_correction_status`, `p5b5_provider_dependency_status`, `p5b5_evidence_completeness_status`, `is_current_effective_record`, `superseded_by_finality_record_id`.

### `p5_batch5_memory_records` (new)

Append-only governed Memory table. Trigger `p5b5_memory_records_append_only()` blocks DELETE and blocks UPDATE of every column except: `memory_status`, `dispute_status`, `correction_status`, `superseded_by_memory_record_id`.

RLS:
- SELECT — platform_admin OR auditor only.
- INSERT/UPDATE/DELETE — service_role only (i.e. via security-definer RPC in Phase 3).

GRANTs:
- `SELECT` to `authenticated`
- `ALL` to `service_role`

## Drift guard

`scripts/check-p5-batch5-vocab-drift.mjs` validates the 7 closed enums + the 2 version stamps. Independent of the v1 `basic_memory_records` guard, which is unchanged and still passes.

## Out of scope (later phases)

- Phase 2: correction / dispute / supersession tables + RPCs
- Phase 3: Memory writer + exclusion rules
- Phase 4: permission matrix + API-safe projection
- Phase 5: UI surfaces
- Phase 6: acceptance tests + evidence

## Verification

- Migration ran successfully against `ugrfyhwlonlmlcmcpcdm`.
- `node scripts/check-p5-batch5-vocab-drift.mjs` → OK
- `node scripts/check-basic-memory-vocab-drift.mjs` → OK (v1 untouched)
- No business rows mutated. No cron jobs added or modified.
- C6.2 status unchanged: `CRON_INVOKE_CORRELATION_HARDENING_PHASE_1_DEPLOYED_PENDING_TICK`.

## Final status

`P5_BATCH5_PHASE_1_DEPLOYED`
