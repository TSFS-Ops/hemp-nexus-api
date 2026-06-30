# C10 — Sealed WaD metadata immutability

**Status:** `C10_SEALED_WAD_METADATA_IMMUTABILITY_DEPLOYED_PENDING_VERIFICATION`

## Finding (from C10 inspection)

`public.wads` carried `sealed_at` and `seal_hash` to mark a WaD as
sealed, but no trigger blocked post-seal mutation. RLS allowed POI
parties / admins to UPDATE sealed rows, and the `Service role can manage
WaDs` policy let service-role do the same. Append-only protection on
`event_store` / `match_events` / `poi_events` did not extend to `wads`.

No evidence of actual post-seal mutation in current data, but DB-level
enforcement was absent.

## Why RLS alone was insufficient

- The existing UPDATE policy is per-row authorisation, not per-column.
  It cannot say "after sealing, only revocation columns may change".
- Service-role bypasses RLS by design.
- A trigger is the only layer that fires for every caller (including
  service-role) and can compare OLD vs NEW columns.

## Chosen approach

Single BEFORE UPDATE OR DELETE trigger on `public.wads` calling
`public.assert_wad_seal_immutability()`:

- `OLD.sealed_at IS NULL` → no enforcement (sealing itself, draft edits,
  attestation status transitions all still work).
- `OLD.sealed_at IS NOT NULL` AND `TG_OP = 'DELETE'` → raise
  `sealed_wad_immutable`.
- `OLD.sealed_at IS NOT NULL` AND `TG_OP = 'UPDATE'` → permit only
  changes to the allowlist below. Any other diff raises
  `sealed_wad_immutable`.

`SECURITY DEFINER`, `SET search_path = public`, `LANGUAGE plpgsql`.
Trigger fires for normal users, admins, and service-role.

## Allowlist (post-seal UPDATE)

Each entry corresponds to a real existing path:

| Column | Why it must remain mutable post-seal |
| --- | --- |
| `status` | `wad/revoke` sets `status = 'revoked'`; future supersession may set `'superseded'`. |
| `revoked_at` | written by the admin revoke path in `supabase/functions/wad/index.ts`. |
| `revoked_by` | written by the admin revoke path. |
| `revoked_reason` | written by the admin revoke path. |
| `superseded_by_wad_id` | reserved for the supersession path declared in the schema. |
| `certificate_path` | reserved for certificate persistence. |
| `certificate_generated_at` | written by `supabase/functions/deal-certificate/index.ts` after seal. |
| `updated_at` | bumped by the existing `update_wads_updated_at` trigger. |

No other column is permitted to change post-seal.

## Protected fields (post-seal)

Everything else, including (non-exhaustive):

- `canonical_payload_json`
- `evidence_bundle`
- `seal_hash`, `sealed_at`
- `ledger_entry_hash`, `prev_ledger_entry_hash`
- `supersedes_wad_id`
- `id`, `org_id`, `buyer_org_id`, `seller_org_id`
- `buyer_signatory_user_id`, `seller_signatory_user_id`
- `poi_id`, `created_by`, `created_at`
- `is_demo`, `demo_dataset_id`

Mutating any of these on a sealed row raises `sealed_wad_immutable`.
DELETE on a sealed row raises the same.

## Existing-path compatibility

| Path | File | Notes |
| --- | --- | --- |
| Sealing transition | `supabase/functions/wad/index.ts:1153` sets `status`, `seal_hash`, `sealed_at` together | At call time `OLD.sealed_at IS NULL` → trigger does not enforce. ✅ |
| Pre-seal attestation status bump | `wad/index.ts:1066` updates `status`, `buyer_signatory_user_id`, `seller_signatory_user_id` and is gated on `wad.status !== 'sealed'` | Pre-seal only. ✅ |
| Admin revoke | `wad/index.ts:1324` updates `status`, `revoked_at`, `revoked_by`, `revoked_reason` | All four are in the allowlist. ✅ |
| Certificate generation | `deal-certificate/index.ts:502` updates `certificate_generated_at` | Allowlisted. ✅ |
| Supersession | declared in schema only; no current writer found | `status`, `superseded_by_wad_id` allowlisted in advance. ✅ |

Allowlist was not silently broadened. Each column maps to an audited
existing or schema-declared path.

## Tests / guards

- `src/tests/c10-wad-seal-immutability.test.ts` — static guard pinning
  function/trigger shape, gating predicate, raise code, protected
  fields, allowlist, and the no-RLS / no-grant / no-other-table contract.
- `supabase/tests/c10_wad_seal_immutability_proof.sql` — transactional
  SQL proof (wrapped in `BEGIN; … ROLLBACK;`) covering: unsealed updates
  allowed; seal transition allowed; mutations to
  `canonical_payload_json` / `evidence_bundle` / `seal_hash` /
  `ledger_entry_hash` / `prev_ledger_entry_hash` blocked; DELETE of
  sealed row blocked; allowlisted revocation + certificate updates
  succeed. Service-role bypass is implicitly covered because the trigger
  has no role gate.

## Explicit non-changes

- ❌ No RLS policy created, altered, or dropped.
- ❌ No GRANT or REVOKE.
- ❌ No storage policy change.
- ❌ `match_documents` not touched.
- ❌ `legal_holds` / `assertNoLegalHold` / cleanup workers not touched.
- ❌ No edge function deployed.
- ❌ No cron change.
- ❌ Append-only event triggers (`event_store`, `match_events`,
  `poi_events`) not touched.
- ❌ No existing WaD row rewritten, backfilled, sealed, unsealed,
  revoked, or deleted.
- ❌ No emails, notifications, or provider calls.
- ❌ Pending C6 / C7 / C8 / C9 runtime items not touched.

## Verification plan

Once the migration is approved:

1. Run `src/tests/c10-wad-seal-immutability.test.ts` (static guard) —
   should pass.
2. Optionally execute `supabase/tests/c10_wad_seal_immutability_proof.sql`
   against the DB; it rolls back its own state.
3. Sanity-check the admin revoke path against an existing sealed WaD in
   a preview session — revoke must still succeed (allowlisted).
4. Sanity-check the certificate download path — `certificate_generated_at`
   write must still succeed.
5. Attempt a direct preview-session UPDATE on a sealed WaD's
   `canonical_payload_json` — must raise `sealed_wad_immutable`.

## Reversibility

```sql
DROP TRIGGER IF EXISTS wads_seal_immutability_trg ON public.wads;
DROP FUNCTION IF EXISTS public.assert_wad_seal_immutability();
```
