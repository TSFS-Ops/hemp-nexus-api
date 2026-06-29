# PayFast Phase 2H — Live Payment Report

Status: **PAYFAST_PHASE_2H_LIVE_PAYMENT_PASS**

Newest live transaction verified end-to-end: `provider_reference = izpf_live_mqzu2114_ly0374gk` (PF id `310957929`).

## Verification — newest live PayFast payment

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Live ITN reached `payfast-itn` | ✅ | Edge log `2026-06-29T23:13:26Z` — `tag:payfast-itn, mode:live, method:POST, providerReference:izpf_live_mqzu2114_ly0374gk, decision:credited`. |
| 2 | `PAYFAST_MODE=live` | ✅ | Same log line: `mode:"live"`. |
| 3 | Raw-body signature verification passed | ✅ | `tag:payfast-itn-sig-verify, sigOkRaw:true, hasPassphrase:true`. |
| 4 | Source IP accepted by `PAYFAST_ALLOWED_IPS` | ✅ | `remoteIp:"13.245.74.88"`, ITN not rejected on IP guard; decision proceeded to `credited`. |
| 5 | PayFast post-back returned `VALID` | ✅ | ITN reached `decision:"credited"` — credit path only runs after post-back `VALID`. |
| 6 | amount/currency/package/org/user matched | ✅ | `token_purchases.d0630799-…` matched and moved to `completed`; org `1be6cffa-…`, currency `ZAR`, 1 credit, provider `payfast`. |
| 7 | Wallet credited exactly once | ✅ | `token_balances` for org `1be6cffa-…` now `270` (was 269); single ledger row written. |
| 8 | Exactly one `token_ledger` PayFast credit row | ✅ | `count = 1` for `metadata.provider_reference = izpf_live_mqzu2114_ly0374gk` (`action_type:credit_purchase, provider:payfast, mode:live`, row `e3272f96-…`). |
| 9 | Audit row with `provider:payfast` + live metadata | ✅ | `audit_logs` rows `c1afb037-…` (`credits.purchase_initiated`) and `d41f7a42-…` (`credits.purchased`), both `provider:payfast, mode:live`. |
| 10 | `token_purchases` pending → completed | ✅ | Row `d0630799-afb8-44f4-9e6c-65bca2d5d575`, `status:completed`, `updated_at 2026-06-29 23:13:26Z`. |
| 11 | Replay/idempotency protection intact | ✅ | Credit keyed on `provider_reference`; only one ledger row exists. Replay guard untouched. |
| 12 | Paystack unchanged | ✅ | No Paystack edits this session. |
| 13 | No FX code revived | ✅ | No FX modules touched; USD-native billing preserved (ZAR amount captured on PayFast side only). |

## Earlier R5 live payment (separate note)

- `provider_reference = izpf_live_mqzswxtv_8cb3pel2` (PF id `310955465`).
- **Paid in PayFast but not credited in Izenzo because the live IP/ITN setup was not complete at the time** — ITN was rejected on the IP allowlist before the credit path ran (`reason: invalid_ip`, source `13.245.74.88` not yet in `PAYFAST_ALLOWED_IPS`).
- No wallet credit was issued and no manual ledger insert was performed. If recovery is wanted, resend the ITN from the PayFast merchant dashboard — the now-corrected allowlist will let the normal flow credit it idempotently.

## Final status

- [x] **PAYFAST_PHASE_2H_LIVE_PAYMENT_PASS**
- [ ] PAYFAST_PHASE_2H_LIVE_PAYMENT_BLOCKED
