# PayFast Phase 2F — Controlled Sandbox Round-Trip Report

Status: **STILL BLOCKED — LATEST RESEND USED `multipart/form-data`; PARSER/AUDIT FIX DEPLOYED, AWAITING POST-FIX RESEND**

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

## 10. Latest resend after body diagnostics (2026-06-29 06:37:51 UTC)

The resent ITN reached the deployed function. Body diagnostics emitted
the following structured line:

```json
{
  "tag": "payfast-itn",
  "mode": "sandbox",
  "method": "POST",
  "contentType": "multipart/form-data; boundary=------------------------b874a9b20ae59887",
  "rawBodyLength": 2595,
  "fieldKeys": ["--------------------------b874a9b20ae59887\r\nContent-Disposition: form-data; name"],
  "hasSignatureField": false,
  "remoteIp": "144.126.193.139",
  "decision": "rejected",
  "reason": "missing_signature",
  "mappedStatus": null,
  "providerReference": null,
  "creditReference": null,
  "detail": null
}
```

Interpretation:

- `rawBodyLength = 2595`, so PayFast did **not** resend an empty ITN.
- `contentType = multipart/form-data`, not the normal
  `application/x-www-form-urlencoded` shape expected by the handler.
- The old diagnostics produced one bogus `fieldKeys` entry because
  `URLSearchParams` was being applied to a multipart body. That means
  PayFast fields were present in the request body, but the handler did
  not parse them.
- The correct branch is therefore: **rawBodyLength > 0 but parsed
  field keys are invalid/empty → fix parser/content-type handling**.
- This is not evidence that PayFast sandbox resend omits the signature;
  the handler never parsed far enough to know whether the multipart
  payload contained a `signature` part.

Verified Izenzo-side state:

| Check | Result |
| --- | --- |
| ITN reached `payfast-itn` | ✅ yes (200 returned, structured log emitted) |
| Signature verification passed | ❌ no — old parser treated multipart body as one non-PayFast key and reported `missing_signature` |
| PayFast post-back returned VALID | ⏭ never reached (gated on signature) |
| amount / currency / package / org / user matched | ⏭ never reached |
| Wallet credited exactly once | ❌ no — 0 PayFast credits for any `izpf_*` |
| `token_ledger` PayFast credit row | ❌ no — 0 rows |
| `audit_logs` rejection row written | ❌ no real ITN rejection row yet; old parser could not resolve `m_payment_id` / org |
| `admin_risk_items` rejection row written | ❌ no new real ITN risk row for this resend; previous duplicate/no-ref handling hid visibility |
| `token_purchases` row status | still `pending` (`5f40aede-…`) |
| Replay protection | intact (no duplicate credit possible because no credit happened) |

`providerReference: null` was caused by a parser/content-type mismatch,
not an empty request. The old code only parsed URL-encoded bodies; the
latest PayFast resend arrived as multipart.

## 11. Fifth fix — multipart parser + visible rejection logging

`supabase/functions/payfast-itn/index.ts` now:

- reads the request body once as an `ArrayBuffer`;
- normalizes `multipart/form-data` bodies into URL-encoded key/value
  data before calling `processPayfastItn`;
- keeps URL-encoded handling unchanged;
- logs `bodyParser` and `parserError` in addition to `method`,
  `contentType`, `rawBodyLength`, `fieldKeys`, `hasSignatureField`,
  `remoteIp`, `decision`, `reason`, and references.

`supabase/functions/_shared/payments/payfast.ts` now:

- resolves the purchase org for rejection writes when `m_payment_id` is
  available, because `audit_logs.org_id` is required;
- writes `audit_logs.entity_id = null` for rejection rows and keeps the
  text PayFast reference in metadata;
- logs exact audit/risk write errors as structured diagnostics instead
  of swallowing them;
- handles duplicate `admin_risk_items.dedup_key` by updating the open
  risk item with `last_seen_at` metadata instead of silently losing the
  rejection;
- selects and credits `token_amount` from `token_purchases` (with test
  fallback for older mocks), matching the actual schema.

No secret value, field value, signature, or credential is logged. The
function has been redeployed and PayFast remains sandbox-only.

Targeted PayFast regression tests pass:

- `src/tests/payfast-itn-phase-2b.test.ts`
- `src/tests/payfast-phase-2d-end-to-end.test.tsx`
- `src/tests/payfast-phase-2b-no-regression.test.ts`

## 12. Confirmations (still true)

- ✅ PayFast remains sandbox-only (`liveEnabled: false`, `select.ts` keeps `payfast: undefined`).
- ✅ No live PayFast credentials added.
- ✅ No customer-facing PayFast checkout — admin-gated sandbox card only.
- ✅ Paystack runtime unchanged.
- ✅ No FX code revived.

## 13. Phase 2F verdict

**Phase 2F is STILL BLOCKED. Not PASS.**

Exact remaining reason: the latest real PayFast resend reached the
function with `rawBodyLength = 2595` and `contentType = multipart/form-data`,
but the old handler parsed only URL-encoded bodies, so it rejected at
`missing_signature` with `providerReference = null`. The parser and
rejection visibility fixes are now deployed, but no post-fix PayFast
ITN has yet credited the wallet or completed the purchase.

Current status:
`PAYFAST_PHASE_2F_SANDBOX_ROUND_TRIP_BLOCKED_MULTIPART_ITN_PARSER_FIXED_AWAITING_POST_FIX_RESEND`


