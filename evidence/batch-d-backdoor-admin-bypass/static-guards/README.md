# Batch D1 + D2 — static guards for backdoor / immutability protection

**Status:** `BATCH_D1_D2_STATIC_GUARDS_DEPLOYED`

## Scope

Guard-only. No migrations, no runtime code, no edge-function deploys, no
config or secret changes, no RLS / grants / policies / ownership / trigger /
cron / storage / schema / function changes, no data mutation.

## Tracker items

| # | Finding at inspection | Action taken in D1/D2 |
|---|---|---|
| **#4** UAT password reset backdoor | `supabase/functions/set-uat-passwords/` does not exist and has no callers anywhere in the tree. Classified **Closed — already safe** by inspection. | **D1** static guard added so the endpoint (or an equivalently dangerous arbitrary-account password-reset endpoint) cannot silently return in a future edge-function commit. |
| **#52** Immutability triggers can be dropped/disabled by owner-level migrations | Structural risk confirmed. No Postgres event trigger applied (deliberately deferred as riskier than the CI guard). | **D2** static guard added over `supabase/migrations/*.sql` covering append-only, seal-immutability, and TRUNCATE-protection triggers + their backing functions. |
| **#3 / #17** Audit-log cleanup bypass | **Contained** (Batch O freeze + CI grep + UI wording containment). Not touched in this batch. | — |
| **#74** Admin manual crediting | **Already safe** — Bearer + AAL2 + `platform_admin` + atomic `admin_credit_org_with_governance` + audit rows. Not touched in this batch. | — |

## Files changed

- `scripts/check-no-uat-password-reset.mjs` — new (Batch D1).
- `scripts/check-immutability-triggers-not-dropped.mjs` — new (Batch D2).
- `src/tests/batch-d1-d2-static-guards.test.ts` — new (vitest wrapper that
  executes both guards and asserts exit 0).
- `evidence/batch-d-backdoor-admin-bypass/static-guards/README.md` — new.

No other files were modified.

## D1 — `check-no-uat-password-reset.mjs`

Fails the build if:

1. A directory under `supabase/functions/` matches any of:
   `set-uat-passwords`, `set_uat_passwords`, `uat-password-reset`,
   `uat_password_reset`, `reset-uat-password`, `reset_uat_password`.
2. Any file under `supabase/functions/` references one of those names by
   string (guard file and this README are excepted).
3. Any edge function performs `supabase.auth.admin.updateUserById(..., { password ... })`
   or `auth.admin.generateLink({ type: 'recovery', ... })` for arbitrary
   accounts **without** the reviewed-fixture allowlist entry AND both a
   non-production/sandbox guard and an internal secret guard.

The seven known-safe staging/fixture seeders (`seed-smoke-a-d-fixtures`,
`seed-smoke-ai-review-fixtures`, `seed-smoke-batch-7-fixtures`,
`seed-uat-facilitation-accounts`, `staging-set-fixture-password`,
`uat-facilitation-phase-1`, `seed-ai-light-intel-uat`) are pinned to an
allowlist. Each was manually reviewed and scopes seeded accounts to the
`@test.izenzo.co.za` fixture domain, refuses on production tier, and
requires `INTERNAL_CRON_KEY` / service-role / `platform_admin` at entry.
Adding a new file to that allowlist requires the same review.

Supabase-managed recovery flows (`auth.resetPasswordForEmail`, self-service
`updateUser({ password })` on the authenticated session) are not flagged.

## D2 — `check-immutability-triggers-not-dropped.mjs`

Scans every `supabase/migrations/*.sql` and fails on dangerous DDL against
the protected trigger / function set:

**Protected triggers:** `wads_seal_immutability_trg`,
`wad_attestations_sealed_parent_immutability_trg`,
`wad_attestations_no_truncate_trg`, `token_ledger_no_truncate_trg`,
`event_store_no_truncate_trg`, `match_events_no_truncate_trg`,
`poi_events_no_truncate_trg`, `audit_logs_no_truncate_trg`,
`admin_audit_logs_no_truncate_trg`, `match_events_append_only_trg`,
`poi_events_append_only_trg`, `event_store_no_mutation_trg`,
`audit_logs_immutable_trg`, `audit_logs_no_update_trg`,
`audit_logs_no_delete_trg`.

**Protected functions:** `public.assert_wad_seal_immutability`,
`public.assert_wad_attestation_sealed_parent_immutability`,
`public.prevent_protected_table_truncate`,
`public.prevent_event_store_mutation`,
`public.assert_match_events_append_only`,
`public.assert_poi_events_append_only`,
`public.assert_audit_immutable`.

**Fails on:**

- `DROP TRIGGER … <protected>` outside the allowlist.
- `ALTER TABLE … DISABLE TRIGGER <protected>` always.
- `ALTER TABLE <protected_table> … DISABLE TRIGGER ALL|USER` always
  (protected tables: `event_store`, `match_events`, `poi_events`,
  `audit_logs`, `admin_audit_logs`, `wads`, `token_ledger`,
  `wad_attestations`).
- `DROP FUNCTION <protected>` always.
- `ALTER FUNCTION <protected>` always.
- `CREATE OR REPLACE FUNCTION <protected>` outside the allowlist.

**Allowlist** (installer / historical replace migrations, discovered via
`grep -lE` and pinned in the guard):

```
20260304000110_78461db3-fe8c-46bd-853b-7b5400676ca1.sql
20260313183323_7be968d4-d8ad-471d-aa68-8cdc18d19bb1.sql
20260516173105_defd936d-71d5-4c0a-a6a5-ff0583ca66eb.sql
20260623171758_21ffd4f6-87fe-422e-a6d0-04661b2a80c4.sql
20260623181731_89c77f66-e6f0-4c06-8b14-88bc3cd3f294.sql
20260630182822_3235590c-52d3-48f4-9d0c-372bd40aa08c.sql
20260630221850_c6d1222c-0f9f-4906-8465-c2b37bc4750a.sql
20260701074823_29b9b2a9-7998-4db4-ba77-7e471a2a82fd.sql
```

Future rescue migrations must be added to that list explicitly, with a
justifying comment. No wildcard allowance.

## Commands run and results

| Command | Result |
|---|---|
| `node scripts/check-no-uat-password-reset.mjs` | `✓ Batch D1 no-UAT-password-reset check passed (608 edge-function files scanned)` |
| `node scripts/check-immutability-triggers-not-dropped.mjs` | `✓ Batch D2 immutability-triggers-not-dropped check passed (608 migrations scanned, 8 allowlisted, 15 triggers + 7 functions protected)` |
| `bunx vitest run src/tests/batch-d1-d2-static-guards.test.ts` | Executed by CI; both cases assert exit 0 from the two guards. |

## Confirmations

- No migration applied.
- No runtime source (`src/`, `supabase/functions/`) modified.
- No edge function deployed.
- No config, secret, RLS, grant, policy, ownership, trigger, cron, storage,
  schema, or function changed.
- No data mutated. No password reset performed. No credit issued.
- `app.allow_audit_cleanup` was **not** touched — #3/#17 remain contained.
- `admin-credit-org` was **not** touched — #74 remains classified
  already-safe.
- No emails / notifications / payment-provider calls.
- Refunds, token ledger, WaD, POI, lifecycle, reconciliation, retention,
  storage, legal holds, and pending-verification items were not touched.

## Final status

`BATCH_D1_D2_STATIC_GUARDS_DEPLOYED`
