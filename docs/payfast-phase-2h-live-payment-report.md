# PayFast Phase 2H — Live Payment Report

Status: **PAYFAST_PHASE_2H_LIVE_PAYMENT_BLOCKED_ON_INVALID_LIVE_MERCHANT_KEY**

## What happened
- Operator clicked the red "Start PayFast Live Payment" button on `/desk/billing`.
- A POST was submitted to PayFast's **live** process URL.
- PayFast's hosted page returned:

  > 400 Bad Request — Invalid merchant key

- No payment was taken. The user never reached the card-entry step.

## Safe verification (no secret values exposed)

| Check | Result | Evidence |
|---|---|---|
| Checkout posts to live PayFast process URL (not sandbox) | ✅ PASS | `supabase/functions/_shared/payments/payfast-live-checkout.ts:53` — `PAYFAST_LIVE_PROCESS_URL = "https://www.payfast.co.za/eng/process"`; used as the form action (line 199). No sandbox URL referenced anywhere in this code path. |
| `PAYFAST_MODE=live` in edge runtime | ✅ PASS | `GET /payfast-checkout-live` probe → `globalMode: "live"`, `available: true`. |
| Live checkout uses `PAYFAST_MERCHANT_ID_LIVE` | ✅ PASS | `payfast-checkout-live/index.ts:140` reads `PAYFAST_MERCHANT_ID_LIVE` only. |
| Live checkout uses `PAYFAST_MERCHANT_KEY_LIVE` | ✅ PASS | `payfast-checkout-live/index.ts:141` reads `PAYFAST_MERCHANT_KEY_LIVE` only. |
| Sandbox merchant credentials are NOT used in live | ✅ PASS | No `PAYFAST_MERCHANT_ID_SANDBOX` / `_KEY_SANDBOX` reads in `payfast-checkout-live` or `_shared/payments/payfast-live-checkout.ts`. Comment at line 25: *"NEVER usable in sandbox mode. Sandbox creds are NEVER read here."* |
| Stored live Merchant Key is not empty | ✅ PRESENT | Probe reports `merchantConfigured: true` (server-side `firstNonEmpty("PAYFAST_MERCHANT_KEY_LIVE")` returned truthy). The value is present but **rejected by PayFast as invalid**. |
| Stored live Merchant Key has no leading/trailing spaces | ❌ UNKNOWN — likely cause | Edge function does not currently `.trim()` the env value before signing/posting. A trailing space, accidental newline, or wrong-environment copy would produce exactly this PayFast response. |
| Live Merchant ID and live Merchant Key from same business profile | ❌ UNKNOWN | Cannot be verified from this side. PayFast rejects with "Invalid merchant key" when the key does not match the merchant ID's active profile. Must be re-checked in the PayFast merchant dashboard. |
| No live checkout row marked completed | ✅ PASS | PayFast never accepted the request → no ITN fired → no DB write to `token_purchases.completed`. |
| No wallet credit issued | ✅ PASS | No ITN → no `token_ledger.credit_purchase` row → no wallet movement. |
| Paystack unchanged | ✅ PASS | No edits to Paystack code paths in this session. |
| No FX code revived | ✅ PASS | No FX modules touched; USD-native billing remains. |

## Root cause (most likely)
PayFast returned **"Invalid merchant key"** on the live hosted page. Our server posted to the correct live URL with the live merchant id + key from `PAYFAST_MERCHANT_KEY_LIVE`. PayFast's rejection means **the stored `PAYFAST_MERCHANT_KEY_LIVE` value itself is not a valid live key for the configured live Merchant ID**. Common causes:

1. Whitespace (trailing space / newline) was pasted into the secret.
2. The key copied was from a different PayFast merchant profile than `PAYFAST_MERCHANT_ID_LIVE`.
3. The "Merchant Key" field was filled with the wrong value (e.g. passphrase, salt, or sandbox key).
4. The PayFast live merchant profile is not yet activated / approved for live integration.

## Action required
- All live payment attempts are stopped at the button by PayFast's own rejection; no money or credit can move.
- The corrected `PAYFAST_MERCHANT_KEY_LIVE` will be requested via the **secure form** (update_secret). It will not be pasted into chat.
- After the corrected value is stored, the edge function will be redeployed and we will retry one live payment.

## Final status
- [ ] PAYFAST_PHASE_2H_LIVE_PAYMENT_PASS
- [x] PAYFAST_PHASE_2H_LIVE_PAYMENT_BLOCKED_ON_INVALID_LIVE_MERCHANT_KEY
