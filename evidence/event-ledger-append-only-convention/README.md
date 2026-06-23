# Event-ledger append-only convention — Option A containment

**Status:** guard/containment only. No database changes were made in this batch.

## Scope

Three tables are treated as append-only ledgers/event streams:

- `public.token_ledger`
- `public.match_events`
- `public.poi_events`

## What this batch did

- Added repo-scan guard `src/tests/event-ledger-append-only-convention-guard.test.ts`
  which fails CI if a new UPDATE/DELETE/TRUNCATE path appears against any of
  these tables outside the narrow audited allowlist.
- Added catalog-only SQL proof
  `supabase/tests/event_ledger_append_only_convention_proof.sql`
  (rollback-wrapped, non-destructive) that asserts RLS is enabled and no
  UPDATE/DELETE policy targets the ordinary `authenticated` role.
- Documented the remaining backend gap in this README.

## What this batch did NOT do

- **No DB immutability triggers were added.**
- No migrations, no RLS changes, no GRANT changes, no ownership changes.
- No changes to `atomic_paid_credit_purchase` or `repair_skeletal_paid_credit`.
- No changes to payments, refunds, POI, WaD, registry, lifecycle, cron,
  reconciliation, infra alerts, or engagement reminders.

## Current allowed mutation paths

| Table          | Allowed mutation site                                                                 | Reason                                                          |
| -------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `token_ledger` | `supabase/migrations/20260623124308_*.sql` — `atomic_paid_credit_purchase`, `repair_skeletal_paid_credit` | Promotes legacy skeletal `'credit'` rows → `'credit_purchase'`. |
| `token_ledger` | `supabase/migrations/20260418155054_*.sql`                                            | Historical backfill UPDATEs (already executed).                 |
| `token_ledger` | `supabase/migrations/20260503202233_*.sql`                                            | Historical cleanup DELETE (already executed).                   |
| `token_ledger` | `supabase/functions/token-purchase/index.ts` (~L1946)                                 | `credit_refund` promotion mirror of the `credit_purchase` pattern; promotes the auto-written `'credit'` row from `atomic_token_credit` to the canonical `'credit_refund'` settlement row. Guarded by `UNIQUE(request_id)` so exactly one settlement row exists per refund reference. **Added to allowlist in this batch — the original inspection missed this site.** |
| `token_ledger` | `supabase/functions/_shared/payment-atomicity_test.ts`                                | Test comment describing the `credit_purchase` UPDATE invariant. |
| `match_events` | _(none)_                                                                              | Strictly append-only.                                           |
| `poi_events`   | _(none)_                                                                              | Strictly append-only.                                           |

Ordinary `authenticated` users are blocked from UPDATE/DELETE on all three
tables by RLS today.

## Remaining backend gap (out of scope for this batch)

`service_role` and the table owner can still mutate these tables because no
DB-level immutability trigger exists yet. This is a latent risk, not a live
exposure: no current edge function or RPC outside the audited list mutates
these tables.

## Recommended next phase (Option B/C — deferred)

1. Add append-only triggers (`BEFORE UPDATE/DELETE/TRUNCATE`) to **`poi_events`**
   first (zero current callers — smallest blast radius).
2. Then **`match_events`** (also zero current callers; hash-chain verifier
   can follow separately).
3. Then **`token_ledger`** with narrow audited carve-outs for skeletal
   paid-credit promotion/repair via a `SECURITY DEFINER` RPC + audit log.

## How to extend the allowlist

If a genuinely required new mutation path is introduced:

1. Update `TOKEN_LEDGER_ALLOWLIST` (or the relevant list) in
   `src/tests/event-ledger-append-only-convention-guard.test.ts`.
2. Add a row to the table above with a one-line justification.
3. Link the migration / RPC that authorises the change.

Adding an entry to `match_events` or `poi_events` allowlists should be
treated as a meaningful design change and reviewed accordingly.
