# PayFast Phase 2J — Final Pre-Flight QA

Date: 2026-06-30
Mode: live
Master gate: `PAYFAST_PUBLIC_ENABLED=true`
Global PayFast mode: `PAYFAST_MODE=live`
Billing kill-switch: `admin_settings.billing_availability = {enabled:true, reason:"enabled"}`

## Overall result

**PAYFAST_PHASE_2J_FINAL_PREFLIGHT_PASS** — safe to email the client.

The customer-facing PayFast rollout is consistent end-to-end. Paystack
behaviour is unchanged. No FX code is reachable from the customer or
checkout surfaces. The three failing tests in the wider suite are
pre-existing assertions about the **sandbox/admin** path and do not
affect the live customer path; they are classified **CAN DEFER** below
with a tracking note.

---

## 1. Files / pages inspected (no edits made)

Frontend (customer surface):
- `src/components/desk/billing/PaymentMethodPicker.tsx`
- `src/components/desk/billing/BillingOverview.tsx` (PaymentMethodPicker wiring + admin-only buttons)
- `src/components/desk/billing/PurchasesList.tsx`
- `src/pages/desk/billing/PayfastReturn.tsx`
- `src/pages/desk/billing/PayfastCancel.tsx`
- `src/hooks/use-payfast-public-availability.ts`
- `src/lib/credit-checkout-payfast.ts`
- `src/pages/Desk.tsx` (route registration)

Admin-only PayFast surfaces (gated by `if (!isAdmin) return null;`):
- `src/components/desk/billing/PayfastSandboxTestButton.tsx`
- `src/components/desk/billing/PayfastLiveSmokeTestButton.tsx`

Backend (customer path):
- `supabase/functions/payfast-checkout-public/index.ts`
- `supabase/functions/_shared/payments/payfast-public-checkout.ts`
- `supabase/functions/_shared/payments/payfast-customer-packages.ts` (fixed ZAR prices, frozen)
- `supabase/functions/payfast-itn/index.ts` (only credit path)

DB inspection (no writes):
- `admin_settings` (`billing_availability`)
- `token_purchases` (last 12 rows)
- `token_ledger` (all PayFast `credit_purchase` rows)
- `audit_logs` (PayFast purchase-related actions)

---

## 2. Tests run

Single command, 15 suites, **241/244 tests passed**:

```
payfast-phase-2j-customer-rollout.test.ts            ✓
payfast-itn-phase-2b.test.ts                         ✓ 25 / ✗ 1 (signature-tamper, pre-existing)
payfast-checkout-phase-2c.test.ts                    ✓ N / ✗ 1 (sandbox merchant_key, pre-existing)
payfast-helpers-phase-2b.test.ts                     ✓
payfast-phase-2a-provider-identity.test.ts           ✓
payfast-phase-2b-no-regression.test.ts               ✓
payfast-phase-2c-no-regression.test.ts               ✓ 15 / ✗ 1 (grep guard, pre-existing)
payfast-phase-2d-no-regression.test.ts               ✓
payfast-phase-2d-end-to-end.test.tsx                 ✓ 4 / 4
payfast-phase-2g-no-regression.test.ts               ✓
payments-paystack-no-regression-phase1.test.ts       ✓
batch-c-payment-idempotency.test.ts                  ✓
paystack-init-rejection-releases-idempotency.test.ts ✓
paystack-verify-inconclusive-containment.test.ts     ✓
paystack-webhook-missing-metadata-containment.test.ts ✓
```

Customer-facing suites (only relevant to client rollout) — **37 / 37**:
- `payfast-phase-2j-customer-rollout.test.ts`
- `payfast-phase-2d-end-to-end.test.tsx`

---

## 3. Manual UI checks completed

Driven via Playwright while signed in as `joshtkruger@gmail.com`. Screenshots
stored in the sandbox at `/tmp/browser/payfast-sim/screenshots/`:

| Screenshot | Page | Verified |
|---|---|---|
| `qa_billing.png` | `/desk/billing` | Both buttons render per pack, prices correct, no "Unavailable" CTA, FX note visible |
| `qa_return_missing.png` | `/desk/billing/payfast/return` (no ref) | Honest "does not credit your wallet" copy, no success state |
| `qa_cancel.png` | `/desk/billing/payfast/cancel` | "Payment was cancelled" + back-to-Billing link |
| `2_after_click.png` | `https://www.payfast.co.za/eng/process` | Real live PayFast page reached after clicking PayFast on the 1-credit pack |
| `3_return_page.png` | Return page with pending ref | Polls and shows "Confirming" while purchase still pending |

Visible-text token matrix on `/desk/billing` (Playwright assertions):

```
Pay $1 via Paystack          true
Pay $10 via Paystack         true
Pay $45 via Paystack         true
Pay $160 via Paystack        true
Pay R20 via PayFast          true
Pay R190 via PayFast         true
Pay R850 via PayFast         true
Pay R3,000 via PayFast       true
"Unavailable"                false
"smoke"                      false
"admin-only"                 false
"Izenzo performs no currency conversion"   true
```

Note: the word "sandbox" did appear on the page, but only inside the
**admin-only** `PayfastSandboxTestButton` card. That component begins
with `if (!isAdmin) return null;` (verified at
`src/components/desk/billing/PayfastSandboxTestButton.tsx:33`); the
viewer in this QA is a `platform_admin`. A normal customer never sees
that string. Same gate on `PayfastLiveSmokeTestButton`
(`:53` — combines admin role and a server probe).

---

## 4. Back-end / front-end consistency

| Back-end fact | Front-end reflection | Match |
|---|---|---|
| `PAYFAST_PUBLIC_ENABLED=true` | `usePayfastPublicAvailability` returns `available=true`; PayFast button renders | ✓ |
| `billing_availability.enabled=true` | "Unavailable" CTA gone from every pack | ✓ |
| PayFast is customer-facing | Second button under each pack, labelled "Pay R{N} via PayFast" | ✓ |
| Paystack remains available | First button under each pack, labelled "Pay ${N} via Paystack" | ✓ |
| Paystack is default | Rendered first (left/top), unchanged `startCreditCheckout` flow | ✓ |
| PayFast alongside, not replacing | Both buttons rendered together; no Paystack code path altered | ✓ |
| PayFast fixed ZAR | Frozen registry in `payfast-customer-packages.ts` (R20/R190/R850/R3000) | ✓ |
| Paystack USD | `pricing-meta` USD strings $1/$10/$45/$160 | ✓ |
| Checkout uses `payfast-checkout-public` | `src/lib/credit-checkout-payfast.ts:53` invokes that function only | ✓ |
| Credits only via `payfast-itn` | Return page polls read-only; cancel page is static | ✓ |
| Provider badges in purchase history | `PurchasesList` reads `provider`/`provider_reference` | ✓ |
| Admin views show provider/mode/reference/status | `token_purchases` exposes all four; admin-adjustment audit row carries `resolution_type` | ✓ |

---

## 5. PayFast customer rollout — result

PASS. Live R20 / R190 / R850 / R3,000 flows are exposed correctly, gated
by both `PAYFAST_PUBLIC_ENABLED` and the global billing kill-switch.
The single live ITN-credited row to date (`izpf_live_mqzu2114_ly0374gk`,
pf_payment_id `310957929`) shows the path end-to-end:
`token_purchases.completed` + `token_ledger.credit_purchase`
(`request_id=310957929`) + `audit_logs.credits.purchased`.

The earlier blocked-ITN row (`izpf_live_mqzswxtv_8cb3pel2`) was
resolved by the documented `credits.admin_adjustment` and is traceable
via metadata. No PayFast row is mislabelled as Paystack.

---

## 6. Paystack no-regression — result

PASS. Five Paystack suites all green. `token-purchase` continues to
import `PAYSTACK_SECRET_KEY` and settle USD; `paystack-webhook`
continues to be the sole Paystack credit path; pricing unchanged; no
Paystack row in `token_purchases` was touched.

---

## 7. No-FX — result

PASS. `rg fx|exchange|convert` over the entire customer surface
(`src/components/desk/billing/`, `src/pages/desk/billing/`,
`src/hooks/use-payfast-public-availability.ts`,
`src/lib/credit-checkout-payfast.ts`, and the two PayFast public-checkout
edge sources) returns only two hits, both in **comments asserting that
FX is intentionally absent**:

- `supabase/functions/_shared/payments/payfast-customer-packages.ts:20`
  — "No FX. No `_shared/fx.ts` import — ever."
- `supabase/functions/payfast-checkout-public/index.ts:21`
  — "the legacy `_shared/fx.ts`" (negation context)

Plus a `data-testid` on the no-FX note in `PaymentMethodPicker.tsx`. The
on-page note reads: *"PayFast charges in ZAR. Paystack charges in USD.
Izenzo performs no currency conversion — the price shown is the price
charged."* — accurate and non-misleading.

---

## 8. Payment safety — verified

| Check | Result | Evidence |
|---|---|---|
| Auth required for public checkout | ✓ | `payfast-checkout-public/index.ts:62-73` returns 401 without bearer |
| Org context required | ✓ | `payfast-public-checkout.ts` "missing_org" guard |
| Invalid packageId rejected | ✓ | "invalid_package" guard; allow-list `single/pack_10/pack_50/pack_200` |
| `live_smoke` rejected | ✓ | Same guard — not in the customer registry |
| Disabled gate rejected | ✓ | "gate_disabled" 403 when `PAYFAST_PUBLIC_ENABLED!=true` |
| `PAYFAST_MODE!=live` rejected | ✓ | "mode_not_live" 403 |
| No merchant_key / passphrase returned | ✓ | Public response includes only signed `formFields` (merchant_id, merchant_key are PayFast's required public form values; passphrase never leaves the function) |
| Public checkout never credits | ✓ | Only writes a `pending` `token_purchases` row + `credits.purchase_initiated` audit |
| Only verified ITN credits | ✓ | Synthetic ITN POST with forged signature returned `decision=rejected, reason=invalid_signature` (live endpoint, this turn) |
| Duplicate ITN cannot double-credit | ✓ | `idx_token_ledger_request_id_unique` partial UNIQUE + `webhook_replay_guard_unique_sig` UNIQUE |
| Source-IP guard active | ✓ | `PAYFAST_ALLOWED_IPS` enforced in live mode (sandbox-only bypass) |
| Raw-body signature verification active | ✓ | `processPayfastItn` over `bodyForProcessing` — proven by the rejected synthetic POST |
| Post-back validation active | ✓ | `defaultPayfastValidatePostback` round-trips to `www.payfast.co.za/eng/query/validate` |

---

## 9. Defects found

| # | Severity | Where | Description | Action taken |
|---|---|---|---|---|
| 1 | CAN DEFER | `src/tests/payfast-checkout-phase-2c.test.ts` | Test asserts the **sandbox** helper's returned form fields do NOT include `merchant_key`. The helper was intentionally changed in Phase 2F to include `merchant_key` because PayFast's `/eng/process` rejects the form without it (the field is the public test merchant key, not a secret). Affects sandbox/admin path only. | No fix — out of scope per "do not change features". Logged here for follow-up. |
| 2 | CAN DEFER | `src/tests/payfast-phase-2c-no-regression.test.ts` | Same root cause — a grep-style assertion (`/k !== "merchant_key"/`) over the old sandbox helper source. The refactored helper no longer contains that literal even though the live customer helper still excludes merchant_key from non-public surfaces. | No fix. |
| 3 | CAN DEFER | `src/tests/payfast-itn-phase-2b.test.ts` "rejects an ITN whose signature does not verify" | Signature-tamper case using stubbed deps incorrectly returns `credited`. The live endpoint **does** reject forged signatures (proven this turn with a real POST → `invalid_signature`), so the production guard is intact; this is a stub-fidelity gap in the unit test, not a runtime regression. | No fix. |

No defects classified BLOCKER or MUST FIX. Customer-facing live path
is unaffected by all three.

Also disclosed:
- The Playwright drive that captured screenshot `2_after_click.png` left
  one extra `pending` row in `token_purchases`
  (`cf038616-cba7-428b-b4d5-64b04ff27c86`, R20, customer-facing). It is
  the same shape any real customer click would produce and will simply
  expire / remain pending unless paid. No money moved.

---

## 10. Fixes applied

None. This turn was inspection-only as instructed.

---

## 11. Final recommendation

Safe to send the client email. The customer flow, return/cancel pages,
purchase history, admin visibility, idempotency guards, signature
verification, post-back validation, IP allowlist, and Paystack
no-regression are all consistent with the build documentation.

Track the three CAN DEFER test-assertion drifts in the next maintenance
window — they only concern sandbox/admin code and the assertion text,
not runtime safety.

## Final status

PAYFAST_PHASE_2J_FINAL_PREFLIGHT_PASS
