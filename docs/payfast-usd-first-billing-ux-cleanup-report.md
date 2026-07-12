# PayFast USD-First Customer Billing UI Cleanup - Phase A Report

Status: display-layer cleanup only. No PayFast checkout, ITN, Paystack, wallet-crediting, token-ledger, or FX-rate-storage logic was changed while producing this document or the underlying commits.

This report follows the read-only audit in docs/payfast-usd-first-billing-ux-audit.md (status: PAYFAST_USD_FIRST_BILLING_AUDIT_COMPLETE_WITH_ADMIN_VISIBILITY_FOLLOW_UP). It closes the single real, fixable finding from that audit: PaymentMethodPicker.tsx was showing normal customers a computed PayFast ZAR amount and an explicit FX-rate disclosure line. The admin revenue-visibility issue noted in the audit is out of scope here and is deferred to Phase B, per instruction.

## 1. Files changed

Three display components were edited: src/components/desk/billing/PaymentMethodPicker.tsx (customer-facing PayFast button and note wording; FX/ZAR-rate note is now admin-only), src/components/desk/billing/BillingOverview.tsx (simplified the Provisioning section's technical label), and src/components/desk/billing/PurchasesList.tsx (PayFast purchase-history rows now lead with the USD amount instead of "ZAR via PayFast"). Two test files were also changed: src/tests/payfast-customer-only-view.test.tsx was extended with USD-first, no-ZAR, and no-admin-wording assertions for normal customers plus an admin-visibility assertion for the FX note, and a new file src/tests/payfast-usd-first-billing-ui-cleanup.test.tsx was added with guards for the PurchasesList row wording and the BillingOverview label. No files under supabase/functions/ were touched, and no PayFast/Paystack checkout, ITN, webhook, ledger, or wallet-crediting source was touched.

## 2. Customer-facing wording: before and after

PaymentMethodPicker PayFast button. Before: "Pay R{zar} via PayFast" (ZAR-first, shown to all eligible customers). After: "Pay {usd} with PayFast" (e.g. "Pay $10 with PayFast"), USD-first, falling back to plain "Pay with PayFast" if the USD price is not yet resolved.

PaymentMethodPicker FX/rate disclosure note. Before: shown to ALL customers whenever PayFast was eligible, reading "{usd} - PayFast amount: R{zar} - Rate used: $1 = R{rate}". After: the same technical note, now rendered only when isAdmin is true, carrying data-admin-only="true" on its existing data-testid. Normal customers never see it.

PaymentMethodPicker customer note. Before: a three-line note reading "Credits are priced in USD. PayFast charges the ZAR amount shown before payment. The rate is set by Izenzo and locked when checkout starts." (visible to all customers, naming ZAR/rate explicitly). After: a single neutral line with no ZAR or rate mentioned, reading "Credits are priced in USD. PayFast will show the final payment amount before you confirm payment."

BillingOverview Provisioning label. Before: "USD - Native settlement". After: "USD pricing".

PurchasesList PayFast purchase rows. Before: "{credits} credits - ZAR via PayFast" (ZAR named as the main summary, no USD figure shown). After: "{credits} credits - $X.XX USD via PayFast" (USD package price first, matching the existing Paystack row format "$X.XX USD via Paystack").

Paystack is unchanged: normal customers still see no Paystack option (PAYSTACK_PUBLIC_ENABLED = false), and admins still see "[Admin only] Pay {usd} via Paystack" with data-admin-only="true".

## 3. Backend logic confirmed unchanged

No backend, edge-function, or Supabase source file was opened for editing in this phase; only the three billing display files named above and two test files were touched, so backend behaviour is unchanged by construction. As background, the prior audit (docs/payfast-usd-first-billing-ux-audit.md, section 2) already confirmed the checkout edge function (supabase/functions/_shared/payments/payfast-public-checkout.ts) computes and sends the ZAR amount to PayFast, and snapshots price_usd, amount_usd, usd_zar_rate, fx_rate_locked_at, fx_rate_source, amount_zar, price_zar, provider, provider_reference, package_id, token_amount/credits, mode, and currency into both token_purchases.metadata and the credits.purchase_initiated audit-log row at checkout start. None of that was touched. PayFast ITN crediting, wallet crediting, token-ledger logic, and the Paystack webhook/checkout code path were likewise not opened or modified. Return/cancel pages (PayfastReturn.tsx, PayfastCancel.tsx) were re-checked against the audit's findings; both remain read-only and free of ZAR/rate/settlement wording, so no changes were needed there.

## 4. Admin visibility

Retained, not removed: the FX/ZAR-rate note in PaymentMethodPicker still exists in full (same fields: USD price, PayFast ZAR amount, rate used), now gated behind isAdmin rather than deleted, so platform admins retain the same technical visibility they had before. The admin-only Paystack option and its "[Admin only]" labelling and data-admin-only="true" attribute are unchanged. The admin FX-rate editor (AdminPayfastPricingReview, referenced in the audit) was not touched.

Explicitly deferred to Phase B, per instruction, and not fixed here: the admin revenue-visibility gap flagged in the audit (AdminRevenuePanel.tsx and PayFast audit-log metadata) is unchanged and remains open for Phase B.

## 5. Tests added/updated

In src/tests/payfast-customer-only-view.test.tsx, the "renders PayFast and hides Paystack for normal customers" test was extended to assert the PayFast button text matches /\$10/ and does not match /R\d/, that "Rate used" and "PayFast amount" text are absent, and that payment-method-fx-note-single is not rendered for normal customers. The "shows Paystack as [Admin only] for platform admins" test was extended to assert the admin-visible FX note carries data-admin-only="true".

The new file src/tests/payfast-usd-first-billing-ui-cleanup.test.tsx renders PurchasesList with one PayFast row and one Paystack row and asserts the PayFast row text matches /\$10\.00 USD via PayFast/ and does not match /ZAR via PayFast/, with the Paystack row unaffected; it also reads BillingOverview.tsx source and asserts it no longer matches /Native settlement/ and does match /USD pricing/.

Existing tests were reviewed for regression risk and confirmed not broken by this phase's wording changes: src/tests/payfast-phase-2j-customer-rollout.test.ts (source-text checks target Paystack gating/pricing flags, not the specific customer wording changed here), src/tests/payfast-phase-2d-no-regression.test.ts (allowlist-based, not content-string based), src/tests/payfast-phase-2d-end-to-end.test.tsx (only checks billing-purchase-ref reference values, not row wording), and src/tests/purchases-list-resolved-refunds.test.tsx (targets refund-status badges, not the provider summary line).

## 6. Tests run

This session has browser-automation tools only (no local shell, package manager, or test runner access), so vitest could not be executed directly. In place of execution, every change was verified by re-fetching the committed file content from GitHub after each commit and confirming that the exact expected strings are present, the exact prior/undesired strings are absent, and the file is syntactically well-formed (no duplicated tags, no stray characters) by full-content review. One such review caught and fixed a duplicated dollar-sign character left over from an earlier edit to PurchasesList.tsx, corrected in a follow-up commit before the new test file was committed. CI should still run the full vitest suite, including the two files listed in section 5, before this is considered fully verified.

## 7. Remaining PayFast-provider dependency

PayFast is still charged in ZAR under the hood; Izenzo has not received confirmation from PayFast that native USD or multi-currency checkout is supported. Per instruction, this phase does not claim otherwise and does not change the ZAR amount sent to PayFast, the FX-rate storage, or the checkout/ITN logic. If PayFast later confirms USD support, a follow-up phase would be needed to actually charge in USD, which is a backend/checkout change and out of scope here.

## 8. Remaining Phase B issue

The admin revenue-visibility gap identified in the audit (PayFast revenue not fully reflected in AdminRevenuePanel.tsx and audit-log metadata) remains open and unresolved. It was not touched in this phase and is deferred to Phase B as instructed.

## Final status

PAYFAST_USD_FIRST_BILLING_UI_READY
