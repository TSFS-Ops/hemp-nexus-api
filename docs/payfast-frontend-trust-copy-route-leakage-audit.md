# PayFast Frontend Trust, Copy, Route and Leakage Audit

Status: **PAYFAST_FRONTEND_TRUST_AUDIT_READY**
Scope: read-only frontend audit. No code changed. No PR. No backend/edge/RLS/migration touched.

Auditor guardrails honoured:
- Did not modify PayFast checkout, ITN, wallet, ledger, or Paystack code.
- Did not build UI or edit copy.
- Did not create backend or CI work.
- Deliverable is this document only.

---

## 1. Executive Summary

PayFast is now the sole customer-facing payment surface, and the return / cancel pages (`/desk/billing/payfast/return`, `/desk/billing/payfast/cancel`) are correctly non-crediting, poll-only, and truthful about the fact that credit is issued only after verified ITN. `PaymentMethodPicker` correctly hides Paystack behind `PAYSTACK_PUBLIC_ENABLED = false` for normal customers and preserves an admin-only "warm" path.

However, there is real residual Paystack leakage into the customer surface — not in checkout, but in **microcopy, purchase history, refund messages, marketing pricing, and legacy `/pages/Billing.tsx` verify logic**. That page is still reachable via redirect fallbacks in several tests, is loaded by `Billing` container patterns, and still uses Paystack-only language ("Check your email for a Paystack receipt", "Payments processed securely by Paystack"). It also carries a legacy `paystack_reference` column display and a refund tooltip that names Paystack to customers.

There is **no** bank-settlement / ZAR / rate-used leakage on customer surfaces today — those concepts live only in admin panels (`AdminRevenuePanel`, `AdminBillingReviewPanel`, `AdminPayfastPricingReview`), which is correct. USD-first framing is intact end-to-end for the customer.

The three highest-risk items are:

1. **Legacy `src/pages/Billing.tsx`** — still contains Paystack-only success/failure/receipt copy and a Paystack-only verify path. Some tests still target it; it is the single largest surface for customer-visible Paystack leakage.
2. **`PurchasesList` customer row** — renders the `Paystack` provider badge, `via Paystack`, `paystack_reference`, and a refund tooltip that names Paystack to end customers.
3. **`Pricing.tsx` public marketing** — public footnote reads "Charged in USD at checkout via Paystack." Public prospects are being told the customer-facing processor is Paystack, which is now false.

Everything else is either safe, admin-scoped, or a naming-hygiene cleanup.

---

## 2. Findings Table (risk-ranked)

| # | ID | Area | Severity | File / Route | Summary |
|---|----|------|----------|--------------|---------|
| 1 | CUSTOMER_PROVIDER_LEAK | Marketing | High | `src/pages/Pricing.tsx:269` | Public pricing footnote names Paystack as the customer checkout processor. |
| 2 | CUSTOMER_PROVIDER_LEAK | Legacy billing | High | `src/pages/Billing.tsx:586,726` | "Paystack receipt", "Payments processed securely by Paystack" shown to customers. |
| 3 | CUSTOMER_PROVIDER_LEAK | Purchase history | High | `src/components/desk/billing/PurchasesList.tsx:150,164,175,180,194` | Customer rows show `Paystack` badge, "via Paystack", `paystack_reference` code, and a Paystack-named refund tooltip. |
| 4 | CUSTOMER_PROVIDER_LEAK | Refund copy | Medium | `PurchasesList.tsx:150` | "Refund approved — provider settlement pending" + "(Paystack) confirmation that funds have been returned" leaks *both* provider name *and* the word "settlement" to the customer. |
| 5 | ROUTE_HYGIENE | Reachability | Medium | `src/App.tsx:348,362` | `/billing` and `/dashboard/billing` still exist; they only redirect, but consumers of `Billing.tsx` are still wired in the code. |
| 6 | ORPHAN_CODE | Stale page | Medium | `src/pages/Billing.tsx` (whole file) | Superseded by `BillingOverview.tsx` + `/desk/billing`. Not the router entry, but still imported/tested and drifting from new PayFast-only reality. |
| 7 | LOCAL_STORAGE_LEAK | Client persistence | Low | `PaymentReferenceStatus.tsx:36` | `localStorage` key literally `izenzo.billing.paystack-attempts.v1`. Customer-observable in devtools. |
| 8 | NAMING_HYGIENE | Types / helpers | Low | `PaymentReferenceStatus.tsx` `PaystackAttempt`, `recordPaystackAttempt`, `paystackStatus` fields on `apiFetch` responses | Names are Paystack-shaped but describe a generic checkout attempt; not visible to customers, but a trap for future copy. |
| 9 | ADMIN_INTENDED (safe) | Test / dev buttons | Info | `PayfastLiveSmokeTestButton.tsx`, `PayfastSandboxTestButton.tsx` | Guarded behind `isAdmin`; wording is admin-facing and names Paystack correctly. |
| 10 | NO_CURRENCY_LEAK_FOUND | Customer copy | Pass | `BillingOverview.tsx`, `PayfastReturn.tsx`, `PayfastCancel.tsx`, `PaymentMethodPicker.tsx` | No ZAR / Rand / "rate used" / "bank settlement" strings surface to the customer. |
| 11 | NO_PROVIDER_LEAK_FOUND | Return / cancel | Pass | `src/pages/desk/billing/PayfastReturn.tsx`, `PayfastCancel.tsx` | Non-crediting, poll-only, truthful; ITN clearly identified as the only credit path. |
| 12 | ADMIN_INTENDED (safe) | Revenue console | Pass | `AdminRevenuePanel.tsx` | ZAR legacy rows / `credits.purchased` / `payment_reference` correctly scoped to `/hq` + admin RLS. |

---

## 3. Route Inventory

Customer-facing (reachable, in-app):

- `/desk/billing` → `BillingOverview.tsx`. USD-first. Uses `PaymentMethodPicker` (PayFast primary; Paystack hidden for non-admin). ✅ Primary surface.
- `/desk/billing/payfast/return` → `PayfastReturn.tsx`. Non-crediting, poll-only, truthful copy. ✅
- `/desk/billing/payfast/cancel` → `PayfastCancel.tsx`. Static "no charge" page. ✅
- `/pricing` → `Pricing.tsx`. Public marketing. ⚠️ Paystack named in footnote.

Legacy / redirect only (should not render customer-facing Paystack):

- `/billing` → `<Navigate to="/desk/billing" replace />` (App.tsx:348). ✅ redirect only.
- `/dashboard/billing` → `<LegacyRedirect to="/desk/billing" label="Billing" />` (App.tsx:362). ✅ containment.
- `src/pages/Billing.tsx` — **not** mounted directly by any live route, but the file still exists, still imports `PayfastSandboxTestButton`, `AdminPayfastPricingReview`, `PurchasesList` and is targeted by ≥6 tests (`payfast-usd-first-billing-ui-cleanup`, `payfast-phase-2d-end-to-end`, `token-purchase-billing-availability-source`, `billing-availability-guard`, `purchases-list-resolved-refunds`, `payfast-customer-only-view`). Any future dev who wires it back in will re-expose Paystack-only copy. **Recommend deletion after tests are re-pointed at `BillingOverview.tsx`.**

Docs / admin routes touching payments (should never be customer-reachable):

- `/hq/revenue*` → `AdminRevenuePanel`. Admin/auditor only. ✅
- `/admin/billing-review` and equivalents → `AdminBillingReviewPanel`. Admin only. ✅
- `/docs/api-pricing` → `DocsApiPricing`. Public docs; does not surface Paystack. ✅

Reconciliation surface **does not yet exist** in the app router — recommended path `/hq/revenue/reconciliation` (see §7).

---

## 4. Currency / Settlement Leakage

Searched customer surfaces (`src/pages/Billing.tsx`, `src/pages/desk/billing/`, `src/components/desk/billing/`) for `\bZAR\b`, `Rand`, `bank settl`, `settlement`, `rate used`, `native settlement`, `PayFast amount`:

- **No** customer-facing occurrences of ZAR / Rand / rate used / bank settlement / native settlement. ✅
- One customer-facing occurrence of the word **settlement** in `PurchasesList.tsx:150` — the refund badge says *"Refund approved — provider settlement pending"* and the tooltip says *"awaiting payment-provider (Paystack) confirmation that funds have been returned"*. This double-leaks provider + settlement vocabulary into the customer surface. Flagged as **CUSTOMER_PROVIDER_LEAK** + **CUSTOMER_CURRENCY_LEAK-adjacent**.
- `AdminRevenuePanel.tsx`, `AdminBillingReviewPanel.tsx`, `AdminPayfastPricingReview.tsx` legitimately reference ZAR, `metadata.price_zar`, `payment_reference`, `credits.purchase_initiated`. Correct, admin-only.

Verdict: **NO_CURRENCY_LEAK_FOUND** except item #4 in the findings table.

---

## 5. Recommended Microcopy (customer-facing, USD-first, provider-neutral where appropriate)

These are **recommendations only**; no copy has been changed.

| State | Recommended copy |
|-------|------------------|
| Payment successful | "Payment confirmed. **N** credits added to your wallet. New balance: **X** credits." |
| Payment pending / settling | "We're confirming your payment with PayFast. Your credits will appear automatically once payment is confirmed — this usually takes under a minute. You can safely close this page." |
| Payment failed | "Payment was not successful. Your card was not charged. Please try again, or contact support@izenzo.co.za if this keeps happening." |
| Checkout cancelled | "You cancelled the payment at PayFast. No charge was made and no credits were added." |
| Credits available | "**X** credits available. 1 credit = $1.00 USD, charged in USD at checkout." |
| Refund under review | "Refund request received. Our team is reviewing it. If approved, funds are returned by the original payment method — this can take several business days." *(Do not name the provider, do not use the word "settlement", do not promise a date.)* |
| Dispute under review | "This purchase is under dispute review. Wallet credits linked to this purchase may be held until the dispute is resolved." |
| Purchase history row | "**N** credits · $X.XX USD · PayFast · Ref `xxxx`" (drop the Paystack branch when Paystack is customer-hidden; keep an internal-only tooltip if needed for admin impersonation). |

Terms customers should **never** see: `settlement`, `bank settlement`, `provider settlement`, `Paystack`, `ZAR`, `Rand`, `rate used`, `native settlement`, `provider_reference` (label — value is fine as `Ref`), `m_payment_id`, `paystack_reference`.

---

## 6. Stale Code Cleanup List

| File / Route / Component | Reachable? | Customer-facing? | Recommendation | Risk |
|--------------------------|------------|------------------|----------------|------|
| `src/pages/Billing.tsx` | Not via router; via tests + potentially imports | Would be, if re-mounted | **Delete** after re-pointing tests at `BillingOverview.tsx` (or explicitly annotate `@deprecated` + remove Paystack-only copy) | High |
| `src/components/desk/billing/PurchasesList.tsx` Paystack branch (lines ~150, 164, 175, 180, 194) | Yes | Yes | Replace Paystack branding with provider-neutral "PayFast" or "Card" for the customer view; keep a separate admin view | High |
| `src/pages/Pricing.tsx:269` footnote | Yes | Yes (public) | Reword: "All prices in USD. Charged in USD at checkout." | High |
| `src/components/desk/billing/PaymentReferenceStatus.tsx` (localStorage key + `PaystackAttempt` type) | Yes | Devtools-visible | Rename type + key to `CheckoutAttempt` / `izenzo.billing.checkout-attempts.v1`; keep migration for old key | Low |
| `src/components/desk/billing/PendingPurchaseNotice.tsx` header comments naming Paystack | Yes | Only comments | Update comments; no user-visible change | Info |
| `src/components/desk/billing/CheckoutErrorNotice.tsx` docstring "Paystack checkout-initiation" | Yes | Only docstring | Update to "PayFast checkout initiation" | Info |
| `src/components/desk/billing/PayfastSandboxTestButton.tsx` / `PayfastLiveSmokeTestButton.tsx` | Admin only | No | Leave alone (admin QA) | Info |
| `/billing` and `/dashboard/billing` redirects | Yes (as redirects) | No | Keep — they are the containment | Info |

Explicitly **not** in scope for cleanup: everything under `AdminRevenuePanel`, `AdminBillingReviewPanel`, `AdminPayfastPricingReview` — those are admin surfaces and Paystack references there are correct.

---

## 7. Reconciliation Console — Frontend Acceptance Criteria (for future build)

Aligned with `docs/payfast-admin-reconciliation-console-ui-audit.md` and `docs/payfast-enterprise-operations-runbook.md`.

**Route access**
- `/hq/revenue/reconciliation` mounted inside `/hq`.
- Phase 1: `platform_admin` only. Phase 2: read-only for `auditor`.
- 404 (not 403) for `org_admin`, `funder_*`, `dev_*`, unauthenticated. Never appears in customer or funder nav.

**Summary cards (6)**
1. Purchases awaiting settlement (count + USD)
2. Settled today (count + USD)
3. Overdue (past expected settlement window, count + USD)
4. Exceptions (manual attention required)
5. Refunds awaiting provider return
6. Disputes open

**Filters** — date range, status (`pending / delayed / confirmed / exception`), provider (`payfast` default, `paystack` legacy toggle), org, has-bank-ref, has-note, amount range (USD).

**Table columns** — Purchase ID · Org · Created (UTC) · Expected settlement · Actual settlement · USD amount · ZAR captured amount · Provider ref · Bank ref · Status badge · Last actor · Row menu.

**Audit drawer** — full timeline of `payfast_settlements` state transitions, actor, note, bank ref, linked `audit_logs` entries, ITN payload hash. Read-only. Copyable JSON.

**Export** — CSV + JSON of filtered set. Server-side generated. Watermarked with actor + timestamp. Never includes raw card / bank credentials.

**Row actions (audited, never mutate wallet/ledger)**
- Mark confirmed (with bank ref, required note)
- Mark delayed (with reason)
- Mark exception (with severity + note)
- Add / edit operational note
- Attach bank reference
- Link to related refund / dispute
- Open audit drawer

**States**
- Empty: "No purchases match these filters."
- Loading: skeleton for cards + table rows.
- Error: inline banner + retry; never blank.
- Degraded (backend unavailable): read-only banner "Reconciliation backend unreachable — showing last cached snapshot" + disable all row actions.

**Hard invariants**
- No wallet / ledger / `token_purchases` / PayFast payload mutation from the UI.
- No customer route ever reaches this console.
- Paystack rows appear only under an explicit "Legacy / internal" toggle, styled distinctly and never in the default view.

---

## 8. Frontend Test Plan

| # | Test | Type | Notes |
|---|------|------|-------|
| 1 | Customer sees PayFast button, does not see Paystack button | Vitest (RTL) | Extend `payfast-customer-only-view.test.tsx` to also assert Paystack CTA absent for non-admin. |
| 2 | Admin still sees `[Admin only] Pay via Paystack` | Vitest | `PaymentMethodPicker` with `isAdmin=true`. |
| 3 | `PurchasesList` never renders `paystack_reference` or the Paystack badge for customer role | Vitest | New — currently fails per finding #3. |
| 4 | Refund badge/tooltip does not contain the words "Paystack" or "settlement" for customer role | Vitest | New. |
| 5 | `/pricing` footnote does not mention Paystack | Vitest (snapshot on the footnote node) | New — currently fails. |
| 6 | `PayfastReturn` never writes to wallet/ledger and shows correct copy per status | Vitest | Already covered by `payfast-phase-2j-customer-rollout.test.ts`; extend to assert no `insert`/`update` calls on `token_balances` / `token_ledger`. |
| 7 | `PayfastCancel` shows "no charge, no credits" static copy | Vitest | Trivial snapshot. |
| 8 | `/billing` and `/dashboard/billing` redirect to `/desk/billing` | Playwright | New e2e; assert final URL + no flash of Paystack copy. |
| 9 | `/hq/revenue/reconciliation` returns 404 for customer / funder / dev roles | Playwright | Once backend is live. |
| 10 | Customer never sees ZAR / Rand / "bank settlement" strings on any `/desk/**` route | Playwright | Crawl `/desk/billing`, `/desk/billing/payfast/return?m_payment_id=fake`, `/desk/billing/payfast/cancel`, assert none of the banned tokens present in DOM text. |
| 11 | Admin can see ZAR + `payment_reference` on `AdminRevenuePanel` | Vitest / Playwright | Ensure the audit surface is not accidentally scrubbed by frontend cleanup. |
| 12 | Legacy `Billing.tsx` is not reachable by any router entry | Vitest | Parse `App.tsx` routes; assert `Billing` import is not registered as `element=`. |
| 13 | Refund UI never claims "instant refund"; renders review-only wording | Vitest | Assert on `RefundRequestDialog` copy. |
| 14 | Dispute UI never mentions settlement exceptions | Vitest | New. |
| 15 | Reconciliation row actions never touch `token_balances` / `token_ledger` client-side | Vitest | Once console is built; mock supabase client and assert forbidden tables never invoked. |

Vitest / component: 1, 2, 3, 4, 5, 6, 7, 11 (component), 12, 13, 14, 15.
Playwright / e2e: 8, 9, 10, 11 (route access).

---

## 9. Do-Not-Build / Do-Not-Change Warnings

- Do **not** change PayFast checkout, `payfast-itn`, `token-purchase*`, wallet, or ledger code as part of copy cleanup.
- Do **not** remove Paystack code paths or feature flag (`PAYSTACK_PUBLIC_ENABLED`). It must remain warm and admin-testable.
- Do **not** wire customer surfaces to `payfast_settlements` (once it exists). Only admin surfaces may read it.
- Do **not** create the reconciliation UI until Claude's backend proof (`payfast_settlements` + settlement RPCs) is signed off.
- Do **not** rename `token_purchases.paystack_reference` from the client — it is a persisted column read by admin panels.
- Do **not** delete `src/pages/Billing.tsx` until every test file listed in §3 has been re-pointed at `BillingOverview.tsx`.
- Do **not** introduce ZAR, "rate used", "bank settlement" strings into any `/desk/**` surface.

---

## 10. Recommended Next Lovable Task (after Claude's backend proof passes)

**"PayFast Frontend Trust Cleanup — Small Batch, UI-Only"**

1. Rewrite `Pricing.tsx` footnote to drop Paystack.
2. Reword customer branches of `PurchasesList.tsx` (badge, "via …", `paystack_reference` label, refund tooltip) to be provider-neutral / PayFast-only for non-admin.
3. Delete `src/pages/Billing.tsx` and re-point the six existing tests at `BillingOverview.tsx`.
4. Rename the `PaystackAttempt` type + localStorage key to `CheckoutAttempt` / `izenzo.billing.checkout-attempts.v1` (with one-time key migration).
5. Add the new Vitest cases listed in §8 (#1, #3, #4, #5, #12).
6. Add the Playwright banned-tokens crawl (#10).
7. Only **after** the backend proof: scaffold `/hq/revenue/reconciliation` shell per §7 (empty-state + role gating first; row actions come in a later batch).

Explicit non-goals for that task: no schema, no RLS, no edge functions, no wallet/ledger touches, no Paystack removal.

---

Final status: **PAYFAST_FRONTEND_TRUST_AUDIT_READY**
