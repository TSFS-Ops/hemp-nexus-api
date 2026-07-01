# Batch B3 — WaD attestations sealed-parent immutability

**Tracker item:** #73 — WaD attestations can be edited by service role after sealing.

**Status:** `BATCH_B3_WAD_ATTESTATIONS_SEALED_PARENT_IMMUTABILITY_DEPLOYED_PENDING_VERIFICATION`

## Original exposure

`public.wad_attestations` was append-shaped (no `updated_at`, unique
`(wad_id, user_id)`) and RLS blocked authenticated UPDATE/DELETE, but:

- `service_role` and the table owner bypass RLS.
- No DB trigger prevented post-seal edit or delete of attestation rows.
- Attestations are part of the sealed evidence record (C10). Signer
  changes should go through a new WaD / supersession — never through
  editing or deleting a sealed attestation.

The B3 inspection confirmed **zero live UPDATE or DELETE writers**
against `wad_attestations` in the app, edge functions, migrations,
scripts, or cron. The only live writer is the pre-seal INSERT in
`supabase/functions/wad/index.ts`.

## Repair

Migration
`supabase/migrations/20260701074823_29b9b2a9-7998-4db4-ba77-7e471a2a82fd.sql`
adds a single trigger + function pair.

- Function: `public.assert_wad_attestation_sealed_parent_immutability()`
  - `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public`.
  - Looks up `public.wads.sealed_at` for the row's `wad_id`.
  - If `sealed_at IS NOT NULL`, raises `check_violation` with the
    message `wad_attestation_sealed_parent_immutable: <OP> on
    public.wad_attestations is not permitted after parent WaD <id> was
    sealed at <ts>`.
  - If unsealed, returns `NEW` for UPDATE and `OLD` for DELETE.

- Trigger: `wad_attestations_sealed_parent_immutability_trg`
  - `BEFORE UPDATE OR DELETE ON public.wad_attestations FOR EACH ROW`.
  - Fires for every caller — no role gate, so service_role and the
    table owner are also blocked post-seal.

## Why no allowlist

Unlike C10 on `public.wads` (which needed a narrow allowlist for
revocation and certificate generation), `wad_attestations` has **no
legitimate post-seal writer**. The signer-change flow is supersession
on the parent WaD, not mutation of the attestation row. An
allowlist-free trigger matches the product rule.

## Explicit non-changes

- ❌ No RLS policy created, altered, or dropped.
- ❌ No GRANT / REVOKE.
- ❌ No table ownership change.
- ❌ No FORCE ROW LEVEL SECURITY.
- ❌ Batch B1 `wad_attestations_no_truncate_trg` untouched.
- ❌ C10 `wads_seal_immutability_trg` untouched.
- ❌ Deferred Batch B2 (`token_ledger` UPDATE/DELETE trigger) untouched.
- ❌ No edge function deployed, no cron change, no emails, no
  notifications, no provider calls.
- ❌ No production row inserted, updated, deleted, sealed, unsealed,
  revoked, superseded, truncated, archived, or purged.

## Tests / guards

- **Static guard:** `scripts/check-batch-b3-wad-attestation-immutability.mjs`
  pins the migration shape (function attrs, trigger definition, parent
  `sealed_at` lookup, raise code) and asserts no forbidden GRANT /
  policy / FORCE RLS / ownership changes, no touch to Batch B1
  TRUNCATE trigger, no subsequent DROP/DISABLE of the B3 trigger, and
  no live UPDATE/DELETE writers against `wad_attestations` in `src/`,
  `supabase/functions/`, `scripts/`, `e2e/`.

- **SQL proof:** `supabase/tests/batch_b3_wad_attestation_immutability_proof.sql`
  is rollback-only. It builds an ephemeral WaD + attestation fixture,
  verifies pre-seal UPDATE and DELETE work, seals the parent, then
  verifies:
  - post-seal UPDATE raises `wad_attestation_sealed_parent_immutable`;
  - post-seal DELETE raises `wad_attestation_sealed_parent_immutable`;
  - sealed parent WaD DELETE remains blocked by the C10 trigger
    (`sealed_wad_immutable`), preventing a cascade-delete workaround.
  The proof requires table-owner / service-role privileges. Sandbox
  roles without those privileges are blocked by RLS/privilege checks
  before the trigger; that path is safe (nothing can mutate the row)
  but does not exercise the trigger message. Full trigger-message
  verification is pending privileged CI execution.

## Commands run and results

```
node scripts/check-batch-b3-wad-attestation-immutability.mjs
  → ✓ Batch B3 wad_attestation immutability check passed
     (install migration: 20260701074823_...sql)

node scripts/check-batch-b1-truncate-guards.mjs
  → ✓ Batch B1 TRUNCATE-guards check passed (8 protected tables)

bunx vitest run src/tests/c10-wad-seal-immutability.test.ts
  → 10 passed
```

Live trigger inspection via privileged read confirms both triggers
present on `public.wad_attestations`:

- `wad_attestations_no_truncate_trg` — BEFORE TRUNCATE (Batch B1)
- `wad_attestations_sealed_parent_immutability_trg` —
  BEFORE UPDATE OR DELETE FOR EACH ROW (Batch B3)

The rollback-only SQL proof was not executed in this session because
it must run under table-owner / service-role privileges in a CI
context. Live trigger existence is confirmed; trigger-message
verification is the pending privileged step.

## Reversibility

```sql
DROP TRIGGER IF EXISTS wad_attestations_sealed_parent_immutability_trg
  ON public.wad_attestations;
DROP FUNCTION IF EXISTS public.assert_wad_attestation_sealed_parent_immutability();
```
