# VerifyNow confirmed-schema classifier fix (Batch V-Confirmed-Schema)

Status marker: VERIFYNOW_CONFIRMED_SCHEMA_CLASSIFIER_FIX_IMPLEMENTED_PENDING_ZA_BASIC_RETRY

Date: 2026-07-11

## 1. Diagnostic finding that triggered this fix

The single supervised sandbox retry (ZA `za_said_basic`, fixture `8001015009087`) confirmed via the admin-only diagnostic: `raw_http_status: 200`. VerifyNow accepted the request and the auth/request-body path is healthy — the request itself was never rejected. The remaining `internal_status: "provider_error"` was therefore a classifier/response-schema gap, not an auth or request problem: the previous classifier only recognised top-level `match`/`status` and the Batch V-Hardening `verified`/`isVerified`/`identityVerified`/`verificationStatus` signals, none of which exist in VerifyNow's real response.

## 2. Confirmed real VerifyNow response shapes

Two confirmed families for `said_verification`, provided directly from VerifyNow sandbox evidence:

Nested family: top-level `success` (boolean), `requestId`, `mode`, `remainingCredits`, `reportType`, `input.idNumber`, `user_id`, and `results.said_verification` containing `Status`, `transaction_id`, `meta.environment`, `meta.timestamp`, and `realTimeResults.{Status, transaction_id, Verification}`.

Flat family: top-level `success` (boolean) and `result.{IDN, Name, Surname, OnHANIS, OnNPR, DeadIndicator, IDNBlocked, PhotoAvailable, SmartCardIssued, MaritalStatus, DateOfDeath, DateOfMarriage, IDIssueDate, IDSeqNo, BirthPlaceCountryCode, Photo, PhotoStatus, Error}`, plus top-level `transaction_id` and `meta.{environment, timestamp}`.

## 3. Classifier mapping added

Both shapes are gated behind a top-level `success: true` envelope check — `success: true` alone is never sufficient; the identity outcome always comes from the explicit fields below. Any value outside these explicit sets, for either shape, still falls through to the pre-existing `provider_error` default.

Nested `results.said_verification.Status` (and, one level deeper, `realTimeResults.Status`), case-insensitive, trimmed, space/hyphen-normalised to underscores:
- `verified` / `clear` / `clear_match` / `pass` / `passed` / `match` / `matched` → `clear_match`
- `mismatch` / `clear_mismatch` / `no_match` / `not_found` (and close variants) → `possible_mismatch` (a safe, non-clear, manual-review outcome)
- `blocked` → `blocked_id`; `deceased` → `deceased`; `fraud` / `suspected_fraud` → `suspected_fraud` (all three already resolve to the same `blocked_pending_admin_decision` internal status)
- `pending` / `provider_pending` / `source_unavailable` → `source_unavailable`; `timeout` → `timeout`
- anything else, or no `Status` found at either level → `provider_error` (unchanged fail-closed default)

Flat `result` shape, with defensive boolean parsing (real `true`/`false`, and case-insensitive `"true"/"false"/"yes"/"no"/"y"/"n"/"1"/"0"` strings):
- `Error` present (non-empty string, or any truthy non-string) → `provider_error`, unless its text clearly indicates not-found / source-unavailable / timeout, which map to those dedicated outcomes instead
- `DeadIndicator` true → `deceased`; `IDNBlocked` true → `blocked_id` (both checked before any positive match, so they can never be overridden by `OnHANIS`/`OnNPR`)
- `OnHANIS` true AND `OnNPR` true (with no `Error`/`DeadIndicator`/`IDNBlocked`) → `clear_match`
- `OnHANIS` false OR `OnNPR` false → `possible_mismatch`
- any other/missing combination → `provider_error` (explicit, not merely a fallthrough — every field this shape can contain is enumerated)

## 4. Files changed

- `supabase/functions/_shared/verifynow/adapter.ts` — added `parseBoolLike`, `readStatusField`, `classifySaidStatusValue`, `classifySaidVerificationShape`, `classifyFlatResultError`, `classifyFlatResultShape`, and a new `success: true`-gated check inside `classifyProviderResponse`'s existing 2xx branch, after the pre-existing Batch V-Hardening checks. `raw_http_status`, `response_body_shape`, `error_code`, and `raw_outcome` diagnostics are unchanged in shape and meaning. Request body construction, `provider-contract-map.ts`, and the UI-facing contract (`ok`, `subject_id`, `internal_status`, `unlocks_controlled_actions`) were not touched.
- `supabase/functions/_shared/verifynow/adapter_smoke_test.ts` — added 17 new `Deno.test` blocks (42 → 59 total); all 42 pre-existing tests preserved unmodified.

## 5. Tests added (17 new, summarised)

Nested shape: Status/realTimeResults.Status verified/clear/pass → clear_match (2 tests); Status mismatch/no_match/not_found → safe non-clear outcome; Status blocked/deceased/fraud → blocked/admin-decision outcome; unrecognised Status → provider_error; said_verification present with no Status → provider_error; `{ success: true }` alone → provider_error.

Flat shape: OnHANIS+OnNPR true (Dead/Blocked false) → clear_match; DeadIndicator true → blocked/admin-decision outcome; IDNBlocked true → blocked/admin-decision outcome; OnHANIS/OnNPR false → safe mismatch/review outcome; Error populated → provider_error; unknown/missing fields → provider_error; casing-defensive string/boolean parsing.

Regression: pre-existing top-level `match`/`status`/hardening behaviour unaffected; HTTP 401/403/4xx/5xx unchanged even with the new confirmed-schema fields attached to the body; one end-to-end `verifyNowIdv` test with an injected 200 `said_verification` response.

## 6. Tests run — actually executed via CI, not merely committed

Exact command (already wired into CI by the prior batch): `deno test --allow-env --no-check supabase/functions/_shared/verifynow/adapter_smoke_test.ts`.

First attempt (commit `1890de6`, CI run #2000, job `86541177978`) surfaced one genuine test-authoring mistake, not a classifier bug: the end-to-end test used route `za_said_basic` and expected `idv_completed` / `unlocks_controlled_actions: true`, but `za_said_basic` is `document_class: "supporting_only"` with `can_unlock_controlled_actions: false` in `idv-route-table.ts` — by design, a `clear_match` on this route correctly downgrades to `manual_review_required` / `unlocks_controlled_actions: false`. Result: `FAILED | 58 passed | 1 failed`, with the single failure's diff (`- manual_review_required / + idv_completed`) confirming the classifier itself (`raw_outcome: "clear_match"`) worked exactly as intended.

Fixed in commit `0bb8adc` (corrected only the test's expected values; no adapter.ts change). Re-run: CI run #2001, job `86541407797`, succeeded in 8s. Final line: `ok | 59 passed | 0 failed (19ms)`.

## 7. CI / baseline status

In run #2001: `VerifyNow classifier hardening tests (Deno)` succeeded (green). Pre-existing unrelated baseline failures continue as documented elsewhere in this repo's evidence trail (`Schema drift check`, `E2E — POI mint soft-route` — fails closed on missing repo secrets by design, `Dependency audit`) — none of these are new regressions introduced by this change; only `adapter.ts` and its own test file were touched.

## 8. What did not change

No migration created. No RLS policy or grant changed. No secret read or changed. No frontend file changed or published. No change to `provider-contract-map.ts` or the outbound request body/headers. No real identity data used (only the previously-approved sandbox fixture `8001015009087`). No production VerifyNow used. Client testing was not resumed — this batch is repo-side classifier/test work plus CI verification only. `raw_http_status`, `response_body_shape`, `error_code`, and `raw_outcome` diagnostics are all unchanged in shape and meaning.

## 9. Deployment / sync status

This session has GitHub web access only, no Lovable Cloud dashboard access. Both commits (`672178f` for `adapter.ts`, `1890de6` and `0bb8adc` for the test file) were made directly to `main`. Per the deployment model already confirmed in this workstream, backend Edge Function code deploys automatically to the shared Lovable Cloud backend once it lands in the Lovable workspace synced from this repository's `main` branch. Whether and when that auto-deploy has actually completed cannot be confirmed from this session — this should be confirmed by whoever has Lovable Cloud dashboard access before the next retry.

## 10. Next single smoke test to run

Exactly one more supervised sandbox retry of the same approved fixture (South Africa, `za_said_basic`, ID `8001015009087`, via `/desk/idv/start`), after confirming the backend has redeployed. Expect `internal_status` to now resolve away from `provider_error` if VerifyNow's real response matches either confirmed shape — but because `za_said_basic` cannot unlock controlled actions by route policy, a pass will correctly show as `internal_status: "manual_review_required"` / `unlocks_controlled_actions: false`, not `idv_completed`/`true`; the admin-only diagnostic's `raw_outcome` field (not the user-facing `internal_status`) is the field that will show `clear_match` if the fix worked. If `internal_status` is still `provider_error` after this retry, the admin-only `response_body_shape` diagnostic should be inspected next to see which fields VerifyNow actually returned, since that would mean a third, still-unconfirmed shape is in play.

Final verdict: VERIFYNOW_CONFIRMED_SCHEMA_CLASSIFIER_FIX_IMPLEMENTED_PENDING_ZA_BASIC_RETRY
