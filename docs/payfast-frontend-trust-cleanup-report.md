# PayFast Frontend Trust Cleanup — Report

Status: **PAYFAST_FRONTEND_TRUST_CLEANUP_PR_READY**
Branch: `fix/payfast-frontend-trust-leakage`
Scope: frontend copy + presentation only. No backend, edge, RLS, migration, wallet, ledger, ITN, checkout, settlement-tracking or provider behaviour changed.

## Files changed

| File | Change |
|------|--------|
| `src/pages/Pricing.tsx` | Public footnote + top-of-file docstring no longer name Paystack. Public copy now reads "Credits are purchased securely through PayFast." |
| `src/pages/Billing.tsx` (legacy, unrouted; kept for test compatibility) | Two customer-visible Paystack lines rewritten to provider-neutral / PayFast-correct wording. All remaining `paystack*` references are internal code identifiers and comments only — never rendered to a customer. |
| `src/components/desk/billing/PurchasesList.tsx` | Added `useAuth().isAdmin` gate. For non-admin customers: no "Paystack" text, no `paystack_reference` value, no "settlement" wording in the refund-approved tooltip. Legacy provider rows show "via card checkout" + last-4-masked payment reference. Admins retain "Paystack · legacy/internal" badge (marked `data-admin-only`) and the operational "provider settlement pending" tooltip. |
| `src/tests/payfast-frontend-trust-cleanup.test.tsx` | **New** — 5 focused tests (see below). |
| `src/tests/purchases-list-resolved-refunds.test.tsx` | Added AuthContext mock (isAdmin: true) — the test's assertions were on the admin-visible "provider settlement pending" wording, which is now correctly gated. |
| `src/tests/payfast-usd-first-billing-ui-cleanup.test.tsx` | Same AuthContext mock addition. Test verifies admin/back-office USD-first wording, which retains "via Paystack" on the admin path. |

## Exact leakage removed

1. `src/pages/Pricing.tsx:269` — was: *"All prices in USD. Charged in USD at checkout via Paystack."* → *"All prices in USD. Credits are purchased securely through PayFast."*
2. `src/pages/Pricing.tsx:6` — docstring "USD natively via Paystack" → "USD natively via PayFast".
3. `src/pages/Billing.tsx:586` — was: *"Check your email for a Paystack receipt…"* → *"Check your email for a receipt from our checkout provider…"*
4. `src/pages/Billing.tsx:726` — was: *"Payments processed securely by Paystack."* → *"Payments processed securely through PayFast."*
5. `PurchasesList.tsx` — customer surface no longer renders any of: `Paystack` badge, `via Paystack`, `Payment provider: paystack` tooltip, raw `paystack_reference` value, or *"provider settlement pending"* / *"awaiting payment-provider (Paystack) confirmation…"* refund copy.

## Customer / admin behaviour after cleanup

**Normal customer (`isAdmin = false`)**
- Public `/pricing`: no "Paystack" anywhere on the page.
- `/desk/billing` purchase rows:
  - PayFast row → `10 credits · $10.00 USD via PayFast` + `PayFast` badge + full `provider_reference`.
  - Legacy row → `10 credits · $10.00 USD via card checkout` + `Card checkout` badge + masked `••••XXXX` payment reference. No "Paystack" string, no raw reference.
  - Reference label reads *"Payment reference"* (never *"Ref"*), tooltip *"Payment reference"* (never provider name).
- Refund-approved badge → *"Refund approved"*. Tooltip → *"Your refund has been approved. Funds are returned by the original payment method and may take several business days to appear."* No "Paystack", no "settlement".

**Platform admin (`isAdmin = true`)**
- Everything above, plus legacy rows badged **"Paystack · legacy/internal"** with amber styling and `data-admin-only="true"`.
- Reference label reads *"Ref"* with full raw value; tooltip retains *"Payment provider: paystack (legacy/internal)"*.
- Refund-approved badge retains operational wording *"Refund approved — provider settlement pending"*, tooltip retains *"Internal approval recorded. Awaiting payment-provider confirmation that funds have been returned."* (Provider name removed from the customer-visible-string surface even for admins, per audit guidance — provider is conveyed via the separate provider badge/tooltip.)

## Tests added / updated

New: `src/tests/payfast-frontend-trust-cleanup.test.tsx` — 5 tests:

1. Public `Pricing.tsx` source contains no `Paystack` (case-insensitive).
2. Legacy `Billing.tsx` no longer contains the two customer-facing Paystack strings.
3. Non-admin `PurchasesList` renders neither "Paystack", "settlement", nor a raw `paystack_reference` value, and no `[title*="paystack"]` tooltip is emitted.
4. Non-admin refund-approved badge tooltip does not mention "Paystack" or "settlement".
5. Admin `PurchasesList` retains the `Paystack · legacy/internal` badge with `data-admin-only="true"` and admin-only *"settlement pending"* tooltip.

Updated: `purchases-list-resolved-refunds.test.tsx`, `payfast-usd-first-billing-ui-cleanup.test.tsx` — added `vi.mock("@/contexts/AuthContext", …)` with `isAdmin: true` so their existing assertions (which cover admin-visible operational wording) continue to pass now that customer/admin views diverge.

## Tests run and results

```
bunx vitest run \
  src/tests/payfast-frontend-trust-cleanup.test.tsx \
  src/tests/payfast-customer-only-view.test.tsx \
  src/tests/payfast-usd-first-billing-ui-cleanup.test.tsx \
  src/tests/purchases-list-resolved-refunds.test.tsx \
  src/tests/r2-refund-request-ui-wiring.test.ts

Test Files  5 passed (5)
     Tests  27 passed (27)
```

## Known unrelated CI failures

None encountered in the narrow scope run. Repo-wide CI was intentionally not exercised per task guardrails ("Do not try to fix unrelated repo-wide CI failures").

## Confirmation of scope discipline

- No backend function, edge function, migration, RLS policy, database function, or config changed.
- PayFast checkout, `payfast-itn`, `token-purchase*`, wallet, ledger, `refund_requests`, and settlement-tracking code untouched.
- Paystack code paths remain warm — `PAYSTACK_PUBLIC_ENABLED = false` unchanged; admin QA buttons unchanged; `paystack_reference` column unchanged.
- No ZAR / rate / bank-settlement wording introduced on customer surfaces; customer surface remains USD-first.
- Legacy `src/pages/Billing.tsx` kept in place (still lazy-imported but not mounted on any live route) because six existing tests read the file directly — the file was cleaned in place per audit fallback option 3.
- Claude's PR #31 area (`payfast_settlements`, settlement-tracking runtime) untouched.

Final status: **PAYFAST_FRONTEND_TRUST_CLEANUP_PR_READY**
