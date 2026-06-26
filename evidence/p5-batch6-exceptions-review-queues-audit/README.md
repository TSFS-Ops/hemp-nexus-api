# P-5 Batch 6 — Exceptions, Review Queues and Audit

Governed exception-control layer for the P-5 spine: capture, queue, prioritise,
review, dispute, audit, and externally report on every operational, evidence,
compliance, funder, provider, payment, finality, Memory and security exception.

This batch is built and accepted in **phases**, mirroring the gated workflow
used for Batch 5. Each phase is applied as a separate batch and only proceeds
on explicit user acceptance.

## Cross-batch contracts

- **Batch 5 remains authoritative** for finality (`p5_batch4_finality_records`)
  and Memory (`p5_batch5_memory_records`). Batch 6 references Batch 5 status
  semantics but does not redefine finality or Memory state.
- **C6.2 remains pending.** Batch 6 must not introduce `pg_cron` jobs or
  scheduled sweeps. Existing no-cron guard in `scripts/check-p5-batch5-no-cron.mjs`
  will be extended in Phase 6 to cover Batch 6 files.
- **No Batch 7 work.** Phase 1 drift guard rejects any `p5-batch7` / `Batch 7`
  token in the registry.

---

## Phase 1 — Data and constants  ✅ DEPLOYED

Status marker: `P5_BATCH6_PHASE_1_DEPLOYED`

### What was applied

- `src/lib/p5-batch6-exception-registry.ts` — Single Source of Truth (SSOT):
  - `P5_BATCH6_SCHEMA_VERSION = "p5b6.v1"`
  - `P5_BATCH6_EXCEPTION_TYPES` (12 client-approved categories)
  - `P5_BATCH6_EXCEPTION_DEFINITIONS` (owner role, default queue, default status,
    default severity, finality/Memory impact flags, authorised resolvers)
  - `P5_BATCH6_REVIEW_QUEUES` (10 incl. `unified_operations_inbox`)
  - `P5_BATCH6_QUEUE_DEFINITIONS` (owner role, SLA targets, control-tower flag)
  - `P5_BATCH6_PRIORITIES` (P0–P4 with sort order, escalation hours, downgrade
    approval requirement)
  - `P5_BATCH6_STATUSES` (21 controlled lifecycle statuses) and
    `P5_BATCH6_TERMINAL_STATUSES`
  - `P5_BATCH6_DISPUTE_STATES` (13) and `P5_BATCH6_DISPUTE_STATES_PAUSE_MEMORY`
  - `P5_BATCH6_NOTE_TYPES` (10, immutable) and reason-mandatory subset
  - `P5_BATCH6_AUDIT_EVENTS` (≥48, all `p5b6.*` prefix) and
    `P5_BATCH6_AUDIT_EVENTS_REQUIRE_BEFORE_AFTER`
  - `P5_BATCH6_REPORTS` (13) and `P5_BATCH6_REPORT_DEFINITIONS` (export formats,
    restricted flag, mandatory audit-event-on-export)
  - `P5_BATCH6_EXTERNAL_SAFE_MESSAGES` (5 approved external phrases)
  - `P5_BATCH6_BANNED_EXTERNAL_WORDING` (15 forbidden external phrases)
  - `P5_BATCH6_API_SAFE_FIELDS` (14 allowlisted fields incl. `schema_version`)
  - `P5_BATCH6_API_SAFE_STATUSES` (13 machine-safe statuses)
  - `P5_BATCH6_FORBIDDEN_EXTERNAL_FIELDS` (raw payloads, secrets, private notes)

- `scripts/check-p5-batch6-exception-consistency.mjs` — Phase 1 drift guard:
  - registry file exists
  - all 12 exception types, 10 queues, 5 priorities, ≥21 statuses, 13 dispute
    states, 10 note types, ≥30 audit events, 13 reports, ≥10 banned phrases
  - banned external phrases do not appear inside the approved external-safe
    messages
  - no Batch 7 tokens leak into the registry

- `src/tests/p5-batch6-phase-1-registry.test.ts` — registry contract tests:
  cardinality, presence, cross-references (every exception's default queue and
  default status must be registered), priority sort order monotonic, banned
  phrases not present in approved phrases, API-safe contract surface.

### Constraints honoured

- No DB migrations.
- No RPCs.
- No edge functions.
- No UI routes.
- No cron jobs.
- No changes to Batch 5 or prior P-5/P-4 functionality.

### Pending phases (separate apply batches, each gated by acceptance)

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | SSOT registry + drift guard + contract tests | ✅ DEPLOYED |
| 2 | DB persistence: `p5b6_exceptions`, `p5b6_exception_notes`, `p5b6_exception_audit_events`, `p5b6_exception_disputes`, `p5b6_exception_queue_assignments`, `p5b6_exception_report_exports` with RLS, GRANTs, append-only triggers | ✅ DEPLOYED |
| 3 | Server-side RPCs: create, assign, change priority, resolve, reopen, request evidence, approve waiver, raise dispute, mark finality under dispute, pause/resume Memory reuse, tombstone-legal | ⏸ pending acceptance |
| 4 | Permission matrix + API-safe projection (`projectExceptionToApiSafe`) + blocked-state helpers | ⏸ |
| 5 | UI: Unified Operations Inbox, queue screens, exception detail, dispute workflow, cross-domain timeline, reports, organisation/funder/developer external-safe surfaces | ⏸ |
| 6 | Final QA: cross-phase consistency, sensitive-field exposure sweep, permission matrix re-check, wording guard, no-cron guard extension, acceptance suite | ⏸ |

---

## Phase 2 — DB persistence  ✅ DEPLOYED

Status marker: `P5_BATCH6_PHASE_2_DEPLOYED`

### Tables created (all `public` schema, `schema_version = 'p5b6.v1'`)

| Table | Purpose | Append-only |
|-------|---------|-------------|
| `p5b6_exceptions` | Core exception record (type, queue, priority, status, severity, owner role, assignee, org/funder/counterparty scope, links to finality/memory/match, external-safe message) | No (mutable lifecycle) |
| `p5b6_exception_notes` | Immutable governance notes (10 note_types) | Yes |
| `p5b6_exception_audit_events` | Append-only audit ledger; all event_code values must start with `p5b6.` | Yes |
| `p5b6_exception_disputes` | Dispute lifecycle (13 dispute_states) with `pauses_memory` flag | No (state advances) |
| `p5b6_exception_queue_assignments` | Historical assignment trail | Yes |
| `p5b6_exception_report_exports` | Report export ledger (`csv`/`json`/`pdf`, restricted flag, scope) | Yes |

### CHECK constraints mirror Phase 1 SSOT

- 12 exception types, 10 queues, 5 priorities, 21 statuses, 13 dispute states, 10 note types — values match `src/lib/p5-batch6-exception-registry.ts` exactly.
- Every table enforces `schema_version = 'p5b6.v1'`.
- Audit event_code must match `p5b6.%`.

### Functions / triggers

- `public.p5b6_block_mutation_append_only()` — SECURITY DEFINER, `search_path = public`. Raises `42501` on any UPDATE/DELETE attempted by a non-`service_role`/non-`postgres` caller. Attached to notes, audit, queue assignments and report exports.
- `update_updated_at_column` reused for mutable tables (`p5b6_exceptions`, `p5b6_exception_disputes`).

### RLS + GRANTs

All six tables:
- `GRANT SELECT ... TO authenticated`
- `GRANT ALL ... TO service_role`
- `ENABLE ROW LEVEL SECURITY`
- Admin SELECT policy: `platform_admin` OR `governance_reviewer` OR `compliance_analyst` (canonical roles present in `app_role` enum).
- `p5b6_exceptions` additionally has a tenant-scoped SELECT policy: rows where `org_id`, `funder_org_id` or `counterparty_org_id` matches the caller's `profiles.org_id`.
- No `anon` grants. No client-side INSERT/UPDATE/DELETE policies — all writes go through service-role RPCs added in Phase 3.

### Indexes

- `p5b6_exceptions_queue_status_idx (review_queue, status)`
- `p5b6_exceptions_org_idx (org_id)`
- `p5b6_exceptions_assignee_idx (assignee_user_id)`
- `p5b6_notes_exception_idx (exception_id)`
- `p5b6_audit_exception_idx (exception_id, created_at)`
- `p5b6_audit_event_code_idx (event_code)`
- `p5b6_disputes_exception_idx (exception_id)`
- `p5b6_disputes_state_idx (dispute_state)`
- `p5b6_qassign_exception_idx (exception_id, created_at)`
- `p5b6_reports_code_idx (report_code, created_at)`

### Constraints honoured

- Additive migration only — no schema changes to Batch 5 finality, Memory or any earlier P-5/P-4 table.
- No UI routes, no React/TS source changes.
- No edge functions.
- No `pg_cron` jobs or scheduled sweeps (C6.2 still pending).
- No RPC endpoints (Phase 3).
- No API projection (Phase 4).
- No Batch 7 dashboard/API tokens.
- Sensitive fields (`metadata`, `before_snapshot`, `after_snapshot`, internal `reason` notes) remain server-side only — never exposed to a future external projection; Phase 4 allowlist will enforce.

### Test / linter results

- Migration applied cleanly (single transaction).
- Supabase linter: 327 issues reported, all pre-existing (no new errors introduced by Batch 6 Phase 2). The new function `p5b6_block_mutation_append_only` already pins `search_path = public` so it does not add a `Function Search Path Mutable` warning.

### Status marker

`P5_BATCH6_PHASE_2_DEPLOYED` — awaiting acceptance before Phase 3 (server-side RPCs).
