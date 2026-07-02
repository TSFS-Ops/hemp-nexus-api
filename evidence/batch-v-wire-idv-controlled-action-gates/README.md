# Batch V-Wire — Complete VerifyNow IDV Gate Wiring

Status: **BATCH_V_WIRE_COMPLETE_ALL_CONTROLLED_ACTIONS_GATED**

All seven controlled-action call-sites are now wired to the deployed
Batch V IDV gate helpers. WaD seal (Batch V) remains wired; the six
previously deferred sites are wired in this batch.

## Per-path wiring

| # | Controlled action | File | Call | Blocker code |
|---|---|---|---|---|
| 1 | wad_seal | `supabase/functions/wad/index.ts` | `assertWadSealIdvGate(...)` (Batch V) | `IDV_REQUIRED_WAD_SEAL` |
| 2 | finality_action | `supabase/functions/p5-batch4-execution-summary/index.ts` | `assertActorIdvGate(..., "finality_action")` | `IDV_REQUIRED_FINALITY` |
| 3 | funder_ready_grant | `supabase/functions/p5-batch3-funder-summary/index.ts` | `assertActorIdvGate(..., "funder_ready_grant")` | `IDV_REQUIRED_FUNDER_READY` |
| 4 | api_ready_true | `supabase/functions/registry-readiness-transition/index.ts` | `assertActorIdvGate(..., "api_ready_true")` + `buildApiIdvProjection` | `IDV_REQUIRED` |
| 5 | poi_bind_party | `supabase/functions/poi-transition/index.ts` (only for binding `toState ∈ {ELIGIBLE, COMPLETION_REQUESTED, COMPLETED}`) | `assertActorIdvGate(..., "poi_bind_party")` | `IDV_REQUIRED_BINDING_POI` |
| 6 | evidence_approval | `supabase/functions/registry-claim-review/index.ts` (only for `approve_claim / reject_claim / accept_evidence_item / reject_evidence_item / escalate_claim`) | `assertActorIdvGate(..., "evidence_approval")` | `IDV_REQUIRED_EVIDENCE_APPROVAL` |
| 7 | transaction_approval | `supabase/functions/trade-approval/index.ts` (POST from human callers) | `assertActorIdvGate(..., "transaction_approval")` | `IDV_REQUIRED_TRANSACTION_APPROVAL` |

## Files changed

- added  `supabase/functions/_shared/idv-actor-gate.ts` (resolver +
  `assertActorIdvGate`)
- edited `supabase/functions/p5-batch4-execution-summary/index.ts`
- edited `supabase/functions/p5-batch3-funder-summary/index.ts`
- edited `supabase/functions/registry-readiness-transition/index.ts`
- edited `supabase/functions/poi-transition/index.ts`
- edited `supabase/functions/registry-claim-review/index.ts`
- edited `supabase/functions/trade-approval/index.ts`
- added  `src/tests/batch-v-wire-per-path-consumption.test.ts`
- updated `evidence/batch-v-wire-idv-controlled-action-gates/README.md`

WaD seal wiring (Batch V) is unchanged and remains asserted.

## Behaviour

- **Blocking**: every unresolved IDV status (`pending`,
  `provider_pending`, `provider_not_available`, `retry_required`,
  `alternative_document_required`, `manual_review_required`,
  `blocked_pending_admin_decision`, `provider_error`, `failed`,
  `expired`, `unsupported`, `error`) causes the controlled action to
  return HTTP 409 with a scoped safe blocker code and safe label. No raw
  provider payload, ID number, ID photo, biometric or manual-review
  notes are emitted.
- **Release**: `idv_completed` (live-provider) OR `manual_review_accepted`
  releases the gate (`idvReleasesControlledAction`).
  `manual_review_required`, `provider_pending`,
  `provider_not_available` never release.
- **API ready=true**: `registry-readiness-transition` returns
  `buildApiIdvProjection(...)` (`ready:false`, fixed shape, no raw
  provider fields) when IDV is blocking.
- **POI stays commercially light**: only binding transitions
  (`ELIGIBLE`, `COMPLETION_REQUESTED`, `COMPLETED`) call the gate.
  DRAFT and PENDING_APPROVAL flows are untouched.
- **Evidence upload unchanged**: only controlled review/approval
  actions on `registry-claim-review` call the gate. Ordinary evidence
  upload endpoints are not modified.
- **Non-sensitive work remains allowed**: account creation, profile
  completion, non-binding upload, drafting, viewing permitted records
  and POI preparation are not in the controlled-action registry.
- **Person-only preserved**: no gate call flips `entities.status`,
  `counterparties.verified`, `funder_ready`, `finality_ready` or any
  `ready:true` field on a table. Enforced by
  `src/tests/batch-v-person-only.test.ts`.
- **Subject-enrolment boundary**: the resolver is soft no-op when no
  `p5scr_subjects` row exists for the actor (matches the WaD-seal
  boundary; enrolment is out of scope for this batch). Any *existing*
  blocking IDV state is respected.

## Old-provider policy

`assertActorIdvGate` uses only `p5scr_idv_records` (VerifyNow lineage).
No Dilisense / Sanctions.io / Sumsub / Didit / ComplyCube / Onfido /
Companies House code paths are added or called. The per-path test scans
each wired file to prove no old-provider name is introduced.

## VerifyNow secrets

- `VERIFYNOW_API_KEY` — stored securely as an environment secret; never
  in source, tests, logs or evidence.
- `VERIFYNOW_BASE_URL=https://www.verifynow.co.za/api/external`
- `VERIFYNOW_MODE=sandbox` (unchanged).

No live provider call was made in this batch. No production data was
mutated. Tests run offline with no VerifyNow network access.

## Tests

Offline, no provider calls, no DB mutation, no secrets required:

- `src/tests/batch-v-wire-per-path-consumption.test.ts` — 9 assertions
  scanning each of the six wired edge functions for
  `assertActorIdvGate`, the correct `ControlledAction` literal, the
  scoped blocker code, plus WaD seal preservation and no old-provider
  / unsafe-wording regressions.
- `src/tests/batch-v-wire-controlled-action-gates.test.ts` — 35
  assertions on gate uniformity, manual-review release semantics, API
  projection shape and provider-neutral wording.
- `src/tests/batch-v-controlled-action-gate.test.ts` — 18 assertions
  covering 7-action registry, null/undefined fail-closed and WaD-seal
  presence.
- `src/tests/batch-v-person-only.test.ts` — 12 assertions proving no
  company/funder/finality/API write is introduced.

Run: `bunx vitest run src/tests/batch-v-wire-per-path-consumption.test.ts src/tests/batch-v-wire-controlled-action-gates.test.ts src/tests/batch-v-controlled-action-gate.test.ts src/tests/batch-v-person-only.test.ts`
Result: **4 files / 74 assertions passed**.

## Residual risks

- `assertActorIdvGate` is soft no-op when no `p5scr_subjects` row exists
  for the actor. Subject enrolment for all users is a separate batch;
  until then, gates only block actors already registered in the p5scr
  spine (WaD-seal boundary policy).
- Schema-level hardening of `counterparties.verified` /
  `entities.status` remains deferred (Batch O-Remainder note).
- `VERIFYNOW_MODE` is `sandbox`. Live smoke test requires Izenzo
  approval on VerifyNow credit usage before flipping to `production`.

## Final status

**`BATCH_V_WIRE_COMPLETE_ALL_CONTROLLED_ACTIONS_GATED`**
