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

## D. Operator hand-off

**Two distinct accounts — do not confuse them:**

| Account | Where it logs in | Purpose |
| --- | --- | --- |
| `joshtkruger@gmail.com` | Izenzo (`https://trade.izenzo.co.za`) | The human operator who clicks the sandbox test button. Already exists in `auth.users`, already holds `platform_admin` (plus `org_admin`, `org_member`). No signup or role grant needed. |
| `contact@vericro.com` | PayFast sandbox merchant dashboard (separate, not Izenzo) | The PayFast merchant identity. **Never used to sign in to Izenzo.** Already represented by the stored sandbox merchant credentials. |

james@izenzo.co.za is **not** used for this test.

### Operator steps (run as joshtkruger@gmail.com on Izenzo)

1. Open `https://trade.izenzo.co.za` and sign in as
   **`joshtkruger@gmail.com`**.
2. In the left menu, click **Billing**.
3. Scroll to the bottom of the Billing page. You will see an
   amber-bordered card titled **"PayFast Sandbox Test (Admin Only)"**.
   (If you do not see it, you are not signed in as that account —
   stop and tell us.)
4. Click **"Start PayFast Sandbox Test"**. A new browser tab opens on
   the PayFast sandbox payment page
   (`https://sandbox.payfast.co.za/eng/process`).
5. On the PayFast sandbox page, use the sandbox card details PayFast
   shows on screen, then click **"Complete Payment"** (or the green
   confirm button PayFast shows). You do **not** log in to PayFast —
   the sandbox merchant identity (`contact@vericro.com`) is already
   embedded in the form sent from Izenzo.
6. After payment, PayFast will redirect you back to
   `https://trade.izenzo.co.za/billing?payfast=return`. You should
   land on the Billing page with `?payfast=return` in the URL.
7. Reply back with exactly: **"Sandbox payment completed at <time>,
   reached the return page."** Do not paste card details or any URL
   fragment after a `#`.

After your reply we will:

- check the `payfast-itn` edge function logs for the inbound ITN POST;
- check `token_purchases` for the new sandbox row;
- check `token_ledger` / wallet balance for the single sandbox credit;
- check `audit_logs` for the corresponding entry;
- confirm exactly one credit landed (no double-credit).

If the PayFast sandbox page does not open, or you land on the cancel
page (`?payfast=cancel`), tell us — do not retry repeatedly, and do
not enter real card details anywhere.

---

Current status:
`PAYFAST_PHASE_2F_SANDBOX_ROUND_TRIP_READY_FOR_JOSHTKRUGER_ON_IZENZO`
