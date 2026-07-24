# PayFast Settlement-to-Bank Tracking -- Phase 1 Report

Date: 2026-07-23
Branch: build/payfast-settlement-tracking-phase-1
Repository: TSFS-Ops/hemp-nexus-api
Scope: backend foundation only. No code changes to PayFast checkout, PayFast ITN verification, Paystack, wallet crediting, or token_ledger. No historical rows were mutated. No PR #28, #29, or #30 files were touched.

This report documents the Phase 1 backend build for PayFast settlement-to-bank tracking, following on from docs/payfast-enterprise-readiness-audit-2026-07-23.md and docs/payfast-settlement-tracking-build-plan-2026-07-23.md.

## Files changed

Two new files were added on this branch, plus this report as a third. No existing file was modified.

supabase/migrations/20260723160000_payfast_settlement_tracking_phase1.sql creates the payment_settlements table, its indexes, RLS policy, and four SECURITY DEFINER RPCs, plus a small business-day helper function.

src/tests/payfast-settlement-tracking-phase-1.test.ts is a static source-contract test suite that reads the migration files and the PayFast ITN shared module directly from disk and asserts on their contents. This repository does not have a live Supabase project reachable from this environment, so tests here follow the same established pattern already used by src/tests/api-usage-dashboard-batch-4-alerts-security-signals.test.ts rather than exercising a real database.

docs/payfast-settlement-tracking-phase-1-report.md is this report.

## Schema created

The migration creates a single new table, payment_settlements, plus supporting indexes and a small reusable helper function.

The table is provider-generic in shape (columns named provider and provider_reference rather than payfast-specific names) but the provider column is currently constrained to accept only payfast, matching the instruction to support provider = payfast in Phase 1 while leaving room to extend later. Columns include id, provider, provider_reference, token_purchase_id (references token_purchases, unique), org_id (references organizations), amount_usd, amount_zar, usd_zar_rate, expected_settlement_at, status, settlement_confirmed_at, settlement_confirmed_by, bank_reference, exception_reason, exception_code, notes (an append-only jsonb array), created_at, updated_at, created_by, updated_by, and a free-form metadata jsonb column.

Two unique constraints protect against duplicate rows: one on (provider, provider_reference), and one on token_purchase_id, so a single completed purchase can never end up with more than one settlement row. A table-level check constraint additionally enforces that a row cannot be marked confirmed unless it already carries a bank_reference, as defense in depth alongside the same rule being enforced in the admin update RPC. Three indexes support the expected admin/reconciliation query patterns: (provider, status), (org_id), and (expected_settlement_at).

## Statuses

The status column uses exactly the five values specified: expected, confirmed, delayed, exception, cancelled. reconciled is deliberately not part of the enum yet, since there is no real PayFast bank-settlement feed to reconcile against; the test suite explicitly asserts that reconciled does not appear anywhere in the migration.

## Reconciliation job behaviour

create_missing_payfast_settlements_v1 is a SECURITY DEFINER function that scans token_purchases for rows where provider = payfast, status = completed, provider_reference is present, and org_id is present, and where no payment_settlements row yet exists for that token_purchase_id. For each matching row it inserts a new payment_settlements row with status expected, an expected_settlement_at computed by adding a configurable number of business days (default two) to the purchase updated_at timestamp, and a metadata payload recording the source purchase id, source provider reference, creation reason, and the rule used. The insert uses ON CONFLICT (token_purchase_id) DO NOTHING, so calling the function repeatedly is safe and never creates a duplicate row. The function never writes to token_purchases, token_ledger, or any wallet-related table, and never calls the credit RPC. It can be invoked by service_role in a scheduled/cron context (no auth.uid()) or manually by a platform_admin; any other authenticated caller is rejected.

The business-day calculation is delegated to a small new helper, add_business_days, which advances a timestamp by whole days and skips Saturdays and Sundays. It does not know about public holidays; this is documented as a deliberate Phase 1 simplification.

## Admin update behaviour

payment_settlement_mark_v1 is the single governed entry point for platform admins to change a settlement row. It requires the caller to hold platform_admin (via the existing has_role RPC pattern); any other caller, including auditor, is rejected, since auditor is read-only for this feature. It accepts one of six actions: confirm, delay, exception, cancel, add_note, and set_bank_reference.

Confirm requires a bank_reference to already be set on the row or supplied in the same call, otherwise it raises an error; on success it sets settlement_confirmed_at and settlement_confirmed_by. Delay requires either a reason or a note to be supplied. Exception requires a reason. Cancel accepts an optional reason. Add_note and set_bank_reference each require non-empty input. Notes are stored as an append-only jsonb array; every note action appends a new object with a timestamp, the acting admin, and the note text, and never truncates or overwrites earlier notes.

Every successful call writes one row to admin_audit_logs recording the admin, the action, the settlement id, and a details payload with the before and after status plus flags for whether a bank reference, reason, or note was present. When a settlement is marked exception, the function also writes (or refreshes, via ON CONFLICT on dedup_key) a high-severity admin_risk_items row of kind payfast_settlement_exception, so the exception immediately surfaces in the existing HQ risk inbox without waiting for a scheduled scan.

The function never references token_purchases, token_ledger, or any wallet/PayFast ITN code; the test suite asserts this negatively.

## List function contract

payment_settlements_list_v1 is a read-only SECURITY DEFINER function for the future admin reconciliation UI. It is gated to platform_admin or auditor; any other caller is rejected. It accepts optional filters for status, provider, org_id, a substring search on provider_reference, a substring search on bank_reference, and a created_at date range, plus limit/offset (limit is clamped between 1 and 1000). For each matching settlement it returns a jsonb object containing the settlement fields, the organisation name, the source purchase confirmation timestamp (token_purchases.updated_at), the wallet-credited timestamp (looked up from the existing audit_logs credits.purchased entry for the same org and provider_reference), and two convenience booleans, has_refund_request and has_payment_dispute, computed against the existing refund_requests and payment_disputes tables so the future UI can surface those indicators without a second round trip.

## RLS and role model

RLS is enabled on payment_settlements. The only policy is a SELECT policy for authenticated users who pass has_role platform_admin or has_role auditor; there are no INSERT, UPDATE, or DELETE policies for authenticated at all, so a normal client cannot write to this table under any role, even platform_admin, through direct table access. All writes go exclusively through the two SECURITY DEFINER RPCs described above, which run with elevated privilege and enforce their own role and validation checks before touching a row. anon and authenticated have no default table grants; only service_role has full table access, matching the pattern already used by api_usage_alerts and other recent admin-only tables in this repository. No customer, org member, or non-admin role can read or write settlement data at any layer.

## Alerts and exception queues

Three risk-item kinds are wired into the existing admin_risk_items inbox. payfast_settlement_exception is raised inline by payment_settlement_mark_v1 the moment a row is marked exception, so it appears immediately rather than waiting for a scan. payfast_settlement_overdue and payfast_paid_no_settlement_record are raised by a second new function, detect_payment_settlement_risks_v1, which scans for settlements still expected past their expected_settlement_at, and for completed PayFast purchases with no settlement row at all after a configurable grace window (default 24 hours), guarding against a broken or skipped reconciliation run rather than duplicating its logic. All three kinds use the existing dedup_key convention with ON CONFLICT so repeated scans never create duplicate alerts.

## Tests run

Because this environment has no live Supabase project to run a real migration against, the test suite added in this Phase 1 (src/tests/payfast-settlement-tracking-phase-1.test.ts) follows the repositorys established static source-contract pattern: it reads every migration file from disk, concatenates them, and asserts via regex that the table, constraints, RLS policy, grants, and each RPC body contain the required clauses (SECURITY DEFINER, search_path, the platform_admin/auditor role checks, the validation error messages for each action, the ON CONFLICT idempotency guards, and the absence of any reference to token_purchases/token_ledger inside the mutation RPCs). It also reads the live PayFast ITN shared module from disk and asserts it contains no reference to any of the new table or function names, which is the closest available proxy for a no-regression test in this environment. This mirrors exactly how the existing batch-4 alerts feature in this repository is tested, and these tests were not executed against a live database because none is reachable here; they were verified by careful manual construction and re-reading of the committed file content shown in this report.

## Migration and backfill strategy

No backfill is performed in this Phase 1 migration. The reconciliation function only creates settlement rows prospectively when it is called; historical PayFast purchases that completed before this feature existed will simply be picked up the first time create_missing_payfast_settlements_v1 runs, since it scans all completed PayFast purchases without a settlement row regardless of age, not only newly completed ones. No existing row in token_purchases, token_ledger, or any other table was altered by this migration. A separate, explicitly admin-triggered backfill tool was considered but is not needed given the reconciliation function already covers historical rows safely; this is noted as an option only if a future need arises to backfill with a different rule than the default two-business-day expectation.

## Limitations

Several items are explicitly out of scope for Phase 1 and are called out here rather than silently assumed. There is no real PayFast bank-settlement feed or API integration; expected_settlement_at is an operational estimate only, derived from a conservative Mon-Fri business-day rule with no public-holiday awareness, and all confirmation is manual via the admin update RPC. The amount_usd and amount_zar values are read from token_purchases.metadata (price_usd, amount_usd, amount_zar, price_zar) rather than a dedicated settlement feed, so any historical purchase missing those metadata keys will carry a null amount in its settlement row rather than a computed one. No admin UI was built in this phase; only the backend RPCs exist. No edge function wrapper was created for the three write/read RPCs, since this repositorys existing equivalent feature (api_usage_alerts) also calls its RPCs directly from the client via supabase-js rpc(), rather than through a dedicated edge function, and Phase 1 follows that same convention for consistency. Whether compliance_analyst or any role other than auditor should also get read access was left as an open question in the design plan and remains open here; only platform_admin and auditor are wired in.

## Phase 2 recommendations

The most valuable next steps are the admin UI itself (a new panel or tab reading payment_settlements_list_v1 and calling payment_settlement_mark_v1), a scheduled invocation of both create_missing_payfast_settlements_v1 and detect_payment_settlement_risks_v1 (there is no cron wiring yet; both functions exist but nothing currently calls them on a schedule), CSV export from the list RPC output, and the consolidated PayFast operator runbook identified as the second enterprise gap in the original audit. A real reconciled status and amount-mismatch alert should only be added once PayFast confirms whether any settlement/payout feed or report format is available; this repository currently has no evidence of one.

## Is the UI now unblocked

Yes. payment_settlements_list_v1 and payment_settlement_mark_v1 together provide everything a first admin panel needs: a filterable, joined read contract and a single governed write endpoint with built-in validation and audit logging. Building the panel no longer requires any further schema or RPC design decisions; it is a Phase 2 UI implementation task against the contract documented above.

## Blocked items

None of the required Phase 1 backend work is blocked. The items listed under Limitations above are deferred by design, not blocked by missing information needed to proceed with Phase 1 itself.

Final status: PAYFAST_SETTLEMENT_TRACKING_PHASE_1_PR_READY
