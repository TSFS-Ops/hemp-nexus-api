# Event-ledger append-only convention — phased hardening

## Scope

Three tables are treated as append-only ledgers/event streams:

- `public.token_ledger` — convention-guarded only (Option A)
- `public.match_events` — convention-guarded only (Option A)
- `public.poi_events` — **DB-enforced append-only (Option B applied)**

## Current state per table

| Table          | Enforcement                                                                 | Bypass         |
| -------------- | --------------------------------------------------------------------------- | -------------- |
| `token_ledger` | Repo-scan guard + RLS only. No DB trigger.                                  | n/a            |
| `match_events` | Repo-scan guard + RLS only. No DB trigger.                                  | n/a            |
| `poi_events`   | **Repo-scan guard + RLS + DB trigger** blocks UPDATE/DELETE/TRUNCATE.       | **None.**      |

### `poi_events` DB enforcement details

- Trigger function: `public.assert_poi_events_append_only()` — `SECURITY DEFINER`, pinned `search_path = public`, raises
  `POI_EVENTS_APPEND_ONLY: <operation> blocked on public.poi_events` with SQLSTATE `check_violation`.
- Row-level trigger: `poi_events_no_mutate_trg` — `BEFORE UPDATE OR DELETE ... FOR EACH ROW`.
- Statement-level trigger: `poi_events_no_truncate_trg` — `BEFORE TRUNCATE ... FOR EACH STATEMENT`.
- No bypass GUC, no admin override, no `service_role` exception.
- Proof: `supabase/tests/poi_events_append_only_freeze_proof.sql` (rollback-wrapped).
- Pre-apply state: 0 rows in `poi_events`, zero repo mutation callers.

## What this batch did

- Added migration creating the trigger function and both triggers on `public.poi_events`.
- Added rollback-wrapped SQL proof `supabase/tests/poi_events_append_only_freeze_proof.sql`.
- Extended `src/tests/event-ledger-append-only-convention-guard.test.ts` to assert:
  - proof file exists, references `POI_EVENTS_APPEND_ONLY`, `poi_events_no_mutate_trg`, `poi_events_no_truncate_trg`;
  - `POI_EVENTS_ALLOWLIST` contains no runtime mutation callers.
- Updated this README to reflect Option B enforcement on `poi_events`.

## What this batch did NOT do

- **No changes to `match_events` or `token_ledger`.**
- No changes to RLS, grants, or table ownership on any table.
- No changes to `atomic_poi_transition`, `atomic_collapse_record`, or any POI/collapse lifecycle behaviour
  (INSERTs continue to work; only UPDATE/DELETE/TRUNCATE are blocked).
- No changes to payments, refunds, WaD, registry, lifecycle, cron, reconciliation, infra alerts, or
  engagement reminders.

## Current allowed mutation paths

| Table          | Allowed mutation site                                                                 | Reason                                                          |
| -------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `token_ledger` | `supabase/migrations/20260623124308_*.sql` — `atomic_paid_credit_purchase`, `repair_skeletal_paid_credit` | Promotes legacy skeletal `'credit'` rows → `'credit_purchase'`. |
| `token_ledger` | `supabase/migrations/20260418155054_*.sql`                                            | Historical backfill UPDATEs (already executed).                 |
| `token_ledger` | `supabase/migrations/20260503202233_*.sql`                                            | Historical cleanup DELETE (already executed).                   |
| `token_ledger` | `supabase/functions/token-purchase/index.ts` (~L1946)                                 | `credit_refund` promotion mirror; guarded by `UNIQUE(request_id)`. |
| `token_ledger` | `supabase/functions/_shared/payment-atomicity_test.ts`                                | Test comment describing the `credit_purchase` UPDATE invariant. |
| `match_events` | _(none)_                                                                              | Strictly append-only (convention).                              |
| `poi_events`   | _(none — DB-enforced)_                                                                | Strictly append-only. UPDATE/DELETE/TRUNCATE blocked by trigger. |

## Remaining backend gap (out of scope for this batch)

`service_role` and the table owner can still mutate `token_ledger` and `match_events` because no
DB-level immutability triggers exist on those two tables yet. This is a latent risk, not a live
exposure: no current edge function or RPC outside the audited list mutates those tables.

## Recommended next phase (deferred)

1. Replicate the `poi_events` pattern on **`match_events`** (also zero current callers; the
   `previous_event_hash` chain verifier can follow separately).
2. Then **`token_ledger`** with narrow audited carve-outs for skeletal paid-credit
   promotion/repair via a `SECURITY DEFINER` RPC + admin_audit_logs entry.

## How to extend the allowlist

If a genuinely required new mutation path is introduced on `token_ledger` or `match_events`:

1. Update `TOKEN_LEDGER_ALLOWLIST` or `MATCH_EVENTS_ALLOWLIST` in
   `src/tests/event-ledger-append-only-convention-guard.test.ts`.
2. Add a row to the table above with a one-line justification.
3. Link the migration / RPC that authorises the change.

`POI_EVENTS_ALLOWLIST` MUST remain empty of runtime mutation callers — the DB trigger now
blocks any attempt regardless. Adding such an entry would be incorrect.
