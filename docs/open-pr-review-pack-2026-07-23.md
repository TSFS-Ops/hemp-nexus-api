# Open PR Review Pack - 2026-07-23

Review preparation only. No code was changed, no PR was merged, and no new PR was opened to produce this document. This pack summarizes the three currently open PRs on TSFS-Ops/hemp-nexus-api so a human reviewer can decide review order and payment/security sign-off needs.

Source verification: all mergeability, file lists, and CI check states below were re-read directly from each PR's Conversation and Files-changed tabs on 2026-07-23, after Task 1/2/3 of the prior autonomous session had already run.

## PR 28 - Harden Paystack admin-only payment path

Branch: hardening/paystack-admin-only. Status: Open, not merged, "Able to merge," no conflicts with main.

Business purpose: Paystack is not being offered to customers. This PR closes two gaps in the legacy/admin-only Paystack path: it stops any non-admin caller from starting a Paystack checkout, and it makes the Paystack webhook cross-check incoming settlement data against the original stored purchase record before crediting anything. PayFast stays the only payment method customers ever see.

Files changed (4): docs/paystack-admin-only-hardening-report.md; src/tests/paystack-admin-only-initiation-guard.test.ts; src/tests/paystack-webhook-stored-purchase-validation.test.ts; supabase/functions/token-purchase/index.ts.

Risk level: Medium-high. It changes production payment initiation and webhook crediting logic, even though the change is narrow and additive.

What a reviewer must inspect: the exact placement of the platform_admin/has_role check in token-purchase/index.ts relative to idempotency reservation and the Paystack API call, to confirm no reservation or charge can happen before the guard runs; the webhook cross-check fields (provider, status, token_amount, org_id, user_id, currency, amount_usd) to confirm a forged or mismatched webhook payload is rejected rather than silently accepted when no matching token_purchases row exists; confirmation that existing idempotency/duplicate-webhook protections were not altered; confirmation that the legacy paystack_reference field is preserved unchanged; and that no customer-facing route, nav item, or copy exposes Paystack.

Tests/checks run: narrow suite (new + directly affected tests) 16/16 passing; broader payment/billing regression suite 537/540 passing, with the 3 failures confirmed pre-existing (PayFast Codespace secret-dependent tests, same before/after via git stash comparison).

Known CI failures and status: 4 failing checks (Lint to Typecheck to Test to Build, Schema drift check, E2E POI mint soft-route, Dependency audit HIGH/CRITICAL gate). All 4 are confirmed pre-existing on main (same lint error count, same schema-drift violations, same missing E2E secrets, same npm advisories) and not introduced by this PR. This was posted as a PR comment on 2026-07-23.

Can it be reviewed independently: Yes. It does not depend on PR 29 or PR 30, and touches only Paystack code paths.

Recommended merge order: Third, after PR 30 and PR 29, and only once a reviewer with payment/security context has read the diff.

Payment/security review required: Yes, explicitly required. It touches payment initiation and webhook crediting.

Reason not to merge yet: no human has reviewed the admin-gate placement or the webhook cross-check logic yet; the 4 pre-existing CI failures, while unrelated, mean CI is not green.

## PR 29 - Fix PayFast ITN signature-bypass defect and correct 2 stale merchant_key test assertions

Branch: investigate/payfast-codespace-failures. Status: Open, not merged, "Able to merge," no conflicts with main.

Business purpose: Fixes a real security defect in PayFast's ITN (Instant Transaction Notification) signature verification, where an attacker could append extra data after the signature field and bypass tamper detection under the raw-body fallback path. Also corrects two test files that wrongly assumed merchant_key should never appear in the checkout form, when in fact PayFast's protocol requires merchant_key to be present - only the passphrase must stay hidden.

Files changed (4): docs/payfast-codespace-test-failures-investigation.md; src/tests/payfast-checkout-phase-2c.test.ts; src/tests/payfast-phase-2c-no-regression.test.ts; supabase/functions/_shared/payments/payfast.ts.

Risk level: Medium. It is a small, additive change confined to one verification function in production PayFast code, but it is customer-facing payment-security logic.

What a reviewer must inspect: the exact diff in payfast.ts's verifyPayfastSignatureFromRawBody, confirming the new check only rejects bodies with trailing content after the signature value and does not change signature computation, encoding, or accepted-signature logic for well-formed bodies; the two updated merchant_key test assertions, cross-checked against payfast-live-checkout.ts, to confirm merchant_key really is required by PayFast and passphrase still never reaches the client; and confirmation that no PayFast checkout flow, wallet/ledger crediting, or idempotency handling was touched outside this one function.

Tests/checks run: target 3 PayFast test files now pass 52/52. Full regression run: 7809 tests total, 37 failures across 23 files, none referencing PayFast - all pre-existing and unrelated (registry search, notifications, batch isolation, screening/audit, public-api).

Known CI failures and status: same 4 pre-existing checks as PR 28 (Lint to Typecheck to Test to Build, Schema drift check, E2E POI mint soft-route, Dependency audit gate), reconfirmed unchanged and not introduced by this branch; branch reconfirmed clean with no new commits pending.

Can it be reviewed independently: Yes. It does not touch Paystack, PR 28, or PR 30's files.

Recommended merge order: Second, after PR 30, ahead of PR 28, because it fixes a live security defect in the only customer-facing payment path.

Payment/security review required: Yes. It is a signature-verification bypass fix in the customer-facing PayFast path and should get the same scrutiny as PR 28, arguably with more urgency.

Reason not to merge yet: no human has reviewed the signature-verification diff yet; recommend prioritizing this review given it closes an actual bypass, not just a hardening measure.

## PR 30 - Triage repo-wide CI debt; fix 2 stale lint errors in tests; document schema-drift, E2E-secrets, and dependency-audit findings

Branch: triage/repo-ci-debt-2026-07-23. Status: Open, not merged, "Able to merge," no conflicts with main.

Business purpose: Investigates the 4 CI checks failing across main, PR 28, and PR 29, fixes the 2 lint errors that were safe to fix mechanically, and documents (without changing) the schema-drift, E2E-secrets, and dependency-vulnerability findings so they can be triaged as separate, deliberate workstreams later.

Files changed (6): docs/dependency-audit-plan-2026-07-23.md; docs/payment-pr-sequencing-recommendation-2026-07-23.md; docs/repo-ci-debt-repair-2026-07-23.md; docs/repo-ci-debt-triage-2026-07-23.md; src/tests/funder-workspace-batch1-foundation.test.ts; src/tests/funder-workspace-batch6-notifications.test.ts.

Risk level: Low. Only 2 files contain non-doc changes, both test-only, both mechanical (regex-spacing cleanup and a disallowed require() swapped for an already-imported statSync). No production, payment, auth, or RLS code is touched.

What a reviewer must inspect: the 2 test-file diffs, to confirm the regex-spacing conversions in funder-workspace-batch1-foundation.test.ts are behaviorally identical (multi-space runs replaced with equivalent quantifiers) and that the statSync swap in funder-workspace-batch6-notifications.test.ts is a pure import-style change with no behavior difference; and the 4 documentation files, to confirm the recommendations are reasonable before anyone acts on them.

Tests/checks run: eslint on both changed test files exits 0; both files pass 67/67 tests.

Known CI failures and status: 5 failing checks are currently showing on this PR - the same 4 pre-existing checks seen on PR 28 and PR 29, plus one additional check not present on those PRs' check lists: "PR26 Pilot Readiness Validation / Source - focused tests - full Vitest - typecheck," which failed after 4-5 minutes. This extra check appears to be path-filtered (it also shows a second, passing job, "Disposable DB - migrations - idempotency - fixtures - isolation"). It was not present on PR 28 or PR 29 because those PRs did not touch files matching its trigger paths. This has not been separately root-caused and should be checked by the reviewer before merge - it is flagged here, not investigated further, per the review-prep-only scope of this task.

Can it be reviewed independently: Yes. It is fully independent of PR 28 and PR 29 - different branch, different files, no payment code.

Recommended merge order: First. It is the lowest-risk PR and unblocks nothing else, but reviewing and merging it first shrinks the repo-wide CI debt baseline before the two payment PRs are reviewed.

Payment/security review required: No. It does not touch payments, auth, RLS, or webhook code. A general code reviewer is sufficient, though the newly-flagged PR26 Pilot Readiness Validation failure should be explained before merge.

Reason not to merge yet: the new PR26 Pilot Readiness Validation failure has not been explained; no human has reviewed the 2 mechanical test diffs or the 4 documentation files yet.

## Recommended plan after review

PR 30 should be reviewed first: it is the lowest-risk change, contains no payment code, and reviewing it first reduces the amount of pre-existing CI noise a reviewer has to mentally filter out when they move on to PR 29 and PR 28. Its one open question - the new PR26 Pilot Readiness Validation failure - should be resolved or explained before merge.

PR 29 should be prioritised immediately after PR 30 is handled, because it fixes a real PayFast ITN signature-verification bypass, not just a hardening measure. This is the one open PR with an active security defect fix in the customer-facing payment path, so it should not sit in queue behind PR 28.

PR 28 should be reviewed last among the three, and specifically by someone with payment/security context, because it changes Paystack checkout initiation gating and webhook settlement crediting. It is independent of PR 29, so this ordering is about risk/urgency prioritisation, not a technical dependency.

No dependency-audit or schema-drift work should be mixed into any of these three PRs. Both are already documented separately (docs/dependency-audit-plan-2026-07-23.md and docs/repo-ci-debt-triage-2026-07-23.md, both delivered via PR 30) and should be their own future workstreams with their own review, not bundled into payment-path or lint-cleanup review.

The next build workstream after these three PRs are reviewed should be a PayFast enterprise-readiness audit, focused on reconciliation, settlement, exception handling, refunds and disputes, tenant safety, and operational runbooks. This is a larger, dedicated body of work distinct from the defect fix in PR 29, and should be scoped and branched separately once PR 29 lands.

## Final status

OPEN_PR_REVIEW_PACK_READY


## Addendum - PR 30 additional check investigation (2026-07-23)

This addendum investigates the fifth failing check flagged in the original review pack: "PR26 Pilot Readiness Validation / Source - focused tests - full Vitest - typecheck." No code was changed, nothing was merged, and no new PR was opened to produce this addendum. Only PR 30 was investigated; PR 28 and PR 29 were not touched.

Why this check ran on PR 30 at all: the PR26 Pilot Readiness Validation workflow (.github/workflows/pr26-pilot-readiness-validation.yml) triggers on pull requests to main only when the diff touches specific paths, including the glob "src/tests/funder-workspace-*.test.ts". PR 30 touches src/tests/funder-workspace-batch1-foundation.test.ts and src/tests/funder-workspace-batch6-notifications.test.ts, both of which match that glob. That is exactly why this workflow ran on PR 30 and not on PR 28 or PR 29, neither of which touches any funder-workspace test file.

Exact failing command: within the job's "Full Vitest suite (fail-closed)" step, the command is "bunx vitest run --reporter=verbose 2>&1 | tee validation-artifact/11-full-vitest.txt", run with env VITE_SUPABASE_URL=http://localhost:54321 and VITE_SUPABASE_PUBLISHABLE_KEY=dummy-anon-key-for-vitest (no real Supabase/PostgREST backend is running in this job). This step exited with code 1, which is what fails the check; the subsequent "Typecheck (fail-closed)" step never ran (0s, skipped) because the job stops after the first failing step.

Exact error / summary: the run reports "Test Files 28 failed | 489 passed | 1 skipped (518)", "Tests 67 failed | 7914 passed | 2 skipped (7983)", "Errors 2 errors". A representative example failure is src/tests/basic-memory-schema.test.ts, "table is reachable (PostgREST sees it) but anon select returns no rows", which fails with "Test timed out in 5000ms" - a network timeout against the dummy localhost Supabase URL, not an assertion failure. One of the two unhandled errors is an unrelated mock-export issue: "[vitest] No readRecentPendingAttempts export is defined on the @/components/desk/billing/PaymentReferenceStatus mock."

Whether this is introduced by PR 30: No. The 28 failing test files are: admin-f7-manual-overrides-wiring, audit-ledger-copy-capability-guard, basic-memory-schema, basic-memory-writer, batch-d1-d2-static-guards, batch-m-notifications-prefs, batch-s-support-manual-intervention, cp-fixtures-admin-ui-proof, desk-route-integrity, event-ledger-append-only-convention-guard, funder-workspace-batch2-routes, funder-workspace-batch3-funder-ui, funder-workspace-batch5-workflow, not-002-010-cooldown-and-stale-reminders, not-008-dec-009-unsubscribe-classification, p5-batch3-stage2-isolation, p5-batch3-stage3-isolation, p5-batch3-stage4-isolation, p5-batch3-stage5-isolation, p5-batch3-stage6-isolation, p5-screening-phase-6-memory-audit, payfast-checkout-phase-2c, payfast-itn-phase-2b, payfast-phase-2c-no-regression, phase-1a-support-behavioural, public-api-v1-batch5-counterparty-lookup-summary, public-api-v1-sandprod-batch2-foundation, and registry-search-partial-match.integration (all .test.ts). None of these are the two files PR 30 edited.

Whether it is caused by the two test-file lint changes: No. funder-workspace-batch1-foundation.test.ts and funder-workspace-batch6-notifications.test.ts, the only test files PR 30 touched, do not appear anywhere in the 28-file failure list, and both were already independently confirmed in the original triage to pass 67/67 with eslint exiting 0.

Whether it is caused by the new docs files: No. Markdown files are not executed by Vitest and cannot affect test outcomes; none of the four new doc files are imported or referenced by any test or source file.

Whether it is a pre-existing focused-test/typecheck issue triggered by path filters: Yes. The path filter is why the workflow ran on PR 30 at all, but the failures themselves are pre-existing and environmental. The three payfast-*.test.ts failures in this list are the exact same pre-existing failures already investigated and fixed on PR 29's branch (PR 30 is based on plain main, which does not include PR 29's fix, so they still fail here as expected). The remaining failures are dominated by tests that need a live Supabase/PostgREST backend (for example the 5-second timeout on basic-memory-schema.test.ts against the dummy localhost URL), which this job's "Full Vitest suite" step has never provided. Checking the workflow's own run history confirms this: the two most recent runs of this same workflow before PR 30 (runs #121 and #122, both against the unrelated PR #27 branch claude/funder-workspace-backend-completion) also failed, and PR 30 does not modify the workflow file itself.

Whether a safe minimal fix is available within PR 30's scope: No. Making this job pass would require either standing up a disposable Supabase-compatible backend for the full unscoped Vitest run (a significant CI infrastructure change) or narrowing the "Full Vitest suite" step to a scoped subset of tests (a change to the shared CI workflow file itself, with a blast radius well beyond this PR and outside the low-risk, docs-and-lint-only scope already used for PR 30). Neither is a small or safe change to make inside this PR, so none was applied.

Whether PR 30 should remain blocked until fixed: No. This failure is not evidence of a defect in PR 30's diff. It is the same category of pre-existing, environment-caused CI debt already documented for the repo's other checks (missing live backend / missing secrets), just surfaced by this PR because of the funder-workspace path filter. A reviewer can treat this identically to the other four pre-existing failures already disclosed: safe to review and merge on its technical merits, once a human has read the two mechanical test diffs and four documentation files, without waiting on this check to turn green.

## Addendum final status

PR30_EXTRA_CHECK_PREEXISTING_OR_UNRELATED
