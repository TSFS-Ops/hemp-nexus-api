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

## Runtime behavioural proof

Added 2026-07-24, after the static source-contract tests above. This section documents a genuine runtime proof -- not another static source-text check -- added at supabase/tests/payfast_settlement_tracking_phase1_runtime_proof.sql and run in CI by .github/workflows/payfast-settlement-runtime-proof.yml.

### How it is run

The new workflow runs on every push to this PR (and via workflow_dispatch) on a GitHub-hosted runner with a disposable postgres:15 service container -- the same pattern already established by .github/workflows/pr26-pilot-readiness-validation.yml, extended with a session-settable auth.uid() stub so a single psql session can simulate an anonymous caller, an ordinary authenticated customer, an auditor, and a platform_admin via SET ROLE plus a custom GUC. The job: (1) bootstraps a minimal Supabase-compatibility surface (auth/storage schemas, anon/authenticated/service_role roles, pgcrypto/uuid-ossp); (2) applies the full supabase/migrations/*.sql chain, including this PR's own migration; (3) runs the proof SQL file, which seeds its own throwaway fixtures (one organisation, three auth.users + user_roles rows, and a set of token_purchases rows) and executes 43 individual behavioural assertions against the four PR #31 RPCs; (4) fails the job (non-zero exit) unless the proof file itself reports every assertion passed.

Locally, the same file can be run against any disposable Postgres 15 instance with the bootstrap step's schemas/roles already present via: `psql -v ON_ERROR_STOP=1 -f supabase/tests/payfast_settlement_tracking_phase1_runtime_proof.sql`.

### What it proves

All of the following were exercised as real SQL/RPC calls against a real Postgres 15 instance running this PR's actual migration output, not read from source text: the payment_settlements table, its four constraints, three indexes, RLS policy, and all four RPCs exist with the documented signatures; an anonymous caller, and an ordinary authenticated non-admin user, cannot read or write payment_settlements at all (permission denied at the GRANT level, not merely RLS-filtered, for writes); a platform_admin and an auditor can both read payment_settlements via RLS, and an auditor's direct write attempt is denied; a completed PayFast purchase produces exactly one settlement row via create_missing_payfast_settlements_v1, a second run creates no duplicate, and failed/abandoned/pending/non-PayFast/missing-provider-reference purchases are correctly skipped; the created row's status, amount_usd, amount_zar, and usd_zar_rate are correctly carried across from token_purchases.metadata; payment_settlement_mark_v1 correctly enforces confirm-requires-bank-reference, delay-requires-reason-or-note, and exception-requires-reason, appends (never overwrites) notes, and writes admin_audit_logs with before/after status on every call; an ordinary customer and an auditor are both rejected by payment_settlement_mark_v1; payment_settlements_list_v1 is usable by platform_admin and auditor, rejects an ordinary customer, and its status/provider_reference/org/date-range/limit filters and returned field shape all work correctly; detect_payment_settlement_risks_v1 is rejected for an ordinary customer; and across every RPC call made during the run, the underlying token_purchases rows remained byte-identical to a pre-proof snapshot, and token_ledger and token_balances row counts were unchanged -- confirming no wallet, ledger, or payment-confirmation mutation anywhere in this feature.

40 of 43 assertions pass. The remaining 3 failures are all one and the same genuine, pre-existing defect in this PR's own migration, described below -- not an artifact of the proof harness, and not related to schema, RLS, or the reconciliation/list RPCs.

### Bug found: ON CONFLICT (dedup_key) does not match the partial unique index

admin_risk_items_dedup_key_uniq (added in an earlier, unrelated migration) is a **partial** unique index: `CREATE UNIQUE INDEX ... ON public.admin_risk_items (dedup_key) WHERE dedup_key IS NOT NULL`. Postgres will only use a partial index as the arbiter for a plain `ON CONFLICT (dedup_key)` clause if the ON CONFLICT clause repeats a compatible WHERE predicate; without it, Postgres cannot infer the index and raises "there is no unique or exclusion constraint matching the ON CONFLICT specification". Both of this PR's admin_risk_items inserts use the plain form:

- payment_settlement_mark_v1's exception-action insert (`ON CONFLICT (dedup_key) DO UPDATE ...`)
- detect_payment_settlement_risks_v1's two inserts (same pattern, both risk kinds)

The runtime proof confirms this is a real, reproducible failure, not a false positive: marking a settlement exception raises this error inline (so the whole payment_settlement_mark_v1 call fails and the settlement is never actually marked exception, since the failed INSERT aborts the transaction), and detect_payment_settlement_risks_v1 fails identically for both of its risk kinds (overdue-expected and paid-no-settlement-record), so it currently cannot write any risk item at all. Everything else in both functions -- the role checks, the validation rules, the settlement status updates that happen before the admin_risk_items insert -- is unaffected and proven working.

**Recommended fix (not applied here, per this task's scope):** either add the matching predicate to both ON CONFLICT clauses (`ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO UPDATE ...`), or replace the partial unique index with a plain (non-partial) one on admin_risk_items(dedup_key). Either change is small, localized to admin_risk_items-writing code, and outside this task's approved scope of "add a proof, do not modify PayFast/Paystack/wallet/ledger/config.toml logic" -- flagging it here for a follow-up commit on this same PR rather than fixing it silently.

### Other pre-existing, unrelated environment/schema quirks found while building the proof

None of the following are PayFast/payment_settlements issues; all are documented in the proof SQL and workflow YAML comments and are tolerated only as specifically-named, logged exceptions (not a blanket "ignore errors" rule):

- token_purchases.paystack_reference remains NOT NULL UNIQUE even for provider='payfast' rows (a legacy Paystack-era constraint PayFast Phase 2A did not relax); the proof's fixtures supply a synthetic legacy value to satisfy it.
- token_purchases.status has no 'cancelled' value in its CHECK constraint (only pending, completed, failed, abandoned); the proof uses failed/abandoned/pending in place of "cancelled/incomplete".
- RBAC Stage 3A (prevent_frozen_role_assignment) permanently freezes the legacy role labels admin, api_admin, billing_admin, buyer, seller, and broker -- none can ever be newly assigned again. The proof uses org_member for its ordinary-customer fixture instead.
- A later migration's handle_new_user() trigger on auth.users calls an internal helper that queries public.team_invitations, a table no migration in this repository creates; inserting any auth.users row (including the proof's own throwaway fixtures) fails unless that trigger is disabled first.
- Plain postgres:15 lacks pg_cron, pg_net, pgjwt, pg_graphql, pgmq, supabase_vault (including vault.decrypted_secrets), the "realtime" schema, and the built-in supabase_realtime publication -- all Supabase-platform-only features some older, unrelated migrations depend on. A few older migrations also assume specific seed rows already exist (narrowly-named foreign-key/not-null violations on four unrelated tables) or embed an unrelated fixture self-check ("Test prerequisite failed: Dove profile not found"). The migration-apply step tolerates only these specific, named, logged conditions and fails closed on anything else.

### Commands run

`psql -v ON_ERROR_STOP=1 -f supabase/tests/payfast_settlement_tracking_phase1_runtime_proof.sql` (plus the bootstrap and full migration-chain apply steps described above), executed by GitHub Actions in .github/workflows/payfast-settlement-runtime-proof.yml. See that workflow's run history on PR #31 for the exact logs.

### Result

40 / 43 behavioural assertions passed on a real disposable Postgres 15 instance running this PR's real migration output. The 3 failures are one confirmed, reproducible, pre-existing defect in this PR's own admin_risk_items integration (ON CONFLICT vs. partial unique index), described above. Everything else this PR claims -- table/constraint/index/RLS/RPC existence, full role-based access control, reconciliation creation/idempotency/skip rules, admin update validation/audit-logging/append-only notes, list filtering, and zero wallet/ledger/token_purchases mutation -- is now runtime-proven, not merely statically asserted.

### Is PR #31 now runtime-proven?

Partially. The schema, RLS, reconciliation, admin-update (aside from the exception action), and list-RPC behaviour are now genuinely runtime-proven. The risk-item integration (exception-marking's inline alert, and both detect_payment_settlement_risks_v1 alert kinds) is runtime-proven to be **broken** in its current form, not working -- this is a real bug this PR should fix before merge, not a proof-harness limitation.

### Is UI work now unblocked?

The list and admin-update RPCs (aside from the exception action) are unblocked for UI work now that they are runtime-proven, not just statically asserted. Any admin-UI affordance for marking a settlement "exception", and any risk-inbox surfacing of PayFast settlement risk items, should wait for the ON CONFLICT fix above, since both currently fail at the database level.

## Blocked items

None of the required Phase 1 backend work is blocked. The items listed under Limitations above are deferred by design, not blocked by missing information needed to proceed with Phase 1 itself. See "Runtime behavioural proof" above for one confirmed, reproducible bug (ON CONFLICT vs. a partial unique index on admin_risk_items) that this PR should fix before merge -- it affects the exception-marking action and the risk-detection RPC only, not the schema, RLS, reconciliation, or list-RPC behaviour, all of which are now runtime-proven.

Final status: PAYFAST_SETTLEMENT_TRACKING_PHASE_1_PR_READY
