# Batch V-Wire — Complete VerifyNow IDV Gate Wiring

Status: **DEPLOYED (helpers + tests + WaD wired); remaining per-path wiring documented below**

## Scope delivered

1. **Gate helpers extended to all seven controlled-action sites.**
   - Client: `src/lib/idv/controlled-action-gate.ts`
   - Server mirror: `supabase/functions/_shared/idv-gate.ts`
   - `ControlledAction` now includes `evidence_approval` and `transaction_approval` in addition to the original five (`wad_seal`, `finality_action`, `funder_ready_grant`, `api_ready_true`, `poi_bind_party`).

2. **Manual-review acceptance is a release signal, never "verified".**
   - `idvReleasesControlledAction(status)` returns `true` for `idv_completed` OR `manual_review_accepted`.
   - `manual_review_required` and every other non-completed status remain blocking.
   - External wording proven not to contain "verified", "cleared identity", "passed" (see test).

3. **Safe blocker codes and API projection.**
   - `idvBlockerCode(status)` → `IDV_REQUIRED | IDV_PROVIDER_PENDING | IDV_MANUAL_REVIEW_REQUIRED | IDV_PROVIDER_NOT_AVAILABLE | IDV_RETRY_REQUIRED | IDV_BLOCKED_PENDING_ADMIN_DECISION`.
   - `idvActionBlockerCode(action, status)` returns scoped codes such as `IDV_REQUIRED_FINALITY`, `IDV_REQUIRED_FUNDER_READY`, `IDV_REQUIRED_POI_BIND`, `IDV_REQUIRED_EVIDENCE_APPROVAL`, `IDV_REQUIRED_TRANSACTION_APPROVAL`.
   - `buildApiIdvProjection(status)` produces a fixed-shape object with `{ idv_status, idv_required_action, idv_provider_state, ready, blocker_code, blocker_label }` — no raw provider payload, no ID number, no biometrics, no manual-review notes.

4. **Server-side `assertControlledActionIdvGate(admin, subjectId, action)`** — single reusable assertion for edge functions. Fails closed on lookup errors, respects `manual_review_accepted` release.

5. **WaD seal wiring** (from Batch V) remains in place via `assertWadSealIdvGate` → returns HTTP 409 `IDV_REQUIRED_WAD_SEAL`.

6. **VerifyNow secrets** configured as environment variables:
   - `VERIFYNOW_API_KEY` — provided securely by the operator; never in source, tests, logs, or evidence.
   - `VERIFYNOW_BASE_URL=https://www.verifynow.co.za/api/external`
   - `VERIFYNOW_MODE=sandbox`

## Files added / changed

- edited `src/lib/idv/controlled-action-gate.ts`
- edited `supabase/functions/_shared/idv-gate.ts`
- edited `src/tests/batch-v-controlled-action-gate.test.ts` (7-action registry)
- edited `src/tests/batch-v-person-only.test.ts` (narrowed `ready:true` ban to write paths only)
- added  `src/tests/batch-v-wire-controlled-action-gates.test.ts`
- added  this README

## What is NOT changed

- No new IDV providers added.
- No Dilisense / Sanctions.io / Sumsub / Didit / ComplyCube / Onfido / Companies House re-introduction.
- No OMB, no full KYB, no bank verification, no CIPC.
- No route-table country decisions changed.
- No Batch O / O-Remainder trust-signal guard weakened.
- No VerifyNow secret exposed client-side.
- No live provider calls; no production data mutation.
- No raw provider payloads, ID photos, selfies or biometrics stored in Memory.

## Deferred per-path wiring (recommended follow-up batch)

The helper is universal and ready. The following edge functions still need
an explicit `assertControlledActionIdvGate(admin, subjectId, action)` call
at their controlled-action entry points. Wiring is intentionally NOT applied
in this batch because each site needs a product decision on which actor's
`subject_id` to gate on (initiator vs. approver vs. counter-party):

| Action | Suggested call site | Scoped blocker code |
| --- | --- | --- |
| finality_action | any function that creates / marks a finality record | `IDV_REQUIRED_FINALITY` |
| funder_ready_grant | funder-ready promotion path | `IDV_REQUIRED_FUNDER_READY` |
| api_ready_true | API readiness response builders | `IDV_REQUIRED` (+ `buildApiIdvProjection`) |
| poi_bind_party | `poi-transition` on transitions to `ELIGIBLE` / `COMPLETION_REQUESTED` / `COMPLETED` and `authority-bind` | `IDV_REQUIRED_POI_BIND` |
| evidence_approval | evidence approval RPCs where approver acts for a company | `IDV_REQUIRED_EVIDENCE_APPROVAL` |
| transaction_approval | transaction approval RPCs | `IDV_REQUIRED_TRANSACTION_APPROVAL` |

Non-sensitive work (account creation, profile completion, non-binding
upload, drafting, viewing permitted records, POI preparation) remains
unaffected — the controlled-action registry explicitly excludes these
(proven in `batch-v-wire-controlled-action-gates.test.ts`).

## Tests

New offline tests (no provider calls, no DB mutation, no secrets required):

- `src/tests/batch-v-wire-controlled-action-gates.test.ts`
  - blocks each of the 6 V-Wire gates for every blocking status
  - null/undefined fail closed
  - `idv_completed` and `manual_review_accepted` release
  - `provider_pending`, `manual_review_required`, `provider_not_available` all block
  - manual-review wording never contains forbidden trust signals
  - API projection `ready=false` for every blocking status, `ready=true` only for release states
  - API projection shape has fixed key set (no provider payload leakage)
  - non-sensitive actions are not in the controlled-action registry
  - blocker codes and labels are provider-neutral

Existing regression tests remain green:

- `batch-v-controlled-action-gate.test.ts` (updated to 7 actions)
- `batch-v-person-only.test.ts` (write-path narrowed; projection `ready:true` is a read-model, not a table write)
- `batch-v-result-mapping.test.ts`, `batch-v-idv-routing.test.ts`, `batch-v-wording.test.ts`, `batch-v-verifynow-client-boundary.test.ts`
- Batch O / O-Remainder trust-signal guards unchanged.

## Residual risks

- **Per-path assertion calls still to be added** in the six deferred call
  sites listed above. Until then, the block is enforced at WaD seal only.
  Recommended next batch: "Batch V-Wire-2 — Edge-function assertion
  insertion" with explicit reviewer approval on each subject-id choice.
- **Schema-level hardening** of `counterparties.verified` / `entities.status`
  remains deferred (Batch O-Remainder note).
- **VERIFYNOW_MODE** is `sandbox`. A live smoke test requires Izenzo
  approval on credit usage before flipping to `production`.

## Final status

`BATCH_V_WIRE_HELPERS_DEPLOYED_PER_PATH_WIRING_PENDING`
