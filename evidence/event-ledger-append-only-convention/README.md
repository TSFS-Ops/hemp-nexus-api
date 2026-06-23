# Event-ledger append-only convention — phased hardening

## Scope

Three tables are treated as append-only ledgers/event streams:

- `public.token_ledger` — convention-guarded only (Option A)
- `public.match_events` — **DB-enforced append-only (Option B applied)**
- `public.poi_events` — **DB-enforced append-only (Option B applied)**

## Current state per table

| Table          | Enforcement                                                                 | Bypass         |
| -------------- | --------------------------------------------------------------------------- | -------------- |
| `token_ledger` | Repo-scan guard + RLS only. No DB trigger.                                  | n/a            |
| `match_events` | **Repo-scan guard + RLS + DB trigger** blocks UPDATE/DELETE/TRUNCATE.       | **None.**      |
| `poi_events`   | **Repo-scan guard + RLS + DB trigger** blocks UPDATE/DELETE/TRUNCATE.       | **None.**      |

### `poi_events` DB enforcement details

- Trigger function: `public.assert_poi_events_append_only()` — `SECURITY DEFINER`, pinned `search_path = public`, raises
  `POI_EVENTS_APPEND_ONLY: <operation> blocked on public.poi_events` with SQLSTATE `check_violation`.
- Row-level trigger: `poi_events_no_mutate_trg` — `BEFORE UPDATE OR DELETE ... FOR EACH ROW`.
- Statement-level trigger: `poi_events_no_truncate_trg` — `BEFORE TRUNCATE ... FOR EACH STATEMENT`.
- No bypass GUC, no admin override, no `service_role` exception.
- Proof: `supabase/tests/poi_events_append_only_freeze_proof.sql` (rollback-wrapped).
- Pre-apply state: 0 rows in `poi_events`, zero repo mutation callers.

### `match_events` DB enforcement details

- Trigger function: `public.assert_match_events_append_only()` — `SECURITY DEFINER`, pinned `search_path = public`, raises
  `MATCH_EVENTS_APPEND_ONLY: <operation> blocked on public.match_events` with SQLSTATE `check_violation`.
- Row-level trigger: `match_events_no_mutate_trg` — `BEFORE UPDATE OR DELETE ... FOR EACH ROW`.
- Statement-level trigger: `match_events_no_truncate_trg` — `BEFORE TRUNCATE ... FOR EACH STATEMENT`.
- No bypass GUC, no admin override, no `service_role` exception.
- Proof: `supabase/tests/match_events_append_only_freeze_proof.sql` (rollback-wrapped).
- Pre-apply state: 456 rows in `match_events`; 0 null `payload_hash`; 276 null `previous_event_hash` (expected chain heads);
  zero repo mutation callers.

### Deferred for `match_events` (NOT in this batch)

- Hash-chain continuity verifier (scheduled or trigger-time walker of `previous_event_hash`).
- Insert-time sibling-chain concurrency lock (advisory lock keyed by `match_id`) to prevent two concurrent
  inserts from chaining off the same `previous_event_hash` and creating divergent siblings.

Both are required for full closure; until then `match_events` is **CONTAINED**, not CLOSED.

## What this batch did

- Added migration creating `assert_match_events_append_only()` and both triggers on `public.match_events`.
- Added rollback-wrapped SQL proof `supabase/tests/match_events_append_only_freeze_proof.sql`.
- Extended `src/tests/event-ledger-append-only-convention-guard.test.ts` to assert:
  - proof file exists, references `MATCH_EVENTS_APPEND_ONLY`, `match_events_no_mutate_trg`, `match_events_no_truncate_trg`;
  - `MATCH_EVENTS_ALLOWLIST` contains no runtime mutation callers;
  - the new migration creates triggers only and does not UPDATE/DELETE/TRUNCATE `match_events`.
- Updated this README to reflect Option B enforcement on `match_events`.

## What this batch did NOT do

- **No changes to `poi_events` or `token_ledger`.**
- No changes to RLS, grants, or table ownership on any table.
- No changes to match lifecycle, WaD, POI, payments, refunds, registry, cron,
  reconciliation, infra alerts, or engagement reminders.
- No hash-chain verifier and no insert-time advisory lock — both deferred.

## Current allowed mutation paths

| Table          | Allowed mutation site                                                                 | Reason                                                          |
| -------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `token_ledger` | `supabase/migrations/20260623124308_*.sql` — `atomic_paid_credit_purchase`, `repair_skeletal_paid_credit` | Promotes legacy skeletal `'credit'` rows → `'credit_purchase'`. |
| `token_ledger` | `supabase/migrations/20260418155054_*.sql`                                            | Historical backfill UPDATEs (already executed).                 |
| `token_ledger` | `supabase/migrations/20260503202233_*.sql`                                            | Historical cleanup DELETE (already executed).                   |
| `token_ledger` | `supabase/functions/token-purchase/index.ts` (~L1946)                                 | `credit_refund` promotion mirror; guarded by `UNIQUE(request_id)`. |
| `token_ledger` | `supabase/functions/_shared/payment-atomicity_test.ts`                                | Test comment describing the `credit_purchase` UPDATE invariant. |
| `match_events` | _(none — DB-enforced)_                                                                | Strictly append-only. UPDATE/DELETE/TRUNCATE blocked by trigger. |
| `poi_events`   | _(none — DB-enforced)_                                                                | Strictly append-only. UPDATE/DELETE/TRUNCATE blocked by trigger. |

## Remaining backend gap (out of scope for this batch)

`service_role` and the table owner can still mutate `token_ledger` because no DB-level immutability trigger
exists there yet. This is a latent risk, not a live exposure: no current edge function or RPC outside the
audited list mutates the table.

## Recommended next phase (deferred)

1. `match_events` chain verifier programme: scheduled hash-chain walker plus insert-time advisory lock on
   `match_id` to prevent sibling-chain divergence. Required to move `match_events` from CONTAINED → CLOSED.
2. `token_ledger` audited carve-out design: narrow `SECURITY DEFINER` RPC for skeletal paid-credit
   promotion/repair + `admin_audit_logs` entry, then trigger-enforce append-only with the carve-out.

Sequencing depends on release priority.

## How to extend the allowlist

If a genuinely required new mutation path is introduced on `token_ledger`:

1. Update `TOKEN_LEDGER_ALLOWLIST` in
   `src/tests/event-ledger-append-only-convention-guard.test.ts`.
2. Add a row to the table above with a one-line justification.
3. Link the migration / RPC that authorises the change.

`MATCH_EVENTS_ALLOWLIST` and `POI_EVENTS_ALLOWLIST` MUST remain empty of runtime mutation callers — the DB
triggers now block any attempt regardless. Adding such an entry would be incorrect.
