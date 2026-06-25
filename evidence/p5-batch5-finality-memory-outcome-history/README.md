# P-5 Batch 5 — Finality, Memory and Outcome History

**Status:** `P5_BATCH5_PHASE_4_DEPLOYED` (permission matrix + API-safe projection)

## Phase 4 scope (this batch)

Pure TS. Permission matrix and strict-allowlist API-safe projection. **No DB migration, no UI, no API endpoints registered, no cron jobs, no scheduled sweeps. Memory writer restrictions from Phase 3 are unchanged.**

### Files

- `src/lib/p5-batch5/permissions.ts`
  - 9 roles × 14 capability flags matrix (`getP5B5Capabilities(role, context)`).
  - Typed helpers: `canViewFinality`, `canViewMemory`, `canPerformFinalityAction`, `canExportP5B5`.
  - Context inputs: organisation ownership, assigned-case access, funder lane access, API scopes, auditor mandate, support escalation state. Missing context defaults to deny.
  - Supersede is super-admin-only (matches Phase 2 RPC `p5b5_supersede_finality` server gate).
- `src/lib/p5-batch5/api-safe.ts`
  - `P5B5_API_SAFE_FIELDS` — strict 14-field allowlist (matches the brief).
  - `projectFinalityToApiSafe(input, options)` — drops every key outside the allowlist; hides `evidence_rating` unless `evidence_rating.read` scope is present; hides `finality_record_reference` + `hash_reference` unless `audit.read` is present; hides `provider_dependency_status` unless `provider_dependency.read` (or `audit.read`) is present; always stamps `schema_version` (`p5b5.v1`) and `outcome_code_version` (`p5b5-outcomes.v1`) from `src/lib/p5-batch5/version.ts`.
  - Reliance-affecting states never return a clean projection — they return a typed blocked state:
    - missing / `none` → `finality_not_created`
    - `TEST_OR_INVALID` → `record_invalid_test`
    - `under_dispute` or paused memory → `memory_paused_due_to_dispute`
    - `superseded` → `record_superseded` (with `current_effective_record_reference` if supplied)
    - plus `permission_denied` and `evidence_not_shareable` available for caller composition.
  - `buildP5B5BlockedState(reason, context)` — typed blocked response. Never carries evidence, notes, raw payloads or internal fields.
  - `stripToApiSafe(body)` — defensive last-mile stripper for edge functions composing responses from multiple sources.

### Tests

- `src/tests/p5-batch5-phase-4-permissions-api-safe.test.ts` — 29 tests covering:
  - matrix shape (9 roles, 14 capabilities, every role returns a full flag object).
  - per-role gating: super admin full powers; compliance admin everything except supersede; org owner / contributor org-scoped + case-assigned; counterparty applicant case-scoped + may mark dispute / never exports; funder lane-gated; external API client scope-gated; auditor mandate-gated + read-only; support read-only during escalation, never exports / corrections / disputes.
  - typed helpers consistent with the matrix; supersede gating; export gating; unknown role denies everything.
  - API-safe projection drops unknown fields (`raw_payload`, `private_notes`, `bank_account_number`, `api_key`, `support_notes`, `scoring_formula`, `unverified_allegation`); evidence rating / hash / provider scopes enforced; version stamps always present.
  - `stripToApiSafe` removes unknown keys and stamps versions.
  - blocked-state behaviour for missing, TEST_OR_INVALID, under-dispute (3 paths), superseded (with current-effective ref), and version stamping on blocked responses.
  - blocked states never carry evidence, notes, raw payloads or internal fields (key-set assertion).

### Verification

- `bunx vitest run src/tests/p5-batch5-phase-4-permissions-api-safe.test.ts` → 29 passed.
- Phase 1 + 2 + 3 vocab drift guards still pass.
- No DB migration, no edge function registered, no UI added. No cron jobs or scheduled sweeps. C6.2 still `CRON_INVOKE_CORRELATION_HARDENING_PHASE_1_DEPLOYED_PENDING_TICK`.

### Final status

`P5_BATCH5_PHASE_4_DEPLOYED`

---

## Phase 3 scope (previously deployed)

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

---

## Phase 5 — UI surfaces (deployed)

Display + action surface over the Phase 1–4 foundations. **No new business rules**, no new RPCs, no cron, no schema changes.

### New files

- `src/pages/admin/p5-batch5/FinalityMemory.tsx` — admin Finality & Memory page (route `/admin/p5-batch5/finality-memory`, `platform_admin` guarded)
- `src/pages/desk/p5-batch5/OrganisationFinality.tsx` — organisation view (route `/desk/p5-batch5/finality`, `RequireAuth`)
- `src/pages/funder/p5-batch5/FunderFinality.tsx` — funder lane view (route `/funder/p5-batch5/finality`, `RequireAuth`)
- `src/components/p5-batch5/CounterpartyFinalitySummary.tsx`
- `src/components/p5-batch5/MemoryHistoryPanel.tsx` — permission-aware
- `src/components/p5-batch5/ApiSafePreviewPanel.tsx` — uses `projectFinalityToApiSafe` (no hand-rolled projection)
- `src/components/p5-batch5/WarningBanners.tsx` — dispute / corrected / superseded / excluded / provider-failure / test-invalid banners using approved wording
- `src/components/p5-batch5/ReasonedActionDialog.tsx` — reason-required, confirm-required, banned-wording-blocked, role-gated; delegates submit to caller's RPC bridge
- `src/lib/p5-batch5/wording.ts` — approved phrases + tooltips + `findP5B5BannedPhrases` runtime guard
- `scripts/check-p5-batch5-ui-wording.mjs` — UI banned-wording drift guard
- `src/tests/p5-batch5-phase-5-ui-contract.test.ts` — 45 tests

### Guarantees enforced by tests + guards

- UI never calls `supabase.from('p5_batch4_finality_records')`, `supabase.from('p5_batch5_memory_records')`, or `supabase.rpc('p5b5_*')` directly.
- API-safe preview panel uses the Phase 4 projection helper.
- Sensitive raw fields (raw provider payloads, raw bank details, private/internal/support notes, draft AI suggestions) are never rendered.
- Reasoned-action dialog requires reason ≥ 8 chars, confirmation checkbox, role permission and rejects banned wording.
- All 15 `P5B5_FORBIDDEN_WORDS` are absent across every Batch 5 UI file (8 files scanned).
- Routes guarded: admin via `role="platform_admin"`, organisation and funder via `RequireAuth`.

### Verification

- `node scripts/check-p5-batch5-ui-wording.mjs` → OK (8 files)
- `node scripts/check-p5-batch5-vocab-drift.mjs` → OK
- `node scripts/check-basic-memory-vocab-drift.mjs` → OK (v1 untouched)
- `bunx vitest run src/tests/p5-batch5-phase-5-ui-contract.test.ts` → 45/45 pass
- No DB migration, no edge functions, no cron jobs.

## Final status

`P5_BATCH5_PHASE_5_DEPLOYED`

---

## Phase 6 — Final acceptance, verification & evidence (deployed)

Hardening + cross-consistency verification phase. **No new features, no new RPCs, no schema changes, no edge functions, no cron jobs.** C6.2 remains pending and untouched.

### New files

- `src/tests/p5-batch5-phase-6-acceptance.test.ts` — 30 acceptance tests covering finality vocab, all 11 outcome codes, API-safe projection cross-consistency, blocked-state coverage, 9×14 permission matrix, forbidden-field stripping (recursive), repeated-pattern threshold, banned wording in approved phrases/tooltips, v1 basic-memory separation, and cron-absence in migrations.
- `scripts/check-p5-batch5-no-cron.mjs` — Batch 5 cron-absence drift guard (scans all Batch 5 migrations, lib, components and pages).

### Verification matrix

| Required area | Evidence |
| --- | --- |
| Finality creation gates | Phase 2 RPC tests + Phase 6 vocab assertions |
| All 11 final outcome codes | Phase 6 `routes all 11 outcome codes` |
| Finality locking | Phase 1 `prevent_finality_mutation` trigger |
| Correction / dispute / supersession / admin reclassification | Phase 2 tests + Phase 6 enum coverage |
| Memory writer & exclusions | Phase 3 tests + Phase 6 `TEST_OR_INVALID` exclusion |
| Forbidden-field stripping (recursive) | Phase 6 `strips raw provider, bank, credentials, pii and internal notes recursively` |
| Repeated-pattern threshold | Phase 6 `repeated-pattern threshold matches the spec` |
| 9-role × 14-capability matrix | Phase 4 + Phase 6 `has exactly 9 roles and 14 capabilities` |
| API-safe projection | Phase 6 `every successful projection emits exactly the 14 allowlisted fields` |
| Blocked-state responses | Phase 6 `every blocked reason has a non-empty user-safe message` |
| UI route guards & sensitive-field hiding | Phase 5 contract tests (45) |
| Warning banners & reasoned-action dialogs | Phase 5 contract tests |
| Audit event emission | Phase 2 RPC `audit_log` inserts |
| Drift guards | vocab, UI wording, no-cron — all OK |
| Banned wording absence | Phase 6 `no approved phrase or tooltip contains a banned phrase` |
| No cron additions | Phase 6 `no Batch 5 migration contains pg_cron tokens` + `check-p5-batch5-no-cron.mjs` |
| v1 isolation | Phase 6 `no Batch 5 source file imports basic-memory vocab` |

### Final verification run

- `node scripts/check-p5-batch5-no-cron.mjs` → OK (17 files scanned)
- `node scripts/check-p5-batch5-vocab-drift.mjs` → OK
- `node scripts/check-p5-batch5-ui-wording.mjs` → OK (8 files scanned)
- `node scripts/check-basic-memory-vocab-drift.mjs` → OK (v1 untouched)
- `bunx vitest run src/tests/p5-batch5-phase-{2,3,4,5,6}-*.test.ts` → **131 / 131 pass**
- No migration, no edge function, no cron job, no schema change introduced in Phase 6.
- C6.2 status unchanged: `CRON_INVOKE_CORRELATION_HARDENING_PHASE_1_DEPLOYED_PENDING_TICK`.

## Final acceptance marker

`P5_BATCH5_FINALITY_MEMORY_OUTCOME_HISTORY_COMPLETE`
