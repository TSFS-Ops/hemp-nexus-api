# P-5 Batch 5 — Finality, Memory and Outcome History

**Status:** `P5_BATCH5_PHASE_3_DEPLOYED` (governed Memory writer + exclusion rules)

## Phase 3 scope (this batch)

Pure governed Memory write logic + exclusion enforcement. **No UI, no API projection, no cron jobs, no scheduled sweeps.**

### New DB functions (migration `*_phase_3_*.sql`)

- `public.p5b5_write_memory_from_finality(finality_record_id uuid, actor_id uuid, reason text) RETURNS uuid`
  - `SECURITY DEFINER`. `REVOKE ALL ... FROM PUBLIC`; `GRANT EXECUTE ... TO service_role` only.
  - **Idempotent** on `finality_record_id` — re-running returns the existing memory id and emits `p5b5.memory_write_skipped_idempotent`. No duplicate reusable memory.
  - **Exclusions enforced:**
    - finality not `final` → `p5b5.memory_write_excluded` (reason `not_final`), returns NULL.
    - outcome `TEST_OR_INVALID` → `p5b5.memory_write_excluded` (reason `test_or_invalid`), returns NULL.
    - `p5b5_dispute_status = 'under_dispute'` → row written with `memory_status='paused'`, `reliance_level='do_not_rely'`, audit event `p5b5.memory_paused`.
  - **Provider-dependency safety:** `FAILED_PROVIDER_DEPENDENCY` is tagged `is_provider_process_event=true`, `is_counterparty_fault=false`, `reliance_level='provider_process_history_only'`. Never written as counterparty misconduct.
  - **Forbidden-field stripping:** every snapshot copied into `safe_facts` is fed through `p5b5_strip_forbidden_fields` first. Raw bank details, account numbers, IBAN/SWIFT/routing, credentials, API keys, tokens, webhook secrets, private/internal/support notes, draft AI suggestions, PII not required, raw provider payloads, scraped claims, media rumours, duplicated notifications, test payments and sandbox payloads are removed recursively.
  - Emits a row to `p5_batch4_audit_events` on **every** code path (write / paused / excluded / idempotent).
- `public.p5b5_strip_forbidden_fields(jsonb) RETURNS jsonb` — `IMMUTABLE`, recursive object/array walk. Mirrored at `src/lib/p5-batch5/memory-writer.ts` for tests and edge-function use.
- `public.p5b5_detect_repeated_pattern(case_id uuid, outcome_type text) RETURNS boolean` — returns true only when EITHER ≥2 finality-backed (`final`, current-effective) events of the same outcome class exist for the case, OR ≥1 compliance-approved material event (`finality_corrections` or `finality_supersessions`) exists. One ordinary event is never enough.

### New TS module

- `src/lib/p5-batch5/memory-writer.ts`
  - `P5B5_MEMORY_EXCLUDED_OUTCOMES` — outcomes that may never produce reusable memory.
  - `P5B5_MEMORY_PERMITTED_SOURCES` — the nine approved source classes.
  - `P5B5_MEMORY_FORBIDDEN_SOURCES` — the exclusion list from the client brief (drafts, allegations, raw bank details, credentials, sandbox, etc.).
  - `P5B5_FORBIDDEN_FIELDS` — mirrors the DB stripper key set.
  - `P5B5_REPEATED_PATTERN_RULE` — `{ min_finality_backed_events: 2, min_compliance_approved_material_events: 1 }`.
  - `p5b5StripForbiddenFields(input)` — pure client-side mirror of the DB stripper (defensive use only).
  - `callP5B5WriteMemoryFromFinality(client, args)` — typed RPC caller for service-role edge contexts. Browser clients are blocked by the `REVOKE ALL FROM PUBLIC` on the RPC.

### Tests

- `src/tests/p5-batch5-phase-3-memory-writer.test.ts` — 21 tests covering:
  - forbidden-field stripping for raw bank details, credentials, tokens, API keys, provider payloads, private/internal notes, draft AI, PII; recursion into nested objects and arrays; null/scalar safety.
  - exclusion / permitted source vocabularies.
  - repeated-pattern threshold constants.
  - DB writer source guarantees: idempotency clause, non-final exclusion, `TEST_OR_INVALID` exclusion, `under_dispute` pause path, audit-event emission on every path, provider-dependency safety tags, snapshot stripping, `SECURITY DEFINER` with `REVOKE ALL FROM PUBLIC` and `service_role`-only `GRANT EXECUTE`, pattern detector thresholds.
  - migration adds no cron, no `pg_cron`, no `CREATE EXTENSION`.
- Phase 1 + 2 vocab drift guards still pass: `node scripts/check-p5-batch5-vocab-drift.mjs` → OK, `node scripts/check-basic-memory-vocab-drift.mjs` → OK.

### Verification

- Migration applied successfully against `ugrfyhwlonlmlcmcpcdm`.
- No business rows mutated.
- No cron jobs or scheduled sweeps added or modified. C6.2 still `CRON_INVOKE_CORRELATION_HARDENING_PHASE_1_DEPLOYED_PENDING_TICK`.
- No UI surfaces, no API-safe projection — those are Phase 4 / Phase 5.

### Final status

`P5_BATCH5_PHASE_3_DEPLOYED`

---

## Phase 2 scope (previously deployed)

Controlled change layer on top of the Phase 1 locked finality table. **Append-only, no cron jobs, no UI, no Memory writer logic beyond the dispute pause/restore behaviour.**

### New tables (all append-only via triggers)

- `finality_corrections` — corrected view with before/after; original retained.
- `finality_disputes` — challenge records + resolution outcomes (resolution fields locked once set).
- `finality_supersessions` — links original → superseding finality record.
- `finality_administrative_reclassifications` — outcome-label corrections.

RLS: read by platform_admin / compliance_analyst / legal_reviewer / auditor (per table); all writes via security-definer RPCs (service_role only at the data layer).

GRANTs per project rules: `SELECT` to `authenticated`, `ALL` to `service_role`.

### New enums

- `p5b5_dispute_category` (8 values per brief section 11.1)
- `p5b5_dispute_resolution` (7 values per brief section 11.6)

### Five server-side RPCs (security-definer, `EXECUTE` revoked from `anon`)

| RPC | Authorised roles | Effect |
|-----|------------------|--------|
| `p5b5_add_correction` | platform_admin, compliance_analyst | Inserts correction row; flips `p5b5_correction_status='corrected'`; transitions `final → corrected`. |
| `p5b5_mark_under_dispute` | platform_admin, compliance_analyst, legal_reviewer | Inserts dispute row; flips `p5b5_dispute_status='under_dispute'`, `p5b5_finality_status='under_dispute'`, `p5b5_memory_status='paused'`; pauses matching `p5_batch5_memory_records`. Blocks if an unresolved dispute already exists. |
| `p5b5_resolve_dispute` | platform_admin, compliance_analyst | Locks resolution; restores Memory to `active` on `dismissed`; keeps Memory `paused` on `upheld`/`partially_upheld`/`escalated`/`corrected`/`superseded` (caller must follow up with correction/supersession). |
| `p5b5_supersede_finality` | platform_admin only | Inserts supersession row; marks original `is_current_effective_record=false`, `p5b5_finality_status='superseded'`, `p5b5_memory_status='superseded'`; flips superseding record to current effective. |
| `p5b5_reclassify_finality` | platform_admin, compliance_analyst | Records previous → corrected outcome label; flips `p5b5_correction_status='administrative_reclassification'`. Does not change underlying evidence. |

Every RPC:
- validates a non-empty `reason`,
- writes a row to `p5_batch4_audit_events` with `event_type` prefixed `p5b5.*` and full `before_state`/`after_state` JSON,
- updates only fields permitted by the Phase 1 `p5b5_prevent_finality_mutation` lock trigger,
- never deletes or overwrites the original finality record,
- returns the new record id.

### Append-only enforcement

- `p5b5_insert_only_block()` — blocks all UPDATE/DELETE on `finality_corrections`, `finality_supersessions`, `finality_administrative_reclassifications`.
- `p5b5_disputes_append_only()` — blocks DELETE; on UPDATE, only resolution fields may transition, and once `resolution IS NOT NULL` they are locked.

### Tests

- `src/tests/p5-batch5-phase-2-correction-dispute-supersession.test.ts` — vocab parity for resolution outcomes, correction statuses, dispute lifecycle and the 11 final outcome codes; documents the five RPC names and four governed table names.
- Phase 1 drift guard still passes (`node scripts/check-p5-batch5-vocab-drift.mjs` → OK).
- v1 guard still passes (`node scripts/check-basic-memory-vocab-drift.mjs` → OK).

### Verification

- Migration applied successfully against `ugrfyhwlonlmlcmcpcdm`.
- No business rows mutated.
- No cron jobs added or modified. C6.2 still `CRON_INVOKE_CORRELATION_HARDENING_PHASE_1_DEPLOYED_PENDING_TICK`.

---

## Phase 1 scope (previously deployed)

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
