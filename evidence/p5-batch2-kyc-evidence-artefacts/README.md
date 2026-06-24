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

---

## Stage 3 — Server RPCs + scoped edge function + SQL proof

**Status:** `P5_BATCH_2_STAGE_3_COMPLETE`

### Files added / changed

- `supabase/migrations/<ts>_p5_batch2_stage_3_rpcs.sql` — 11
  SECURITY DEFINER RPCs (all `SET search_path = public`) + one role-resolver
  helper.
- `supabase/migrations/<ts>_p5_batch2_stage_3_snapshot_fix.sql` — rename of
  ambiguous loop variable inside `p5b2_snapshot_finality_pack`.
- `supabase/functions/p5-batch2-readiness-summary/index.ts` — viewer-scoped
  safe API JSON edge function.
- `supabase/tests/p5_batch2_rpc_proof.sql` — transactional SQL proof
  (BEGIN…ROLLBACK; emits `P5B2_STAGE3_PROOF_OK`).
- `src/tests/p5-batch2-stage3-edge-and-rpc.test.ts` — Stage 3 TS tests.

### RPC surface

| RPC | Purpose | Audit row | Role gate |
|---|---|---|---|
| `p5b2_create_kyc_record` | Create KYC/KYB record | n/a (creation logged in `created_by`) | platform_admin / compliance_analyst / operator_case_manager / governance_reviewer |
| `p5b2_link_records` | Person↔company / party↔transaction links; blocks cross-org for non-admins | n/a (created_by + correlation_id) | same as above |
| `p5b2_generate_checklist` | Returns 8-bucket checklist | read-only | any visible reader |
| `p5b2_upload_evidence_version` | Append new immutable version; archives previous; requires `replacement_reason` if replacing | `upload` / `replace` | uploader roles |
| `p5b2_review_evidence` | accept / accept_with_warning / reject / request_correction | review action | accept = compliance_analyst / platform_admin / executive_approver; reject = operator and above |
| `p5b2_set_provider_state` | Set provider status; blocks `provider_live=true` without `provider_result_reference` | `mark_provider_dependent` | platform_admin / compliance_analyst / developer_technical_admin |
| `p5b2_waive_evidence` | Scoped, reasoned waiver | `waive` | platform_admin / compliance_analyst / executive_approver |
| `p5b2_withdraw_evidence` | Mark `revoked` (no hard delete) | `revoke` | platform_admin / compliance_analyst |
| `p5b2_suspend_release` | Suspend ↔ release flow | `suspend_hold` / `resume` | platform_admin / compliance_analyst |
| `p5b2_snapshot_finality_pack` | Append-only finality pack snapshot | `finality_pack_snapshot` | governance_reviewer and above |
| `p5b2_log_sensitive_access` | Append-only unmask / download audit (never the value itself) | n/a (append-only log) | any authenticated actor with `reason_text` |

Funder and API-customer actors are **never** in any RPC role allow-list —
they cannot mutate evidence via Stage 3 surfaces.

### Edge function

`supabase/functions/p5-batch2-readiness-summary` returns the exact safe API
shape required by the Batch 2 instruction set. It:

- requires a valid Supabase JWT (`getClaims`);
- resolves the caller's role and forces non-privileged callers down from the
  `admin` viewer to `organisation_user`;
- selects only the safe columns from `p5_batch2_evidence_items` /
  `p5_batch2_kyc_records` — never `reviewer_note_internal`,
  `notes_internal`, `provider_raw_response`, `fraud_flag` or any raw
  ID / passport / bank / tax / address column;
- runs the forbidden-wording sweep with the same negation-aware logic as
  the Stage 2 `provider-wording-guard`;
- rewrites `suspected_fraud_or_tampering` to `"Manual review required"` for
  every non-admin viewer;
- never returns raw files, only references and metadata.

### SQL proof

Command:

```
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/p5_batch2_rpc_proof.sql
```

Result:

```
BEGIN
NOTICE:  P5B2_STAGE3_PROOF_OK
DO
ROLLBACK
```

Proves end-to-end: create record → link → checklist → upload → reject with
fixed reason → resubmit with replacement_reason → accept replacement →
accept_with_warning → waive conditional → set provider state →
**reject `provider_live=true` without reference** → snapshot finality pack →
log sensitive access → assert append-only on review events, sensitive-access
log, pack items, and version immutability → no sensitive value leaked in
checklist output. ROLLBACK leaves no business rows mutated.

### TS test result

```
bunx vitest run src/tests/p5-batch2-*.test.ts
Test Files  9 passed (9)
     Tests  66 passed (66)  (58 prior + 8 Stage 3)
```

### Confirmations

- **No UI** added.
- **No customer / funder / API-customer surfaces** added.
- **No notifications or cron** added.
- **No Batch 1 readiness wiring** added.
- **No existing trade / POI / WaD / billing / payment / business-decision
  rows mutated.**
- Every material RPC writes an audit row in
  `p5_batch2_evidence_review_events` (or, for unmask events, in
  `p5_batch2_sensitive_access_log`).
- Stage 1 append-only triggers (`p5b2_append_only_block`,
  `p5b2_versions_guard`) and the
  `p5b2_evidence_no_unsupported_live_claim` CHECK remain enforced — the
  SQL proof asserts each one.
- Edge function passes the provider-wording guard before responding.
- Stage 4 not started.

