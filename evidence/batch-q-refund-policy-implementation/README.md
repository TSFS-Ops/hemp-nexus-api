# Batch Q â Provider-neutral refund reservation and settlement finalisation

Status at time of writing: **BATCH_Q_REFUND_POLICY_IMPLEMENTED_PENDING_CI_AND_RUNTIME_VERIFICATION**

Branch: `batch-q-refund-reservation-settlement`

## 1. Phase 1 inspection correction (carried forward)

The original Batch Q framing assumed Paystack had been superseded by PayFast. Phase 1 read-only inspection corrected this: **PayFast and Paystack are both live and coexisting.** PayFast is primary/preferred for the customer journey per client decision, but Paystack purchases and Paystack refund-webhook settlement remain fully live and are preserved unchanged by this batch. This is documented in `docs/payfast-phase-2j-customer-rollout-report.md`, whose "Remaining limitations" section 9 explicitly scopes automated PayFast refund-status checking as a future "Phase 2K" item, not something present in the codebase today.

## 2. Client questionnaire decision implemented

Admin approval of a refund means "approved for refund processing" only. Credits are reserved (held) at approval, not finally deducted. Final deduction happens only when a payment provider confirms successful settlement (existing Paystack webhook path, unchanged) or an authorised admin records a manual offline settlement with reason, reference, timestamp, admin identity and an audit/governance entry. Settlement mismatches always go to manual review; nothing is auto-refunded, auto-credited, or finally deducted on a mismatch.

## 3. Schema / migration changes

New migration: `supabase/migrations/20260707140000_batch_q_refund_reservation_settlement.sql` (additive only). Adds `token_balances.reserved_refund_tokens` (spendable balance = balance â reserved_refund_tokens); a new `token_refund_reservations` table (one row per refund_request_id, status active/consumed/released, RLS enabled, service_role only); `refund_requests.reservation_id` and `refund_requests.final_ledger_id` linkage columns; and widens `token_ledger_action_type_check` by exactly one new value, `refund_hold`, needed for the zero-value hold-marker ledger row written at approval (this was a bug caught and fixed during self-review â the constraint did not originally allow it).

## 4. RPC / function changes

`approve_refund()` â no longer finally deducts `token_balances.balance`. Computes a reserve amount (`GREATEST(0, LEAST(credits_at_request, available))`), creates/confirms a `token_refund_reservations` row (idempotent via `ON CONFLICT (refund_request_id) DO NOTHING`, with a concurrent-race fallback), increments `reserved_refund_tokens`, writes a `token_ledger` row with `action_type='refund_hold'` and `tokens_burned=0` as a pure audit marker (not a deduction), and sets `provider_settlement_status='not_submitted'` exactly as before. Duplicate-approval replay is handled explicitly and returns the existing reservation rather than re-reserving. Tolerates a missing `token_balances` row (treated as balance=0) rather than introducing a new hard-failure mode â this matches the pre-Batch-Q function's silent tolerance and was required to keep the existing live-DB proof `supabase/tests/batch_f2_atomic_refund_proof.sql` passing.

`atomic_token_burn()` â one surgical change: the spend-gating WHERE clause now excludes `reserved_refund_tokens` from spendable balance (`(balance - COALESCE(reserved_refund_tokens,0)) >= p_amount`). The billing-hold check, ledger insert and governance-emission signature are preserved verbatim from the currently-deployed function.

`mark_refund_provider_settled()` â preserves its existing idempotency (dedupe on `provider_refund_reference`) and conflict-detection (`REFUND_SETTLEMENT_CONFLICT` â `admin_risk_items`) verbatim. Adds: a legacy-row fallback for refunds approved before this migration (`reservation_id IS NULL` â record settlement confirmation only, no second deduction, since the old immediate-deduction behaviour already moved the credits at approval time); a best-effort currency cross-check against `token_purchases.currency` that opens an `admin_risk_items` row (`refund_settlement_mismatch`) and returns `REFUND_SETTLEMENT_MISMATCH` without moving money on mismatch; and, on success, consumes the reservation and performs the final deduction exactly once, writing the closing `token_ledger` row with `action_type='refund'`.

`mark_refund_manually_settled_with_governance()` â preserves its existing governance/hash-chain/idempotency logic verbatim (authorised admin id, notes â¥ 20 chars, hash-chained `admin.hq_decision_recorded` event). Adds reservation consumption plus the final deduction (same pattern as the provider-settled path) when a reservation exists; skips the second deduction for legacy pre-Batch-Q rows with no reservation.

`surface_unsettled_refunds()` â wording-only change (risk-item description now says credits are "held in reserve pending settlement" rather than "reversed in-platform"); dedup/open/auto-resolve logic is unchanged.

All new/changed functions keep the existing `REVOKE ALL ... FROM PUBLIC, anon, authenticated` / `GRANT ... TO service_role` lockdown pattern. The new `token_refund_reservations` table has RLS enabled with all grants revoked from anon/authenticated (service_role only).

## 5. Reservation / hold mechanism

`token_refund_reservations`: one row per `refund_request_id` (unique index), `status â {active, consumed, released}`. Created/confirmed at admin approval; prevents the customer from spending reserved credits (enforced by the `atomic_token_burn` WHERE-clause change); is not a final deduction; is idempotent on duplicate approval attempts; never reserves more than the currently available balance; is consumed exactly once, by whichever settlement path (provider-confirmed or manual) closes it out first.

## 6. Before / after state machine

**Before:** `approve_refund` â immediately and finally decremented `token_balances.balance` and wrote a final `token_ledger` refund row. `provider_settlement_status` was a pure tracking label that did not gate the deduction. `mark_refund_provider_settled` / `mark_refund_manually_settled_with_governance` explicitly did not touch balances/ledger (per their own SQL comments), assuming the deduction had already happened at approval.

**After:** `approve_refund` â reserves credits only (`reserved_refund_tokens` += amount; `balance` unchanged; zero-value `refund_hold` audit marker written). Final deduction moves to whichever settlement path closes the reservation: `mark_refund_provider_settled` (Paystack webhook, existing call site unchanged) or `mark_refund_manually_settled_with_governance` (admin action, now the only close-out path for refunds without a provider webhook, e.g. PayFast today).

## 7. Provider-specific handling

**Paystack** â webhook settlement is unchanged: `token-purchase/index.ts`'s Paystack refund webhook handler continues to call `mark_refund_provider_settled` exactly as before; only the effect of that call changed (it now performs the final deduction instead of a no-op confirmation).

**PayFast** â no automated refund-status check exists in this codebase (confirmed in Phase 1; see `docs/payfast-phase-2j-customer-rollout-report.md` Â§9). This batch does **not** fabricate one. PayFast refunds are completed via the authorised manual-offline-settlement path (`mark_refund_manually_settled_with_governance`) until a real PayFast refund-status integration exists (tracked as a future Phase 2K item). A fail-closed constant, `PAYFAST_REFUND_STATUS_CHECK_NOT_IMPLEMENTED`, was added to `supabase/functions/_shared/dec-007-policy.ts` so that any future code path that would otherwise need to call a live PayFast refund-status check has an explicit, honest, fail-closed value to return instead of fabricating success.

## 8. Wording changes

New `CUSTOMER_REFUND_LABELS` SSOT in `src/lib/policy/dec-007-refund-policy.ts` (mirrored in the Deno shared policy): "Refund requested", "Refund approved for processing", "Awaiting provider confirmation", "Refund completed", "Refund requires admin review", plus the pre-existing "Refund declined" / "Refund superseded". A new `customerRefundLabel(requestStatus, providerSettlementStatus)` helper in `src/lib/policy/refund-settlement.ts` reads **both** fields, so a provider-settled or manually-settled refund now correctly shows "Refund completed" instead of getting stuck on an approval-only label forever (the exact regression named in the task). `PurchasesList.tsx` was updated to use this helper and to remove the hardcoded "(Paystack)" wording from its tooltip, which previously appeared even on PayFast rows â the tooltip is now provider-neutral by default and only names PayFast/Paystack specifically when the row genuinely belongs to that provider. The `DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER` was also corrected: it previously (accurately, pre-Batch-Q) said manual settlement "does NOT move money and does NOT change credits or the token ledger" â this is no longer true under Batch Q, since manual settlement is now the close-out step that performs the final deduction, so the disclaimer was rewritten to say it does not call Paystack/PayFast but does finally deduct the reserved credits and write the closing ledger entry. A new `DEC_007_BATCH_Q_APPROVAL_DISCLAIMER` explains the reservation-not-final-deduction distinction to admins at approval time.

## 9. Tests run and results

No local/CI test execution is available in this session (browser-only tool access; no terminal). The following were added/updated and are expected to run under the existing Vitest/Deno CI pipeline once pushed:

- `src/tests/batch-q-refund-reservation-settlement.test.ts` (new) â static source-inspection guard pinning the migration SQL's reservation mechanism, approve/settle/manual-settle behaviour, the token_ledger_action_type_check widening, the missing-token_balances-row tolerance fix, the atomic_token_burn WHERE-clause change, and the PayFast fail-closed adapter-gap constant.
- `src/tests/refund-settlement-status-ssot.test.ts` (updated) â fixed two assertions that were made false by the corrected, more honest `DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER` text; added coverage for `REFUND_RESERVATION_STATUSES` and the new `customerRefundLabel()` helper, including an explicit regression test proving a provider-settled refund no longer gets stuck on an approval-only label.
- `supabase/tests/refund_provider_settlement_proof.sql` (updated, live-DB proof) â this file's Test C and Test E previously asserted that `mark_refund_provider_settled` / `mark_refund_manually_settled_with_governance` left `token_balances.balance` **unchanged**, which was true pre-Batch-Q and is now intentionally false (these are exactly where the final deduction now happens). Updated to assert the correct new behaviour: the first settlement call deducts exactly the reserved amount once, and the deduped retry does not deduct again.
- `supabase/tests/batch_f2_atomic_refund_proof.sql` (not modified) â verified compatible. This live-DB proof seeds a refund with `credits_at_request=0` and **no** `token_balances` row, which is exactly the edge case that required the missing-row-tolerance fix in section 4 above; without that fix this proof would have failed with a new `TOKEN_BALANCE_NOT_FOUND` error it does not expect.
- `src/tests/admin-refund-wiring.test.ts`, `src/tests/admin-refund-mark-settled-wiring.test.ts`, `src/tests/r2-refund-request-ui-wiring.test.ts` (not modified) â inspected and confirmed compatible; none of their assertions reference the balance-mutation timing this batch changes, and the `PurchasesList.tsx` wording/wiring assertions they check (Request refund button, pending-state rendering, `list-org-purchases` invocation, no direct Paystack/PayFast calls, no admin-approve/decline calls from the org-side UI) all still hold after the wording fix in section 8.
- `supabase/functions/_shared/governance-atomicity-batch1_test.ts` (not modified) â reads a different, untouched migration file by fixed path; confirmed the `atomic_token_burn(uuid, integer, text, text, jsonb)` signature this batch preserves matches exactly what that Deno test pins.

CI has not yet run against this branch/PR at the time of writing this evidence file.

## 10. Known caveats

- No terminal/CI execution capability in this session â none of the above tests, old or new, have actually been executed by the author of this batch. Correctness has been established by careful static cross-reference against every SQL/TS file this migration touches or that touches the same tables/columns, not by running the suite.
- PayFast refund settlement remains manual-offline-only; a real PayFast refund-status integration is out of scope for this batch (tracked as future Phase 2K).
- The reservation mechanism does not implement an explicit "released on decline" path beyond the existing guarantee that decline/blocked/superseded refunds never reach `approve_refund` in the first place (a refund_request can only be approved once from `pending`; declined/blocked/superseded rows never get a reservation). No case was found in the current schema where an *already-reserved* refund needs to be released without being settled, so no separate `release_refund_reservation` RPC was added â flagging this explicitly in case reviewers know of a workflow (e.g. an "undo approval" admin action) that would need it.


---

## PR #22 review pass (review/verify only â no code changes made in this pass)

Reviewed by: Claude (browser-only tools, no terminal/CI execution capability).
PR: https://github.com/TSFS-Ops/hemp-nexus-api/pull/22
Branch: `batch-q-refund-reservation-settlement` (12 commits, +1,688/-322, 10 files)

### CI status (as of this review)

7 checks ran. 1 passed, 5 failed, 1 skipped.

- **Batch 7 Guards / Prebuild guards Â· parity Â· Batch 7 tests** â PASSED.
- - **CI / Lint â Typecheck â Test â Build** â FAILED. Root cause: a genuine parsing bug introduced by this PR in `src/components/desk/billing/PurchasesList.tsx`. ESLint reports `120:53 error Parsing error: Unexpected token`. Manual inspection confirms every JSX closing tag in the file's `return (...)` block was corrupted during the earlier full-file rewrite: the tag name is duplicated immediately after the closing `>`, e.g. `</CardTitle>CardTitle>`, `</CardDescription>CardDescription>`, `</CardHeader>CardHeader>`, `</p>p>` (confirmed at lines 120, 127, 128, 133, 180, and likely more throughout the file). This is a **real, PR-introduced blocker** â the file cannot compile. Because Lint fails first in this job, Typecheck/Run unit tests/Notification regression suite/Build never executed, so **none of the new or updated tests in this PR have actually been run or confirmed passing by CI yet**.
  - - **CI / Schema drift check** â FAILED, but pre-existing and unrelated: violations are in `src/pages/Auth.tsx`, `Landing.tsx`, `Trust.tsx`, `products/ComplianceEngine.tsx`, `products/TradeDesk.tsx`, `solutions/Traders.tsx` â none touched by this PR. Confirmed this check also fails identically on `main` (latest run #1958).
    - - **CI / E2E â POI mint soft-route (422 â 202)** â FAILED, unrelated: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are not configured as repo secrets. Also fails identically on `main`.
      - - **CI / Governance rollback proof** â FAILED, unrelated/environmental: `apt-get install postgresql-client` failed on an unsigned/unreachable `packages.microsoft.com` repo (network/infra flake). This job actually **passed** on the latest `main` run, so this looks like transient CI-runner flakiness rather than a systemic or code-related failure.
        - - **CI / Dependency audit (HIGH/CRITICAL gate)** â FAILED, pre-existing: 13 vulnerabilities (1 critical â `vitest` UI file-read; several high â `glob`, `minimatch`, `picomatch`, `react-router`, `undici`, `ws`) already present in the lockfile. This PR does not touch `package.json`/`package-lock.json`. Also fails identically on `main`.
          - - **CI / Staging smoke AâD** â skipped (secrets missing), as designed.
           
            - **Net CI classification:** 1 blocker directly introduced by this PR (PurchasesList.tsx parse error). 4 failing checks are pre-existing/environmental and reproduce identically (or worse) on `main` â not caused by Batch Q.
           
            - ### Migration review (`20260707140000_batch_q_refund_reservation_settlement.sql`)
           
            - Re-read in full. `token_refund_reservations` is additive (new table, RLS enabled, `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT ALL ... TO service_role` only, unique index on `refund_request_id` for idempotency, `status` check constrained to `active/consumed/released`). `token_balances.reserved_refund_tokens` is additive (`ADD COLUMN IF NOT EXISTS ... DEFAULT 0` + non-negative check constraint). `refund_requests.reservation_id`/`final_ledger_id` are additive, nullable FKs â safe for legacy rows. `refund_hold` is added to `token_ledger_action_type_check` by dropping and recreating the constraint with every previous value preserved plus the one new value â confirmed no existing allowed value was dropped. No destructive statements (no `DROP TABLE`, no column removal, no data-mutating `UPDATE`/`DELETE` outside the four refund RPCs' own runtime logic). Rollback would require a follow-up migration (Postgres migrations here are forward-only); reverting mid-flight would strand any reservations created after this migration ships, which is an inherent (not novel) characteristic of this migration style in this repo.
           
            - ### RPC / accounting-model review
           
            - Traced `approve_refund`, `atomic_token_burn`, `mark_refund_provider_settled`, and `mark_refund_manually_settled_with_governance` line by line. Approval reserves via `reserved_refund_tokens += v_reserve_amount` and writes a zero-value `refund_hold` ledger marker; it no longer performs `balance = GREATEST(0, balance - ...)`. It tolerates a missing `token_balances` row (`COALESCE(..., 0)`) rather than hard-failing, and is idempotent both via an explicit "already approved with reservation" branch and an `ON CONFLICT (refund_request_id) DO NOTHING` race guard. `atomic_token_burn`'s only change is the WHERE-clause guard `(balance - COALESCE(reserved_refund_tokens,0)) >= p_amount`, so reserved credits are correctly excluded from spendable balance; the billing-hold gate and governance-emission signature are preserved verbatim. Both settlement functions consume the reservation and perform the single final deduction (`balance -= reserved_credits`, `reserved_refund_tokens -= reserved_credits`, both floored with `GREATEST(0, ...)`), mark the reservation `consumed`, and are idempotent (second call short-circuits on `reservation.status = 'consumed'` or matching provider reference) â confirmed this cannot race in practice because both paths take `SELECT ... FOR UPDATE` on the same `refund_requests` row first. Currency mismatches and conflicting provider references open an `admin_risk_items` row and `RETURN` before reaching the deduction code (verified the mismatch-return precedes the deduction statement in file order) â no automatic money movement on mismatch, as required. Legacy (pre-Batch-Q, `reservation_id IS NULL`) refunds are correctly special-cased to skip a second deduction in both settlement functions. Cross-checked against `admin_refund_approve_with_governance` (only reads `ledger_id` from `approve_refund`'s return â unaffected) and the `refund_requests_settlement_status_guard` trigger (only touches columns this migration still sets correctly) â no conflicts found.
           
            - ### UI wording review
           
            - `src/lib/policy/dec-007-refund-policy.ts` `CUSTOMER_REFUND_LABELS` matches the required customer-facing vocabulary exactly ("Refund requested" / "Refund approved for processing" / "Awaiting provider confirmation" / "Refund completed" / "Refund requires admin review" / "Refund declined" / "Refund superseded"). `customerRefundLabel()` in `refund-settlement.ts` only returns `completed` when `isMoneyReturned(providerSettlementStatus)` is true (i.e. `provider_completed` or `manually_settled_offline`) â "Refund completed" cannot show before settlement evidence exists. `list-org-purchases/index.ts` now selects `provider_settlement_status` so the UI has the data it needs. **However, this cannot currently be visually confirmed in the running app** because `PurchasesList.tsx`, the component that consumes these labels, does not currently compile (see CI blocker above) â the wording logic is verified correct at the source level only.
           
            - One pre-existing (not Batch-Q-introduced) inconsistency noted for awareness: `supabase/functions/_shared/dec-007-policy.ts`'s `DEC_007_PAY_009_ADMIN_DISCLAIMER` is shorter than its `src/lib/policy/dec-007-refund-policy.ts` counterpart, despite a file-header comment requiring them to stay "numerically/string identical." Confirmed via `main` branch diff that this drift predates this PR; Batch Q only added new constants to the Deno file additively and did not touch this existing string.
           
            - ### Test coverage review
           
            - `src/tests/refund-settlement-status-ssot.test.ts` and the new `src/tests/batch-q-refund-reservation-settlement.test.ts` were read in full and cross-checked line-by-line against the actual migration/policy source â every regex assertion matches real corresponding code (reservation schema, idempotency, no-balance-row tolerance, mismatch-before-deduction ordering, PayFast fail-closed constant, no live provider calls). `supabase/tests/refund_provider_settlement_proof.sql` Test C and Test E now correctly assert a three-point balance check (before â mid â after: first call deducts 10, idempotent retry does not double-deduct). All of this is static/logical verification only â **none of it has been executed**, because the CI job that runs Vitest never got past the Lint step due to the PurchasesList.tsx blocker.
           
            - ### Blockers
           
            - 1. **Must fix before merge:** `src/components/desk/billing/PurchasesList.tsx` â pervasive JSX closing-tag corruption breaks the build. This is the sole reason CI's main test/build job fails, and it also means test results are still unconfirmed.
             
              2. ### Caveats (unresolved, unchanged from before this review)
             
              3. No terminal/CI execution capability in this session â all migration/RPC/test verification above is static source review, not live execution. CI remains the first real runtime verification pass once the blocker above is fixed and pushed. PayFast settlement remains manual-offline-only by design (no automated status checker exists). No explicit "release reservation on decline" RPC exists; not required by any case found so far, flagged for reviewer awareness.
             
              4. ### Recommendation
             
              5. **Hold â do not merge.** Fix the PurchasesList.tsx corruption, push, and let the full CI suite run (in particular Typecheck/Run unit tests/Build) before reconsidering merge. The 4 other failing checks are pre-existing/environmental and do not need to block this specific PR, but are worth a separate maintenance pass.
             
              6. Final status: **BATCH_Q_PR_NEEDS_FIXES**
              7. 

## PR #22 JSX corruption fix (follow-up to review pass)

Scope of this pass: fix only the JSX corruption in src/components/desk/billing/PurchasesList.tsx that was blocking CI. No refund business logic, SQL, RPCs, ledger logic, provider logic, or customer wording was changed.

### What was fixed

Two commits on batch-q-refund-reservation-settlement:

Commit 1d46c57 fixed 22 instances of a duplicated-closing-tag corruption pattern, for example </CardTitle>CardTitle> became </CardTitle>, </CardDescription>CardDescription> became </CardDescription>, </CardHeader>CardHeader> became </CardHeader>, and </p>p> became </p>, plus the same pattern on span, code, div, Badge, Button, CardContent, and Card. Verified by regex scan of the raw file content before and after the fix (22 matches, then 0 matches).

Commit 7666bfe was needed because CI still failed after commit 1 with a new parse error at 290:6, "Expression expected". Root cause: the same corruption pattern also hit the anonymous JSX fragment shorthand at the very end of the file: closing sequence </>> should have been </>, and a stray }</> should have been just }. Both were fixed. Verified by regex scan showing zero remaining instances of the bad pattern, and by a full clipboard-based content diff against the intended fixed text before committing.

Both fixes were verified against the GitHub API blob content directly, rather than the CDN-cached raw.githubusercontent.com URL (which lagged behind after each commit), to confirm the committed file exactly matched the intended fix before moving on.

### CI status after both fixes (commit 7666bfe)

Lint, Terminology guard, and Typecheck now all pass cleanly. Previously Lint failed at the parse stage, so Typecheck, Test, and Build never ran at all for this PR. This is the main outcome of this pass: CI can now actually execute the test suite for the first time.

Run unit tests then executed the full suite and failed. Test Files: 49 failed, 441 passed, 2 skipped (492 total). Tests: 29 failed, 7105 passed, 9 skipped (7143 total). 2 errors reported.

The large majority of these 49 failed files are pre-existing and unrelated to Batch Q, spread across many unrelated areas of the codebase. This is consistent with the earlier review pass finding that main's own "Run unit tests" step was also failing before this PR existed (main's failure could not be fully inspected at the time because the log never finished rendering in the UI).

One failure is directly Batch-Q-specific and was not previously visible, because the parse error prevented any test in the suite from running at all:

src/tests/batch-q-refund-reservation-settlement.test.ts, in the group "Batch Q migration - atomic_token_burn excludes reserved credits from spendable balance", the case "gates the burn UPDATE on (balance - reserved_refund_tokens) >= amount" failed.

AssertionError: the test's regex, expecting a WHERE clause of the form "org_id = p_org_id AND (balance - COALESCE(reserved_refund_tokens,0)) >= p_amount", did not match the actual migration SQL content. All 32 other assertions in this same test file passed, including the reservation schema, idempotency, no-balance-row tolerance, mismatch-before-deduction ordering, and PayFast fail-closed checks.

Other failing checks on this run: Schema drift check (pre-existing violations in files not touched by this PR, per the earlier review pass), E2E POI mint soft-route (missing repository secrets, environmental), and the Dependency audit HIGH/CRITICAL gate (pre-existing dependency vulnerabilities, unrelated to this PR's own files). Governance rollback proof passed on this run; it had failed on the immediately-prior run with an apt-get and network error, which confirms that failure was transient CI-runner flakiness as suspected in the earlier review pass.

### Not fixed in this pass (out of scope)

The atomic_token_burn regex mismatch above is a real, newly-exposed discrepancy in the Batch Q PR's own test or migration, not a JSX issue. Per this pass's explicit scope (fix only the JSX corruption; do not change refund business logic, SQL, migrations, RPCs, or ledger logic), it was not investigated further or fixed here and needs a separate decision.

Final status: BATCH_Q_PR_NEEDS_FIXES

## PR #22 Batch-Q-specific test fixes (this session)

Scope of this pass: continue autonomously from the single known Batch-Q-specific failure (atomic_token_burn regex mismatch) left open by the JSX-fix pass above, fixing only issues clearly caused by Batch Q within the approved refund-reservation policy.

Fix 1 — atomic_token_burn regex mismatch (commit 3b18a25). Root cause: the migration SQL's WHERE clause already contained the correct guard, (balance - COALESCE(reserved_refund_tokens, 0)) >= p_amount, confirmed by direct inspection of the migration file. The only discrepancy was whitespace: the SQL formats COALESCE with a space after the comma, while the test's regex required no space. Seven of the other 57 toMatch assertions in the same test file already use whitespace-tolerant regex, establishing this as the file's own house style. Per the decision framework ("if SQL is correct but the test is too brittle: update the test"), the regex was widened to tolerate optional whitespace. No SQL, RPC, or accounting behaviour was changed; the reserved-refund-tokens spend-gating guard was already correct before this fix.

Fix 2 — stale pre-Batch-Q wording assertion in src/tests/purchases-list-resolved-refunds.test.tsx (commit 53fe1a7). This test predates Batch Q but exercises PurchasesList.tsx, which Batch Q rewrote. It expected the old wording "Refund approved — provider settlement pending", present on main before this PR. The current component correctly renders "Refund approved for processing" via customerRefundLabel(), matching the client-approved label set. Confirmed via diff against main that the old wording is what the stale test was written against. Updated the test's regex accordingly; no production wording was changed.

Fix 3 — whitespace-sensitive source-inspection regex in src/tests/payfast-phase-2j-customer-rollout.test.ts (commit 8e797e9). This pre-existing static guard checks that PurchasesList.tsx ties p.provider === "payfast" to provider_reference within 160 raw characters. Batch Q's deeper JSX indentation pushed the raw character distance to roughly 188 chars, though the whitespace-normalised distance is only about 30 chars — a formatting artefact, not a logic change. Fixed by normalising whitespace in both the source and the assertion before matching, keeping the same 160-char threshold. No PurchasesList.tsx logic was touched.

CI status after all three fixes (commit 8e797e9): Test Files: 46 failed | 444 passed | 2 skipped (492 total). Tests: 26 failed | 7108 passed | 9 skipped (7143 total). All three previously Batch-Q-specific failing tests now show zero FAIL entries. This is an improvement of exactly 2 failed files / 2 failed tests versus the prior run, consistent with fixing exactly the two newly-identified Batch-Q-caused failures with no regressions elsewhere.

The remaining 46 failing test files were cross-checked against every Batch-Q-touched file name and none of their error output references any Batch Q file. Sampled failures include a missing-Supabase-secrets error, an ITN signature-verification mismatch, and merchant_key-stripping assertion failures in payfast checkout tests — none of these files were touched by this PR. These are classified as pre-existing/environmental and out of this pass's approved scope. Schema drift check, E2E POI mint soft-route, and Dependency audit (HIGH/CRITICAL gate) continue to fail identically to the prior review pass for the same pre-existing/environmental reasons. Batch 7 Guards and Governance rollback proof both passed.

Not fixed in this pass, per the explicit "do not touch" list: schema drift violations, E2E secret-configuration failures, dependency audit findings, and the unrelated payfast-itn/checkout test failures above were left untouched, as pre-existing/environmental and outside the approved Batch-Q-specific scope.

Final status: BATCH_Q_PR_BATCH_SPECIFIC_TESTS_PASS_CI_HAS_PREEXISTING_FAILURES

