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

Stop Claude

## 12. Autonomous completion mode -- Lovable deployment blocker (2026-07-09)

Under an autonomous-completion authorisation, the following additional verification and investigation was performed directly on the branch tip and via GitHub, without merging or deploying anything.

PR quality re-check: provider-contract-map.ts and adapter.ts were re-read in full from the branch. Confirmed: exactly three confirmed entries (za_said_basic, za_home_affairs_enhanced, ng_nin) in CONTRACTS; resolveProviderContract returns null for anything else; the adapter resolves the contract immediately after the API-key check and returns PROVIDER_MISCONFIGURED (no fetch reached) when the contract is null; the outbound URL is built from contract.endpoint_path, never from the internal document_type; mode is always included explicitly in the provider body; SA routes post to /verify, Nigeria NIN posts to /africa-verification. No secrets, schema, RLS, RPC, migration, manual-review, admin-review, WaD-gate or legacy idv-verify changes were found anywhere in the diff.

CI re-check: the fresh CI run triggered by commit ec256e5 (the evidence-file-only commit) completed with the identical pattern already documented above -- Batch 7 Guards and Governance rollback proof green; Lint->Typecheck->Test->Build, Schema drift check, Dependency audit and E2E red; Staging smoke A-D skipped. This confirms the documentation-only commit introduced no new failures.

Lovable deployment investigation: checked the repository's GitHub Deployments page (returns 404 -- GitHub's own Deployments API is not in use), Settings > Environments ("There are no environments for this repository"), and Settings > GitHub Apps, which confirms a "lovable.dev" GitHub App (by GPT-Engineer-App) is installed on this repository -- this is almost certainly the mechanism behind the README's "Deployment: Automatic via Lovable Cloud" line. Opening that app's Configure page required GitHub account-owner "sudo mode" re-authentication via email, which was not attempted, as it requires the account owner directly and falls outside safe autonomous access.

As a result, none of the following could be determined from information available to this session: whether merging to main triggers an automatic deploy, what environment (staging/preview/production/shared) would receive it, whether auto-deploy can be paused or switched to manual, or whether a preview-first deployment path exists. No Lovable dashboard login is available to this session.

Per the autonomous decision framework's rule for this exact situation (deployment target unknown and cannot be paused/controlled from available access): do not merge. PR #23 was NOT merged, nothing was deployed, and no further PRs were opened.

Next human action required: someone with either Lovable project-dashboard access, or the GitHub account owner completing the "sudo mode" email verification to view the lovable.dev app's configuration, needs to confirm the deploy trigger, target environment, and whether it can be paused or run preview-only -- before PR #23 is merged.

Final verdict: BLOCKED_LOVABLE_DEPLOYMENT_TARGET_UNKNOWN (this supersedes the prior VERIFYNOW_CONTRACT_ALIGNMENT_READY_FOR_PR_REVIEW marker at the top of this file pending that clarification).
