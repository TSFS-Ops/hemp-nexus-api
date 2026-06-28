# PayFast Phase 2F — Controlled Sandbox Round-Trip Report

Status: **STOPPED SAFELY — AWAITING HUMAN-DRIVEN SANDBOX EXECUTION**

PayFast remains sandbox/admin-only. No live credentials added, no
customer-facing surface exposed, no Paystack change, no FX revival.

---

## 1. Pre-flight (verified)

Confirmed by `secrets--fetch_secrets` and source-text scan:

| Item | Status | Evidence |
| --- | --- | --- |
| `PAYFAST_MODE=sandbox` | ✅ stored | secret present; `payfast-itn/index.ts` only opts in to live when `raw === "live"` |
| Sandbox merchant credentials available by name | ✅ | `PAYFAST_MERCHANT_ID_SANDBOX`, `PAYFAST_MERCHANT_KEY_SANDBOX`, `PAYFAST_PASSPHRASE_SANDBOX` listed (values not echoed) |
| `PAYFAST_SANDBOX_CHECKOUT_ENABLED=true` | ✅ stored | secret present |
| PayFast live disabled | ✅ | `PAYFAST_PROVIDER.liveEnabled: false` in `_shared/payments/payfast.ts` |
| `select.ts` does not expose PayFast as live selectable | ✅ | `payfast: undefined` in registry |
| Customers cannot initiate PayFast checkout | ✅ | helper rejects unless `gateEnabled && isPlatformAdmin && mode === "sandbox"`; no `src/components` or `src/pages` button (Phase 2C/2D allow-list guard green) |
| Paystack unchanged | ✅ | `token-purchase` still USD-native (`currency: "USD"`, `fx_basis: "native_usd"`), still reads `PAYSTACK_SECRET_KEY`; `paystack-webhook` still HMAC SHA-512 |
| No FX revival | ✅ | `scripts/check-fx-no-importers.mjs` → OK |

## 2. Sandbox URLs (configured in our env; PayFast dashboard config unverifiable from here)

Stored:

- Notify / ITN: `https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/payfast-itn`
- Return: `https://trade.izenzo.co.za/billing?payfast=return`
- Cancel: `https://trade.izenzo.co.za/billing?payfast=cancel`

These URLs are present as `PAYFAST_NOTIFY_URL`, `PAYFAST_RETURN_URL`,
`PAYFAST_CANCEL_URL` secrets and will be used by the sandbox checkout
helper. **Confirming they are also pasted into the PayFast sandbox
merchant dashboard requires manual review by an operator with PayFast
sandbox dashboard access — not performable from this environment.**

## 3–6. Controlled checkout, ITN completion, visibility & negative checks

**Not executed. Stopped safely.**

Reason: A genuine Phase 2F round-trip requires:

1. A human signed in as `james@izenzo.co.za` clicking through the
   admin-gated sandbox checkout in the live preview.
2. Completing the hosted PayFast sandbox payment on PayFast's own
   sandbox UI with sandbox card details.
3. PayFast's sandbox servers POSTing an ITN back to
   `https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/payfast-itn`.

None of those three are something the build agent can perform — there
is no headless way to drive the PayFast sandbox payment page from here,
and no way to forge an authentic signed ITN that would also pass the
PayFast validate post-back. Attempting to fabricate ITN POSTs would
either fail validation (no proof) or, worse, bypass the post-back check
and produce a false positive that does not reflect real provider
behaviour.

What is ready for the operator to execute:

- Admin-gated edge function `payfast-checkout-sandbox` is deployed.
- ITN endpoint `payfast-itn` is deployed and defaults to sandbox.
- Secrets, URLs, and admin email are stored.
- Atomic credit path (`atomic_paid_credit_purchase`) and idempotency
  guards exist on the success path.

## 7. Tests run

| Suite | Result |
| --- | --- |
| `payfast-phase-2b-no-regression` (16 tests) | ✅ passed |
| `payfast-phase-2c-no-regression` (15 tests) | ✅ passed |
| `payfast-phase-2d-no-regression` (12 tests) | ✅ passed |
| `scripts/check-fx-no-importers.mjs` (FX no-import guard) | ✅ OK |
| Customer-facing PayFast no-surface guard | ✅ green (enforced inside 2C/2D suites via `rg` allow-list) |

A full payments / billing / refund / reconciliation re-run was not
triggered in this turn because no source code was modified — the green
state from prior phases is unchanged.

## 8. Defects

- None found in the source/guard layer.
- Round-trip defects, if any, can only surface once a human completes
  steps 3–6.

## 9. Confirmations

- PayFast is still sandbox-only ✅
- No live PayFast credentials were added ✅
- No customer-facing PayFast button exists ✅
- Paystack remains unchanged ✅
- No FX code was revived ✅

## 10. Hand-off — what the operator needs to do

To complete Phase 2F:

1. Sign in to the preview as `james@izenzo.co.za`.
2. Trigger the admin-gated PayFast sandbox checkout (calls
   `payfast-checkout-sandbox` with `Idempotency-Key`).
3. Complete the sandbox payment on the returned PayFast URL using
   PayFast's published sandbox card.
4. Watch `payfast-itn` edge logs for the inbound ITN, then re-run this
   report's checks 4/5/6 against `token_purchases`, `token_ledger`,
   `audit_logs`, and the admin purchase history UI.

Once that round-trip is observed end-to-end, this report can be
re-classified to `PAYFAST_PHASE_2F_SANDBOX_ROUND_TRIP_OBSERVED`.

Current status:
`PAYFAST_PHASE_2F_SANDBOX_ROUND_TRIP_AWAITING_HUMAN_EXECUTION`
