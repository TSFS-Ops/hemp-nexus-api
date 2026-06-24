# P-5 Batch 2 — KYC / KYB, Evidence and Artefacts

Batch 2 is large enough that it must be built in supervised stages, the same way Batch 1 was (Stages 1→6 + embarrassment audit). Each stage ends with tests + evidence README update, then stops for sign-off.

This plan is the **build instruction set**. The client's questionnaire answers are the source of truth, and provider-dependent checks must never be described as live / verified / passed until real provider results exist.

---

## Stage 1 — Foundation: schema, enums, RLS, audit, SSOT drift guard

**Goal:** lay down the governed evidence data layer with append-only audit and a TS ↔ DB drift guard. No UI, no behaviour change to Batch 1.

DB (single migration, `p5_batch2_*` namespace, `org_id`-scoped RLS, GRANTs, append-only audit triggers):

- Enums
  - `p5_kyc_record_type` (company, director_officer, ubo_controller, authorised_rep, counterparty, funder_entity, funder_contact, api_customer, transaction_party, bank_account, invited_evidence_owner)
  - `p5_evidence_status` (missing, requested, uploaded, under_review, accepted, accepted_with_warning, rejected, expired, replaced, waived, provider_dependent, suspended_hold, revoked)
  - `p5_evidence_rating` (strong, good, acceptable, weak, unusable, provider_dependent)
  - `p5_requirement_level` (mandatory, optional, conditional, not_required)
  - `p5_rejection_reason` (20-code fixed list from §9)
  - `p5_provider_status` (provider_ready_not_live_provider_verified, provider_credentials_pending, provider_result_pending, provider_unavailable, provider_failed, manual_review_recorded_not_provider_verified)
  - `p5_replacement_reason` (10 codes from §13)
- Tables
  - `p5_kyc_records` (party records — type, linked entity/txn/bank, jurisdiction, status)
  - `p5_kyc_record_links` (many-to-many person↔company, party↔transaction)
  - `p5_evidence_items` (record_id, category, requirement_level, status, rating, expiry_date, provider_*, current_version_id)
  - `p5_evidence_versions` (immutable: file_hash, uploader, uploaded_at, replacement_reason, archived_at)
  - `p5_evidence_review_events` (append-only: action, reason_code, reviewer_note (admin-only), customer_safe_note, actor_type)
  - `p5_evidence_packs` + `p5_evidence_pack_items` (finality snapshots)
  - `p5_evidence_waivers` (scope, reason, expiry)
  - `p5_sensitive_access_log` (unmask/download events)
- RLS: `org_id` scoped + role checks (`platform_admin`, compliance, operator, party-owner via record link)
- GRANTs: `authenticated` + `service_role`; no `anon`
- Append-only triggers on `*_review_events`, `*_versions`, `*_pack_items`, `sensitive_access_log`

TS SSOT (`src/lib/p5-batch2/`):

- `constants.ts` — all enums mirrored
- `types.ts` — record / evidence / version / pack interfaces
- `drift-guard.test.ts` — DB enum ↔ TS SSOT parity (target 7/7 enums)

**Acceptance:** drift guard 7/7 passing; no business rows mutated; evidence/p5-batch2-kyc-evidence-artefacts/README.md created with Stage 1 marker. **Stop.**

---

## Stage 2 — Pure-TS engines: checklist, status, rating, provider wording, readiness bridge

No DB writes, no UI. Pure deterministic functions + tests.

- `checklist-engine.ts` — generates required evidence list from `{record_type, jurisdiction, entity_type, transaction_type, finality_condition, funder_rule, api_rule, provider_dependency, overrides, waivers}`. Returns segmented buckets: missing-mandatory, missing-mandatory-before-finality, missing-conditional, optional-recommendations, uploaded-unreviewed, rejected, expired, provider-dependent.
- `status-transitions.ts` — legal status transitions + actor-role guard.
- `rating-engine.ts` — six-band auto pre-rating from completeness/expiry/match/provider; flags items requiring human reviewer.
- `provider-wording-guard.ts` — forbidden phrases ("verified", "passed", "cleared", "sanctions clear", "bank verified", "provider approved", "no adverse result") rejected for any record where `provider_live=false`; safe-wording catalogue per viewer (admin / funder / org / counterparty / api).
- `readiness-bridge.ts` — given evidence state, returns deltas for {KYB, KYC, governance, compliance, bankability, execution, finality, funder-pack, api-readiness}. Pure function — Stage 3 wires it to DB.
- `expiry-rules.ts` — §12 expiry windows + reminder schedule (30/14/7d).
- `masking.ts` — last-4 for bank/ID, partial for tax/VAT/address; role matrix from §11.

Tests under `src/tests/p5-batch2-*.test.ts` covering each engine + a wording-guard sweep.

**Acceptance:** all Stage 2 tests green; no DB or UI changes. README updated. **Stop.**

---

## Stage 3 — Server RPCs + edge function + provider-state model

Server-authoritative actions. Every RPC writes audit. Append-only enforced.

Migration: RPCs (security definer, `SET search_path = public`):

- `p5b2_create_kyc_record`, `p5b2_link_records`
- `p5b2_generate_checklist` (returns segmented buckets)
- `p5b2_upload_evidence_version` (creates new version, marks previous Replaced, requires replacement_reason)
- `p5b2_review_evidence` (accept / accept_with_warning / reject / request_correction — reason_code required for reject/correction)
- `p5b2_set_provider_state` (admin/system only; never sets a "verified" state without provider result reference)
- `p5b2_waive_evidence` (admin; scope + reason mandatory)
- `p5b2_withdraw_evidence`, `p5b2_suspend_release`
- `p5b2_snapshot_finality_pack` (immutable pack write)
- `p5b2_log_sensitive_access` (unmask/download)

Edge function `p5-batch2-readiness-summary` — viewer-scoped, returns the exact API JSON from §16; never emits raw files / full PII; respects masking + provider-wording guards.

SQL proof (`supabase/tests/p5_batch2_rpc_proof.sql`): exercises full happy + rejection + replacement + waiver paths in a transaction, emits `P5B2_STAGE3_PROOF_OK`, rolls back.

TS tests: API scoping, masking, provider wording on edge response.

**Acceptance:** RPC + edge tests pass; SQL proof OK; no business rows mutated; README updated. **Stop.**

---

## Stage 4 — Admin / operator surfaces

All admin/operator UI behind `useP5Batch2Permissions` (extends Stage 4 of Batch 1 patterns):

- Evidence dashboard (gap / review / provider-dependent / expiry / rejected / bank-change / UBO-high-risk queues)
- Record detail (checklist, version history, audit timeline, sensitive access log)
- Evidence pack viewer + finality snapshot viewer
- Reasoned-action dialogs (Approve, Accept with warning, Reject, Request correction, Waive, Suspend/Release, Set provider state, Unmask)
- All mutations go through Stage 3 RPC wrappers — never direct table writes.
- Wording guard applied at render time to every label.

Tests: permissions, dashboard render, wording, action wiring.

**Acceptance:** Stage 4 tests + Stage 1–3 tests all green. No customer/funder/API surfaces yet. **Stop.**

---

## Stage 5 — Subject + counterparty + funder + API-customer surfaces

Read-only or strictly-scoped write surfaces:

- Org / counterparty: checklist, upload task list, missing list, rejection-with-safe-reason view, expiry warnings, provider-dependent safe messaging, readiness status.
- Director / UBO / invited owner: own-evidence upload + status only.
- Funder: permissioned evidence pack viewer, readiness summary, provider-dependent warnings, masked personal/bank.
- API-customer surface: metadata + readiness + gap output (no raw files by default).

All these surfaces consume only the scoped summary edge function from Stage 3 — never the raw tables. Wording guard enforced.

Tests: leak audit (no admin-only fields in non-admin surfaces), masking, wording, funder-mutation-forbidden.

**Acceptance:** cumulative tests green, no business mutations, no admin-only field leakage. **Stop.**

---

## Stage 6 — Notifications, SLA cron, finality bridge, end-to-end acceptance journey

- Notifications/tasks for the 13 triggers in §19 with idempotency.
- Cron `p5-batch2-evidence-sla-monitor` (15 min) — expiry reminders (30/14/7d), missing-finality escalation (48h), missing-non-finality escalation (5wd), bank-change second-review SLA.
- Wire `readiness-bridge` outputs into Batch 1 readiness cases; finality must be blocked while hard blockers exist.
- End-to-end acceptance test mirroring §20 journey (single test that walks all 28 steps).
- Cross-consistency guards (§21) as scripts under `scripts/check-p5-batch2-*.mjs`:
status, rating, provider-wording, API-exposure, masking, audit, readiness-bridge, finality, versioning, memory-safety.
- Final embarrassment-prevention audit (cross-surface, role-leak, wording sweep).

**Acceptance:** full P-5 Batch 2 test suite green; all guards green; SQL proofs green; README finalised with `P5_BATCH_2_COMPLETE` marker. **Stop. Do not start Batch 3.**

---

## Cross-cutting non-negotiables (every stage)

- **Zero business mutation**: no edits to existing trade / POI / WaD / billing / payment / business-decision rows.
- **Append-only audit**: every material action writes an immutable event; tested via triggers.
- **Provider wording guard**: enforced in DB (CHECK/trigger where feasible), TS (lint-style guard), and at render time.
- **Masking**: applied server-side in edge function and client-side at render — never trust either alone.
- **No raw files in API by default**: file access requires explicit scope + permission + signed short-lived URL + access log.
- **Memory safety**: only outcome references (no raw PII / bank / ID numbers / provider raw responses) ever sent to Memory.
- **Stop at each stage** for sign-off before proceeding.

---

## Technical notes

- New code lives under `src/lib/p5-batch2/`, `src/pages/admin/p5-batch2/`, `src/pages/registry/p5-batch2/`, `src/pages/funder/p5-batch2/`, `supabase/functions/p5-batch2-*`, `supabase/migrations/`, `evidence/p5-batch2-kyc-evidence-artefacts/`.
- Reuses Batch 1 patterns: `useP5Permissions`-style hook, RPC wrappers in `src/lib/p5-batch2/rpc.ts`, append-only triggers, drift-guard test pattern, cron via `cron_invoke()` with `x-internal-key`.
- All UI uses semantic tokens — no hardcoded colours; existing shadcn variants only.

Awaiting approval to start **Stage 1** only.  
  
This is strong. I would send it to Lovable almost exactly as written. The only adjustment I’d make is to **tighten the opening instruction** so Lovable does not accidentally start multiple stages or treat the whole document as one mega-build.

Use this as the final command:

Start **P-5 Batch 2 — Stage 1 only**.

Use the full Batch 2 build instruction set above as the controlling plan, but implement **Stage 1 only** at this time.

Client answers are the source of truth. Provider-dependent checks must never be described as live, verified, passed, cleared, bank verified, sanctions clear, provider approved or no adverse result unless real provider results exist.

For Stage 1, build only:

1. The governed evidence database foundation.
2. The required enums.
3. The `p5_batch2_*` tables.
4. Org-scoped RLS and role-based access.
5. GRANTs for `authenticated` and `service_role`, with no `anon`.
6. Append-only audit triggers.
7. TS SSOT under `src/lib/p5-batch2/`.
8. DB enum ↔ TS SSOT drift guard tests.
9. Evidence README with Stage 1 marker.

Do **not** build UI.  
Do **not** wire behaviour into Batch 1.  
Do **not** mutate existing trade, POI, WaD, billing, payment or business-decision rows.  
Do **not** start Stage 2.  
Do **not** create customer, funder or API surfaces.  
Do **not** add provider simulation or fake verification.

Stage 1 acceptance requirement:

- One migration only for the Stage 1 DB foundation.
- All 7 enum drift guards pass.
- Append-only audit protections are tested.
- RLS is tested for org scoping and role access.
- No business rows are mutated.
- `evidence/p5-batch2-kyc-evidence-artefacts/README.md` is created or updated with a clear Stage 1 marker.
- Final response must stop after Stage 1 evidence and ask for sign-off before Stage 2.

Return:

- Files created/changed.
- Tests added.
- Test results.
- SQL proof / guard result.
- Confirmation that no Batch 1 behaviour or business rows were changed.
- Clear marker: `P5_BATCH_2_STAGE_1_COMPLETE`.

The main thing this fixes is scope discipline. Your staged plan is already enterprise-grade; this command makes it impossible for Lovable to “helpfully” jump ahead.