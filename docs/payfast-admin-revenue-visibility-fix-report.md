# PayFast Admin Revenue Visibility Fix — Phase B

Status: PAYFAST_ADMIN_REVENUE_VISIBILITY_FIXED

This report documents Phase B, which fixes the admin revenue visibility gap left open by Phase A (see docs/payfast-usd-first-billing-ux-audit.md and docs/payfast-usd-first-billing-ux-cleanup-report.md). Phase A made the customer-facing Billing UI USD-first and PayFast-only. This phase does not touch customer UI, PayFast checkout amount logic, PayFast ITN validation, wallet crediting, ledger idempotency, or Paystack. It fixes only what AdminRevenuePanel.tsx surfaces for completed PayFast purchases.

## Root cause

PayFast checkout initiation (supabase/functions/_shared/payments/payfast-public-checkout.ts) has always snapshotted the correct commercial numbers into token_purchases.metadata at the moment a customer starts checkout: amount_usd, price_usd, usd_zar_rate, fx_rate_locked_at, amount_zar, price_zar and more. That data was never lost. The gap was downstream of it.

When the PayFast ITN handler (processPayfastItn in supabase/functions/_shared/payments/payfast.ts) confirmed a COMPLETE settlement, its success-path audit insert wrote a credits.purchased row whose metadata carried only the ZAR-side fields (provider, provider_reference, pf_payment_id, price_zar, amount_gross_zar, mode, plus crediting bookkeeping). It never copied the USD price, the FX rate or a payment_reference/reference field across from the purchase row it had just read.

AdminRevenuePanel.tsx contains a function named purchaseFromAuditLog that reads exactly that settlement-time audit row, not the checkout-time token_purchases.metadata. Its USD figure comes from meta.price_usd, its FX figure from meta.fx_rate/meta.legacy_fx_rate, and its reference from meta.payment_reference/meta.reference. None of those keys existed on a PayFast settlement row, so a completed PayFast purchase surfaced as $0 USD revenue with a blank FX-rate column and a blank reference column, even though every one of those numbers had been captured correctly at checkout. The panel isNativeUsd gate (meta.currency === "USD" || meta.fx_basis === "native_usd" || legacy_zar === 0) also excluded PayFast rows from USD totals on purpose, because that gate exists to stop pre-cutover Paystack ZAR rows from double-counting, and it had no PayFast-specific carve-out.

## Files changed

supabase/functions/_shared/payments/payfast.ts — the credits.purchased success-path audit insert (step 12 of processPayfastItn) now reads the purchase row checkout-time metadata and copies the USD/FX/reference fields onto the settlement audit row. Nothing else in this file changed: signature verification, IP allowlist, replay guard, validate post-back, status mapping, amount/currency/package checks, the atomic_paid_credit_purchase RPC call and its arguments, and the token_purchases status update are all untouched.

src/components/admin/AdminRevenuePanel.tsx — purchaseFromAuditLog and purchaseFromLedger now resolve the USD amount, FX rate and reference through safe fallback chains, and both were changed to also treat provider === "payfast" rows as native USD revenue. PurchaseEnriched, AuditLogRow, LedgerRow, purchaseFromAuditLog and purchaseFromLedger were additionally marked export (no behaviour change) so tests can call the real aggregation logic directly. Everything else — the query shape, demo-org exclusion, dedup-by-payment_reference, totals/series/top-buyers aggregation, CSV export, and all JSX/rendering — is unchanged.

src/tests/payfast-admin-revenue-visibility-fix.test.ts — new test file (see Tests below).

docs/payfast-admin-revenue-visibility-fix-report.md — this report.

## Audit metadata fields added or mapped

The credits.purchased audit row written by the processPayfastItn success path now includes, in addition to the fields it already wrote (provider, provider_reference, pf_payment_id, credits_added, new_balance, already_credited, package_id, price_zar, amount_gross_zar, mode):

status, set to "completed".

token_amount, equal to the credited amount (purchaseCredits).

payment_reference and reference, both set to the same credit-allocation reference already used for the atomic_paid_credit_purchase call (pf_payment_id when PayFast sent one, otherwise m_payment_id). This is the field the brief asked for as mapped from provider_reference or pf_payment_id as appropriate, expressed through the existing creditReference variable rather than a new computation.

amount_usd and price_usd, read from the purchase row checkout-time metadata (metadata.amount_usd, falling back to metadata.price_usd).

usd_zar_rate and fx_rate, both read from metadata.usd_zar_rate (fx_rate is the same value under the name AdminRevenuePanel already knew how to read).

fx_rate_locked_at, read from metadata.fx_rate_locked_at.

amount_zar, read from metadata.amount_zar.

All of these are read-only lookups against the purchase row already fetched earlier in processPayfastItn; nothing is recalculated, no admin_settings row is re-read at settlement time, and no live or external FX API is called. When a purchase predates the USD-first checkout (Phase 2J) and therefore carries no such metadata, every one of these fields is written as null rather than invented — see Historical rows below.

## Admin panel fields fixed

AdminRevenuePanel.tsx purchaseFromAuditLog (and purchaseFromLedger, for the manual-reconciliation safety-net path) now resolve three values through fallback chains instead of a single hard-coded key: the USD amount tries meta.amount_usd then meta.price_usd; the FX rate tries meta.fx_rate then meta.usd_zar_rate then meta.legacy_fx_rate; the reference tries meta.payment_reference then meta.provider_reference then meta.pf_payment_id then meta.reference. The credits figure gained a third fallback, meta.token_amount, matching the column name PayFast checkout and settlement rows actually use. The legacy_zar computation gained two more source fields, meta.amount_zar and meta.amount_gross_zar, so a PayFast row ZAR figure is always found even on rows where price_zar is absent for some reason.

The isNativeUsd gate that decides whether a row counts as USD revenue now also returns true whenever meta.provider === "payfast" and a positive USD figure was resolved, in addition to its existing currency === "USD" / fx_basis === "native_usd" / legacy_zar === 0 conditions. This is the one behavioural change in the panel: previously a PayFast row with both a USD price and a ZAR amount present was forced to settlement_currency "ZAR" and amount_usd 0, by the same rule that correctly protects pre-cutover Paystack rows from double-counting. PayFast rows do not have that double-counting risk, because the ZAR figure is what PayFast actually charged and the USD figure is the commercial price locked at checkout, so they are exempted from that rule by name rather than by loosening it for everyone. Paystack rows are matched by exactly the same conditions as before and are unaffected.

Revenue totals, the daily/monthly chart, the top-buyers table and the per-org timeline all read amount_usd off the same PurchaseEnriched rows, so once a PayFast row resolves a non-zero amount_usd it is automatically included in totals, the chart and the buyer rankings, with no separate wiring needed for those views. The FX-rate and reference columns in the per-org timeline read legacy_fx_rate and payment_reference off the same rows, so they populate for PayFast purchases for the same reason.

## Tests added or updated

src/tests/payfast-admin-revenue-visibility-fix.test.ts was added. It exercises processPayfastItn end-to-end against an in-memory mock Supabase client (the same pattern used by the existing src/tests/payfast-itn-phase-2b.test.ts) and asserts that a completed PayFast purchase credits.purchased audit row carries amount_usd, price_usd, usd_zar_rate, fx_rate, fx_rate_locked_at, amount_zar, payment_reference, reference, provider_reference, pf_payment_id, token_amount and status, all matching the checkout-time metadata fixture. A separate test constructs a purchase row with only legacy price_zar metadata (no USD/FX fields at all, modelling a pre-Phase-2J row) and asserts the same ITN path still credits normally while every enriched field is written as null rather than a fabricated value. Two more tests confirm a duplicate ITN still only replay-rejects and only ever calls atomic_paid_credit_purchase once, and that the RPC is still called with the same p_org_id, p_amount, p_reference_id and p_endpoint as before, with a p_metadata payload that still carries only the ZAR-side fields it always had (no USD fields were added to the crediting RPC call, the enrichment lives only in the audit row).

Because AdminRevenuePanel.tsx is a page-level React component wired to react-query and a live Supabase client, this repository existing convention (see src/tests/batch-h-refund-fx-legacy.test.ts and src/tests/batch-u-prod-safety.test.ts) is to verify it at the source-text level rather than mounting it, so this file follows that same convention: it reads the committed source with readFileSync and asserts the exact fallback expressions above are present, that provider === "payfast" appears in both purchaseFromAuditLog and purchaseFromLedger, that the Paystack currency/fx_basis gate and the num()/str() defensive helpers are untouched, that demo-org exclusion and the audit-vs-ledger dedup comment are untouched, and that neither payfast.ts nor AdminRevenuePanel.tsx import _shared/fx.ts or reference any external FX API host.

## Tests run or source-verified

No test runner is available in this browser-only environment, so the new test file was not executed by a live CI run. Every assertion was instead traced by hand against the exact committed source of both payfast.ts and AdminRevenuePanel.tsx (fetched fresh after each commit) to confirm it would pass: the ITN-path assertions were checked field-by-field against the enriched metadata object literal now written by processPayfastItn, and the source-verified assertions were checked as literal substrings of the committed files, copied from the actual committed text rather than retyped from memory, to avoid any drift between the assertion and the real code. The existing payfast-itn-phase-2b.test.ts mock-Supabase harness this file reuses is itself an established, previously-passing pattern in this repository.

## Historical-row limitation

Historical rows are not mutated in this phase. Any credits.purchased row written before this fix, whether from PayFast or Paystack, keeps exactly the metadata it already had. The panel handles those rows the same way it always has for Paystack: num() and str() return 0/null for missing fields rather than throwing, so an old PayFast row with no amount_usd, no fx_rate and no payment_reference simply falls through to legacy_zar (still populated from price_zar/amount_gross_zar) and is shown with settlement_currency "ZAR" and a blank FX/reference column, exactly like a pre-cutover Paystack row is shown today. It is not counted in USD totals and it does not crash the panel. It is displayed as incomplete rather than corrupting any total.

This means historical PayFast purchases settled before this fix will continue to read as ZAR/legacy in the admin panel, not as USD revenue, until they are backfilled. Only new completed PayFast purchases (any ITN processed after this fix ships) will carry the full USD/FX/reference metadata automatically.

## Backfill recommendation

A later backfill is recommended but is out of scope for this phase, exactly as the brief specifies. For every historical PayFast credits.purchased row, the matching token_purchases row (joinable by provider_reference/pf_payment_id) still holds its own checkout-time metadata with the USD price, FX rate and ZAR amount, so nothing has been lost and a backfill is possible whenever it is scheduled. That backfill should be run as a separate, controlled, auditable migration or ops script (in the same spirit as the existing metadata.backfilled = true pattern already used elsewhere in this codebase for reconstructed audit rows), reviewed and executed outside of this phase, and should not be performed as a side effect of this report.

## Remaining PayFast-provider dependency

Unchanged from Phase A: PayFast still settles in ZAR under the current admin-managed FX-rate model, and the platform has not yet received confirmation from PayFast on whether native USD/multi-currency checkout is available. Nothing in this phase claims or assumes that PayFast supports USD settlement; the USD figures shown to admins are the same checkout-time commercial price that was already being computed and stored, now simply carried through to the settlement audit row and read correctly by the dashboard.

## Final status

PAYFAST_ADMIN_REVENUE_VISIBILITY_FIXED. Completed PayFast purchases now carry USD amount, FX rate, provider/payment reference, token amount and status on their settlement audit row, sourced read-only from the existing checkout-time metadata snapshot; AdminRevenuePanel resolves those fields through safe fallback chains and includes PayFast USD revenue in totals, the chart and top-buyer rankings without breaking Paystack rows, demo-org exclusion, or historical rows with missing metadata. PayFast checkout amount logic, ITN validation, wallet crediting, ledger idempotency and Paystack are all untouched. A historical-row backfill remains a separate, recommended, not-yet-scheduled follow-up.
