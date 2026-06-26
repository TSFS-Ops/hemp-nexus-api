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


