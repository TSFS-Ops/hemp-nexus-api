# Batch B1 — TRUNCATE guards on append-only / sealed-immutability tables

**Status:** `BATCH_B1_TRUNCATE_GUARDS_DEPLOYED_PENDING_VERIFICATION`

## Original tracker items addressed

- **#49** — `event_store` blocks UPDATE/DELETE but not TRUNCATE.
- **#71** — Table owners not forced through RLS (TRUNCATE path), reinterpreted as trigger-based defence on the eight tables below. FORCE ROW LEVEL SECURITY was deliberately **not** applied.

## Tables protected

A `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger was added to each of:

1. `public.event_store`
2. `public.match_events`
3. `public.poi_events`
4. `public.audit_logs`
5. `public.admin_audit_logs`
6. `public.wads`
7. `public.token_ledger`
8. `public.wad_attestations`

All triggers call the new shared function `public.prevent_protected_table_truncate()`, which raises:

```
protected_table_truncate_blocked: TRUNCATE on <schema>.<table> is not permitted
  (append-only / sealed-immutability protected table)
```

`SQLSTATE = check_violation` (23514).

## Migration

`supabase/migrations/<batch_b1_truncate_guards>.sql`

- Creates `public.prevent_protected_table_truncate()` (LANGUAGE plpgsql, SECURITY DEFINER, SET search_path = public).
- Installs the eight named triggers using `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` for idempotency.
- Touches no other table, function, RLS policy, grant, ownership setting, or row of data.

## Trigger / function names

- Function: `public.prevent_protected_table_truncate()`
- Triggers:
  - `event_store_no_truncate_trg`
  - `match_events_no_truncate_trg`
  - `poi_events_no_truncate_trg`
  - `audit_logs_no_truncate_trg`
  - `admin_audit_logs_no_truncate_trg`
  - `wads_no_truncate_trg`
  - `token_ledger_no_truncate_trg`
  - `wad_attestations_no_truncate_trg`

Verified live via `SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname LIKE '%no_truncate_trg'` — all eight present.

## Tests / guards added

- **SQL proof:** `supabase/tests/batch_b1_truncate_guards_proof.sql`
  - Wraps the whole block in `BEGIN; ... ROLLBACK;`.
  - For each protected table, opens a savepoint, attempts `TRUNCATE public.<table>`, and asserts a `check_violation` whose message contains `protected_table_truncate_blocked` and the table name.
  - Any other SQLSTATE or success path raises `PROOF_FAIL`.
  - Must be executed in a privileged (table-owner / service-role / `postgres`) context. The sandbox role used by the agent does not hold TRUNCATE privilege, so it hits the privilege check before the trigger — this is intentional defence in depth and is documented inside the proof file.

- **Static guard:** `scripts/check-batch-b1-truncate-guards.mjs`
  - Asserts the install migration contains the shared function and one well-formed `BEFORE TRUNCATE ... FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_protected_table_truncate` trigger per protected table.
  - Fails the build if any later migration drops or disables any of the eight triggers.
  - Fails the build if any later migration applies `FORCE ROW LEVEL SECURITY` to a protected table (Batch B1 explicitly forbids broad FORCE RLS).
  - Fails the build if any file under `src/`, `supabase/`, `scripts/`, `e2e/` contains `TRUNCATE` of any protected table, except the proof file and this README/guard.

## Commands run and results

| Command | Result |
|---|---|
| `supabase--migration` | succeeded; existing pre-Batch-B1 linter warnings unchanged in count category (function search_path, extension in public, etc. — all pre-existing). |
| `SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname LIKE '%no_truncate_trg'` | 8 triggers listed, one per protected table. |
| Live `BEGIN; TRUNCATE public.<t>; ROLLBACK;` from agent sandbox role | Blocked by table-level privilege check before reaching the trigger — expected; CI/service-role context exercises the trigger via the proof file. |
| Existing append-only UPDATE/DELETE triggers | Unchanged (verified by reading `assert_audit_immutable`, `assert_match_events_append_only`, `assert_poi_events_append_only`, `prevent_event_store_mutation`, `assert_wad_seal_immutability`). |

## Confirmations

- **B2 NOT applied** — no `token_ledger` UPDATE/DELETE append-only trigger was added. Append-only enforcement on `token_ledger` remains by convention pending writer-path audit.
- **B3 NOT applied** — no `wad_attestations` sealed-parent immutability trigger was added. Service-role/owner can still edit attestations post-seal pending product decision on the allowlist.
- **No FORCE ROW LEVEL SECURITY** — none of the eight tables had `relforcerowsecurity` flipped. Trigger-based protection is the chosen pattern.
- **No table ownership change.**
- **No grants changed.**
- **No RLS policies changed.**
- **No existing UPDATE/DELETE triggers altered.**
- **No production data mutated.** The only TRUNCATE attempts run during apply/verify were inside `BEGIN; ROLLBACK;` blocks that hit the privilege check before any rows could be touched.
- **No edge functions deployed.**
- **No cron changes.**
- **No payments / refunds / credits / token crediting / reconciliation / lifecycle / storage / legal-hold / email / provider work touched.**

## Deferred (out of scope for B1)

- **B2:** `token_ledger` append-only trigger (#35) — requires writer-path audit confirming all writers insert new rows.
- **B3:** `wad_attestations` sealed-parent immutability (#73) — requires product decision on post-seal attestation edit allowlist.
- **#71** in its "FORCE RLS" interpretation — explicitly rejected as broadly unsafe; replaced by trigger-based equivalents in B1/B2/B3.

## Final status

`BATCH_B1_TRUNCATE_GUARDS_DEPLOYED_PENDING_VERIFICATION`

Verification will move to `BATCH_B1_TRUNCATE_GUARDS_VERIFIED` once the proof script is executed in a privileged CI/service-role context and reports `PROOF_OK: all 8 protected tables refused TRUNCATE`.
