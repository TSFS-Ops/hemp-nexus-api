# PayFast Phase 2F — Controlled Sandbox Round-Trip Report

Status: **STILL BLOCKED — FOURTH RESEND REJECTED AT `missing_signature`; BODY DIAGNOSTICS DEPLOYED, AWAITING FIFTH RESEND**

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

## 7. Third resend — result

Operator resent the ITN a third time. PayFast UI reported success
(it inspects only the HTTP status, and the endpoint always answers 200).
Izenzo-side state on re-check:

| Check | Result | Evidence |
| --- | --- | --- |
| ITN reached `payfast-itn`? | ✅ | Edge function booted at 23:13:07 UTC matching the resend window |
| Signature verified? | ❓ Unknown | No `console.log` of the decision existed; function silently rejected |
| Validate post-back VALID? | ❓ Unknown | Same — no observability |
| Amount/currency/package/org/user match? | ❌ Not reached | Earlier gate failed |
| `atomic_paid_credit_purchase` called? | ❌ | 0 ledger rows for any `izpf_*` `request_id` |
| Wallet credited exactly once? | ❌ | `token_balances` for org `1be6cffa-…` still `268`, `updated_at = 2026-04-30` |
| `token_ledger` credit row? | ❌ | 0 rows |
| `audit_logs` rejection row? | ❌ | Audit insert silently failed — `entity_id` is `uuid` in schema but the code was passing the text token `izpf_…`; the `try/catch` swallowed the type error. Only the original `credits.purchase_initiated` row remains for each attempt. |
| `token_purchases` row | ❌ Still `pending` | Row `5f40aede-…`, provider=`payfast`, provider_reference=`izpf_mqycj2cj_3bnxo2pa`, amount_usd=`0.00`, currency=`ZAR` |
| Replay protection intact? | ✅ (unexercised) | Code path unchanged |
| Purchase history renders as PayFast? | ✅ | `PurchasesList.tsx` provider fallback unchanged |

## 8. Third fix — observability + audit-insert correctness

`supabase/functions/_shared/payments/payfast.ts`:

- Rejection path now writes `entity_id: null` and keeps the
  `provider_reference` token in `metadata` only. This stops the
  silent uuid-type insert failure so future rejections become visible
  in `audit_logs` and `admin_risk_items`.

`supabase/functions/payfast-itn/index.ts`:

- Wrapper now `console.log`s a single structured JSON line per ITN
  (`tag`, `mode`, `decision`, `reason`, `mappedStatus`,
  `providerReference`, `creditReference`, `detail`). No secret value
  is logged. This means the next resend will produce an
  unambiguous diagnostic line in the edge function logs even if
  the audit write is somehow blocked.

Redeployed.

## 9. Confirmations (still true)

- ✅ PayFast remains sandbox-only (`liveEnabled: false`, `select.ts` keeps `payfast: undefined`).
- ✅ No live PayFast credentials added.
- ✅ No customer-facing PayFast checkout — admin-gated sandbox card only.
- ✅ Paystack runtime unchanged — `token-purchase` still settles in USD using `PAYSTACK_SECRET_KEY`, `paystack-webhook` still uses HMAC SHA-512.
- ✅ No FX code revived — neither helper imports `_shared/fx.ts`.

## 10. Fourth resend (2026-06-28 23:20:22 UTC = 01:20:22 SAST)

The fourth resend reached the deployed function. The new structured
log line was emitted exactly once:

```json
{"tag":"payfast-itn","mode":"sandbox","decision":"rejected",
 "reason":"missing_signature","mappedStatus":null,
 "providerReference":null,"creditReference":null,"detail":null}
```

Verified Izenzo-side state:

| Check | Result |
| --- | --- |
| ITN reached `payfast-itn` | ✅ yes (200 returned, structured log emitted) |
| Signature verification passed | ❌ no — function reports `missing_signature` |
| PayFast post-back returned VALID | ⏭ never reached (gated on signature) |
| amount / currency / package / org / user matched | ⏭ never reached |
| Wallet credited exactly once | ❌ no — 0 PayFast credits for any `izpf_*` |
| `token_ledger` PayFast credit row | ❌ no — 0 rows |
| `audit_logs` rejection row written | ❌ still 0 new payfast rejection rows |
| `admin_risk_items` rejection row written | ❌ still 0 |
| `token_purchases` row status | still `pending` (`5f40aede-…`) |
| Replay protection | intact (no duplicate credit possible because no credit happened) |

`providerReference: null` is the smoking gun: the function did not
even recover an `m_payment_id`, which means the parsed form body had
no usable fields at all — not just a missing `signature`. The most
likely explanations are (a) PayFast's "Resend" delivers an empty /
non-form-encoded body to the notify URL, or (b) a proxy is stripping
the body before our handler sees it. The existing structured log
cannot distinguish these.

## 11. Fourth fix — body diagnostics (this turn)

`supabase/functions/payfast-itn/index.ts` now also logs, per ITN:

- `method`, `contentType`
- `rawBodyLength`
- `fieldKeys` (names only, never values)
- `hasSignatureField` (boolean)
- `remoteIp`

No secret value, no field value, no signature is logged. Redeployed
via `supabase--deploy_edge_functions`.

The next resend will tell us unambiguously whether PayFast is
delivering a populated form body or an empty/garbled one, and we can
either fix the parser or report the upstream PayFast bug.

## 12. Confirmations (still true)

- ✅ PayFast remains sandbox-only (`liveEnabled: false`, `select.ts` keeps `payfast: undefined`).
- ✅ No live PayFast credentials added.
- ✅ No customer-facing PayFast checkout — admin-gated sandbox card only.
- ✅ Paystack runtime unchanged.
- ✅ No FX code revived.

## 13. Phase 2F verdict

**Phase 2F is STILL BLOCKED. Not PASS.**

Exact remaining reason: `payfast-itn` is rejecting with
`missing_signature` and `providerReference: null`, indicating the
parsed body contains no recognised PayFast fields. Body-level
diagnostics have been deployed to identify whether the resend
delivers an empty/non-form-encoded body or a populated one missing
only the signature field. Awaiting one more resend.

Current status:
`PAYFAST_PHASE_2F_SANDBOX_ROUND_TRIP_BLOCKED_MISSING_SIGNATURE_BODY_DIAGNOSTICS_DEPLOYED_AWAITING_FIFTH_RESEND`


