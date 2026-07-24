# PayFast Enterprise-Readiness Audit — 2026-07-23

Repository: TSFS-Ops/hemp-nexus-api. Scope: inspection only. No code was changed, no PRs were merged, and no historical rows were mutated. PR #28, PR #29 and PR #30 were not touched. Paystack, PayFast, and wallet/ledger logic were not modified during this audit.

Context confirmed at inspection time: PayFast is the only payment method a normal, non-admin customer can see or use. Paystack is gated behind `PAYSTACK_PUBLIC_ENABLED = false` and is only rendered for admins, labelled "[Admin only]". PR #29, the raw-body ITN signature fallback fix, and PR #28, Paystack admin-only hardening, are both still open and unmerged against main. PR #30, CI debt triage, is unrelated to PayFast logic and was not touched.

## 1. Customer-facing billing flow

Inspected: PaymentMethodPicker.tsx, PurchasesList, the Desk Billing page, Pricing, PayfastReturn.tsx, PayfastCancel.tsx, and the legacy /billing and /dashboard/billing routes.

PaymentMethodPicker.tsx renders PayFast as the default, primary customer button, with USD-first copy such as "Pay $10 with PayFast". Paystack only renders when the caller is an admin, and is explicitly labelled as admin-only, so normal customers never see it. FX and ZAR mechanics, meaning the computed rate and ZAR amount, are gated behind an isAdmin check in the same component, so ordinary customers are not shown ZAR conversion detail on this button. PayfastReturn.tsx and PayfastCancel.tsx were confirmed read-only: both poll purchase status purely for display and neither calls a crediting RPC or writes to Supabase, and the cancel page performs no writes at all. The old /billing route and /dashboard/billing now hard-redirect via React Router's Navigate component to /desk/billing before the legacy page can ever mount.

One non-blocking gap was found here: src/pages/Billing.tsx, a full legacy Paystack-only checkout page, still exists in the repository and is unreachable dead code. This was confirmed both from the App.tsx redirect and from this repo's own test comment describing it as an orphaned shell. It is not a live customer-facing risk, since it cannot be routed to, but it is stale code that should eventually be removed to avoid confusion or accidental re-linking.

Classification: PAYFAST_CUSTOMER_FLOW_READY

## 2. PayFast hosted checkout and USD/ZAR reality

Inspected: PAYFAST_USD_PRICES, PAYFAST_CUSTOMER_PACKAGES, the checkout-time FX snapshot logic, and customer-facing copy across the Billing and Pricing surfaces.

USD is the source of truth for customer pricing, with flat $10, $100, $500 and $2,000 packages and no per-unit discount tiering exposed to customers. PayFast itself is ZAR-native: the ZAR amount is computed server-side from an admin-controlled exchange rate setting at checkout time, and the USD amount, the ZAR amount, and the FX rate actually used are all snapshotted onto the purchase row together with a lock timestamp, so a later admin rate change cannot retroactively alter an in-flight or historical purchase. The customer-facing Izenzo interface is USD-first everywhere checked, while the ZAR and rate detail remains admin-only. No code or copy was found that claims PayFast itself charges the customer in USD; the ZAR conversion is real and happens server-side before redirect, and the actual PayFast-hosted checkout page does display a ZAR amount, which is expected PayFast behaviour rather than a defect, since PayFast settles in ZAR.

Classification: PAYFAST_CURRENCY_DISCLOSURE_READY

## 3. PayFast checkout initiation

Inspected: payfast-checkout-live, payfast-checkout-sandbox, the public checkout helper, the connectivity probe, provider reference generation, package lookup, pending purchase creation, audit logging, idempotency and retry behaviour, and live versus sandbox separation, drawing on the Phase 2C, 2D and 2G test suites and on payfast.ts directly.

A token_purchases row is created with status set to pending before the customer is ever redirected to PayFast, with provider set to payfast and a unique provider_reference generated server-side that the customer cannot supply or influence. The package id, token amount, USD amount, ZAR amount and locked FX rate are all stored on that row at creation time, and an audit log row is written at initiation. Package price, token amount and FX rate are resolved server-side from a fixed registry rather than from client-supplied values, so a customer cannot tamper with amount, package or rate by editing the request payload. Sandbox and live are structurally separated through dedicated sandbox merchant id, key and passphrase constants and process URLs, and the Phase 2G no-regression tests assert the live registry never references sandbox constants and vice versa. Merchant id, merchant key and passphrase are read only from server-side environment variables inside the edge functions, with none present in client bundles.

Classification: PAYFAST_CHECKOUT_INIT_READY

## 4. PayFast ITN verification

Inspected: payfast-itn, the shared PayFast verifier in supabase/functions/_shared/payments/payfast.ts, specifically processPayfastItn and verifyPayfastSignatureFromRawBody, passphrase handling, allowed-IP logic, amount, currency, package and reference matching, pending-purchase lookup, status transition, duplicate handling, and audit logging. PR #29's diff was read directly to confirm the exact defect and its fix.

On main, unpatched, the raw-body signature fallback path in verifyPayfastSignatureFromRawBody only validates the content that appears before the signature field in the raw body. It does not confirm that nothing improper follows the signature value. This means a request whose primary reconstructed-signature check correctly fails, because of appended trailing data, can still incorrectly pass verification through the raw-body fallback path. PR #29 adds a check that the tail of the raw body after the signature field must exactly equal the supplied signature value, or the request is rejected, and this fix exists only on PR #29's branch and is not present on main. Every other inspected ITN behaviour, including the passphrase check, the allowed-IP allow-list, amount, currency, package and reference matching against the pending purchase, the status transition to paid, duplicate-ITN handling, and audit-log writes on both accept and reject, is present and covered by the Phase 2B, 2D and 2F test suites, independent of the PR #29 defect. Because this is a signature-verification bypass on the primary payment-authenticity control, main is not enterprise-ready for ITN verification until PR #29 is merged. Readiness is entirely contingent on merging PR #29, and no other ITN gap was found.

Classification: PAYFAST_ITN_READY_AFTER_PR29

## 5. Wallet and ledger crediting

Inspected: the PayFast crediting path inside processPayfastItn, atomic_paid_credit_purchase, token_ledger, token_wallets and token_balances, request_id uniqueness, provider_reference uniqueness, and idempotency and replay guards.

A valid PayFast ITN credits the wallet exactly once through atomic_paid_credit_purchase, which is guarded by a uniqueness constraint on the crediting request and reference so replays are deduplicated rather than double-credited. Duplicate ITNs, which PayFast is documented to send, are detected and short-circuited before a second credit can occur, and this is covered by dedicated Phase 2B and 2F duplicate-ITN tests. Failed, invalid-signature, or mismatched ITNs never reach the crediting call, since verification happens strictly before crediting. Token wallets, token balances, and the token ledger are written atomically together, and manual or admin corrections such as refund reversals are written through governed RPCs that leave an audit trail rather than through direct table edits. PayFast and Paystack use separate reference columns and namespaces, provider_reference for PayFast versus paystack_reference for Paystack, alongside a shared provider column, so the two cannot collide on reference lookups.

Classification: PAYFAST_LEDGER_CREDITING_READY

## 6. Purchase history and tenant isolation

Inspected: PurchasesList, the list-org-purchases edge function, read in full, RLS assumptions, direct Supabase reads, admin versus customer views, and provider-reference display.

The list-org-purchases function resolves the caller's org_id strictly from their authenticated profile, via the caller's bearer token, before querying token_purchases, and every query is explicitly filtered on that org_id, so a customer cannot see another organisation's purchases through this endpoint. Although the function uses a service-role client for the actual query, bypassing RLS, org scoping is enforced in application code from a server-resolved identity rather than from client-supplied input, so this is not a tenant-isolation gap. Raw token_purchases is not exposed directly to the client; customers only receive the shaped response from this function, plus refund-request status fields. Provider references shown to customers are the safe provider_reference and paystack_reference values already generated server-side, with no secrets or internal-only fields included in the response shape read. Admin-only views such as AdminRevenuePanel and AdminBillingReviewPanel are separate components gated by admin-role checks and are not reachable from this customer-facing endpoint.

Classification: PAYFAST_PURCHASE_HISTORY_TENANT_SAFE

## 7. Admin revenue reporting and reconciliation

Inspected: AdminRevenuePanel.tsx, specifically purchaseFromAuditLog and purchaseFromLedger, audit-log parsing, token-ledger parsing, USD, ZAR and rate field resolution, demo and test exclusions, and the payfast-admin-revenue-visibility-fix-report.md fix history plus its dedicated test file.

An earlier audit found that AdminRevenuePanel.tsx was not correctly surfacing PayFast USD revenue, FX rate or reference for completed PayFast purchases, sometimes falling back to a zero amount or a blank field. This was subsequently fixed: purchaseFromAuditLog and purchaseFromLedger now resolve the USD amount, FX rate and reference through safe fallback chains from the existing checkout-time metadata snapshot, with a dedicated regression test asserting this against the real committed source of both payfast.ts and AdminRevenuePanel.tsx. Demo and test organisations are excluded from revenue totals, confirmed by a dedicated production-safety test, and legacy ZAR-only rows are excluded from USD revenue totals rather than silently mis-added. An admin can trace a PayFast payment end-to-end, from the checkout row through the ITN audit row and the wallet and ledger row to the AdminRevenuePanel display, using the shared provider_reference. No double-counting mechanism was found; the panel reads from the audit log and ledger rather than re-deriving amounts independently per row.

Classification: PAYFAST_ADMIN_REVENUE_READY

## 8. Settlement tracking

The codebase was inspected for any tracking of PayFast's settlement of funds into Izenzo's own bank account, for example at Nedbank, using targeted searches combining settlement, bank and Nedbank with payfast.

No settlement-to-bank tracking exists for PayFast purchases. A provider_settlement_status field does exist in the schema, but it belongs to the refund lifecycle, tracking whether an approved refund's money has actually been returned to the customer, and is unrelated to tracking whether an original PayFast sale has been settled into Izenzo's bank account. AdminRevenuePanel.tsx contains a pending-settlement concept, but this is a manual and legacy-reconciliation safety net for purchases missing clean audit metadata, not a bank-settlement tracker. No field, table, or admin action was found that records a payment as paid but not yet settled to bank, no payout or bank-transfer status exists, and no exception path distinguishes payment success from bank settlement. This is best read as an expected gap for a platform at this stage rather than a defect, since PayFast's own merchant dashboard remains the authoritative source for settlement-to-bank status today, but it does mean the application itself cannot answer whether a specific transaction has reached the bank account without leaving the app.

Classification: PAYFAST_SETTLEMENT_TRACKING_GAP_FOUND

## 9. Refunds and disputes

Inspected: refund_requests, payment_disputes, dec-007-refund-policy.ts, read in full, the admin-refund-approve and admin-refund-decline edge functions, AdminBillingReviewPanel.tsx, refund-settlement.ts, and related SQL migrations and proof tests.

PayFast and Paystack purchases can both be refunded through a governed flow: a customer or admin-initiated refund_requests row is approved or declined by an admin through the admin-refund-approve or admin-refund-decline function, which calls a governance RPC and then the underlying approve_refund RPC, all inside one database transaction. On approval, the token balance is decremented immediately, floored at zero so it cannot go negative, and a token_ledger row with action_type set to refund is inserted, carrying the refund request id as its entity id. A dedicated additive lifecycle field, provider_settlement_status, was added specifically so that an approved status, meaning the internal credit reversal, is never confused with money actually having been returned to the customer's bank or card; reports that mean real money movement must filter on that settlement field rather than on the approved status alone. Idempotency is proven at the SQL level: a proof script shows a second call with the same actor and request id is deduplicated and does not double-debit or re-approve an already-decided refund, and a third call returns a structured already-decided result rather than an error or a silent no-op. Partial refunds create a manual-review admin risk item rather than silently succeeding. Paystack disputes open a soft hold on affected credits without changing balances until resolved, which avoids negative wallet chaos, and PayFast-specific dispute linkage was not found to differ materially in architecture from this shared payment_disputes handling. Provider references are retained on the purchase row throughout the refund lifecycle rather than being cleared, and all admin actions are audited with a reviewer identity and a decision reason.

Classification: PAYFAST_REFUND_DISPUTE_READY

## 10. Alerts and exception queues

Inspected: admin_risk_items, payment-governance.ts, payment-observability.ts, side-effect-reconciliation, HealthBoard.tsx, Status.tsx, and revenue-notification and cron-heartbeat wiring.

admin_risk_items is a mature, idempotent, dedup-keyed exception queue used across the whole payment stack, not just PayFast. Confirmed kinds include payfast_itn_rejected, covering invalid signature, unknown reference, and amount or currency mismatch, raised with high severity; missing_side_effect, raised by side-effect-reconciliation for events with no matching side effect within a tolerance window; balance_drift, raised by a wallet-balance drift detector that never mutates balances itself and only raises the alarm; and auth_email_dead_lettered. Failures in the crediting path that cannot be atomically resolved are recorded into admin_risk_items and audit_logs rather than failing silently. HealthBoard.tsx, at the governance health route, surfaces open admin_risk_items, cron_heartbeats job health, and today's manual-follow-up backlog from audit_logs in one authenticated admin view, with demo and test risk items excluded from production incident counts. Duplicate ITNs and resends update the existing open risk-item row via its dedup key rather than creating noise. Settlement delay and refund or dispute events were not confirmed to raise a dedicated admin_risk_items alert specifically, which is consistent with settlement tracking not existing at all per section 8, and PayFast environment or secret misconfiguration was not confirmed to raise a dedicated alert either; these are the residual watch items in an otherwise comprehensive monitoring system.

Classification: PAYFAST_EXCEPTION_MONITORING_READY

## 11. Operational runbooks

Docs were inspected for a PayFast live smoke test, a sandbox test, ITN resend or manual replay procedures, settlement reconciliation, refund and dispute handling, emergency disabling, secret rotation, and incident response.

A general launch runbook and a handover document exist, covering the overall product launch event, the first twenty-four hours checklist, and the general release-gate process, but these are not PayFast-specific operational procedures. Numerous PayFast phase reports exist, spanning phase 2A through 2J plus sandbox dashboard reports, which are valuable point-in-time evidence and audit records of what was built and tested, but they read as historical engineering reports rather than a living, consolidated operational runbook that an on-call engineer or support agent could follow step by step during an incident. No dedicated document was found covering how to manually resend or replay a missed or failed PayFast ITN in production, how to reconcile PayFast settlement against the bank statement, step-by-step refund and dispute handling instructions for support staff, how to emergency-disable PayFast checkout, noting that the PAYFAST_PUBLIC_ENABLED flag already exists in code and could serve this purpose even though no runbook documents the procedure, blast radius, or rollback steps for flipping it, or how to rotate the PayFast merchant key and passphrase safely. This is a documentation gap rather than a code gap, since the underlying mechanisms for several of these, such as the feature flag, the idempotent risk items, and the audit logs, already exist in code; they are simply not packaged into an operator-facing runbook.

Classification: PAYFAST_RUNBOOKS_GAP_FOUND

## 12. Tests and CI

PayFast test coverage was inspected across src/tests, where 35 files matched a payfast search, and across the supabase/tests SQL proof suites.

Checkout initiation, sandbox versus live separation, and provider-identity boundaries are covered by the Phase 2C checkout test, the Phase 2B helpers test, the Phase 2A provider-identity test, and the Phase 2B, 2C, 2D and 2G no-regression test family. Valid ITN, invalid signature, and duplicate-ITN handling are covered by the Phase 2B ITN test and the Phase 2D end-to-end test, including assertions against admin_risk_items rows of kind payfast_itn_rejected. Wallet-credit-once behaviour, admin revenue reporting, purchase-history and tenant safety, return and cancel read-only behaviour, and Paystack being hidden from customers are each covered by dedicated tests, including the admin-revenue-visibility-fix test, the customer-only-view test, the USD-first billing UI cleanup test, and the Phase 2J customer-rollout test. The specific raw-body appended-data tamper case that PR #29 fixes was not found to have a dedicated passing regression test on main, which is consistent with the defect itself still being present on main; readiness of test coverage for this exact case depends on PR #29 landing together with its own test, in the same way that ITN readiness does. No currency-mismatch-specific PayFast test was independently confirmed line by line in this pass, although amount, reference and package mismatch tests were confirmed; this is a minor residual verification gap for the roadmap rather than a known defect.

Classification: PAYFAST_TEST_COVERAGE_READY_AFTER_PR29

## 13. Enterprise-readiness roadmap

Priority 1, merge PR #29. This closes the ITN signature-verification bypass described in section 4. It is a code change, already written and reviewed-pending on PR #29's branch, risk level high because it is a payment-authenticity control, and the recommended action is simply to review and merge the existing PR #29 rather than open a new branch. Tests needed are a dedicated raw-body appended-data tamper regression test if PR #29 does not already include one; this item is the definition of "depends on PR #29" and does not depend on PayFast confirming multi-currency checkout.

Priority 2, add a dedicated raw-body tamper regression test and a currency-mismatch regression test to the PayFast ITN suite, tracked in section 12. This is a CI and test-coverage change, risk level medium, recommended as a small follow-up branch such as test/payfast-itn-tamper-and-currency-coverage, ideally bundled with or immediately after the PR #29 merge so the fix and its proof land together. It depends on PR #29 and does not depend on multi-currency PayFast confirmation.

Priority 3, build a PayFast settlement-to-bank tracking capability, described in section 8. This is primarily a provider and business-process item, since it requires deciding how settlement confirmation reaches the app, for example a manual admin entry, a bank-statement import, or a PayFast payout API if one exists, with a secondary code component to store and display that status. Risk level is low to medium, since its absence is an operational visibility gap rather than a security or correctness defect. Recommended as a new branch such as feature/payfast-settlement-tracking, with tests covering that recording a settlement confirmation never mutates the original purchase or ledger rows and that the exception path for paid-but-not-settled is surfaced to admins. This does not depend on PR #29 and does not depend on PayFast confirming multi-currency checkout.

Priority 4, write a consolidated PayFast operational runbook, described in section 11, covering live smoke testing, sandbox testing, manual ITN resend or replay, settlement reconciliation once section 8 is addressed, refund and dispute handling steps for support staff, emergency-disable procedure and blast radius for the existing PAYFAST_PUBLIC_ENABLED flag, and secret rotation steps for the merchant id, key and passphrase. This is a documentation-only item, risk level low, recommended as a docs branch such as docs/payfast-operational-runbook, with no code tests needed beyond confirming any commands or scripts referenced in the runbook actually exist and run as described. It does not depend on PR #29 and does not depend on multi-currency confirmation, though it should reference the PR #29 fix once merged.

Priority 5, remove the orphaned src/pages/Billing.tsx legacy checkout page described in section 1, once the team is confident nothing internal still references it. This is a small code cleanup item, risk level low given it is already unreachable, recommended as part of routine housekeeping rather than an urgent branch, with a test asserting the route and any remaining imports are fully removed. It does not depend on PR #29 and does not depend on multi-currency confirmation.

Priority 6, extend the admin_risk_items exception system, described in section 10, to explicitly cover settlement delay once section 8 exists, refund and dispute admin-queue notifications, and PayFast environment or secret misconfiguration at startup. This is primarily a code and observability change, risk level low to medium, recommended as a follow-up branch such as feature/payfast-exception-coverage-extension, with tests asserting each new alert kind is raised idempotently with a stable dedup key, following the existing pattern. It does not depend on PR #29 directly, though the new misconfiguration alert should also cover any new PR #29-related configuration if applicable, and it does not depend on multi-currency confirmation.

None of the priorities above depend on PayFast confirming native USD or multi-currency checkout support, because the current architecture already treats USD as the customer-facing source of truth and computes ZAR server-side for PayFast's benefit; if PayFast were to later offer native USD settlement, that would be a separate, larger currency-architecture change requiring its own dedicated audit rather than a roadmap line item here.

## Report

Branch created from main: audit/payfast-enterprise-readiness-2026-07-23. File created on that branch: docs/payfast-enterprise-readiness-audit-2026-07-23.md. No pull request was opened, per instructions. No code was changed, no PRs were merged, and no historical rows were mutated during this audit.

Summary of classifications: PAYFAST_CUSTOMER_FLOW_READY, PAYFAST_CURRENCY_DISCLOSURE_READY, PAYFAST_CHECKOUT_INIT_READY, PAYFAST_ITN_READY_AFTER_PR29, PAYFAST_LEDGER_CREDITING_READY, PAYFAST_PURCHASE_HISTORY_TENANT_SAFE, PAYFAST_ADMIN_REVENUE_READY, PAYFAST_SETTLEMENT_TRACKING_GAP_FOUND, PAYFAST_REFUND_DISPUTE_READY, PAYFAST_EXCEPTION_MONITORING_READY, PAYFAST_RUNBOOKS_GAP_FOUND, PAYFAST_TEST_COVERAGE_READY_AFTER_PR29.

Because three of the twelve areas resolved to a gap-found or PR-29-contingent state rather than an unconditional ready state, PayFast is not yet fully enterprise-ready in its current main-branch form. The single highest-priority blocker is the unmerged PR #29 ITN signature-verification fix; the remaining gaps, settlement tracking and operational runbooks, are real but lower-severity operational maturity gaps rather than active security defects.

Final status: PAYFAST_ENTERPRISE_READINESS_AUDIT_COMPLETE
