# PayFast Phase 2F — Unblocker Report

Status: **UNBLOCKER APPLIED — READY FOR HUMAN SANDBOX RUN**
PayFast remains sandbox-only and admin-only. Paystack unchanged. No
live PayFast credentials introduced. No FX revival.

---

## A. Files changed

| File | Change |
| --- | --- |
| `supabase/functions/payfast-checkout-sandbox/index.ts` | Secret-name reconciliation. Reads stored names (`PAYFAST_MERCHANT_ID_SANDBOX`, `PAYFAST_MERCHANT_KEY_SANDBOX`, `PAYFAST_PASSPHRASE_SANDBOX`, `PAYFAST_RETURN_URL`, `PAYFAST_CANCEL_URL`, `PAYFAST_NOTIFY_URL`) first; falls back to the older `PAYFAST_SANDBOX_*` style. No secret value is ever logged or returned. |
| `src/components/desk/billing/PayfastSandboxTestButton.tsx` | New admin-only "Start PayFast Sandbox Test" button. Returns `null` when viewer is not `platform_admin`. Posts `{ provider:"payfast", mode:"sandbox", packageId:"single" }` to `payfast-checkout-sandbox`, then auto-submits the returned form to PayFast's sandbox URL in a new tab. |
| `src/pages/Billing.tsx` | Mounts `<PayfastSandboxTestButton />` at the bottom of the billing page. Hidden for everyone except `platform_admin`. |
| `src/tests/payfast-phase-2b-no-regression.test.ts` | Allowlist: add the new admin-only button + Billing.tsx (admin-only is not "customer-facing"). |
| `src/tests/payfast-phase-2c-no-regression.test.ts` | Same allowlist update. |
| `src/tests/payfast-phase-2d-no-regression.test.ts` | Same allowlist update. |

## B. Tests run

| Suite | Tests | Result |
| --- | --- | --- |
| `payfast-phase-2b-no-regression` | 16 | ✅ pass |
| `payfast-phase-2c-no-regression` | 15 | ✅ pass |
| `payfast-phase-2d-no-regression` | 12 | ✅ pass |
| **Total** | **43** | **✅ all pass** |

These guards prove, on every run:

- PayFast `liveEnabled: false` in `_shared/payments/payfast.ts`;
- `select.ts` keeps `payfast: undefined` in the live registry;
- the sandbox checkout helper still rejects unless `mode === "sandbox"`;
- the helper strips `merchant_key` from returned form fields;
- no helper imports `_shared/fx.ts` (FX still inert);
- no helper reads `PAYSTACK_*` secrets;
- Paystack settles in USD with `fx_basis: "native_usd"` and still uses `PAYSTACK_SECRET_KEY` and HMAC SHA-512;
- the only `src/` files that mention PayFast are the explicit allowlist (display fallback, admin-only sandbox button, Billing host page, generated types).

## C. Confirmations

- ✅ PayFast remains sandbox-only.
- ✅ No live PayFast credentials added.
- ✅ No customer-facing PayFast checkout exists — the new button renders `null` unless `isAdmin === true`, is labelled "Admin Only" and "Sandbox / Test only", and lives below the Paystack-only purchase UI.
- ✅ Paystack runtime unchanged (no edit to `token-purchase` or `paystack-webhook`).
- ✅ No FX code revived.
- ✅ Secret-name reconciliation works without touching stored secret values.
- ✅ Missing sandbox credentials still fail safely — `merchantId`/`merchantKey` resolve to `""` and the helper rejects in `buildPayfastSandboxCheckout`.
- ✅ Normal customers cannot trigger PayFast — server-side gate requires `gateEnabled && isPlatformAdmin && mode === "sandbox"`, regardless of any client tampering.
- ✅ Return/cancel pages do **not** credit; only verified ITN credits via `payfast-itn` and `atomic_paid_credit_purchase`.

## D. Operator hand-off (for contact@vericro.com)

**Status check (run this turn):** `contact@vericro.com` does **not yet
exist** in `auth.users` and therefore holds no roles. Until an auth
user exists for that email, the sandbox button cannot render for them
and the edge-function role gate will reject the call as
`unauthenticated`. The earlier draft of this report named
james@izenzo.co.za only as a fallback; per current instruction we are
NOT using james for this test.

### Role required

The existing `payfast-checkout-sandbox` edge function gates on:

```ts
has_role(user_id, 'platform_admin')
```

That literal is the *only* role the gate accepts. There is no narrower
"sandbox-tester" role today, so for this single controlled sandbox
round-trip `contact@vericro.com` needs `platform_admin`. Adding a
narrower role would require changing the gate in
`payfast-checkout-sandbox/index.ts` and re-running the guard suite —
out of scope for this unblocker.

### Two-step hand-off

**Step 1 — operator creates the auth user (one-time, ~1 minute):**

1. Open `https://trade.izenzo.co.za/auth` in a private browser window.
2. Choose **Sign up**.
3. Enter email **`contact@vericro.com`** and a strong password.
4. Confirm the verification email if the app sends one.
5. Reply back with exactly: **"contact@vericro.com signup complete"**.

**Step 2 — platform grants the minimum role (done by us, once Step 1
confirms):** a single-row insert into `public.user_roles`
(`user_id = <contact@vericro.com>`, `role = 'platform_admin'`) via the
migration tool. No password or PII is touched. We will confirm in
chat when the role is live.

**Step 3 — operator runs the sandbox payment:**

1. Sign in to `https://trade.izenzo.co.za` as **contact@vericro.com**.
2. Click **Billing** in the left menu.
3. Scroll to the bottom. You will see an amber-bordered card titled
   **"PayFast Sandbox Test (Admin Only)"**. If you do not see it,
   stop and tell us — the role grant has not propagated yet.
4. Click **"Start PayFast Sandbox Test"**. A new browser tab opens on
   the PayFast sandbox payment page
   (`https://sandbox.payfast.co.za/eng/process`).
5. On the PayFast sandbox page, use PayFast's published sandbox card
   details (PayFast shows them on screen). Click **"Complete Payment"**
   (or the equivalent green confirm button PayFast shows).
6. After payment, PayFast will redirect you back to
   `https://trade.izenzo.co.za/billing?payfast=return`. You should
   land on the Billing page with `?payfast=return` in the URL.
7. Reply back with exactly: **"Sandbox payment completed at <time>,
   reached the return page."** Do not paste any card details or any
   URL fragments after a `#`.

After Step 3 reply we will:

- check the `payfast-itn` edge function logs for the inbound ITN POST;
- check `token_purchases` for the new sandbox row;
- check `token_ledger` / wallet balance for the single sandbox credit;
- check `audit_logs` for the corresponding entry;
- confirm exactly one credit landed (no double-credit).

If the PayFast sandbox page does not open, or you land on the cancel
page (`?payfast=cancel`), tell us — do not retry repeatedly, and do
not enter real card details anywhere.

james@izenzo.co.za is intentionally **not** used for this test.

---

Current status:
`PAYFAST_PHASE_2F_AWAITING_CONTACT_AT_VERICRO_SIGNUP_BEFORE_ROLE_GRANT`
