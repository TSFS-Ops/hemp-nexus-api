# PayFast Phase 2H — Live Payment Report

Status: **AWAITING_OPERATOR_PAYMENT**

## Configuration enabled
- `PAYFAST_MODE = live` (updated via secure form)
- `PAYFAST_LIVE_SMOKE_ENABLED = true` (gate flag retained for code stability; button label no longer says "smoke test")
- Live secrets present by name only: `PAYFAST_MERCHANT_ID_LIVE`, `PAYFAST_MERCHANT_KEY_LIVE`, `PAYFAST_PASSPHRASE_LIVE`, `PAYFAST_RETURN_URL_LIVE`, `PAYFAST_CANCEL_URL_LIVE`, `PAYFAST_NOTIFY_URL_LIVE`
- Sandbox secrets untouched and NOT read in live mode (`payfast-itn` reads only `PAYFAST_PASSPHRASE_LIVE` when `PAYFAST_MODE=live`; no fallback)
- Paystack: unchanged. FX: not revived. Customer-facing PayFast: not exposed (admin-only gate on button + edge function).

## Visible UI change
- `PayfastLiveSmokeTestButton.tsx`:
  - CardTitle: "PayFast Live Payment (Admin Only — REAL MONEY)"
  - Button label: "Start PayFast Live Payment"
  - Confirm dialog: "⚠ LIVE PayFast payment — This will charge a real amount via PayFast LIVE."
- Internal gate flag name `PAYFAST_LIVE_SMOKE_ENABLED` retained as-is (per instruction).

## Operator steps (for joshtkruger@gmail.com)

1. **Open** https://trade.izenzo.co.za/desk/billing
   (If redirected to `/auth`, sign in as joshtkruger@gmail.com.)
2. **Scroll** to the billing page. Two admin-only PayFast cards are visible:
   - amber "PayFast Sandbox Test (Admin Only)" — *ignore this one*
   - red-bordered **"PayFast Live Payment (Admin Only — REAL MONEY)"** — this is the live one
3. **Click** the red "Start PayFast Live Payment" button.
4. **Amount that will be charged: R5.00 ZAR** (PayFast live documented minimum; credits 1 token on success).
5. **Confirmation dialog** will appear:
   `⚠ LIVE PayFast payment — This will charge a real amount via PayFast LIVE. Proceed?`
   Click **OK**.
6. **A new tab opens** to PayFast's live hosted page (`https://www.payfast.co.za/eng/process`) showing the R5.00 charge and the Izenzo merchant.
7. **Complete the payment** with your real card on PayFast's page.
8. **Return page** — PayFast will redirect to `https://trade.izenzo.co.za/billing?payfast=return`.
9. **After payment**, send back:
   `Live PayFast payment completed.`

## Verification (filled in after payment)

| Check | Result |
|---|---|
| Live PayFast ITN reached `payfast-itn` | _pending_ |
| `mode = live` recorded | _pending_ |
| Live signature verification passed (raw-body path) | _pending_ |
| PayFast post-back returned VALID | _pending_ |
| amount/currency/package/org/user matched | _pending_ |
| Wallet credited exactly once | _pending_ |
| Exactly one `token_ledger.credit_purchase` row | _pending_ |
| Audit row with `provider: payfast` + live metadata | _pending_ |
| `token_purchases` row moved pending → completed | _pending_ |
| Replay/idempotency protection intact | _pending_ |
| Paystack unchanged | _pending_ |
| No FX code revived | _pending_ |

## Final status (filled in after verification)
- [ ] PAYFAST_PHASE_2H_LIVE_PAYMENT_PASS
- [ ] PAYFAST_PHASE_2H_LIVE_PAYMENT_BLOCKED
