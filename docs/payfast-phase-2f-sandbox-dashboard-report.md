# PayFast Phase 2F — Controlled Sandbox Round-Trip Report

Status: **STILL BLOCKED — AWAITING THIRD ITN RESEND AFTER SECRET-NAME + SANDBOX-IP FIX**

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
| PayFast ITN ID | `1889141` |
| PayFast sandbox dashboard | Transaction = completed; ITN (after resend) = Completed / Success |

## 2. Original failure cause (first attempt)

PayFast → cURL Error / Pending QUEUE. The `payfast-itn` edge function
existed in source since Phase 2B but had **never been deployed** to the
platform. `POST .../functions/v1/payfast-itn` returned HTTP 404 at the
network layer, before any JWT/signature logic could run.

## 3. First fix — deployment

`payfast-itn` deployed via `supabase--deploy_edge_functions`. Direct
curl confirms the endpoint now returns HTTP 200 with
`{"ok":false,"decision":"rejected","reason":"missing_signature",...}`
when called with an unsigned body — i.e. reachable, parsing, and
rejecting safely. Operator then resent the ITN; PayFast UI flipped to
**Completed / Success** (PayFast only inspects the HTTP status, not the
body).

## 4. Izenzo-side verification after the resend

| Check | Result | Evidence |
| --- | --- | --- |
| ITN reached `payfast-itn`? | ✅ | Edge logs show fresh `booted` entry at 22:28:18 matching the resend time |
| Signature verified? | ❌ | `index.ts` read `PAYFAST_PASSPHRASE`, but the stored secret is `PAYFAST_PASSPHRASE_SANDBOX` → MD5 base mismatch |
| Validate post-back VALID? | n/a | Never reached |
| Amount/currency/package/org/user match? | n/a | Never reached |
| `atomic_paid_credit_purchase` called? | ❌ | 0 ledger rows for `request_id` containing `izpf_mqycj2cj_3bnxo2pa` |
| Wallet credited exactly once? | ❌ | `token_balances` for org `1be6cffa-…` still `268`, `updated_at = 2026-04-30` |
| `token_ledger` credit row? | ❌ | 0 rows |
| `audit_logs` rejection row? | ❌ | Insert wrapped in `try { ... } catch { /* swallow */ }`; likely failed silently on `entity_id` (uuid column) being given a text reference. Only the earlier `credits.purchase_initiated` row exists. |
| `token_purchases` row | ❌ Still `pending` | Row `5f40aede-0943-4ec2-b0c9-47f68f46b78b`, provider=`payfast`, provider_reference=`izpf_mqycj2cj_3bnxo2pa`, amount_usd=`0.00`, currency=`ZAR` |
| Replay protection intact? | ✅ (unexercised) | Code path unchanged |
| Purchase history renders as PayFast? | ✅ | `PurchasesList.tsx` provider fallback unchanged |

## 5. Second fix — secret-name + sandbox IP reconciliation

`supabase/functions/payfast-itn/index.ts`:

- `resolvePassphrase(mode)` — sandbox now reads
  `PAYFAST_PASSPHRASE_SANDBOX` first, falling back to
  `PAYFAST_PASSPHRASE`; live mode reads `PAYFAST_PASSPHRASE` first then
  `PAYFAST_PASSPHRASE_LIVE`. No secret value is ever logged.
- `resolveSandboxBypass(mode, allowedIps)` — sandbox skips the
  source-IP check when either `PAYFAST_SANDBOX_SKIP_IP_CHECK=true` OR
  the allowlist is empty (Phase 2F foundation). Live mode still **never**
  bypasses regardless of env.
- Redeployed.

## 6. Confirmations (unchanged)

- ✅ PayFast remains sandbox-only (`liveEnabled: false`,
  `select.ts` keeps `payfast: undefined`).
- ✅ No live PayFast credentials added.
- ✅ No customer-facing PayFast button — admin-gated card only.
- ✅ Paystack runtime unchanged.
- ✅ No FX code revived.

## 7. Next step

Operator to resend the same ITN from the PayFast sandbox dashboard
(three-dot Actions → Resend). After the resend we will re-run §4 and
flip the status accordingly.

Current status:
`PAYFAST_PHASE_2F_SANDBOX_ROUND_TRIP_BLOCKED_ON_ITN_SECRET_NAME_FIXED_AWAITING_THIRD_RESEND`
