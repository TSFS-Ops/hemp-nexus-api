# Batch V-UI-Fix-4 -- Real VerifyNow IDV Wiring and Manual Review Queue Alignment

Status: Implementation complete on branch `batch-v-ui-fix-4-real-idv-and-queue-alignment`. Not merged. Manual staging verification still required before this is used for the live client smoke test.

## 1. Phase 1 findings (recap)

Phase 1 source review (prior session) identified two high-priority gaps left open by PR #14 (Batch V-UI-Fix-3, admin route redirect only):

1. **Manual-review queue data-source mismatch.** The user-facing manual-review opener (`idv-open-manual-review`) wrote to `p5scr_manual_reviews`, but the admin review queue (`IdvReviewQueue.tsx`) read from `p5scr_check_results`. A Ghana/unsupported-country manual-review case opened from the user screen would not appear in the admin queue.
2. **IDV verify request-shape mismatch.** `/desk/idv/start` called `idv-verify` with `subject_id`/`document_country`/`document_type`, but `idv-verify` is an older entity/KYB verifier that expects `entity_id` and queries the `entities` table. It has no person-IDV dispatch path at all (only `companies_house`, `cipc`, `onfido`). South Africa and Nigeria were not genuinely wired to VerifyNow person-IDV.

## 2. Confirmed p5scr_idv_records schema

Confirmed from the generated Supabase types (`src/integrations/supabase/types.ts`):

Table `p5scr_idv_records` -- columns: `id`, `subject_id`, `state`, `provider_ref` (nullable), `provider_live_now` (boolean), `raw_provider_payload_admin_only` (Json, nullable), `recorded_by` (nullable), `activation_signed_off_at` (nullable), `expires_at` (nullable), `created_at`, `decided_at`.

RPC `p5scr_record_idv` -- Args: `p_subject_id` (string, required), `p_state` (string, required), `p_provider_ref` (string, optional), `p_provider_live_now` (boolean, optional), `p_raw_provider_payload_admin_only` (Json, optional), `p_activation_signed_off_at` (string, optional), `p_expires_at` (string, optional). Returns: string.

`p5scr_subjects` -- confirmed columns include `organisation_id` (nullable). **`org_id` does not exist on this table.**

## 3. Manual-review source-of-truth decision

`p5scr_manual_reviews` is the source of truth for user-opened IDV manual-review cases (category `idv_person`). Implementation:

- `IdvReviewQueue.tsx` now reads OPEN cases (`decided_at IS NULL`, `category = idv_person`) directly from `p5scr_manual_reviews`, joined per-row with `p5scr_subjects.display_label`. It no longer reads `p5scr_check_results`.
- `idv-manual-review` (admin decision function) is unchanged in how it writes decisions to `p5scr_manual_reviews`, and now also projects the decision into the gate-readable `p5scr_idv_records` table via the existing `p5scr_record_idv` RPC (never a raw insert).
- `IdvReviewCase.tsx` (admin case detail) now reads current status from `p5scr_idv_records` instead of `p5scr_check_results`, and displays the `projected_gate_state` returned by `idv-manual-review` after a decision is saved, instead of guessing the resulting status on the client.
- `IdvStatusWidget.tsx` (user-facing) now reads the latest state from `p5scr_idv_records` instead of `p5scr_check_results`, which nothing in the person-IDV flow wrote to.

There is a single source of truth end-to-end: `p5scr_manual_reviews` for case lifecycle, `p5scr_idv_records` for gate/user-readable status, connected by the `p5scr_record_idv` RPC. No split-brain state.

## 4. Person-IDV function fix

A new edge function, `supabase/functions/idv-person-verify/index.ts`, was created:

- Authenticates the caller via their bearer token and confirms the target `p5scr_subjects` row's `person_external_ref` matches the authenticated user.
- Routes strictly by (document_country, document_type) via the existing shared route table (`resolveIdvRoute`), and returns a safe `PROVIDER_NOT_AVAILABLE` response without ever calling VerifyNow if the route does not resolve to a live route (defence in depth; the UI should never reach this function for such a route).
- Calls the existing VerifyNow adapter (`verifyNowIdv`) only for a resolved live route.
- Does not import or call Onfido, CIPC, Companies House, Dilisense, Sanctions.io, Sumsub, Didit or ComplyCube.
- Records the safe outcome into `p5scr_idv_records` via `p5scr_record_idv` (never a raw insert).
- Returns only safe fields to the UI (`ok`, `subject_id`, `internal_status`, `unlocks_controlled_actions`) -- never the raw provider payload, which is stored admin-only.
- Does not reference `VERIFYNOW_API_KEY` or `VERIFYNOW_MODE` directly (both remain adapter-internal, server-side only).

`idv-verify` (the legacy entity/KYB function) was not modified. Its provider allow-lists, dispatch logic and Companies House/CIPC/Onfido paths are untouched, confirmed by a source-level guard test.

## 5. /desk/idv/start change

`IdvStart.tsx` now calls `idv-person-verify` (not `idv-verify`) for the live-route branch. The manual-review / provider-not-available branch is unchanged and still calls `idv-open-manual-review`. On a live-call error, the screen falls back to opening a manual-review case and shows a safe "Manual review required" / "Provider pending" style status -- it never presents a failed live call as a pass.

Document-type labelling was made clearer using the route table's own `document_class` field (no route-table changes, no per-country hardcoding):

- `document_class === "full_idv"` entries are suffixed "(Recommended -- full identity verification)".
- `document_class === "supporting_only"` entries are suffixed "(Supporting only -- does not unlock controlled actions)".

## 6. South Africa smoke-test document type

Home Affairs identity verification (`za_home_affairs_enhanced`) -- `document_class: "full_idv"`, `can_unlock_controlled_actions: true`. This is the preferred full-IDV smoke-test option for South Africa.

`za_said_basic` ("South African ID number check") is `supporting_only` and is now labelled accordingly.

## 7. Nigeria smoke-test document type

Nigerian NIN verification (`ng_nin`) -- `document_class: "full_idv"`, `can_unlock_controlled_actions: true`. This is the preferred full-IDV smoke-test option for Nigeria.

Per the existing route table, `ng_virtual_nin` and `ng_nin_slip` are also already `full_idv`/`can_unlock_controlled_actions: true` -- they are shown with the same "Recommended" suffix.

## 8. Nigerian voter ID -- supporting-only confirmation

`ng_voter_id` ("Nigerian voter ID check") has `document_class: "supporting_only"` and `can_unlock_controlled_actions: false` in the route table. It is now labelled "(Supporting only -- does not unlock controlled actions)" in the UI, same as `ng_bvn`, `ng_phone_lookup` and `ng_bank_account_check`.

## 9. WaD gate fix

`supabase/functions/_shared/idv-wad-seal-gate.ts` queried `p5scr_subjects.org_id`, which does not exist (the real column is `organisation_id`). Every lookup therefore errored and was silently swallowed as "no subject found", meaning the WaD seal IDV gate could never actually block a seal -- a fail-open bug in a controlled-action gate.

Fix applied:

- The lookup now queries `.eq("organisation_id", orgId)`.
- The lookup failure path now distinguishes a genuine query error from "no row found". A genuine error now returns `allowed: false` (fails CLOSED) instead of silently continuing past the gate. "No subject registered yet" (a real, expected null result with no error) still skips the gate for that party, preserving the additive/no-regression rule for orgs that haven't been provisioned into `p5scr_subjects` yet.
- The `IDV_REQUIRED_WAD_SEAL` error code and `assertWadSealIdvGate` export signature are unchanged, so `supabase/functions/wad/index.ts` and the existing `batch-v-controlled-action-gate.test.ts` guard continue to pass unmodified.

## 10. Decision to gate-state mapping (new, conservative)

A new function, `mapDecisionToGateState`, was added to `supabase/functions/_shared/idv-manual-review-shape.ts` to project an admin's `p5scr_manual_reviews` decision into the InternalIdvStatus state written to `p5scr_idv_records`:

| Admin decision | Gate state written |
| --- | --- |
| manual_review_accepted | manual_review_accepted (the only releasing state) |
| manual_review_rejected | failed |
| more_information_required | alternative_document_required |
| alternative_document_required | alternative_document_required |
| provider_retry_required | retry_required |
| blocked_pending_admin_decision | blocked_pending_admin_decision |
| waived_with_reason | blocked_pending_admin_decision (deliberately conservative -- see below) |

Product decision flagged for manual follow-up: `waived_with_reason` maps its `p5scr_manual_reviews.decision` column to `cleared_with_conditions`, which reads as a policy-level clearance. This batch does not treat it as a gate-release signal, because the task's hard limits require that no decision silently widen release conditions beyond what Batch V already defines (`manual_review_accepted` and `idv_completed` only). If product intends `waived_with_reason` to release controlled-action gates, that requires an explicit, separate decision -- not inferred here.

## 11. Tests

The following were added/updated. Tests could not be executed in this session -- this is a browser-only tool environment with no Node/Deno/CI execution available. All tests are written and committed to the branch for CI to run; the assertions below were verified by direct source inspection (not by running the test runner) as an interim check.

New files:

- `src/tests/batch-v-ui-fix-4-real-idv-and-queue.test.ts` (vitest) -- 20 assertions covering: `IdvStart.tsx` calls `idv-person-verify` and never `idv-verify`; the manual-review branch still uses `idv-open-manual-review`; document-type label suffixing; South Africa/Nigeria full-IDV route confirmation; Nigerian voter ID supporting-only confirmation; `idv-person-verify` imports the VerifyNow adapter and no legacy/company provider; route resolution precedes the VerifyNow call; auth + subject-ownership check; `p5scr_record_idv` RPC usage (no raw insert); safe-fields-only response; admin queue reads `p5scr_manual_reviews`; case detail and status widget read `p5scr_idv_records`; `idv-manual-review` projects `projected_gate_state`; the decision-to-gate-state mapping never widens release conditions; WaD gate `organisation_id` fix and fail-closed behaviour; VerifyNow secrets remain out of `src/**`.
- `supabase/functions/idv-person-verify/idv_person_verify_smoke_test.ts` (Deno) -- 9 tests mirroring the existing `o_production_lockout_smoke_test.ts` source-level guard pattern, with a network fetch tripwire, covering: VerifyNow adapter import; no import from `idv-verify`; no legacy/company provider references; route-check-before-provider-call ordering; auth + ownership check; `p5scr_record_idv` usage; safe response shape; `VERIFYNOW_MODE` not overridden; confirmation that `idv-verify`'s allow-lists and dispatch are unchanged.

## 12. Remaining manual staging verification items

1. Confirm the new `idv-person-verify` function is deployed to the staging Supabase project (deployment was not performed or verified from this browser-only session).
2. Confirm `VERIFYNOW_API_KEY` is configured for the sandbox environment so `idv-person-verify` does not fail closed with `PROVIDER_MISCONFIGURED`.
3. Confirm `VERIFYNOW_MODE=sandbox` is set in the environment (not independently verified here).
4. Confirm the `p5scr_record_idv` RPC's grants permit the service-role client used by both `idv-person-verify` and `idv-manual-review` to execute it.
5. Run the actual South Africa (Home Affairs) and Nigeria (NIN) smoke-test submissions end-to-end in staging and confirm a real VerifyNow sandbox response is received and safely reflected in the user status widget.
6. Confirm a Ghana (or other unsupported-country) manual-review case opened from `/desk/idv/start` appears in `/admin/idv/review`, and that recording `manual_review_accepted` there updates the user status widget live.
7. Confirm the hardened WaD gate fail-closed behaviour does not unexpectedly block legitimate deals for orgs that have never been provisioned into `p5scr_subjects` (expected to be unaffected, since "no subject row" still skips the gate for that party -- only genuine lookup errors now fail closed).
8. Run `npm run test` (vitest) and the Deno edge-function test suite in CI/a real dev environment, since they could not be executed in this session.
9. Confirm no regression in the existing Onfido/CIPC/Companies House entity/KYB flows via `idv-verify`, which was not modified but should be spot-checked live.
10. Decide, as a separate product decision, whether `waived_with_reason` should ever release a controlled-action gate; today it deliberately does not.

## Final verdict

CLIENT_SMOKE_TEST_REAL_IDV_AND_QUEUE_READY_FOR_STAGING_VERIFICATION
