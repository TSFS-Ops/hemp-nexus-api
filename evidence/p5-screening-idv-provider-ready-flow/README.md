# P-5 Screening & IDV Provider-Ready Flow

Evidence directory for the P-5 Screening & IDV provider-ready internal build.

This batch is provider-ready only. No live external provider calls, no real
provider credentials, no claim of live verification.

## Phase 1 — SSOT registry (deployed)

Status marker: `P5_SCREENING_PHASE_1_DEPLOYED`

Files:

- `src/lib/p5-screening/registry.ts` — browser-safe SSOT
- `scripts/check-p5-screening-phase-1-registry.mjs` — drift guard
- `src/tests/p5-screening-phase-1-registry.test.ts` — vitest coverage

Pinned vocabulary:

- 5 check categories (`company_aml_sanctions`, `pep`, `watchlist_name`,
  `idv_person`, `adverse_media_admin_triggered`)
- 10 party roles + IDV-required-by-default subset
- 11 check states + clear/unresolved partitions
- 9 gates + block matrix (POI create / POI accept / WaD create never blocked
  by pending screening/IDV; `failed`/`rejected` block everything)
- 90-day reuse window + 5 invalidation triggers
- 10 allowed external phrases (verbatim)
- 15 banned external phrases (verbatim, guard-pinned, never rendered)
- 7 Memory-banned payload kinds
- 17 audit event names + 5 webhook event names (all `p5_screening.*`)
- 10 API-safe fields + 8 forbidden fields

Scope confirmation (Phase 1):

- No UI, no RPC, no API projection, no edge functions, no cron, no migrations
- No live provider calls, no provider credentials
- No payment-provider changes
- No Batch 6 / Batch 7 / Batch 8 surfaces touched
- No `app_role` enum widening
- No Memory or finality mutation
- No P-4 POI/WaD/Trading-Engine changes

## Phase 2 — canonical screening spine (deployed)

Status marker: `P5_SCREENING_PHASE_2_DEPLOYED`

Files:

- `supabase/migrations/20260626181220_*.sql` — single additive migration
- `scripts/check-p5-screening-phase-2-db.mjs` — DB spine guard
- `src/tests/p5-screening-phase-2-db.test.ts` — vitest coverage

Tables created (all `public`, all RLS-enabled, no anon GRANT, platform_admin
SELECT, service_role write):

1. `p5scr_subjects` — canonical party-subject identities + role
2. `p5scr_check_state` — current state per (subject, category); unique
3. `p5scr_check_results` — append-only provider/manual result records
4. `p5scr_manual_reviews` — admin review queue rows
5. `p5scr_idv_records` — append-only IDV outcomes
6. `p5scr_invalidations` — append-only reuse invalidation triggers
7. `p5scr_audit_events` — append-only audit ledger (17 events)
8. `p5scr_webhook_events_ledger` — append-only provider webhook ledger
9. `p5scr_memory_finality_links` — append-only link-only references

Hard contracts:

- Append-only on tables 3, 5, 6, 7, 8, 9 via `p5scr_block_mutation_append_only`
  trigger (SECURITY DEFINER, `SET search_path = public`, REVOKE FROM PUBLIC).
- Raw provider / webhook payloads isolated as `*_admin_only` columns.
- Live-provider claim requires recorded activation sign-off
  (`p5scr_cr_live_requires_signoff`, `p5scr_idv_live_requires_signoff`).
- Memory / finality links are reference-only — the migration never INSERTs or
  UPDATEs `p5_batch5_memory_records` or `p5_batch4_finality_records`.

Scope confirmation (Phase 2):

- DB persistence only — no new RPC write path (Phase 3)
- No UI, no API projection, no edge functions, no cron, no live provider calls
- No provider credentials, no payment-provider changes
- No Batch 6 / Batch 7 / Batch 8 surfaces touched
- No `app_role` enum widening, no destructive schema changes
- No Memory / finality mutation, no P-4 POI/WaD/Trading-Engine changes

## Phase 3 — RPC check engine (deployed)

Status marker: `P5_SCREENING_PHASE_3_DEPLOYED`

Files:

- `supabase/migrations/20260626181548_*.sql` — single additive migration
- `scripts/check-p5-screening-phase-3-rpc.mjs` — RPC guard
- `src/tests/p5-screening-phase-3-rpc.test.ts` — vitest coverage

12 RPCs (`p5scr_upsert_subject`, `p5scr_request_check`,
`p5scr_record_provider_pending`, `p5scr_record_result`, `p5scr_reuse_result`,
`p5scr_open_manual_review`, `p5scr_decide_manual_review`, `p5scr_record_idv`,
`p5scr_invalidate`, `p5scr_log_webhook`, `p5scr_link_memory_finality`,
`p5scr_evaluate_gate`) — all `SECURITY DEFINER`, `SET search_path = public`,
`REVOKE EXECUTE FROM PUBLIC`, `GRANT EXECUTE TO authenticated`, inline
`has_role(auth.uid(), 'platform_admin')` guard, matching audit-event insert.

Hard contracts:

- One open manual review per `(subject_id, category)` enforced by partial
  unique index `p5scr_manual_reviews_one_open`.
- `p5scr_reuse_result` enforces the 90-day reuse window server-side.
- `p5scr_evaluate_gate` is read-only; POI gates only block on confirmed-block
  states (`failed`/`rejected`), matching the SSOT block matrix.
- Live-provider sign-off CHECKs from Phase 2 still enforced; RPCs pass
  `provider_live_now` + `activation_signed_off_at` straight through.
- Append-only triggers on the ledger tables remain in force.

Scope confirmation (Phase 3):

- Service-role / platform_admin RPC write path only
- No new tables, no destructive schema changes
- No UI, no API projection (Phase 4)
- No edge functions, no cron, no live provider calls, no provider credentials
- No payment-provider changes
- No Batch 6 / Batch 7 / Batch 8 surfaces touched
- No `app_role` enum widening, no client-side write policies
- No Memory / finality mutation; link-only references only
- No P-4 POI/WaD/Trading-Engine changes

Awaiting acceptance before proceeding to Phase 4 (API-safe read/projection).

## Phase 4 — API-safe read projections (deployed)

Status marker: `P5_SCREENING_PHASE_4_DEPLOYED`

Files:

- `supabase/migrations/20260626181931_*.sql` — single additive read-only migration
- `scripts/check-p5-screening-phase-4-projection.mjs` — projection guard
- `src/tests/p5-screening-phase-4-projection.test.ts` — vitest coverage

2 read RPCs (`p5scr_api_subject_status`, `p5scr_api_gate_readiness`) — all
`SECURITY DEFINER`, `STABLE`, `SET search_path = public`,
`REVOKE EXECUTE FROM PUBLIC`, `GRANT EXECUTE TO authenticated`, inline
`has_role(auth.uid(), 'platform_admin')` guard.

Projection envelope returns only SSOT API-safe fields: `ready`,
`readiness_status`, `blockers`, `affected_party`, `affected_check`,
`last_checked_at`, `expires_at`, `admin_review_required`, `provider_pending`,
`retry_pending`.

`readiness_status` values are emitted verbatim from the SSOT allowed-wording
set only: `Screening pending`, `Provider pending`, `Manual review required`,
`Identity verification required`, `Screening expired`,
`Not ready - counterparty checks pending`.

Hard contracts:

- SSOT banned-wording set never appears in projection SQL.
- SSOT API-forbidden field names (`raw_provider_payload`, `provider_api_secret`,
  `id_image`, `selfie`, `biometric_template`, `match_score`, `list_name`,
  `raw_adverse_media`) are never selected or returned.
- POI gates (`poi_create`, `poi_accept`, `wad_create`) only surface blockers
  for confirmed-block states (`failed`/`rejected`), matching the SSOT block
  matrix from Phase 1 and the Phase 3 evaluator.

Scope confirmation (Phase 4):

- API-safe read/projection layer only — read-only, no INSERT/UPDATE/DELETE
- No new tables, no destructive schema changes
- No UI (Phase 5), no edge functions, no cron
- No live provider calls, no provider credentials
- No payment-provider changes
- No Batch 6 / Batch 7 / Batch 8 surfaces touched
- No `app_role` enum widening, no client-side write policies
- No Memory / finality access or mutation
- No P-4 POI/WaD/Trading-Engine changes

Awaiting acceptance before proceeding to Phase 5 (admin review queues / UI).

## Phase 5 — admin readiness workbench (deployed)

Status marker: `P5_SCREENING_PHASE_5_DEPLOYED`

Files:

- `src/lib/p5-screening/api.ts` — typed wrapper over Phase 4 projections
- `src/pages/admin/p5-screening/Workbench.tsx` — admin readiness workbench
- `src/App.tsx` — `/admin/p5-screening` route, lazy-loaded, `platform_admin`
- `scripts/check-p5-screening-phase-5-ui.mjs` — UI guard
- `src/tests/p5-screening-phase-5-ui.test.ts` — vitest coverage

Hard contracts:

- Workbench is read-only: no write controls, no direct table access, no edge
  function invocation.
- API wrapper only calls `p5scr_api_subject_status` and `p5scr_api_gate_readiness`
  from Phase 4 — no `supabase.from('p5scr_*')` anywhere in UI.
- SSOT banned wording (`sanctions hit`, `pep hit`, `match score`, `list name`,
  etc.) never appears in any screening UI file.
- SSOT API-forbidden fields (`raw_provider_payload`, `provider_api_secret`,
  `id_image`, `selfie`, `biometric_template`, `match_score`, `list_name`,
  `raw_adverse_media`) never referenced in any screening UI file.
- Mandatory disclaimer rendered on every load:
  *"Provider-ready is not provider-verified. No live provider calls have been
  made; status reflects internal screening state only."*

Scope confirmation (Phase 5):

- UI surfaces only — no DB migrations, no new RPC write path
- No edge functions, no cron, no live provider calls, no provider credentials
- No payment-provider changes
- No Batch 6 / Batch 7 / Batch 8 surfaces touched
- No `app_role` enum widening, no destructive schema changes
- No client-side write policies; reads go through Phase 4 projections only
- No Memory / finality mutation
- No P-4 POI/WaD/Trading-Engine changes
- No tenant or funder surfaces; admin (`platform_admin`) only

## Phase 6 — Memory/audit hardening + final QA aggregate (deployed)

Status markers: `P5_SCREENING_PHASE_6_DEPLOYED`, `P5_SCREENING_IDV_FINAL_QA_COMPLETE`

Files:

- `supabase/migrations/20260626182605_*.sql` — additive guard-only migration
- `scripts/check-p5-screening-phase-6-memory-audit.mjs` — Memory/audit guard
- `src/tests/p5-screening-phase-6-memory-audit.test.ts` — vitest coverage

Hard contracts:

- `p5scr_memory_finality_links` rejects any row whose `kind` is one of the SSOT
  Memory-banned payload kinds (`raw_provider_payload`, `id_image`, `selfie`,
  `biometric`, `unresolved_possible_match`, `provider_pending_state`,
  `raw_adverse_media`) via `BEFORE INSERT OR UPDATE` trigger
  `p5scr_memory_link_kind_guard`.
- `p5scr_audit_events.payload_admin_only` rejects any row whose JSON object
  contains a top-level key in the SSOT API-forbidden set
  (`raw_provider_payload`, `provider_api_secret`, `id_image`, `selfie`,
  `biometric_template`, `match_score`, `list_name`, `raw_adverse_media`) via
  `BEFORE INSERT OR UPDATE` trigger `p5scr_audit_payload_key_guard`.
- Both guard functions are `SECURITY DEFINER`, `SET search_path = public`, and
  have `EXECUTE` revoked from `PUBLIC`.
- Append-only triggers from Phase 2 remain in force; Phase 6 only layers
  additional rejection rules — no row is ever mutated or deleted by Phase 6.

Scope confirmation (Phase 6):

- Memory/audit rule hardening only — no new tables, no new RLS policies,
  no new RPC write path, no projection change, no UI change
- No edge functions, no cron, no live provider calls, no provider credentials
- No payment-provider changes
- No Batch 6 / Batch 7 / Batch 8 surfaces touched
- No `app_role` enum widening, no destructive schema changes
- No Memory / finality mutation; rule layer only
- No P-4 POI/WaD/Trading-Engine changes

### Final QA aggregate

What can be claimed as **internal-live**:

- Canonical screening spine (`p5scr_*` tables, append-only ledgers)
- Required-check RPC engine (12 writers + 2 read projections)
- Admin readiness workbench at `/admin/p5-screening` (`platform_admin` only)
- SSOT-pinned vocabulary, allowed/banned wording guards, API-safe field
  allowlist, Memory-banned payload-kind guard, audit-payload key guard
- Gate matrix wired so POI create/accept/WaD create are only blocked by
  confirmed-block states (`failed`/`rejected`); WaD seal, finality,
  funder-ready, and API `ready=true` are blocked by any unresolved state

What can only be claimed as **provider-ready** (NOT provider-verified):

- Sanctions / PEP / watchlist / adverse media outcomes (all admin- or
  stub-sourced; no live Dilisense / Dow Jones / Refinitiv calls)
- IDV outcomes (no live Onfido / CIPC calls)
- Webhook ledger (`p5scr_webhook_events_ledger`) accepts records but no live
  provider currently posts to it

What must **not** be claimed yet:

- Live provider verification of any subject
- Real-time provider freshness
- Automated adverse-media monitoring
- Cross-jurisdiction watchlist coverage beyond what the admin records manually

Release marker: `P5_SCREENING_IDV_FINAL_QA_COMPLETE`.





