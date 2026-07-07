# Batch Q — Provider-neutral refund reservation and settlement finalisation

Status at time of writing: **BATCH_Q_REFUND_POLICY_IMPLEMENTED_PENDING_CI_AND_RUNTIME_VERIFICATION**

Branch: `batch-q-refund-reservation-settlement`

## 1. Phase 1 inspection correction (carried forward)

The original Batch Q framing assumed Paystack had been superseded by PayFast. Phase 1 read-only inspection corrected this: **PayFast and Paystack are both live and coexisting.** PayFast is primary/preferred for the customer journey per client decision, but Paystack purchases and Paystack refund-webhook settlement remain fully live and are preserved unchanged by this batch. This is documented in `docs/payfast-phase-2j-customer-rollout-report.md`, whose "Remaining limitations" section 9 explicitly scopes automated PayFast refund-status checking as a future "Phase 2K" item, not something present in the codebase today.

## 2. Client questionnaire decision implemented

Admin approval of a refund means "approved for refund processing" only. Credits are reserved (held) at approval, not finally deducted. Final deduction happens only when a payment provider confirms successful settlement (existing Paystack webhook path, unchanged) or an authorised admin records a manual offline settlement with reason, reference, timestamp, admin identity and an audit/governance entry. Settlement mismatches always go to manual review; nothing is auto-refunded, auto-credited, or finally deducted on a mismatch.

## 3. Schema / migration changes

New migration: `supabase/migrations/20260707140000_batch_q_refund_reservation_settlement.sql` (additive only). Adds `token_balances.reserved_refund_tokens` (spendable balance = balance − reserved_refund_tokens); a new `token_refund_reservations` table (one row per refund_request_id, status active/consumed/released, RLS enabled, service_role only); `refund_requests.reservation_id` and `refund_requests.final_ledger_id` linkage columns; and widens `token_ledger_action_type_check` by exactly one new value, `refund_hold`, needed for the zero-value hold-marker ledger row written at approval (this was a bug caught and fixed during self-review — the constraint did not originally allow it).

## 4. RPC / function changes

`approve_refund()` — no longer finally deducts `token_balances.balance`. Computes a reserve amount (`GREATEST(0, LEAST(credits_at_request, available))`), creates/confirms a `token_refund_reservations` row (idempotent via `ON CONFLICT (refund_request_id) DO NOTHING`, with a concurrent-race fallback), increments `reserved_refund_tokens`, writes a `token_ledger` row with `action_type='refund_hold'` and `tokens_burned=0` as a pure audit marker (not a deduction), and sets `provider_settlement_status='not_submitted'` exactly as before. Duplicate-approval replay is handled explicitly and returns the existing reservation rather than re-reserving. Tolerates a missing `token_balances` row (treated as balance=0) rather than introducing a new hard-failure mode — this matches the pre-Batch-Q function's silent tolerance and was required to keep the existing live-DB proof `supabase/tests/batch_f2_atomic_refund_proof.sql` passing.

`atomic_token_burn()` — one surgical change: the spend-gating WHERE clause now excludes `reserved_refund_tokens` from spendable balance (`(balance - COALESCE(reserved_refund_tokens,0)) >= p_amount`). The billing-hold check, ledger insert and governance-emission signature are preserved verbatim from the currently-deployed function.

`mark_refund_provider_settled()` — preserves its existing idempotency (dedupe on `provider_refund_reference`) and conflict-detection (`REFUND_SETTLEMENT_CONFLICT` → `admin_risk_items`) verbatim. Adds: a legacy-row fallback for refunds approved before this migration (`reservation_id IS NULL` ⇒ record settlement confirmation only, no second deduction, since the old immediate-deduction behaviour already moved the credits at approval time); a best-effort currency cross-check against `token_purchases.currency` that opens an `admin_risk_items` row (`refund_settlement_mismatch`) and returns `REFUND_SETTLEMENT_MISMATCH` without moving money on mismatch; and, on success, consumes the reservation and performs the final deduction exactly once, writing the closing `token_ledger` row with `action_type='refund'`.

`mark_refund_manually_settled_with_governance()` — preserves its existing governance/hash-chain/idempotency logic verbatim (authorised admin id, notes ≥ 20 chars, hash-chained `admin.hq_decision_recorded` event). Adds reservation consumption plus the final deduction (same pattern as the provider-settled path) when a reservation exists; skips the second deduction for legacy pre-Batch-Q rows with no reservation.

`surface_unsettled_refunds()` — wording-only change (risk-item description now says credits are "held in reserve pending settlement" rather than "reversed in-platform"); dedup/open/auto-resolve logic is unchanged.

All new/changed functions keep the existing `REVOKE ALL ... FROM PUBLIC, anon, authenticated` / `GRANT ... TO service_role` lockdown pattern. The new `token_refund_reservations` table has RLS enabled with all grants revoked from anon/authenticated (service_role only).

## 5. Reservation / hold mechanism

`token_refund_reservations`: one row per `refund_request_id` (unique index), `status ∈ {active, consumed, released}`. Created/confirmed at admin approval; prevents the customer from spending reserved credits (enforced by the `atomic_token_burn` WHERE-clause change); is not a final deduction; is idempotent on duplicate approval attempts; never reserves more than the currently available balance; is consumed exactly once, by whichever settlement path (provider-confirmed or manual) closes it out first.

## 6. Before / after state machine

**Before:** `approve_refund` → immediately and finally decremented `token_balances.balance` and wrote a final `token_ledger` refund row. `provider_settlement_status` was a pure tracking label that did not gate the deduction. `mark_refund_provider_settled` / `mark_refund_manually_settled_with_governance` explicitly did not touch balances/ledger (per their own SQL comments), assuming the deduction had already happened at approval.

**After:** `approve_refund` → reserves credits only (`reserved_refund_tokens` += amount; `balance` unchanged; zero-value `refund_hold` audit marker written). Final deduction moves to whichever settlement path closes the reservation: `mark_refund_provider_settled` (Paystack webhook, existing call site unchanged) or `mark_refund_manually_settled_with_governance` (admin action, now the only close-out path for refunds without a provider webhook, e.g. PayFast today).

## 7. Provider-specific handling

**Paystack** — webhook settlement is unchanged: `token-purchase/index.ts`'s Paystack refund webhook handler continues to call `mark_refund_provider_settled` exactly as before; only the effect of that call changed (it now performs the final deduction instead of a no-op confirmation).

**PayFast** — no automated refund-status check exists in this codebase (confirmed in Phase 1; see `docs/payfast-phase-2j-customer-rollout-report.md` §9). This batch does **not** fabricate one. PayFast refunds are completed via the authorised manual-offline-settlement path (`mark_refund_manually_settled_with_governance`) until a real PayFast refund-status integration exists (tracked as a future Phase 2K item). A fail-closed constant, `PAYFAST_REFUND_STATUS_CHECK_NOT_IMPLEMENTED`, was added to `supabase/functions/_shared/dec-007-policy.ts` so that any future code path that would otherwise need to call a live PayFast refund-status check has an explicit, honest, fail-closed value to return instead of fabricating success.

## 8. Wording changes

New `CUSTOMER_REFUND_LABELS` SSOT in `src/lib/policy/dec-007-refund-policy.ts` (mirrored in the Deno shared policy): "Refund requested", "Refund approved for processing", "Awaiting provider confirmation", "Refund completed", "Refund requires admin review", plus the pre-existing "Refund declined" / "Refund superseded". A new `customerRefundLabel(requestStatus, providerSettlementStatus)` helper in `src/lib/policy/refund-settlement.ts` reads **both** fields, so a provider-settled or manually-settled refund now correctly shows "Refund completed" instead of getting stuck on an approval-only label forever (the exact regression named in the task). `PurchasesList.tsx` was updated to use this helper and to remove the hardcoded "(Paystack)" wording from its tooltip, which previously appeared even on PayFast rows — the tooltip is now provider-neutral by default and only names PayFast/Paystack specifically when the row genuinely belongs to that provider. The `DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER` was also corrected: it previously (accurately, pre-Batch-Q) said manual settlement "does NOT move money and does NOT change credits or the token ledger" — this is no longer true under Batch Q, since manual settlement is now the close-out step that performs the final deduction, so the disclaimer was rewritten to say it does not call Paystack/PayFast but does finally deduct the reserved credits and write the closing ledger entry. A new `DEC_007_BATCH_Q_APPROVAL_DISCLAIMER` explains the reservation-not-final-deduction distinction to admins at approval time.

## 9. Tests run and results

No local/CI test execution is available in this session (browser-only tool access; no terminal). The following were added/updated and are expected to run under the existing Vitest/Deno CI pipeline once pushed:

- `src/tests/batch-q-refund-reservation-settlement.test.ts` (new) — static source-inspection guard pinning the migration SQL's reservation mechanism, approve/settle/manual-settle behaviour, the token_ledger_action_type_check widening, the missing-token_balances-row tolerance fix, the atomic_token_burn WHERE-clause change, and the PayFast fail-closed adapter-gap constant.
- `src/tests/refund-settlement-status-ssot.test.ts` (updated) — fixed two assertions that were made false by the corrected, more honest `DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER` text; added coverage for `REFUND_RESERVATION_STATUSES` and the new `customerRefundLabel()` helper, including an explicit regression test proving a provider-settled refund no longer gets stuck on an approval-only label.
- `supabase/tests/refund_provider_settlement_proof.sql` (updated, live-DB proof) — this file's Test C and Test E previously asserted that `mark_refund_provider_settled` / `mark_refund_manually_settled_with_governance` left `token_balances.balance` **unchanged**, which was true pre-Batch-Q and is now intentionally false (these are exactly where the final deduction now happens). Updated to assert the correct new behaviour: the first settlement call deducts exactly the reserved amount once, and the deduped retry does not deduct again.
- `supabase/tests/batch_f2_atomic_refund_proof.sql` (not modified) — verified compatible. This live-DB proof seeds a refund with `credits_at_request=0` and **no** `token_balances` row, which is exactly the edge case that required the missing-row-tolerance fix in section 4 above; without that fix this proof would have failed with a new `TOKEN_BALANCE_NOT_FOUND` error it does not expect.
- `src/tests/admin-refund-wiring.test.ts`, `src/tests/admin-refund-mark-settled-wiring.test.ts`, `src/tests/r2-refund-request-ui-wiring.test.ts` (not modified) — inspected and confirmed compatible; none of their assertions reference the balance-mutation timing this batch changes, and the `PurchasesList.tsx` wording/wiring assertions they check (Request refund button, pending-state rendering, `list-org-purchases` invocation, no direct Paystack/PayFast calls, no admin-approve/decline calls from the org-side UI) all still hold after the wording fix in section 8.
- `supabase/functions/_shared/governance-atomicity-batch1_test.ts` (not modified) — reads a different, untouched migration file by fixed path; confirmed the `atomic_token_burn(uuid, integer, text, text, jsonb)` signature this batch preserves matches exactly what that Deno test pins.

CI has not yet run against this branch/PR at the time of writing this evidence file.

## 10. Known caveats

- No terminal/CI execution capability in this session — none of the above tests, old or new, have actually been executed by the author of this batch. Correctness has been established by careful static cross-reference against every SQL/TS file this migration touches or that touches the same tables/columns, not by running the suite.
- PayFast refund settlement remains manual-offline-only; a real PayFast refund-status integration is out of scope for this batch (tracked as future Phase 2K).
- The reservation mechanism does not implement an explicit "released on decline" path beyond the existing guarantee that decline/blocked/superseded refunds never reach `approve_refund` in the first place (a refund_request can only be approved once from `pending`; declined/blocked/superseded rows never get a reservation). No case was found in the current schema where an *already-reserved* refund needs to be released without being settled, so no separate `release_refund_reservation` RPC was added — flagging this explicitly in case reviewers know of a workflow (e.g. an "undo approval" admin action) that would need it.
