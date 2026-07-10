# VerifyNow API Contract Alignment -- Implementation (confirmed routes only)

Status marker: VERIFYNOW_CONTRACT_ALIGNMENT_READY_FOR_PR_REVIEW

Date: 2026-07-08
Branch: verify-now-contract-alignment-confirmed-routes (from main)
Scope: implement the three routes Daniel/VerifyNow have confirmed (South Africa said_basic, South Africa home_affairs_enhanced, Nigeria NIN). All other Nigeria routes remain fail-closed / unconfirmed. No live VerifyNow calls, no production mode, no real identity data were used at any point in this work.

## 1. Daniel/VerifyNow confirmed contracts

South Africa basic ID check ("SAID Verification"): POST https://www.verifynow.co.za/api/external/verify with body { reportType: "said_verification", idNumber: "<13-digit SA ID>", mode }. No names, surname or date of birth required.

South Africa Home Affairs / full ID check ("ID + Photo / Home Affairs ID Photo"): POST https://www.verifynow.co.za/api/external/verify with body { reportType: "home_affairs_id_photo", idNumber: "<13-digit SA ID>", mode }. Daniel confirmed home_affairs_real_time_idv does not appear in VerifyNow's docs and must not be used.

Nigeria NIN: POST https://www.verifynow.co.za/api/external/africa-verification with body { country: "NG", id_type: "NIN_V2", id_number: "<NIN>", mode }. first_name, last_name and dob (YYYY-MM-DD) are optional per VerifyNow and are NOT sent by this implementation, since the task scope only confirmed the nin -> id_number mapping.

Izenzo's VerifyNow API key covers Nigeria per VerifyNow support. Sandbox mode ("mode": "sandbox") returns test/mock responses, does not consume credits, and does not trigger production checks, per VerifyNow support.

## 2. Confirmed sandbox values

South Africa: 8001015009087 and 9111060123086 (confirmed safe in sandbox mode).
Nigeria NIN_V2: 12345678901 (confirmed for NIN_V2 specifically; other example Nigeria sandbox values exist but are not used here).

These values are referenced only in test fixtures (adapter_smoke_test.ts) -- never used for a live call, and never entered as real identity data anywhere in the UI or this evidence.

## 3. What changed in the adapter

New file supabase/functions/_shared/verifynow/provider-contract-map.ts defines a small, explicit map from internal document_type to the confirmed provider contract (endpoint_path, report_type where applicable, field_mapping, constant_fields), with exactly three confirmed entries (za_said_basic, za_home_affairs_enhanced, ng_nin) and everything else absent (fail-closed by omission).

supabase/functions/_shared/verifynow/adapter.ts was changed so that: the outbound URL is now built from the confirmed contract's endpoint_path (POST /verify or POST /africa-verification), never from the internal document_type; a new fail-closed check resolves the contract immediately after the existing API-key check and returns PROVIDER_MISCONFIGURED (no fetch) if the route is unmapped/unconfirmed; the outbound JSON body is now built strictly from the contract's field_mapping and constant_fields, with reportType added only when the contract specifies one, and mode always included explicitly (previously mode only gated the Idempotency-Key header and was never sent to VerifyNow at all).

No changes were made to idv-route-table.ts, result-mapping.ts, the idempotency logic, the response classifier, or any manual-review/admin-review/WaD-gate code.

## 4. What changed in the UI

src/pages/desk/idv/IdvStart.tsx now defines CONFIRMED_STRUCTURED_FIELDS, a small map (za_said_basic, za_home_affairs_enhanced, ng_nin) of structured field definitions (key, label, validation pattern, help text), driven by the same three confirmed routes -- deliberately not derived from the route table's required_fields, since that list also includes fields collected for internal records that are not necessarily sent to the provider.

For a confirmed route, the free-text textarea is replaced by one or more labelled Input fields (South African ID number / Nigerian NIN), rendered under a new activeStructuredFields check. For every other route (manual review, placeholder countries, Other country, and any unconfirmed live-looking Nigeria route), the original free-text textarea and details_text submission are unchanged.

Basic client-side validation was added: the South African ID number must match 13 digits, the Nigerian NIN must match 11 digits (matching the length of the confirmed sandbox value). Validation runs before submission and blocks it with a toast if a field is empty or does not match. No photo, selfie or biometric fields were added anywhere.

On submit, a confirmed route now sends { subject_id, document_country, document_type, payload: structuredFields } to idv-person-verify; every other route keeps the original { subject_id, document_country, document_type, details_text } shape. idv-person-verify itself was not changed -- it already accepted a structured payload object and forwards it to the adapter unmodified.

## 5. Route mapping summary

Confirmed / live-capable: za_said_basic (POST /verify, said_verification), za_home_affairs_enhanced (POST /verify, home_affairs_id_photo), ng_nin (POST /africa-verification, country NG, id_type NIN_V2).

Unconfirmed / remain fail-closed: ng_virtual_nin, ng_nin_slip, ng_bvn, ng_voter_id, ng_phone_lookup, ng_bank_account_check, and any route that would require home_affairs_real_time_idv. These routes are simply absent from provider-contract-map.ts, so the adapter returns PROVIDER_MISCONFIGURED for them without ever calling fetch. The UI continues to show the free-text path for these routes; none of the Nigeria placeholder/manual-review behaviour was touched.

## 6. Tests added/updated

supabase/functions/_shared/verifynow/adapter_smoke_test.ts: five new Deno tests appended (before the existing fetch-tripwire-restore test) asserting: South Africa said_basic posts to a URL ending in /verify (never containing za_said_basic) with reportType "said_verification", idNumber and mode "sandbox"; South Africa home_affairs_enhanced posts to /verify with reportType "home_affairs_id_photo"; Nigeria NIN posts to a URL ending in /africa-verification (never containing ng_nin) with country "NG", id_type "NIN_V2", id_number and mode, and no reportType; and that two representative unconfirmed Nigeria routes (ng_bvn, ng_virtual_nin) return PROVIDER_MISCONFIGURED without ever invoking the fetch tripwire.

src/tests/batch-v-verifynow-contract-alignment-ui.test.ts (new file): source-level guard tests, matching this repo's existing convention for this UI file, asserting the structured-field map exists for exactly the three confirmed routes and does not reference any unconfirmed Nigeria route string, the Input component is imported and rendered under an idv-structured-fields test id, the free-text idv-details textarea path is preserved, the submit body branches between payload and details_text, structured-field validation runs before submission, structured fields are cleared on document-type change, and idv-person-verify is still called (never the legacy idv-verify).

## 7. Whether tests were run

These tests were written and committed to the branch but were not executed locally or via CI by me -- this environment has no Deno/Vitest runtime available to me. They are expected to run automatically once a PR is opened against this branch, alongside the rest of the repository's CI suite. This should be confirmed explicitly during PR review before merge.

## 8. Diff summary / files changed

New: supabase/functions/_shared/verifynow/provider-contract-map.ts. New: src/tests/batch-v-verifynow-contract-alignment-ui.test.ts. New: this evidence file. Modified: supabase/functions/_shared/verifynow/adapter.ts (URL/body construction, new fail-closed contract check, header comment). Modified: src/pages/desk/idv/IdvStart.tsx (structured-field map, Input import, new state/effect, validation, conditional rendering, submit body). Modified: supabase/functions/_shared/verifynow/adapter_smoke_test.ts (five new tests appended). Not touched: idv-route-table.ts (either copy), idv-person-verify/index.ts, idv-verify (legacy), any manual-review/admin-review code, any WaD-gate code, any migration, schema, RLS, RPC or secret.

## 9. Current decision / staging status

Live staging submissions to VerifyNow remain paused. Client testing (David/Daniel/James smoke test) remains paused. This branch has not been opened as a PR and has not been merged or deployed. Staging testing should remain paused until this PR is merged/deployed and then manually verified end-to-end for all three confirmed routes in sandbox mode, using only the confirmed sandbox values listed above -- never real identity data.

## 10. Hard limits observed

No live VerifyNow calls were made. No production mode was used or referenced outside of existing, unchanged config-loading code. No real identity data was used anywhere -- only the confirmed sandbox values and clearly-fake test fixtures. No secrets were changed. No Supabase schema, migration, RLS, RPC or grant was changed. No change to manual-review/admin-review decision policy. No change to WaD gate policy. Legacy idv-verify was not touched. Client testing was not resumed. No claim of staging readiness is made here.

Final verdict: VERIFYNOW_CONTRACT_ALIGNMENT_READY_FOR_PR_REVIEW

## 11. Merge-risk note (documented baseline-CI exception)

Full merge-risk note posted as a PR comment on PR #23 (VerifyNow Contract Alignment: confirmed SA and Nigeria routes) covering: which CI failures are pre-existing and unrelated to this PR's files; confirmation that no failing test touches the VerifyNow adapter, provider-contract-map, IdvStart UI, or the new source guards; confirmation that all 8 new VerifyNow contract-alignment UI test assertions pass in isolation; confirmation that existing IdvStart-related tests still pass; direct confirmation that the current tip of main (commit 59cb5ca, CI run #1970) already fails with the identical pattern (Lint->Typecheck->Test->Build, Schema drift check, E2E, Dependency audit all red; Batch 7 Guards and Governance rollback proof green; identical 46 failed / 444 passed test-file counts modulo this PR's own new passing test file); and confirmation that this PR introduces no new runtime risk beyond the confirmed VerifyNow route changes.

Recommendation recorded in that note: merge PR #23 under a documented baseline-CI exception, since the failing checks are demonstrably pre-existing and identical on main and every VerifyNow-specific check passes. A separate, dedicated CI-baseline repair task (missing Supabase CI secrets, dependency audit findings, schema drift violations, ~30 unrelated failing suites) is recommended as its own follow-up, kept fully separate from this PR.

See the PR #23 conversation thread for the full note.

## 12. Autonomous completion mode -- Lovable deployment blocker (2026-07-09)

Under an autonomous-completion authorisation, the following additional verification and investigation was performed directly on the branch tip and via GitHub, without merging or deploying anything.

PR quality re-check: provider-contract-map.ts and adapter.ts were re-read in full from the branch. Confirmed: exactly three confirmed entries (za_said_basic, za_home_affairs_enhanced, ng_nin) in CONTRACTS; resolveProviderContract returns null for anything else; the adapter resolves the contract immediately after the API-key check and returns PROVIDER_MISCONFIGURED (no fetch reached) when the contract is null; the outbound URL is built from contract.endpoint_path, never from the internal document_type; mode is always included explicitly in the provider body; SA routes post to /verify, Nigeria NIN posts to /africa-verification. No secrets, schema, RLS, RPC, migration, manual-review, admin-review, WaD-gate or legacy idv-verify changes were found anywhere in the diff.

CI re-check: the fresh CI run triggered by commit ec256e5 (the evidence-file-only commit) completed with the identical pattern already documented above -- Batch 7 Guards and Governance rollback proof green; Lint->Typecheck->Test->Build, Schema drift check, Dependency audit and E2E red; Staging smoke A-D skipped. This confirms the documentation-only commit introduced no new failures.

Lovable deployment investigation: checked the repository's GitHub Deployments page (returns 404 -- GitHub's own Deployments API is not in use), Settings > Environments ("There are no environments for this repository"), and Settings > GitHub Apps, which confirms a "lovable.dev" GitHub App (by GPT-Engineer-App) is installed on this repository -- this is almost certainly the mechanism behind the README's "Deployment: Automatic via Lovable Cloud" line. Opening that app's Configure page required GitHub account-owner "sudo mode" re-authentication via email, which was not attempted, as it requires the account owner directly and falls outside safe autonomous access.

As a result, none of the following could be determined from information available to this session: whether merging to main triggers an automatic deploy, what environment (staging/preview/production/shared) would receive it, whether auto-deploy can be paused or switched to manual, or whether a preview-first deployment path exists. No Lovable dashboard login is available to this session.

Per the autonomous decision framework's rule for this exact situation (deployment target unknown and cannot be paused/controlled from available access): do not merge. PR #23 was NOT merged, nothing was deployed, and no further PRs were opened.

Next human action required: someone with either Lovable project-dashboard access, or the GitHub account owner completing the "sudo mode" email verification to view the lovable.dev app's configuration, needs to confirm the deploy trigger, target environment, and whether it can be paused or run preview-only -- before PR #23 is merged.

Final verdict: BLOCKED_LOVABLE_DEPLOYMENT_TARGET_UNKNOWN (this supersedes the prior VERIFYNOW_CONTRACT_ALIGNMENT_READY_FOR_PR_REVIEW marker at the top of this file pending that clarification).


## 13. Re-inspection of Lovable deployment question (2026-07-09, follow-up)

At your request, I re-inspected available GitHub-side deployment configuration for a second time, specifically:

Actions workflow list: confirmed the repository has exactly three workflows (Batch 7 Guards, CI, Dependabot Updates) -- no separate deploy workflow exists anywhere in Actions history (2,377 runs reviewed via the workflow filter).

Repository webhooks (Settings > Webhooks): none configured. This means Lovable is not notified via a classic repo webhook -- consistent with it operating purely through its GitHub App installation rather than through anything visible/editable in Actions or Webhooks.

GitHub Deployments / Environments: unchanged from the prior check -- no GitHub Deployments records, no Environments configured.

lovable.dev GitHub App Configure page: re-attempted, still gated behind GitHub account-owner sudo-mode ("Confirm access" / "trigger a mailer to verify your identity"). I did not trigger that email verification myself, since I have no access to the account's email inbox to retrieve the resulting code, and this is the kind of identity/account-security step that should be completed by the account owner directly, not by me on your behalf.

Conclusion: I still cannot determine the deploy trigger, target environment, pause/manual capability, or rollback availability from this browser session. This finding is unchanged from the previous BLOCKED_LOVABLE_DEPLOYMENT_TARGET_UNKNOWN verdict. PR #23 remains un-merged; nothing has been deployed.


## 14. Confirmed Lovable deployment model and backward-compatibility fix (2026-07-09)

### 14.1 Confirmed deployment model (from Lovable, relayed by you)

Merging to GitHub main does not automatically publish the frontend to the published URLs (compliance-matching.lovable.app, izenzo.co.za, trade.izenzo.co.za, api.trade.izenzo.co.za) -- those only update when someone clicks Publish in Lovable. However, backend changes (Supabase Edge Functions, shared server code) deploy immediately once they land in the Lovable workspace. Supabase project ugrfyhwlonlmlcmcpcdm is a single shared Lovable Cloud backend for both preview and published frontends -- there is no separate staging database/backend. Lovable's experimental GitHub Branch Switching (Account Settings > Labs) can point the Lovable workspace at a non-main branch for frontend preview, but since the backend is the same single shared project regardless of which branch the workspace is synced to, switching to PR #23's branch would deploy this PR's backend changes to the exact same live shared backend that merging to main would. Branch switching therefore provides no backend isolation and is NOT a safe way to test this PR's backend changes separately -- it carries the same immediate shared-backend deployment risk as merging.

### 14.2 Backend files affected by immediate deploy

PR #23 changes two shared server files: supabase/functions/_shared/verifynow/adapter.ts and supabase/functions/_shared/verifynow/provider-contract-map.ts. A repo-wide code search confirms exactly one Edge Function imports the adapter: supabase/functions/idv-person-verify/index.ts. No other Edge Function references verifynow/adapter or the contract map. So the sole immediate-deploy blast radius is idv-person-verify.

### 14.3 Backward-compatibility defect found and fixed

Direct inspection of idv-person-verify/index.ts (as currently on main, i.e. the backend version behind today's published frontend) shows it builds the payload sent to the adapter like this: if the caller supplies a structured `payload` matching the route's required_fields, use that; otherwise, if a free-text `details_text` was sent, fall back to `payload = { details_text }`. Today's published frontend (pre-PR IdvStart.tsx) only ever sends `{ subject_id, document_country, document_type, details_text }` -- it has no `payload` field at all, since the structured-field UI is new in this PR.

Before the fix below, the new adapter.ts built the outbound VerifyNow body by copying `contract.field_mapping` keys out of `input.payload` (e.g. `said_number` -> `idNumber`, `nin` -> `id_number`), silently omitting any key that was not present, and then called `fetch` unconditionally once a contract was resolved. Given the old frontend's payload shape (`{ details_text: "..." }`), none of `said_number`/`nin` would be present, so the adapter would still POST to VerifyNow's sandbox `/verify` or `/africa-verification` endpoint with `idNumber`/`id_number` missing entirely -- a live sandbox call with a malformed/incomplete body, not a fail-closed result. This is exactly the risk you flagged: old frontend + new backend was NOT backward-compatible.

Fix applied (commit on this branch, supabase/functions/_shared/verifynow/adapter.ts): after building the provider body from the contract's field_mapping, the adapter now checks that every field the contract requires was actually populated from the caller's payload. If any required field is missing or empty, it returns the existing safe `PROVIDER_MISCONFIGURED` outcome (same code already used for unmapped/unconfirmed routes) and never calls fetch. This treats "structured fields required but not supplied" exactly like "route not confirmed" -- fail closed, no network call, safe manual-review-eligible outcome.

Four new tests were added to adapter_smoke_test.ts (which runs under the fetch tripwire that fails the test if any uninjected network call occurs), proving: a legacy `{ details_text }`-only payload fails closed for za_said_basic, za_home_affairs_enhanced, and ng_nin without ever reaching fetch; and a partially-structured payload missing the one required field for ng_nin also fails closed. All four assert `error_code === "PROVIDER_MISCONFIGURED"`.

### 14.4 Answers to the specific compatibility questions

If the old published frontend sends `{ subject_id, document_country, document_type, details_text }` to idv-person-verify after this PR deploys: the new backend now accepts the request without error, routes it to the same safe `provider_error` / manual-review-eligible outcome as an unconfirmed route, returns a safe result to the caller, and does NOT call VerifyNow with malformed data and does NOT break the user flow (idv-person-verify already treats any non-"route" or misconfigured outcome as a normal, non-throwing safe result). Unconfirmed Nigeria routes remain fail-closed exactly as before -- this fix reuses the same fail-closed path and does not touch provider-contract-map.ts's confirmed-route list. Production mode is not implicated by this fix and remains sandbox-only exactly as configured; nothing here changes VERIFYNOW_MODE handling.

### 14.5 Merge recommendation

With the fix and new tests in place, PR #23's backend change is now backward-compatible with the currently-published (pre-PR) frontend: whichever payload shape a caller sends, the adapter either builds a complete, contract-valid request or fails closed before touching the network. Combined with the confirmed deployment model (frontend stays unpublished until an explicit Publish click; only the backend deploys immediately to the shared Supabase project), this PR is recommended as safe to merge, on the explicit understanding that: merging deploys the backend (idv-person-verify's dependencies) immediately to the shared live Supabase project ugrfyhwlonlmlcmcpcdm; the frontend will remain on the old free-text UI until Publish is clicked; no client testing resumes until an internal, sandbox-only, credentialed smoke test has been run post-merge; and Lovable branch-switching is not used as a substitute safety net, since it deploys backend changes to the same shared project.

Final verdict: VERIFYNOW_PR_23_SAFE_TO_MERGE_BACKEND_BACKWARD_COMPATIBLE, conditional on the merge being executed with the above understanding documented and on an internal post-merge sandbox smoke check before any client testing.


## 15. PR #23 merged - post-merge status (2026-07-09)

### 15.1 Merge result

PR #23 was merged by explicit user go-ahead on 2026-07-09. Merge commit: 1eef6d91d73f96398f579243aa78c258e7e28ec2 (short 1eef6d9), merging branch verify-now-contract-alignment-confirmed-routes into main. Parents: 59cb5ca9e7919033f420294184fcbcb416a07e26 (prior main tip) and 9f90aa0ab70cefd977d0f23f667b21b7aaed424c (PR branch tip). Files merged (6, unchanged from the PR description): evidence/batch-v-verifynow-multicountry-idv-routing/CONTRACT_ALIGNMENT_IMPLEMENTATION.md, src/pages/desk/idv/IdvStart.tsx, src/tests/batch-v-verifynow-contract-alignment-ui.test.ts, supabase/functions/_shared/verifynow/adapter.ts, supabase/functions/_shared/verifynow/adapter_smoke_test.ts, supabase/functions/_shared/verifynow/provider-contract-map.ts. Final CI state on the merge commit matches the pre-merge baseline exactly: Batch 7 Guards PASS, Governance rollback proof PASS; Schema drift check, Dependency audit, and E2E - POI mint soft-route FAIL for the same pre-existing, unrelated reasons documented in section 14 and the merge-risk note (missing CI secrets, pre-existing schema-drift files, pre-existing vulnerable lockfile packages); Lint to Typecheck to Test to Build tracked the identical unit-test failure pattern seen on every prior run of this branch and on main itself. No new CI failures were introduced by the merge.

### 15.2 Backend deployment implication

Per the confirmed Lovable model (section 14.1), merging to main does not publish the frontend, but does deploy backend/Edge Function changes (adapter.ts, provider-contract-map.ts, and their sole consumer idv-person-verify) immediately to the single shared Lovable Cloud Supabase project (ugrfyhwlonlmlcmcpcdm) used by both the preview and the still-published frontend. This session has no direct visibility into Lovable's internal sync/deploy pipeline or timing, so completion of the backend sync cannot be confirmed from GitHub alone. A safe reachability probe was run instead, see section 15.3.

### 15.3 Post-merge safe probe

One unauthenticated POST was sent to the idv-person-verify Edge Function URL with a harmless placeholder body containing no real identity data. Result: HTTP 401 UNAUTHORIZED. This proves the function is reachable and fails closed before any VerifyNow call when no valid auth is presented. No live VerifyNow call was made or possible from this probe. No authenticated staging/internal test credentials were available in this session, so the confirmed sandbox smoke test (SA 8001015009087 / 9111060123086, Nigeria NIN 12345678901) was not run. Recorded as BLOCKED_STAGING_AUTH_CREDENTIALS_REQUIRED. The smoke test was not faked or simulated.

### 15.4 Backward-compatibility protection status

The section 14.3 fix (fail-closed check for missing contract-required fields before fetch) is part of the merged commit and is exercised by the 4 new tests in adapter_smoke_test.ts, also merged. It has not been independently re-verified against the live deployed function beyond the reachability probe above, since that would require either an authenticated request or a real VerifyNow sandbox call, neither of which was performed.

### 15.5 Client testing status

Client testing (David/Daniel or any end user) remains paused. It should not resume until an authenticated internal sandbox smoke test against the confirmed fixtures has actually been completed and recorded, in addition to the reachability probe above.

Final verdict: VERIFYNOW_PR_23_MERGED_BACKEND_DEPLOYED_FRONTEND_UNPUBLISHED_PENDING_STAGING_AUTH


## 16. Internal smoke test screenshot investigation (2026-07-09)

The user manually exercised the live /desk/idv/start screen on the custom domain www.izenzo.co.za and submitted five test identity checks using only the confirmed sandbox fixtures: South Africa basic ID check with 8001015009087, South Africa Home Affairs check with 8001015009087, South Africa basic ID check with 9111060123086, Nigeria NIN with 12345678901, and Nigeria Virtual NIN (an unconfirmed route) with 12345678901. All five submissions displayed the identical toast reading "Manual review required" with the description "Your submission has been queued for an administrator to review."

### 16.1 Frontend publish status

Logging into www.izenzo.co.za with credentials the user supplied directly confirmed the live custom domain is serving the post-PR-23 structured-field UI, not an older free-text-only version. The frontend has therefore in fact been updated and published on the custom domain, contrary to the earlier standing assumption that this required a manual Publish click in Lovable. Neither the exact timing nor the mechanism of this publish could be confirmed from available tooling, since Lovable's own deployment and publish history is not accessible from this session. This assumption should be treated as corrected going forward.

### 16.2 Code path traced on main for the five submissions

IdvStart.tsx resolves a client-side route for the chosen country and document type. If any route entry resolves at all, including the unconfirmed Nigeria Virtual NIN entry, since the client-side route table is a general document-type catalogue and does not itself encode which routes are contractually confirmed with VerifyNow, the code calls the idv-person-verify edge function with a structured payload. Only if that call returns an error does the code fall back to calling idv-open-manual-review and show the exact toast text observed in all five screenshots. That toast text appears in exactly one place in the file, so all five submissions, confirmed and unconfirmed alike, reached the same error-fallback branch, not a distinct verified or completed success path.

### 16.3 Database check (read-only, using the user's own authenticated session)

Querying the live Supabase project directly, read-only, no writes, using the user's own session token, found the following for this account's organisation: p5scr_subjects has zero rows, p5scr_idv_records has zero rows, p5scr_manual_reviews has zero rows, and audit_logs has exactly one row total, an unrelated persona-selection event from 2026-07-07 that predates the test session, with no idv.person_verify_completed entry. None of the five test submissions produced a persisted backend record of any kind under this account, despite the UI showing a queued-successfully toast for all five.

### 16.4 Interpretation

The p5scr_record_idv RPC runs unconditionally near the end of idv-person-verify's execution whenever that function completes, regardless of whether VerifyNow itself succeeded, timed out, or the route was unconfirmed. A completely empty p5scr_idv_records table therefore means idv-person-verify most likely did not complete execution at all for any of the five attempts, for the confirmed routes and the unconfirmed route alike. It is not possible to tell, from code and database evidence alone, whether the confirmed routes reached VerifyNow's sandbox and failed there, or failed earlier, for example at auth, subject lookup, deployment lag, or an exception thrown before the provider call. It is also notable that idv-open-manual-review's own success is never checked by IdvStart.tsx before showing the queued toast, so the toast text alone is not proof that a manual-review case was actually created, and in this case it demonstrably was not. Determining the precise failure point requires Supabase Edge Function invocation logs, which are not accessible from this session.

### 16.5 Remaining blockers

Confirming whether VerifyNow sandbox was actually reached for the three confirmed routes requires Supabase Edge Function runtime and invocation logs for idv-person-verify and ideally idv-open-manual-review, which are not accessible with the tooling and credentials available in this session. Client testing must remain paused until this is resolved and a real, persisted, passing record is observed in p5scr_idv_records or p5scr_manual_reviews for a confirmed-route submission.

Final verdict: VERIFYNOW_INTERNAL_SMOKE_FAILED_PROVIDER_NOT_CALLED_NO_PERSISTED_BACKEND_RECORD_FOR_ANY_TEST_LOG_ACCESS_REQUIRED


## 17. p5scr_record_idv service-role fix (2026-07-10)

### 17.1 Root cause confirmed

Following the section 16 investigation, the user separately ran a controlled sandbox submission with DevTools open and observed the actual network flow: idv-subject-provision returned 200, idv-person-verify returned 500 with body containing error RECORD_FAILED and detail "p5scr: platform_admin required", and idv-open-manual-review returned 200. Reproducing the same submission from an authenticated session and instrumenting fetch confirmed the identical 500 body. Reading supabase/migrations/20260626181548_bf5cf1d4-f4d5-4d22-98fd-7dec3874440f.sql confirmed the p5scr_record_idv function (SECURITY DEFINER) contains an internal check requiring has_role(auth.uid(), 'platform_admin') before it will write a row. idv-person-verify/index.ts builds its Supabase client from SUPABASE_SERVICE_ROLE_KEY with no forwarded user JWT, so auth.uid() resolves to NULL under that call and the check fails unconditionally, for every caller, every route, and every country. This explains why every one of the five original screenshot tests, and the fresh DevTools-verified test, landed on manual review with no persisted p5scr_idv_records row.

### 17.2 Caller safety analysis

A repo-wide search for p5scr_record_idv found exactly two runtime callers. supabase/functions/idv-person-verify/index.ts validates that the target subject's person_external_ref equals the calling user's id before it ever calls the RPC. supabase/functions/idv-manual-review/index.ts independently validates that the calling user holds the platform_admin role, via a separate has_role RPC call, before it calls the RPC. Both use a service-role client for the write itself, but both gate access at the edge-function layer first. No frontend or browser code calls this RPC directly. A browser client cannot forge auth.role() equal to service_role without possessing the secret SUPABASE_SERVICE_ROLE_KEY, which is never exposed to the browser. The existing CI regression guard, scripts/check-p5-screening-phase-3-rpc.mjs and its mirror src/tests/p5-screening-phase-3-rpc.test.ts, only checks for the presence of the has_role(auth.uid(), 'platform_admin') substring inside the historical migration file, so it continues to pass unchanged.

### 17.3 Fix implemented

Migration supabase/migrations/20260710120000_328b66eb-3abb-4ab7-a803-90679878461e.sql (commit cbdbf60) adds a new CREATE OR REPLACE FUNCTION public.p5scr_record_idv with the identical signature and body, changing only the authorization check to also accept auth.role() equal to service_role alongside the existing platform_admin check, combined with OR. The REVOKE/GRANT statements are re-issued unchanged, still limited to authenticated, with no anon or PUBLIC grant added. No RLS policy of any kind was touched; every p5scr_* table remains platform_admin-only for SELECT. The historical migration file was not edited. A companion static regression test, src/tests/p5scr-record-idv-service-role-fix.test.ts (commit 0a7127a), asserts all of the above against the new migration file and confirms the historical migration is untouched. All eight assertions in that file pass in CI.

### 17.4 CI status after the fix

Both commits show the same job-level pattern already established as this repo's baseline: Governance rollback proof passes; Schema drift check fails on pre-existing, unrelated frontend convention violations (BackButton/PageFooter usage in Auth.tsx, Landing.tsx, Trust.tsx, ComplianceEngine.tsx, TradeDesk.tsx, Traders.tsx); the E2E soft-route job fails because SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_PUBLISHABLE_KEY and VITE_SUPABASE_URL are not configured as CI secrets; and the Dependency audit gate fails on pre-existing npm advisories unrelated to this change. At the unit-test level, the full suite reports 46 failed files and 26 failed tests out of 493 files and 7123 tests on both the migration commit and the test commit, matching the standing baseline; the same unrelated failing suite (src/tests/public-api-v1-sandprod-batch2-foundation.test.ts) appears identically in both runs. The new src/tests/p5scr-record-idv-service-role-fix.test.ts file itself reports 8 passed, 0 failed.

### 17.5 What remains

This fix has not been exercised against the live sandbox yet. Live smoke testing with the approved fixtures (South Africa 8001015009087 and 9111060123086, Nigeria NIN 12345678901) is required to confirm idv-person-verify now returns a clean result and that a corresponding row actually appears in p5scr_idv_records, checked with platform_admin or service-role access. Client testing remains paused until that live smoke test passes. Whether this migration has already been applied to the live Supabase database automatically, through the existing GitHub-to-Supabase sync used by this project, has not been independently confirmed from this session.

Final verdict: VERIFYNOW_P5SCR_RECORD_IDV_SERVICE_ROLE_FIX_IMPLEMENTED_PENDING_LIVE_SMOKE
