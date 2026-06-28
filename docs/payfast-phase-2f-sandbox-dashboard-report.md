# PayFast Phase 2F — Controlled Sandbox Round-Trip Report

Status: **BLOCKED — PAYFAST SANDBOX ITN NEVER REACHED IZENZO**

PayFast remains sandbox/admin-only. No live credentials added, no
customer-facing surface exposed, no Paystack change, no FX revival.

---

## 1. Human-side result (PayFast sandbox dashboard)

Operator: `joshtkruger@gmail.com` (Izenzo) using sandbox merchant
identity `contact@vericro.com` (PayFast).

| Field | Value |
| --- | --- |
| Date | 2026-06-29 |
| Item | Izenzo Credits — 1 Credit (Sandbox) |
| Gross | R20.00 |
| PayFast m_payment_id | `izpf_mqycj2cj_3bnxo2pa` |
| PayFast sandbox dashboard | shows payment as completed |

## 2. Izenzo-side verification (queried directly)

| Check | Result | Evidence |
| --- | --- | --- |
| ITN received by `payfast-itn`? | ❌ **No** | No edge-function logs for `payfast-itn` in the 24h window; the function `list-org-purchases` and `payfast-checkout-sandbox` log normally in the same window, so this is specific to PayFast not POSTing. |
| Signature verification pass? | n/a | No ITN to verify. |
| PayFast validate-postback VALID? | n/a | Never invoked. |
| Amount/currency/package/org/user match? | n/a | Never invoked. |
| `atomic_paid_credit_purchase` called? | ❌ No | 0 ledger rows for `request_id = 'izpf_mqycj2cj_3bnxo2pa'`. |
| Wallet credited exactly once? | ❌ No | `token_balances` for org `1be6cffa-d1d2-425e-b190-5c42ef14a8f0` still `268`, `updated_at = 2026-04-30` — unchanged. |
| `token_ledger` credit row created with PayFast reference? | ❌ No | 0 rows. |
| `audit_logs` row with provider `payfast` for the credit? | ❌ No | Only the `credits.purchase_initiated` row from checkout-init exists. |
| `token_purchases` row moved from pending → completed? | ❌ No | Row `5f40aede-…` still `status = pending`, reference `payfast_sandbox::izpf_mqycj2cj_3bnxo2pa`. |
| Duplicate/replay protection intact? | ✅ (unexercised) | Idempotency guard code unchanged; nothing has been credited so there is nothing to double-credit. |
| Purchase history renders as PayFast (not Paystack)? | ✅ | `PurchasesList.tsx` provider fallback maps `payfast_sandbox::*` references to "PayFast (sandbox)" regardless of credit state. |

## 3. Diagnosis

PayFast's sandbox accepted the card payment and recorded it in the
merchant dashboard, but PayFast never POSTed an ITN to
`https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/payfast-itn`.

The form we send already includes `notify_url`, but PayFast sandbox
typically only emits ITNs when the **Notify URL is also saved in the
sandbox merchant dashboard** (Settings → Integration). With no Notify
URL stored on the PayFast side, the per-transaction `notify_url` field
is commonly ignored. This is a PayFast configuration gap on the
sandbox merchant account, not an Izenzo code defect.

## 4. Classification

**BLOCKER for Phase 2F.** Round-trip cannot be declared observed until
an ITN actually lands and credits the wallet exactly once.

- Not a `must-fix` against code — no code change is required.
- Not `can-defer` — Phase 2F's whole purpose is the round-trip.

## 5. Operator unblock steps

1. Sign in to the **PayFast sandbox merchant dashboard** as
   `contact@vericro.com`.
2. Settings → Integration → set **Notify URL** to:
   `https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/payfast-itn`
3. Save.
4. Either (a) open the existing `izpf_mqycj2cj_3bnxo2pa` transaction
   and click **"Resend ITN"**, or (b) run a fresh sandbox payment via
   the admin-only "Start PayFast Sandbox Test" button.
5. Reply: **"ITN resent"** (or "fresh sandbox payment completed").
6. We will then re-run the §2 checks and re-classify this report.

## 6. Confirmations (unchanged)

- ✅ PayFast remains sandbox-only (`liveEnabled: false`, `select.ts`
  keeps `payfast: undefined`).
- ✅ No live PayFast credentials added.
- ✅ No customer-facing PayFast button — admin-gated card only.
- ✅ Paystack runtime unchanged.
- ✅ No FX code revived.

## 7. Phase 2G — Live Readiness (NOT started)

Recommendation: **do not begin Phase 2G** until §2 is fully green. Once
ITN, ledger, balance, audit, and `token_purchases.status = completed`
are all observed for a sandbox payment, Phase 2G can begin with:

1. Collect live PayFast `merchant_id`, `merchant_key`, `passphrase` via
   the secure secret form only (never pasted in chat).
2. Configure live PayFast dashboard URLs (notify/return/cancel) — same
   three URLs, against the live merchant account.
3. Keep the live PayFast button hidden from normal customers (extend
   the existing admin-only gate; do not surface in `select.ts`).
4. Run **one** very small admin-only live payment as a smoke test.
5. Confirm the live ITN credits the wallet exactly once.
6. Remove/hide the temporary admin-only live test button.
7. Only then decide when to expose PayFast to customers.

Current status:
`PAYFAST_PHASE_2F_SANDBOX_ROUND_TRIP_BLOCKED_ON_PAYFAST_NOTIFY_URL`
