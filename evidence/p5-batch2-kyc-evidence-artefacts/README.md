# P-5 Batch 2 — KYC / KYB, Evidence and Artefacts

Governed evidence layer that converts the client's answered Batch 2
questionnaire into buildable product behaviour. Build is staged; each stage
ends with tests + this README update, then stops for client sign-off.

Provider-dependent checks must **never** be described as live, verified,
passed, cleared, sanctions clear, bank verified, provider approved or no
adverse result until real provider results exist.

---

## Stage 1 — Foundation: schema, enums, RLS, audit, SSOT drift guard

**Status:** `P5_BATCH_2_STAGE_1_COMPLETE`

### Files added / changed

- `supabase/migrations/<timestamp>_p5_batch2_stage_1_foundation.sql` — single
  migration creating all Stage 1 enums, tables, triggers, GRANTs and RLS.
- `src/lib/p5-batch2/constants.ts` — TS SSOT for the 7 Batch 2 enums and the
  forbidden-wording catalogue.
- `src/lib/p5-batch2/types.ts` — shared TS shapes for records, items,
  versions, review events, packs and waivers (admin-only fields kept out of
  shared shapes).
- `src/tests/p5-batch2-enum-drift.test.ts` — DB ↔ TS drift guard (7 enums).
- `evidence/p5-batch2-kyc-evidence-artefacts/README.md` — this file.

### Database surface

Enums (`p5b2_*`):
- `p5b2_kyc_record_type` (11 values)
- `p5b2_evidence_status` (13 values)
- `p5b2_evidence_rating` (6 values)
- `p5b2_requirement_level` (4 values)
- `p5b2_rejection_reason` (20 fixed codes from questionnaire §9)
- `p5b2_provider_status` (6 values — all explicitly non-"verified" wording)
- `p5b2_replacement_reason` (10 values)

Tables (all `p5_batch2_*`):
- `p5_batch2_kyc_records` — party records (subject-linkage trigger requires
  at least one of organisation / counterparty / match / trade_request /
  programme / api_client / owner_user)
- `p5_batch2_record_links` — many-to-many person↔company / party↔transaction
- `p5_batch2_evidence_items` — per-record evidence with status, rating,
  requirement level, expiry, provider-dependency state.
  CHECK constraint `p5b2_evidence_no_unsupported_live_claim` enforces that
  `provider_live = true` requires `provider_result_reference IS NOT NULL` —
  the platform cannot claim live provider verification without a referenced
  provider result.
- `p5_batch2_evidence_versions` — immutable file versions
  (file_hash, uploader, replacement_reason). Append-only guard `p5b2_versions_guard`
  blocks edits to immutable columns; the only mutable columns are
  `is_current` and `archived_at`. Unique partial index forces exactly one
  current version per item.
- `p5_batch2_evidence_review_events` — full append-only review history.
  UPDATE and DELETE are blocked by triggers.
- `p5_batch2_evidence_packs` + `p5_batch2_evidence_pack_items` — immutable
  finality snapshots. Pack items append-only.
- `p5_batch2_evidence_waivers` — admin waivers (scope + reason mandatory).
- `p5_batch2_sensitive_access_log` — append-only unmask / download audit.

Helper functions:
- `public.p5b2_has_any_role(uuid, text[])` (SECURITY DEFINER, `SET search_path = public`)
- `public.p5b2_touch_updated_at()` / `public.p5b2_append_only_block()` /
  `public.p5b2_versions_guard()` / `public.p5b2_kyc_records_require_subject()`
  (all `SET search_path = public`)

GRANTs: `authenticated` (SELECT only on protected tables; UPDATE allowed
only via service_role through the future Stage 3 RPCs); `service_role` full
access where needed. No `anon` grants.

RLS:
- **Privileged read** to any of: `platform_admin`, `executive_approver`,
  `compliance_analyst`, `governance_reviewer`, `operator_case_manager`,
  `auditor`, `auditor_read_only`, `developer_technical_admin`.
- **Org read** for users whose `profiles.org_id` matches a record's
  `organization_id` (KYC records, evidence items via parent record, versions
  via item↔record, packs).
- **Owner read** for the user who owns a personal record
  (`owner_user_id = auth.uid()`).
- Review events, waivers and sensitive access log are **privileged only**;
  customer/funder/API access in later stages goes through a scoped edge
  function — never the raw tables.

### Tests

```
npx vitest run src/tests/p5-batch2-enum-drift.test.ts
```

Expected: 7/7 pass (one assertion per enum).

### Confirmations

- **Zero business mutation.** No existing trade, POI, WaD, billing, payment
  or business-decision rows are touched.
- **Append-only audit.** Triggers reject UPDATE and DELETE on review events,
  pack items and sensitive access log. Evidence versions allow only
  `is_current` / `archived_at` updates.
- **No customer / funder / API surfaces** added in Stage 1.
- **No UI** added in Stage 1.
- **No provider simulation** or fake verification.
- **Provider-wording safety** is enforced at the data layer (CHECK
  constraint) and will be enforced again at edge / UI layers in Stages 2–6.

---

## Stage 2 — Pure-TS engines

**Status:** `P5_BATCH_2_STAGE_2_COMPLETE`

Pure deterministic modules only. No DB writes, no UI, no RPCs, no edge
functions, no Batch 1 readiness wiring, no business-row mutation.

### Files added

- `src/lib/p5-batch2/checklist-engine.ts` — segmented evidence buckets
  (`missing_mandatory`, `missing_mandatory_before_finality`,
  `missing_conditional`, `optional_recommendations`, `uploaded_unreviewed`,
  `rejected`, `expired`, `provider_dependent`, `waived`). Distinguishes
  mandatory / optional / conditional / not_required and applies
  jurisdiction / transaction-type / funder-rule / api-rule / override /
  waiver promotions before bucketing.
- `src/lib/p5-batch2/status-transitions.ts` — full 13-status legal
  transition map with structured denial codes (`illegal_status_transition`,
  `actor_not_authorised`, `terminal_status`). Actor-role guards for
  `platform_admin`, `compliance_owner`, `operator_case_manager`,
  `organisation_user`, `counterparty`, `director_officer`,
  `ubo_controller`, `funder`, `api_customer`, `system`. Funder and
  api_customer can never mutate evidence.
- `src/lib/p5-batch2/rating-engine.ts` — six-band pre-rating
  (`strong`, `good`, `acceptable`, `weak`, `unusable`,
  `provider_dependent`) plus a `human_review_required` flag. Mandatory
  evidence ALWAYS requires human review — automation is never final.
- `src/lib/p5-batch2/provider-wording-guard.ts` — blocks the seven
  forbidden phrases from `P5B2_FORBIDDEN_PROVIDER_WORDING` when
  `provider_live=false`, with negation-aware matching so safe phrases such
  as "Manual review recorded — not provider verified" remain safe. Ships
  safe wording catalogues for `admin`, `organisation_user`,
  `counterparty`, `funder` and `api_user`.
- `src/lib/p5-batch2/readiness-bridge.ts` — pure delta function over
  `kyb` / `kyc` / `governance` / `compliance` / `bankability` /
  `execution` / `finality` / `funder_pack` / `api`. Missing-mandatory →
  blocker; rejected-mandatory → blocker; expired-mandatory → blocker;
  uploaded-unreviewed-mandatory → review (compliance) + blocker
  (finality); weak → review; unusable → blocker; waived → progress only
  within waiver scope; provider-dependent → warning, never live-verified;
  bank details changed → blocks payment + finality.
- `src/lib/p5-batch2/expiry-rules.ts` — policies for proof of address,
  bank confirmation (profile vs payment/finality), tax/VAT, ID/passport,
  company registration, director/officer list, UBO declaration,
  authority-to-act, sector licence and transaction documents. Reminder
  schedule 30 / 14 / 7 days.
- `src/lib/p5-batch2/masking.ts` — role-based masking helpers for bank
  account, ID/passport, tax/VAT, physical address, UBO details, personal
  contact, reviewer note, fraud flag, provider raw response. Usable by
  both edge functions and UI render code.

### Tests added

- `src/tests/p5-batch2-checklist-engine.test.ts` (5)
- `src/tests/p5-batch2-status-transitions.test.ts` (12)
- `src/tests/p5-batch2-rating-engine.test.ts` (7)
- `src/tests/p5-batch2-provider-wording.test.ts` (5)
- `src/tests/p5-batch2-readiness-bridge.test.ts` (6)
- `src/tests/p5-batch2-expiry-rules.test.ts` (7)
- `src/tests/p5-batch2-masking.test.ts` (9)

```
npx vitest run src/tests/p5-batch2-*.test.ts
```

Result: **58 / 58 pass** (51 new Stage 2 + 7 Stage 1 enum-drift).

### Confirmations

- **No DB writes.** No migrations applied in Stage 2.
- **No UI** changes.
- **No RPCs or edge functions.**
- **No Batch 1 readiness wiring** yet — the readiness bridge is pure and
  not invoked by any Batch 1 surface.
- **No existing trade / POI / WaD / billing / payment / business-decision
  rows mutated.**
- Provider wording guard, readiness bridge and masking helpers are now
  the reusable foundations for every later UI / API surface in Stages 3–6.

### Remaining stages (not yet started)

- Stage 3 — server RPCs + scoped edge function + SQL proof
- Stage 4 — admin / operator surfaces
- Stage 5 — subject / counterparty / funder / API-customer surfaces
- Stage 6 — notifications, SLA cron, finality bridge, cross-consistency
  guards, embarrassment audit
