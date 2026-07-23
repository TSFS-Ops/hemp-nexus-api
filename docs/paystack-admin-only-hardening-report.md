# Paystack Admin-Only Hardening Report

Status: `PAYSTACK_ADMIN_ONLY_HARDENED_PR_READY`

Branch: `hardening/paystack-admin-only`

This report documents the hardening work applied following the
`PAYSTACK_ADMIN_ONLY_READINESS_AUDIT_COMPLETE_READY_FOR_HARDENING`
audit status. Product rule enforced throughout: PayFast is the only
customer-facing payment provider; Paystack remains admin-only /
internal / legacy and must stay hidden from normal customers.

## 1. Root cause

The prior audit found that Paystack's admin-only posture rested on a
single layer: `PaymentMethodPicker.tsx` hides the checkout button from
non-admins via `PAYSTACK_PUBLIC_ENABLED = false`. That is a UI
convenience, not a security boundary -- any authenticated user could
still call `POST /token-purchase` directly and start a real Paystack
checkout. Separately, the webhook's `charge.success` handler validated
amount/currency/package against the `credits.purchase_initiated`
**audit log** row, but never cross-checked the settlement against the
canonical `token_purchases` row itself. A webhook carrying
complete-looking metadata (a plausible `org_id` + `credits`) but with
no genuine backing purchase record would still have been credited.

## 2. Files changed

- `supabase/functions/token-purchase/index.ts` (182 insertions, 0
  deletions; two additive blocks, no existing lines removed or
  reordered elsewhere)
- `src/tests/paystack-admin-only-initiation-guard.test.ts` (new, 8
  tests)
- `src/tests/paystack-webhook-stored-purchase-validation.test.ts`
  (new, 8 tests)
- `docs/paystack-admin-only-hardening-report.md` (this file)

No changes were made to any PayFast file, `PaymentMethodPicker.tsx`,
`Billing.tsx`, wallet/ledger RPCs (`atomic_paid_credit_purchase`,
`atomic_token_credit`, `atomic_token_burn`), schema/migrations, or any
FX module.

## 3. Server-side admin-only guard (checkout initiation)

Location: `token-purchase/index.ts`, immediately after the existing
"Profile not found" check and before the billing-availability guard,
inside the `POST /token-purchase` (initiate) branch only.

Behaviour:
- Calls the existing `has_role(_user_id, _role)` SECURITY DEFINER RPC
  with `_role: "platform_admin"` -- the identical pattern already used
  by PayFast's admin-only sandbox gate
  (`payfast-checkout-sandbox/index.ts`). No new client-trusted role
  flag was invented.
- If the RPC call itself errors, the request fails closed with `503
  ADMIN_CHECK_FAILED` (never silently defaults to "allow").
- If the caller is not a platform admin, the request is rejected with
  `403 PAYSTACK_ADMIN_ONLY` / `code: "not_admin"`. Nothing is reserved
  or written except a best-effort `credits.purchase_initiation_blocked`
  audit row (wrapped in try/catch so an audit failure can never block
  the 403 response). No idempotency key is reserved, no Paystack API
  call is made, and no `token_purchases` row is inserted.
- If the caller is a platform admin, execution falls through unchanged
  into the existing billing-availability / billing-hold / demo-mode
  guards and initiation flow -- admin Paystack initiation still writes
  `provider='paystack'`, `provider_reference`, legacy
  `paystack_reference`, `amount_usd`, `currency='USD'`, `package_id`,
  `token_amount`, `status='pending'`, the `credits.purchase_initiated`
  audit row, and idempotency metadata exactly as before.
- Scope is initiation-only: `/verify`, `/webhook`, `/packages`, and
  `/entity` are all handled and returned earlier in the file and are
  completely unreached by this guard, so existing/in-flight Paystack
  transactions, refunds, and disputes are unaffected. PayFast has its
  own separate edge functions and is untouched.

## 4. Webhook success-path hardening (stored-purchase validation)

Location: `handleChargeSuccess`, after the existing edge-level
metadata validation and D-01 initiation-audit-row mismatch check, and
before the D-01 finalised-state idempotency check / the
`atomic_paid_credit_purchase` call.

Behaviour:
- Looks up the `token_purchases` row for the incoming reference, first
  by `provider_reference`, then by the legacy `paystack_reference`
  column (mirroring the existing Recovery-A lookup pattern).
- **Absence** of a row is not itself rejected -- pre-hardening
  historical settlements may legitimately lack one, and the existing
  missing-metadata / initiation-audit-row containment already covers
  that case.
- If a row **is** found, it must be consistent with the settlement
  about to be credited:
  - `provider` must be `"paystack"`.
  - `status` must be in the eligible set `{"pending", "completed"}`
    (`"completed"` is tolerated for idempotent replay -- the
    downstream finalised-state check still prevents a second credit;
    `"failed"`/other terminal states are rejected).
  - `token_amount` must equal the credited `credits`.
  - `org_id` and `user_id`, if present on the row, must match.
  - `currency` and `amount_usd`, if present on the row, must match the
    settlement's currency/USD amount.
- On any mismatch: no credit is issued, the purchase is not marked
  completed, a `credits.purchase_rejected` audit row and a deduped
  `high`-severity `admin_risk_items` row (`payment_stored_purchase_mismatch`)
  are written, and the handler returns normally (`200 OK` at the
  webhook level) -- identical shape to the existing
  `initiation_mismatch` and missing-metadata rejection branches, so
  Paystack does not retry-storm.
- HMAC-SHA512 signature verification, body-level replay protection,
  the `token_ledger.request_id` uniqueness guard, and the existing
  missing-metadata recovery / initiation-audit-row check are all
  unchanged.

## 5. Admin-only UI

No changes were needed or made. `PaymentMethodPicker.tsx` already
hides Paystack from normal customers (`PAYSTACK_PUBLIC_ENABLED =
false`) and marks it `[Admin only]` with `data-admin-only="true"` for
admins; this is already covered by the existing
`payfast-customer-only-view.test.tsx`, which continues to pass
unmodified.

## 6. Tests added/updated

New (16 tests total, both 100% passing in isolation):

- `src/tests/paystack-admin-only-initiation-guard.test.ts` -- proves
  the guard: uses `has_role`/`platform_admin`; rejects non-admins with
  403/`not_admin`; the rejection branch touches neither
  `idempotency_keys`, `token_purchases`, nor the Paystack API; writes
  a best-effort blocked-attempt audit row; fails closed (503) on a
  role-check error; sits before the billing-availability/hold/demo
  guards; is absent from the webhook/verify/packages/entity paths;
  and does not touch wallet/ledger crediting RPCs.
- `src/tests/paystack-webhook-stored-purchase-validation.test.ts` --
  proves the webhook validation: performs the provider_reference ->
  paystack_reference lookup; treats absence as non-fatal; rejects on
  provider/status/token_amount/org_id/user_id/currency/amount_usd
  mismatch; writes the rejected-audit + deduped high-severity risk
  item and returns (no throw); runs before the
  `atomic_paid_credit_purchase` call; does not weaken signature/replay/
  idempotency guards; preserves the existing missing-metadata and
  initiation-mismatch checks; introduces no FX/external FX API.

Existing test files that already cover the remaining required items
and were re-run (all pass) rather than duplicated: normal customers
cannot see Paystack / admin-only marking
(`payfast-customer-only-view.test.tsx`); PayFast initiation for normal
customers, and PayFast no-regression generally
(`payfast-checkout-phase-2c.test.ts`, `payfast-itn-phase-2b.test.ts`,
`payfast-phase-2c-no-regression.test.ts`, `payfast-phase-2d/2g/2j-*`);
Paystack verify remains safe for existing/in-flight transactions
(`paystack-verify-inconclusive-containment.test.ts`); duplicate
webhook/verify cannot double-credit and missing-metadata containment
(`paystack-webhook-missing-metadata-containment.test.ts`); provider
rejection releases idempotency
(`paystack-init-rejection-releases-idempotency.test.ts`); PayFast/
Paystack no-FX/no-regression baseline
(`payments-paystack-no-regression-phase1.test.ts`); admin revenue
reporting and purchase-history org scoping (the existing
admin-revenue-panel and purchase-history/list-org-purchases test
files matched by the broader run below).

## 7. Exact commands run and results

Environment: GitHub Codespace on branch `hardening/paystack-admin-only`,
Node v24.14.0, `npm install` (460 packages), Vitest v4.1.10.

**Command 1 -- narrow, pre-existing Paystack tests (regression check before any edit):**
```
npx vitest run src/tests/paystack-init-rejection-releases-idempotency.test.ts
```
Result (baseline, before any code change): 1 file, 5/5 passed.

**Command 2 -- narrow Paystack suite, after the code changes:**
```
npx vitest run src/tests/paystack-init-rejection-releases-idempotency.test.ts \
  src/tests/paystack-webhook-missing-metadata-containment.test.ts \
  src/tests/paystack-verify-inconclusive-containment.test.ts \
  src/tests/payments-paystack-no-regression-phase1.test.ts
```
Result: initial run 1 failed / 3 passed (39/40 tests) -- the one
failure was a self-inflicted false positive: a guard-comment referencing
the literal path `_shared/payments/payfast-checkout.ts` tripped
`payments-paystack-no-regression-phase1.test.ts`'s "no import from
_shared/payments/" regex, even though nothing was actually imported.
Fixed by rewording the comment. Re-run: **4 files passed, 40/40 tests
passed.**

**Command 3 -- new guard-specific tests:**
```
npx vitest run src/tests/paystack-admin-only-initiation-guard.test.ts \
  src/tests/paystack-webhook-stored-purchase-validation.test.ts
```
First run: 3 failed / 13 passed -- all 3 were bugs in my own new test
assertions (one over-broad "must not mention payfast" check that
collided with the guard's own explanatory comment, and two anchor/
index mistakes that searched for a substring that also occurs earlier,
in a docstring, before the real code it needed to isolate). All three
were fixed in the test files themselves (no production code changed
for this). Re-run: **2 files passed, 16/16 tests passed.**

**Command 4 -- broader PayFast regression set:**
```
npx vitest run src/tests/payfast-...   (13 PayFast test files)
```
Result both **before** my changes (verified via `git stash`) and
**after**: **3 failed / 10 passed (13 files), 3 failed / 207 passed
(210 tests)** -- identical failing tests in both cases:
`payfast-checkout-phase-2c.test.ts` ("successful sandbox initiation"),
`payfast-itn-phase-2b.test.ts` ("rejects an ITN whose signature does
not verify"), `payfast-phase-2c-no-regression.test.ts` ("helper strips
merchant_key from the returned form fields"). These are **pre-existing
environment-dependent failures in this Codespace** (most likely
missing PayFast sandbox merchant secrets), confirmed unrelated to this
change by re-running the identical three files against the unmodified
file (`git stash` / `git stash pop`) with the same result.

**Command 5 -- full payment/billing regression set (38-40 files matching
paystack|payfast|billing|purchase|credit|revenue|token|payment):**
```
npx vitest run $(ls src/tests | grep -iE 'paystack|payfast|billing|purchase|credit|revenue|token|payment' | sed 's#^#src/tests/#')
```
Result: **3 failed / 37 passed (40 files), 3 failed / 537 passed (540
tests)** -- the same 3 pre-existing PayFast-environment failures as
Command 4, zero new failures. Confirmed byte-for-byte identical
failure set both with and without this change applied.

**Not run:** the full repository-wide test suite (529 files under
`src/tests/`, plus Playwright e2e specs). This was judged out of scope
for a payment-hardening change touching a single edge function, and
running it was not practical within this session's time budget. The
executed 40-file / 540-test payment/billing set is, by file-content
match, the complete relevant regression surface for this change.

## 8. PayFast no-regression confirmation

Confirmed by direct comparison (`git stash` before/after): PayFast's
own test suite produces the **exact same** pass/fail counts and the
exact same 3 failing test names with and without this change applied.
No PayFast file was touched by this change (`git diff --stat` shows
only `token-purchase/index.ts` and two new test files). PayFast
checkout initiation, ITN handling, and no-regression coverage are
therefore confirmed unaffected.

## 9. Remaining limitations

- The 3 pre-existing PayFast test failures in this Codespace were not
  investigated or fixed -- they are outside this task's scope
  (admin-only Paystack hardening) and pre-date this change.
- The new guard's role check adds one additional RPC round-trip
  (`has_role`) to every Paystack initiation attempt, admin or not; this
  is the same cost PayFast's sandbox gate already accepts and was not
  benchmarked separately here.
- The webhook stored-purchase validation only activates when a
  `token_purchases` row is found; it does not retroactively harden
  settlements for references that predate the Batch C purchase-row
  insert and never got one. This mirrors the existing, accepted
  behaviour of the initiation-audit-row check for the same reason.
- This report and the underlying test runs were produced inside a
  fresh GitHub Codespace created for this task; no local terminal or
  pre-existing developer environment was used.

## 10. Controlled admin-only Paystack test recommended?

**Yes, recommended before relying on this in production.** Suggested
minimal scope: one platform-admin account performs a real Paystack
sandbox/test-key initiation end-to-end (initiate -> webhook
charge.success -> credit -> purchase history -> admin revenue), and
separately, one non-admin authenticated account attempts a direct
`POST /token-purchase` call and is confirmed to receive `403
not_admin` with no `token_purchases` row created. This would validate
the guard and the stored-purchase cross-check against a live Paystack
test transaction rather than source-text assertions alone.
