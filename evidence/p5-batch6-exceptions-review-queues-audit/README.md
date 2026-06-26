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
| 3 | Server-side RPCs (write path): create, status, priority, assign, note, raise/update dispute, record report export | ✅ DEPLOYED |
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

---

## Phase 3 — Server-side RPCs (write path)  ✅ DEPLOYED

Status marker: `P5_BATCH6_PHASE_3_DEPLOYED`

All functions are `SECURITY DEFINER`, pin `SET search_path = public`, revoke
`EXECUTE` from `PUBLIC`, and grant `EXECUTE` only to `authenticated`. No
`app_role` enum changes. No new client-side write policies. Append-only
tables remain append-only — RPCs only INSERT into notes / audit events /
queue assignments / report exports.

### Internal helpers

| Function | Purpose |
|----------|---------|
| `p5b6_assert_admin_actor()` | Gates on `platform_admin` OR `governance_reviewer` OR `compliance_analyst`; on failure raises `42501` and writes `p5b6.access.unauthorised_attempt_blocked`. |
| `p5b6_assert_external_safe(_msg text)` | Case-insensitive scan against the 15 banned external phrases from SSOT; match raises `22023`. |
| `p5b6_write_audit(_exception_id, _event_code, _before, _after, _reason)` | Append-only insert into `p5b6_exception_audit_events`; enforces `p5b6.*` prefix and before/after-required event list. |

### RPCs (signatures)

| RPC | Signature | Audit events written |
|-----|-----------|----------------------|
| `p5b6_create_exception` | `(text type, text queue, text priority, text status, text severity, text owner_role, text summary, uuid org_id, uuid funder_org_id, uuid counterparty_org_id, uuid related_finality_id, uuid related_memory_id, uuid related_match_id, text external_safe_message, jsonb metadata) RETURNS uuid` | `p5b6.exception.created` |
| `p5b6_update_exception_status` | `(uuid id, text new_status, text reason) RETURNS void` | `p5b6.exception.status_changed` (with before/after); on terminal status sets `resolved_at` and, when a reason is supplied, writes an immutable `resolution_reason` note. |
| `p5b6_update_exception_priority` | `(uuid id, text new_priority, text reason) RETURNS void` | `p5b6.exception.priority_changed` (with before/after) **and** mandatory immutable `priority_change_reason` note. |
| `p5b6_assign_exception` | `(uuid id, text to_queue, uuid to_assignee, text reason) RETURNS void` | First call: `p5b6.exception.assigned`; subsequent: `p5b6.exception.reassigned`. Also inserts a row in `p5b6_exception_queue_assignments`. |
| `p5b6_add_note` | `(uuid id, text note_type, text body, bool reason_required) RETURNS uuid` | `p5b6.exception.note_added` |
| `p5b6_raise_dispute` | `(uuid id, bool pauses_memory) RETURNS uuid` | Creates dispute in `dispute_raised`; if exception status differs, also emits `p5b6.exception.status_changed`; emits `p5b6.dispute.raised`. |
| `p5b6_update_dispute_state` | `(uuid dispute_id, text new_state, text closure_reason) RETURNS void` | `p5b6.dispute.state_changed` (with before/after); on terminal state also `p5b6.dispute.resolved` and stamps `closed_at`; `pauses_memory` flips to `false` when new state is non-pausing. |
| `p5b6_record_report_export` | `(text report_code, text export_format, jsonb scope, bool is_restricted, int row_count, uuid requested_for_org_id) RETURNS uuid` | `p5b6.export.report_generated`. Any `scope.public_message` is run through the banned-wording guard. |

### Validation rules enforced (raised at the boundary)

- All vocabulary values fall back on the table-level CHECK constraints from
  Phase 2 (status / priority / queue / severity / note_type / dispute_state /
  format / `p5b6.*` event prefix). Invalid values raise `22023` or `23514`.
- Caller authorisation: every RPC calls `p5b6_assert_admin_actor()` first.
- Banned external wording: enforced on `external_safe_message` at create time
  and on `scope.public_message` at export time.
- Priority change requires a non-empty reason (`22023` otherwise).
- Append-only invariants preserved: RPCs never UPDATE or DELETE
  `p5b6_exception_notes`, `p5b6_exception_audit_events`,
  `p5b6_exception_queue_assignments` or `p5b6_exception_report_exports`.
- Memory and finality: linked via FK columns on `p5b6_exceptions`; **no**
  RPC mutates `p5_batch4_finality_records` or `p5_batch5_memory_records`.
  Memory-pause semantics are represented entirely by
  `p5b6_exception_disputes.pauses_memory` for now.
- Report export ledger captures intent / metadata only (report_code, format,
  restricted flag, row_count, scope JSON without sensitive snapshots).

### RLS / permission impact summary

- No new RLS policies added.
- No `anon` execute grants.
- `EXECUTE` revoked from `PUBLIC` on every Batch 6 function (RPCs + helpers).
- `authenticated` callers can invoke the RPCs but the body itself enforces
  admin/governance/compliance role; any other authenticated user is blocked.
- Service-role retains direct table access (already granted in Phase 2).

### Constraints honoured

- No UI changes, no React/TS source changes.
- No edge functions.
- No `pg_cron` / scheduled sweeps (C6.2 still pending).
- No API projection (Phase 4) and no Batch 7 dashboard/API surfaces.
- No `app_role` enum widening.
- No destructive schema changes; no changes to Batch 5 finality / Memory
  tables or any prior P-5/P-4 schema.

### Linter results

Supabase linter: 337 issues total (327 pre-existing in Phase 2 + 10 new
warnings of the `Public Can Execute SECURITY DEFINER Function` /
`Function Search Path Mutable` false-positive class — every new RPC pins
`SET search_path = public` and revokes `EXECUTE FROM PUBLIC`, so anonymous
callers cannot invoke them. No new ERROR-level findings. No new
ungoverned write paths introduced.

### Status marker

`P5_BATCH6_PHASE_3_DEPLOYED` — awaiting acceptance before Phase 4
(permission matrix + API-safe projection).

---

## Phase 4 — API-safe projection (read layer)  ✅ DEPLOYED

Status marker: `P5_BATCH6_PHASE_4_DEPLOYED` — read-only SECURITY DEFINER
projections for admin/governance/compliance/tenant/funder scopes. See
migration `20260626051520_*.sql`. Forbidden fields and banned external
wording excluded by construction.

---

## Phase 5 — UI surfaces  ✅ DEPLOYED

Status marker: `P5_BATCH6_PHASE_5_DEPLOYED`. Five routes registered in
`src/App.tsx`, all wrapped in `RequireAuth`. Reads use Phase 4 safe
projections only; writes use Phase 3 RPCs only; no direct `p5b6_*` table
access from the UI.

---

## Phase 6 — Final QA, tests and acceptance report  ✅ DEPLOYED

Status marker: `P5_BATCH6_PHASE_6_DEPLOYED`

### Scope honoured

- No new features, no schema changes, no edge functions, no cron.
- No app_role widening. No Memory/finality mutation.
- No Batch 7 or Batch 8 surfaces. No prior-batch regressions.
- Only tests, guards, evidence updates.

### Added in Phase 6

- `scripts/check-p5-batch6-phase-6-qa.mjs` — cross-phase static guard.
- `src/tests/p5-batch6-phase-6-qa.test.ts` — vitest wrapper.

### What the Phase 6 guard verifies

1. **Phase 1 SSOT** registry present and well-formed.
2. **Phase 2 DB persistence**: 6 tables created, RLS enabled, `authenticated`
   SELECT + `service_role` ALL grants present, no `anon` grants; every
   SSOT vocabulary item (12 exception types, 10 queues, 21 statuses,
   10 note types, 13 dispute states) encoded as CHECK constraint values;
   append-only triggers on notes, audit events, queue assignments and
   report exports.
3. **Phase 3 RPCs** (11 functions): every function `SECURITY DEFINER`
   (or pure `IMMUTABLE` validator) and pins `SET search_path = public`;
   `REVOKE … FROM PUBLIC` present for every function; `GRANT EXECUTE …
   TO authenticated` present for every callable RPC.
4. **Phase 4 projections** (8 functions): same `SECURITY DEFINER` /
   `search_path` / `REVOKE` / `GRANT` contract.
5. **Phase 5 UI** (5 files):
   - no `supabase.from('p5b6_*')` direct table reads or writes anywhere;
   - no references to any of the 21 forbidden external fields
     (raw payloads, secrets, internal/private notes, etc.);
   - no banned external wording (`fraud`, `suspicious`, `sanctions hit`,
     `watchlist hit`, …) — 15 phrases checked case-insensitively;
   - every `.rpc(...)` call resolves to one of the 6 Phase 4 safe-read
     RPCs or one of the 8 Phase 3 write RPCs;
   - tenant (`/desk/...`) and funder (`/funder/...`) surfaces never
     invoke any write RPC.
6. **Routes**: all 5 Batch 6 routes registered in `src/App.tsx` and
   every Batch 6 route wrapped in `<RequireAuth>`.
7. **No pg_cron** schedule statements in any Batch 6 migration; **no
   edge function** under `supabase/functions/` references `p5b6_*`.
8. **No Batch 7 / Batch 8 tokens** in any Batch 6 code line (comment
   lines may negatively reference future batches; code lines may not).

### Test results

```
$ node scripts/check-p5-batch6-exception-consistency.mjs   → OK
$ node scripts/check-p5-batch6-phase-6-qa.mjs               → OK
$ vitest run src/tests/p5-batch6-phase-1-registry.test.ts \
              src/tests/p5-batch6-phase-6-qa.test.ts        → 53/53 pass
```

### Route verification

| Route                                            | Guard          | Component                |
| ------------------------------------------------ | -------------- | ------------------------ |
| `/admin/p5-batch6`                               | `platform_admin` | `Workbench.tsx`        |
| `/admin/p5-batch6/exceptions/:exceptionId`       | `platform_admin` | `ExceptionDetail.tsx`  |
| `/admin/p5-batch6/exports`                       | `platform_admin` | `ReportExports.tsx`    |
| `/desk/p5-batch6/my-exceptions`                  | `RequireAuth`  | `MyExceptions.tsx`       |
| `/funder/p5-batch6/exceptions`                   | `RequireAuth`  | `FunderExceptions.tsx`   |

Server-side authorisation for governance/compliance/tenant/funder scopes
is enforced inside the Phase 4 projections (`p5b6_actor_scope` +
`p5b6_can_view_exception`); the UI route guard is an additional
defence-in-depth layer only.

### Security / RLS verification

- All 6 Batch 6 tables: RLS enabled, `authenticated` SELECT only, no
  anon grants, `service_role` writes only — confirmed by guard.
- All 19 Batch 6 functions (11 Phase 3 + 8 Phase 4): `SECURITY DEFINER`
  (or pure `IMMUTABLE` validator), pinned `SET search_path = public`,
  `EXECUTE` revoked from `PUBLIC`, granted only to `authenticated`.
- Append-only persistence preserved on notes, audit events, queue
  assignments and report exports.
- Memory / finality tables (`p5_batch4_finality_records`,
  `p5_batch5_memory_records`) are **linked only** via FK columns; no
  Batch 6 RPC mutates them.

### Forbidden-field and wording verification

- 21 forbidden external fields — none referenced or rendered in any UI
  file (Workbench, ExceptionDetail, ReportExports, MyExceptions,
  FunderExceptions).
- 15 banned external phrases — none rendered in any UI file and none
  embedded in `P5_BATCH6_EXTERNAL_SAFE_MESSAGES`.
- Phase 3 `p5b6_assert_external_safe` also enforces the same ban
  server-side at write time.

### Final professional QA report

| Invariant                                                          | Result |
| ------------------------------------------------------------------ | :----: |
| Phase 1 SSOT ↔ Phase 2 CHECK constraints aligned                   |   ✅   |
| Phase 2 RLS enabled + correct grants on every new table            |   ✅   |
| Phase 2 append-only triggers on immutable tables                   |   ✅   |
| Phase 3 RPCs SECURITY DEFINER + search_path pinned + REVOKE PUBLIC |   ✅   |
| Phase 4 projections SECURITY DEFINER + search_path pinned + REVOKE |   ✅   |
| Phase 5 UI reads only via Phase 4 safe projections                 |   ✅   |
| Phase 5 UI writes only via Phase 3 RPCs                            |   ✅   |
| No direct `p5b6_*` table access from UI                            |   ✅   |
| Forbidden external fields not referenced in UI                     |   ✅   |
| Banned external wording absent from external-safe surfaces         |   ✅   |
| Tenant / funder surfaces are read-only and scope-limited           |   ✅   |
| All Batch 6 routes registered and guarded by `RequireAuth`         |   ✅   |
| No `pg_cron` jobs introduced (C6.2 still pending)                  |   ✅   |
| No edge functions reference Batch 6                                |   ✅   |
| No `app_role` enum widening                                        |   ✅   |
| No mutation of Memory / finality / prior P-5 / P-4 tables          |   ✅   |
| No Batch 7 / Batch 8 surface leakage                               |   ✅   |
| Vitest: 53 / 53 pass                                               |   ✅   |

### Final status marker

`P5_BATCH6_DEPLOYED` — all six phases accepted; Batch 6 closed.
