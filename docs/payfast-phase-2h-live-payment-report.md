# PayFast Phase 2H — Live Payment Report

Status: **PAYFAST_PHASE_2H_LIVE_PAYMENT_PASS** (final — confirmed)

## Confirmed facts
- Live transaction: `izpf_live_mqzu2114_ly0374gk`
- PayFast ID: `310957929`
- Live ITN reached `payfast-itn`: ✅
- Source IP accepted (`13.245.74.88` in `PAYFAST_ALLOWED_IPS`): ✅
- Raw-body signature verified: ✅
- Decision: `credited`
- Wallet credited exactly once (org `1be6cffa-…`, balance now 270): ✅
- Exactly one `token_ledger.credit_purchase` row (`e3272f96-…`, `payfast`/`live`): ✅
- Audit rows exist (`c1afb037-…` initiated, `d41f7a42-…` purchased): ✅
- `token_purchases.d0630799-…` moved pending → `completed`: ✅
- Paystack unchanged: ✅
- No FX revived: ✅

## Orphaned R5 — resolved via admin adjustment

Earlier R5 live payment (`izpf_live_mqzswxtv_8cb3pel2` / PF `310955465`) was paid in PayFast but originally not credited because the live ITN was rejected on `PAYFAST_ALLOWED_IPS` before the allowlist was corrected. Since the PayFast live dashboard does not expose an ITN resend, an admin-approved manual credit adjustment was applied (operator-approved).

Applied at the user's explicit instruction:

| Check | Result | Evidence |
|---|---|---|
| `token_purchases.d13ac2a8-…` now `completed` | ✅ | `status=completed`, `metadata.resolution=admin_adjustment_due_to_blocked_itn`, `metadata.resolved_by_admin_user_id=582fc403-…`. |
| Wallet balance moved 270 → 271 | ✅ | `token_balances` for org `1be6cffa-…` → `271`. RPC returned `new_balance: 271, credited: 1, already_credited: false`. |
| Exactly one `token_ledger.credit_purchase` row for `request_id=izpf_live_mqzswxtv_8cb3pel2` | ✅ | `ledger_rows=1`, `action_type=credit_purchase`, `metadata.resolution_type=admin_adjustment_due_to_blocked_itn`, ledger id `58869fc9-c866-4d5e-a35e-00843c6c9340`, endpoint `payment:payfast:admin_adjustment`. |
| `audit_logs.credits.admin_adjustment` written | ✅ | Row `5ccefddf-63ce-4d55-b1d7-36fcaf3fa4dc`, `actor_user_id=582fc403-…` (signed-in platform_admin), `entity_type=token_purchase`, `entity_id=d13ac2a8-…`, full metadata with `provider:payfast, mode:live, resolution_type:admin_adjustment_due_to_blocked_itn, provider_reference, pf_payment_id:310955465`. |
| Duplicate ITN would be blocked by the same `request_id` | ✅ | Credit was written through the canonical `atomic_paid_credit_purchase` RPC with `p_reference_id=izpf_live_mqzswxtv_8cb3pel2`. The partial UNIQUE index on `token_ledger.request_id` (used for ITN idempotency, see `supabase/functions/_shared/payments/payfast.ts:936-956`) means a future PayFast ITN resend will return `already_credited:true` and write no second ledger row; the purchase update is gated `.in("status", ["pending"])` so the completed row is not touched. |
| Paystack untouched | ✅ | No Paystack tables, code, or secrets modified. |
| FX not revived | ✅ | No FX modules touched. ZAR amount stored only as audit metadata (`price_zar`, `amount_gross_zar`); no conversion code exists or was added. |

Reason recorded on both ledger and audit rows: *"Live PayFast payment succeeded, but original ITN was blocked before PAYFAST_ALLOWED_IPS was updated"*.

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
