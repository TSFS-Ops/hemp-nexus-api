# Batch 12 — registry_import_records_staging admin-only access

## Issue
`registry_import_records_staging` carries fields explicitly flagged as
admin-only (`contact_email_admin_only`, `contact_phone_admin_only`) and
an `officers` JSONB column that mirrors company-officer personal data.
The previous SELECT policy `registry_import_staging_read_auth` used
`USING (true)` for the `authenticated` role, so any signed-in user
could read every staging row, including those admin-only columns.

A parallel finding existed on `registry_import_batches` whose
`internal_notes`, `evidence_url` and `licence_reference` columns were
exposed through the matching `registry_import_batches_read_auth`
policy.

## Fix
Two migrations applied:

1. **`registry_import_records_staging`**
   - Dropped `registry_import_staging_read_auth`.
   - Added `registry_import_staging_read_admin`: SELECT permitted to
     `authenticated` only when
     `has_role(auth.uid(),'platform_admin') OR has_role(auth.uid(),'compliance_owner')`.
   - The existing `registry_import_staging_write_admin` ALL policy is
     unchanged (already admin/compliance-gated).
   - `service_role` retains full access (RLS bypass) for the import
     pipeline edge functions.

2. **`registry_import_batches`** (same class of finding, fixed together)
   - Dropped `registry_import_batches_read_auth`.
   - Added `registry_import_batches_read_admin` with the same
     admin/compliance scope.

No public-facing view or RPC exposes admin-only contact fields. The
import pipeline UI lives entirely under admin routes (`/admin/registry/imports`)
and is reached through admin-gated edge functions that already check
roles server-side.

## Access matrix after fix
| Caller | SELECT on staging / batches | Read admin-only fields |
|---|---|---|
| anonymous | denied (no anon policy) | no |
| authenticated non-admin | denied (USING evaluates false) | no |
| `platform_admin` | yes | yes |
| `compliance_owner` | yes | yes |
| `service_role` | yes (RLS bypass) | yes |

## Verification
- Vitest `src/tests/batch-12-import-staging-admin-only.test.ts`
  asserts the policy drops, the new admin-scoped policies on both
  tables, and that no non-pipeline edge function references the
  admin-only column names.
- Prebuild guard `scripts/check-sensitive-column-open-select.mjs`
  scans every migration: for any table that defines a column whose
  name ends with `_admin_only`, `_internal`, `_private`, `_sensitive`,
  or `_secret`, the current policy set must not contain a SELECT
  policy with `USING (true)` granted to `anon` / `authenticated` /
  `public`. It honours later `DROP POLICY` statements. The guard now
  passes (9 sensitive tables scanned, 0 violations).
- Wired into `package.json` `prebuild`.
- DB inspection: `pg_policies` for both tables now shows only the
  admin/compliance-scoped SELECT policy and the existing admin-gated
  write policy.

## Result
`contact_email_admin_only`, `contact_phone_admin_only`, the officers
JSONB, and the `internal_notes` / `evidence_url` admin metadata on
import batches are no longer readable by anonymous or standard
authenticated users through any table, view, RPC, or edge function
response path. Access is restricted to `platform_admin`,
`compliance_owner`, and `service_role`.
