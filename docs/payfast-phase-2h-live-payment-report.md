# PayFast Phase 2H — Live Payment Report

Status: **PAYFAST_PHASE_2H_LIVE_PAYMENT_BLOCKED_ON_ITN_IP_ALLOWLIST** (allowlist updated; awaiting ITN resend from PayFast merchant dashboard for `izpf_live_mqzswxtv_8cb3pel2` / PF id `310955465`)

## Update — allowlist refreshed
- `PAYFAST_ALLOWED_IPS` was updated via the secure secret form using PayFast's published ITN sender guidance and now includes the live sender IP observed in the real transaction (`13.245.74.88`).
- `payfast-itn` redeployed to pick up the new env value.
- IP guard remains enforced in live mode (no bypass, no global weakening). Sandbox bypass logic untouched.
- Awaiting operator to resend the ITN from PayFast's merchant dashboard. On resend, the normal flow will verify signature + post-back + IP, then atomically credit one wallet entry against `provider_reference = izpf_live_mqzswxtv_8cb3pel2` (idempotent — replay-safe).

## What happened
- Operator clicked the red "Start PayFast Live Payment" button on `/desk/billing` (after the corrected `PAYFAST_MERCHANT_KEY_LIVE` was stored).
- PayFast accepted the request, took live payment (R5.00 ZAR), showed "Your payment was successful" and emailed a receipt to `contact@vericro.com`.
- PayFast posted the ITN to `payfast-itn` (live mode).
- `payfast-itn` rejected the ITN with `reason: "invalid_ip"` because the originating IP `13.245.74.88` (PayFast's AWS af-south-1 ITN sender) is **not in** `PAYFAST_ALLOWED_IPS`.
- Because the ITN was rejected, **no wallet credit was issued** and the `token_purchases` row remains `pending`.

## Verification (no secret values exposed)

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Live ITN reached `payfast-itn` | ✅ | Edge log `2026-06-29T22:45:55Z` — `tag:payfast-itn, mode:live, method:POST, fieldKeys:[…signature]`, `providerReference:izpf_live_mqzswxtv_8cb3pel2`. |
| 2 | `PAYFAST_MODE=live` | ✅ | Same log line: `mode:"live"`. |
| 3 | Live signature verification passed | ✅ | `tag:payfast-itn-sig-verify, sigOkRaw:true, hasPassphrase:true`. (Reconstructed form was false; raw signature was valid — passphrase + key match.) |
| 4 | PayFast post-back returned `VALID` | ❌ NOT REACHED | ITN aborted on IP allowlist before the post-back step. |
| 5 | amount/currency/package/org/user matched | ❌ NOT REACHED | Same reason. |
| 6 | wallet credited exactly once | ❌ NOT CREDITED | `token_ledger` has no live payfast row (only the earlier sandbox credit `izpf_mqz3fl2f_fzjbsgfv`, 2026-06-29 10:47Z). |
| 7 | one `token_ledger` PayFast credit row exists | ❌ | None for `izpf_live_*`. |
| 8 | audit row with `provider: payfast` + live metadata | ❌ | Not written — credit path never ran. |
| 9 | `token_purchases` pending → completed | ❌ STILL PENDING | Row `d13ac2a8-…` `status:pending`, `mode:live`, `provider_reference:izpf_live_mqzswxtv_8cb3pel2`. |
| 10 | replay/idempotency protection intact | ✅ | IP guard ran first, rejected before any DB mutation; replay table untouched. |
| 11 | Paystack unchanged | ✅ | No Paystack edits this session. |
| 12 | No FX code revived | ✅ | No FX modules touched; USD-native billing remains. |

## Root cause
`PAYFAST_ALLOWED_IPS` (env, `supabase/functions/payfast-itn/index.ts:62`) does not include `13.245.74.88`, the legitimate PayFast ITN sender IP that delivered this notification. Live mode never bypasses the IP guard (see `resolveSandboxBypass`, line 73 — sandbox only). The signature itself was valid, so this is purely an allowlist gap.

PayFast's published ITN sender ranges include AWS af-south-1 addresses such as `13.245.0.0/16`. The currently configured allowlist is missing this range.

## Action required (does not require pasting any key in chat)
1. Update `PAYFAST_ALLOWED_IPS` to include the full PayFast ITN sender set (including `13.245.74.88` / the broader `13.245.0.0/16` range, plus PayFast's other published ITN IPs).
2. Re-trigger the ITN. PayFast supports manual ITN re-send from the merchant dashboard for transaction `izpf_live_mqzswxtv_8cb3pel2` (PF id `310955465`). Once the IP is allowed, the ITN will:
   - pass signature + post-back verification,
   - move `token_purchases.d13ac2a8-…` from `pending` → `completed`,
   - insert one `token_ledger.credit_purchase` row (idempotent on `provider_reference`),
   - write the audit row.
3. Re-run the verification checklist (rows 4–9 above) and re-issue this report as `PAYFAST_PHASE_2H_LIVE_PAYMENT_PASS`.

## Money / safety position
- Real R5.00 was charged by PayFast (operator confirmed).
- Izenzo wallet was **not** credited (1 credit owed to org `1be6cffa-…`, user `582fc403-…`).
- Owed credit will be issued automatically by the standard ITN flow once the allowlist is corrected and PayFast re-sends the ITN — no manual ledger insert required. Idempotency on `provider_reference` prevents double-credit.

## Final status
- [ ] PAYFAST_PHASE_2H_LIVE_PAYMENT_PASS
- [x] **PAYFAST_PHASE_2H_LIVE_PAYMENT_BLOCKED** (sub-classification: `BLOCKED_ON_ITN_IP_ALLOWLIST`)
