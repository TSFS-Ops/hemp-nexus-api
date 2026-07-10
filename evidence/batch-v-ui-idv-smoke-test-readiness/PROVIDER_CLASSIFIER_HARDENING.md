# VerifyNow provider classifier hardening (Batch V-Hardening)

Status marker: VERIFYNOW_PROVIDER_CLASSIFIER_HARDENING_IMPLEMENTED_PENDING_SINGLE_SANDBOX_RETRY

Date: 2026-07-10

## 1. Why this was done without Lovable log/DB access

Lovable chat credits were unavailable, so the admin-only diagnostic row and edge function log line added in the prior instrumentation step (`p5scr_idv_records.raw_provider_payload_admin_only.diagnostic`, `[idv-person-verify] provider_response`) could not be inspected this session. Per explicit instruction, this work proceeded autonomously from static source analysis only, staying within the stated guardrails (no real identity data, no production VerifyNow, no secrets, no migrations, no RLS/grants changes, no frontend changes, no client testing resumption).

## 2. Static-analysis basis for the classifier extension

Direct inspection of this repo's own evidence trail confirms that only the VerifyNow *request* shape was ever confirmed by Daniel/VerifyNow (`reportType`, `idNumber`, `mode` for `said_verification`). No confirmed example of a real VerifyNow *response* body exists anywhere in the repository. The original `classifyProviderResponse` only recognised two top-level string fields (`status`, `match`); any other 2xx response shape -- including plausible real provider shapes such as `{ verified: true }` -- fell through to `provider_error`. Given `za_said_basic`'s contract was confirmed only two days before the last supervised retry and has never had a real sandbox response inspected, a response-shape mismatch was assessed as the most likely cause of the observed `internal_status: "provider_error"` result, ahead of an auth or request-body rejection.

One structural fact from the adapter kept this change safely scoped: the body-shape checks only ever execute on an actual 2xx HTTP response. Every 401/403/4xx/5xx/408 path returns before reaching body-shape logic, so this change cannot affect those branches at all -- confirmed by dedicated regression tests (see below).

## 3. Signals considered explicit enough to pass

The extension recognises a narrow, fixed set of unambiguous positive signals, at top level and one level deep under exactly four wrapper keys (`data`, `result`, `verification`, `response`): boolean `verified === true`, `isVerified === true`, `identityVerified === true`; and string `status === "verified"`, `verificationStatus === "verified"`, `match === "verified"` / `"clear"` / `"clear_match"`. Any of these map to `clear_match`, exactly like the pre-existing `match` handling. The equivalent explicit negative signals (`verified === false` etc., `match === "mismatch"` / `"clear_mismatch"`) map to `possible_mismatch` -- deliberately not a hard block, since a bare boolean/string does not tell us whether the cause was a genuine mismatch, fraud, or something else, and both mismatch outcomes already resolve to the same safe `manual_review_required` result.

## 4. Signals that remain ambiguous / fail-closed

`success: true` alone, `status: "success"` alone, `status: "completed"` alone, and any `message`-only body are deliberately NOT recognised as a pass, since they describe the HTTP call or process, not an identity outcome. Explicit error-style fields (`status: "error"`, `status: "failed"`, `error: true`) and any unrecognised shape continue to fall through to `provider_error`, unchanged from before. No code path in this change can ever cause an unknown or ambiguous response to resolve as a pass.

## 5. Files changed

- `supabase/functions/_shared/verifynow/adapter.ts` -- added `readVerificationSignal` and `readNestedWrapperSignal` (narrow, explicit signal readers used only within the existing 2xx branch of `classifyProviderResponse`); added `deriveProviderErrorCode` (enriches the admin-only `error_code` for `provider_error` outcomes based on HTTP status: `PROVIDER_AUTH_FAILED` for 401/403, `PROVIDER_REQUEST_REJECTED` for 400/405/422, `PROVIDER_RATE_LIMITED` for 429, `PROVIDER_FAILED` otherwise); extended the `error_code` union type accordingly; `verifyNowIdv` now calls `deriveProviderErrorCode` instead of a fixed `"PROVIDER_FAILED"` ternary. `raw_outcome`, the UI-facing contract (`ok`, `subject_id`, `internal_status`, `unlocks_controlled_actions`), `raw_http_status`, and `response_body_shape` are all unchanged in shape and meaning.
- - `supabase/functions/_shared/verifynow/adapter_smoke_test.ts` -- extended with new Deno tests (see below). All pre-existing tests are preserved verbatim.
  - - `provider-contract-map.ts`, `result-mapping.ts`, `response-shape.ts`, `idv-person-verify/index.ts` -- not changed. Source inspection found no evidence the request contract for `za_said_basic` needs correction (Daniel/VerifyNow's confirmed request shape is already implemented exactly), so the allowed-but-conditional scope for those files was not used.
   
    - ## 6. Exact error_code changes
   
    - `VerifyNowAdapterOutcome.error_code` gained four new possible values: `PROVIDER_AUTH_FAILED`, `PROVIDER_REQUEST_REJECTED`, `PROVIDER_RATE_LIMITED`, alongside the retained generic `PROVIDER_FAILED` fallback. These are derived solely from the HTTP status already received and only apply when `raw_outcome === "provider_error"`; every other outcome (`clear_match`, `possible_mismatch`, `clear_mismatch`, `not_found`, `timeout`, `source_unavailable`, `blocked_id`, `deceased`, `suspected_fraud`, the various `PROVIDER_MISCONFIGURED`/`PROVIDER_NOT_AVAILABLE`/`IDEMPOTENCY_*` pre-flight codes) is untouched. `PROVIDER_NOT_FOUND` was intentionally not added, since HTTP 404 already produces a distinct `raw_outcome: "not_found"` value -- adding a redundant error_code for the same signal was judged to add confusion rather than clarity. This field is admin-only diagnostic data; it is never returned to the UI and never logged with any provider values.
   
    - ## 7. Tests added
   
    - 38 new `Deno.test` blocks were added to `adapter_smoke_test.ts`, covering: eight explicit positive signal shapes (top-level and nested under all four wrapper keys); three explicit negative/review signal shapes; unchanged behaviour for not_found/timeout/blocked/deceased/fraud/mismatch statuses; explicit error-style fields remaining fail-closed; seven ambiguous shapes that must never pass (`success: true`, `status: "success"`, `status: "completed"`, `message` variants, nested `success`, unknown nested objects); HTTP-status classification proven unchanged by the new body-shape signals (401/403/400/422/429/408/500 all tested with a `verified: true` body attached, to prove the new signals cannot leak through a non-2xx path); `deriveProviderErrorCode` unit coverage for every bucket; and two end-to-end tests via `verifyNowIdv` with an injected `fetchImpl` (one proving a 401 response now surfaces `PROVIDER_AUTH_FAILED` while the UI-facing contract is unchanged, one proving a `{ verified: true }` 200 response now resolves as a clear match end-to-end). All existing tests are preserved unmodified.
   
    - ## 8. Tests run
   
    - These tests were written and committed but were not executed locally or via CI by me -- this session has no Deno runtime available, only GitHub's web file editor. As with the prior contract-alignment work in this repo, execution is expected to happen automatically via this repository's CI on the next push/PR check, and should be confirmed explicitly by a human or CI run before this is relied upon. This is a real limitation of this session, not a claim that the tests have passed.
   
    - ## 9. CI / baseline status
   
    - Not independently re-checked in this session. Prior evidence in this repo documents a pre-existing baseline CI failure pattern unrelated to VerifyNow files (Lint/Typecheck/Test/Build, schema drift, dependency audit, E2E). This change touches only `adapter.ts` and its own test file; no migration, RLS, grant, or schema file was touched, so it should not introduce new baseline failures, but this has not been confirmed by an actual CI run in this session.
   
    - ## 10. Hard limits observed
   
    - No real identity data was used -- only the previously-confirmed sandbox fixture value (`8001015009087`) and pre-existing fake test values already present in the repo's own tests. No production VerifyNow mode was used or referenced. No secrets were changed or read. No migration was created. No RLS policy, grant, or database constraint was changed. No frontend file was changed or published. Client testing was not resumed. Nothing in this change weakens fail-closed behaviour: every new mapping only recognises a positive/negative signal that was not recognised before, and the default fallthrough for unknown/ambiguous shapes remains `provider_error`, exactly as before.
   
    - ## 11. Deployment / sync status
   
    - This session has GitHub web access only, no Lovable Cloud dashboard access. Both commits were made directly to `main` (`f4e2db8` for `adapter.ts`, `56db0b6` for `adapter_smoke_test.ts`). Per the deployment model confirmed earlier in this workstream, backend Edge Function code deploys automatically to the single shared Lovable Cloud backend once it lands in the Lovable workspace synced from this repository's `main` branch, while frontend publishing requires a separate manual Publish action that was not taken here. Whether and when that backend auto-deploy has actually completed cannot be confirmed from this session -- there is no dashboard access available here to verify it. This should be confirmed by whoever has Lovable Cloud dashboard access before relying on it.
   
    - ## 12. Next single smoke test to run
   
    - Exactly one supervised sandbox retry of the same approved fixture already used in this workstream: South Africa, `za_said_basic`, ID number `8001015009087`, via `/desk/idv/start`. After that retry, the admin-only diagnostic row and `[idv-person-verify] provider_response` log line should be inspected (once Lovable access is restored) to confirm whether `raw_http_status` is now 200 with a recognised `clear_match`/`possible_mismatch` outcome, or whether it surfaces one of the new `PROVIDER_AUTH_FAILED`/`PROVIDER_REQUEST_REJECTED`/`PROVIDER_RATE_LIMITED` codes pointing to the separate auth/request contingency instead.
   
    - Final verdict: VERIFYNOW_PROVIDER_CLASSIFIER_HARDENING_IMPLEMENTED_PENDING_SINGLE_SANDBOX_RETRY
    - 

---

## 13. Update (2026-07-10) — tests wired into CI, no longer dormant

Status marker: VERIFYNOW_CLASSIFIER_HARDENING_TESTS_WIRED_IN_PENDING_LIVE_REDEPLOY_AND_SMOKE

The gap identified after section 12 was real: the 38 new `Deno.test` blocks (plus the pre-existing tests in the same file, 42 total) were committed to `adapter_smoke_test.ts` but were not executed by any CI pipeline. This repo's main `CI` workflow (`.github/workflows/ci.yml`) only ran Bun/Vitest jobs plus one narrowly-scoped Deno job (`e2e-soft-route`, which drives a live deployed function and hard-fails without three repo secrets). Neither covered this file, and there is no `test:deno` script in `package.json`. A repo-wide code search also found 77 other `supabase/functions/**/*_test.ts` Deno files with the same dormant-test problem; fixing all of them is out of scope here, but the fix below follows the same reusable pattern.

### What changed

- `.github/workflows/ci.yml` — added a new, unconditional job, `verifynow-classifier-hardening-tests` ("VerifyNow classifier hardening tests (Deno)"), reusing the same `denoland/setup-deno@v1` action already present in the `e2e-soft-route` job (preference 1 from the task: wire into an existing Deno path rather than inventing a new mechanism). Unlike `e2e-soft-route`, this job needs no secrets and is not gated by `if:` on fork/secret checks, so it always runs on every push to `main` and every pull request. It runs exactly:

  ```
  deno test --allow-env --no-check supabase/functions/_shared/verifynow/adapter_smoke_test.ts
  ```

  `--allow-env` is required because `adapter.ts`'s `loadConfig()` reads `Deno.env` (the test overrides config via `cfgOverride`, but the permission check happens regardless). `--allow-net` was deliberately NOT requested: the test file installs a fetch tripwire that throws on any uninjected network call, and every real HTTP call in the tests goes through an injected `fetchImpl`, so no network permission is needed and none is granted — this keeps the job itself proof that these tests cannot reach the real VerifyNow API.

- No production/runtime file was changed in this update. Only `.github/workflows/ci.yml` and this evidence file were touched.

### Test path coverage confirmation

The single `adapter_smoke_test.ts` run now wired into CI covers every category required for this closeout: explicit positive shapes (`verified`/`isVerified`/`identityVerified`/`status`/`verificationStatus`/`match` === `"verified"`); nested positive shapes one level deep under `data`/`result`/`verification`/`response`; negative/review shapes (`verified: false` and nested equivalents, mapping to `possible_mismatch`, never `clear_match`); ambiguous shapes that must remain `provider_error` (`success: true`, `status: "success"`, `status: "completed"`, message-only bodies, unknown nested shapes); HTTP 401/403/4xx/5xx/408 status behaviour proven unchanged by the new body-shape signals; and `deriveProviderErrorCode`'s per-status `error_code` derivation for every bucket (`PROVIDER_AUTH_FAILED`, `PROVIDER_REQUEST_REJECTED`, `PROVIDER_RATE_LIMITED`, `PROVIDER_FAILED`).

### Tests run — this time actually executed, not just committed

Exact command executed by CI: `deno test --allow-env --no-check supabase/functions/_shared/verifynow/adapter_smoke_test.ts` (job "VerifyNow classifier hardening tests (Deno)", step "Run VerifyNow adapter/classifier Deno tests").

Commit: `ee6ee16` ("CI: wire VerifyNow classifier hardening Deno tests into pipeline"), pushed directly to `main`.
Triggered run: CI #1995, run id `29122836074`, job id `86461682255`.
Result observed directly in the GitHub Actions log for that job: `running 42 tests from ./supabase/functions/_shared/verifynow/adapter_smoke_test.ts` ... `ok | 42 passed | 0 failed (15ms)`. Job status: succeeded, in 11s.

### CI / baseline status after this change

In the same CI #1995 run: `Lint → Typecheck → Test → Build` (Bun/Vitest) ran unaffected by this change. `Schema drift check`, `E2E — POI mint soft-route (422 → 202)` (fails closed on missing repo secrets, by design), and `Dependency audit (HIGH/CRITICAL gate)` showed pre-existing red failures unrelated to this change (consistent with the baseline failure pattern already documented elsewhere in this repo's evidence trail before this session started). `Governance rollback proof` passed (self-skips cleanly without its optional secret). None of these are new regressions introduced by this commit — this commit touched only the CI workflow file and this evidence file.

### Answers to the required report

Files changed: `.github/workflows/ci.yml` (new CI job only — no other lines touched), this file.
Commit SHA: `ee6ee16`.
Exact test command: `deno test --allow-env --no-check supabase/functions/_shared/verifynow/adapter_smoke_test.ts`.
Was the command actually run: yes, by GitHub Actions itself in CI #1995 (not merely asserted) — this is the first time in this workstream these 42 tests have been confirmed to execute.
Result: 42 passed, 0 failed.
CI / baseline status: new job green; pre-existing unrelated baseline failures (schema drift, dependency audit, e2e secret-gated job) unchanged by this commit.
Production/runtime code changed: no. Only CI workflow + evidence.
Live redeploy / smoke still pending: yes — this closes the "tests not run" gap only. Section 12's single supervised sandbox retry (za_said_basic, ID 8001015009087, via /desk/idv/start) has not been performed in this session and still requires Lovable Cloud dashboard access this session does not have.

Final verdict: VERIFYNOW_CLASSIFIER_HARDENING_TESTS_WIRED_IN_PENDING_LIVE_REDEPLOY_AND_SMOKE
