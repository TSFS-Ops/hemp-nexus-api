# PayFast Phase 2F — Controlled Sandbox Round-Trip Report

Status: **STILL BLOCKED — POST-FIX RESEND PARSED MULTIPART CORRECTLY BUT FAILED SIGNATURE VERIFICATION**

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

## 13. Post-fix resend after multipart parser (2026-06-29 06:46:09 UTC)

The same PayFast sandbox ITN was resent after the multipart parser and
rejection logging fixes were deployed. The function parsed the multipart
body correctly this time.

Structured log line:

```json
{
  "tag": "payfast-itn",
  "mode": "sandbox",
  "method": "POST",
  "contentType": "multipart/form-data; boundary=------------------------ad3f221002657043",
  "rawBodyLength": 2595,
  "bodyParser": "multipart",
  "parserError": null,
  "fieldKeys": [
    "m_payment_id",
    "pf_payment_id",
    "payment_status",
    "item_name",
    "item_description",
    "amount_gross",
    "amount_fee",
    "amount_net",
    "custom_str1",
    "custom_str2",
    "custom_str3",
    "custom_str4",
    "custom_str5",
    "custom_int1",
    "custom_int2",
    "custom_int3",
    "custom_int4",
    "custom_int5",
    "name_first",
    "name_last",
    "email_address",
    "merchant_id",
    "signature"
  ],
  "hasSignatureField": true,
  "remoteIp": "144.126.193.139",
  "decision": "rejected",
  "reason": "invalid_signature",
  "mappedStatus": null,
  "providerReference": "izpf_mqycj2cj_3bnxo2pa",
  "creditReference": "3244102",
  "detail": null
}
```

Verification result:

| Check | Result |
| --- | --- |
| Multipart body parsed correctly | ✅ yes (`bodyParser=multipart`, `parserError=null`) |
| `fieldKeys` | ✅ PayFast field names extracted; includes `m_payment_id`, `pf_payment_id`, `payment_status`, and `signature` |
| `m_payment_id` extracted | ✅ `providerReference=izpf_mqycj2cj_3bnxo2pa` |
| `pf_payment_id` extracted | ✅ `creditReference=3244102` |
| `payment_status` extracted | ✅ visible in audit metadata as `COMPLETE` |
| `signature` extracted | ✅ `hasSignatureField=true` |
| Decision | ❌ `rejected` |
| Reason | ❌ `invalid_signature` |
| Signature verification passed | ❌ no |
| PayFast post-back VALID | ⏭ not reached; signature gate failed first |
| Amount/currency/package/org/user matching | ⏭ not reached; signature gate failed first |
| Wallet credited exactly once | ❌ no; org balance remains `268`, unchanged since 2026-04-30 |
| `token_ledger` PayFast credit row | ❌ no rows for PayFast / `izpf_*` |
| `audit_logs` visible record | ✅ yes: `credits.purchase_rejected`, reason `invalid_signature`, provider `payfast`, provider_reference `izpf_mqycj2cj_3bnxo2pa`, pf_payment_id `3244102`, amount `20.00`, payment_status `COMPLETE` |
| `admin_risk_items` visible record | ✅ yes: `payfast_itn_rejected`, severity `high`, dedup_key `payfast_itn:invalid_signature:izpf_mqycj2cj_3bnxo2pa:3244102` |
| `token_purchases` status | ❌ still `pending` for row `5f40aede-0943-4ec2-b0c9-47f68f46b78b` |

The rejection logging fix is now confirmed working: both the canonical
audit row and admin risk row were written for the real PayFast ITN.

This means the old resent ITN payload is now usable enough to parse, but
it is still not usable for crediting because its `signature` does not
verify against the backend's configured sandbox passphrase/signature
base. Since the original transaction has been resent multiple times
across handler changes, the safest next controlled test is a fresh
sandbox transaction against the now-fixed endpoint/parser.

Fresh sandbox transaction steps:

1. Start a new admin-only PayFast sandbox checkout for the 1-credit
   sandbox package.
2. Complete the payment in PayFast sandbox.
3. Confirm PayFast sends the ITN to the existing sandbox Notify URL.
4. Re-check `payfast-itn` logs for `bodyParser=multipart` or
   `form_urlencoded`, `hasSignatureField=true`, and a decision of
   `credited` or `already_credited`.
5. Confirm exactly one wallet credit, one `token_ledger` credit row, one
   `credits.purchased` audit row, and a completed `token_purchases` row.

## 14. Phase 2F verdict

**Phase 2F is STILL BLOCKED. Not PASS.**

### 14.1 Post raw-body-signature-fix resend of ITN 1889264

After the raw-body signature verifier was deployed, the operator was
asked to resend ITN row `1889264` from the PayFast sandbox dashboard.

Verification at the Izenzo side **after the requested resend**:

| Check | Result |
| --- | --- |
| New `payfast-itn` invocation after resend | ❌ none — most recent invocation remains the original 2026-06-29 06:50:33 UTC POST |
| `payfast-itn-sig-verify` diagnostic (reconstructed vs raw-body) | ❌ never logged — handler not re-entered |
| Signature verification | n/a — handler not re-entered |
| PayFast post-back VALID | n/a |
| amount / currency / package / org / user match | n/a |
| Wallet credit | ❌ 0 credit rows |
| `token_ledger` PayFast credit rows | ❌ 0 |
| `audit_logs` newest PayFast row | unchanged: `credits.purchase_rejected` / `invalid_signature` at 06:50:33 UTC |
| `admin_risk_items` newest PayFast row | unchanged |
| `token_purchases` row for `izpf_mqyuxroc_gtq7x20r` | ❌ still `pending` |
| Replay protection | ✅ intact (no double-credit possible because no credit ran) |
| PayFast sandbox-only | ✅ unchanged |
| Live credentials added | ❌ none |
| Customer-facing PayFast checkout | ❌ none (admin-only sandbox button only) |
| Paystack runtime | ✅ unchanged |
| FX code | ✅ still inert, no revival |

The PayFast dashboard may show ITN `1889264` as Completed / Success,
but no new POST has reached the `payfast-itn` Notify URL since
06:50:33 UTC. The raw-body signature path therefore did **not** fire,
and the fix has not yet been exercised end-to-end.

### 14.2 Required next action

Since the PayFast resend did not reach the function, the next
controlled test must be a **fresh sandbox transaction** (not another
resend of `1889264`):

1. As `joshtkruger@gmail.com`, open Billing → click
   "Start PayFast Sandbox Test".
2. Complete the payment on the PayFast sandbox page.
3. Return to Izenzo (`/billing?payfast=return`).
4. Reply: "Fresh PayFast sandbox transaction completed at <time>."

We will then check the new `payfast-itn-sig-verify` log line for
either `reconstructed=ok` or `rawBody=ok`, confirm the wallet credit,
the single `token_ledger` row, the audit/risk rows, and that
`token_purchases` moved from `pending` to `completed`.

Current status:
`PAYFAST_PHASE_2F_SANDBOX_ROUND_TRIP_BLOCKED_RESEND_1889264_DID_NOT_REACH_FUNCTION_RAW_BODY_VERIFIER_NOT_EXERCISED`



