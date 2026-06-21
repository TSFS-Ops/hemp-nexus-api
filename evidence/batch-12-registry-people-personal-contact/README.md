# Batch 12 — registry_company_people personal contact hardening

## Issue
The `registry_company_people` table holds `personal_email`, `personal_phone`
and `personal_address` for company officers. The previous policy
`"public reads public people"` allowed `anon` and `authenticated` to
SELECT any row where `public_visible = true`, including the personal
contact columns. If an admin or service role ever flipped
`public_visible = true` on a row containing PII (accidentally or via a
bug), the personal contact details would become publicly readable.

## Fix
Implemented in migration `20260621_registry_people_personal_contact_hardening`:

1. **Dropped** the public read policy `"public reads public people"` so no
   anon/authenticated client can SELECT directly from the table.
2. **Trigger guard** `registry_company_people_guard_public_visible`
   raises a `check_violation` if any INSERT/UPDATE tries to set
   `public_visible = true` while `personal_email`, `personal_phone` or
   `personal_address` is non-null. This protects against accidental or
   malicious publication of PII even by admins.
3. **Column-level REVOKE** of SELECT on `personal_email`,
   `personal_phone`, `personal_address` from `anon` and `authenticated`
   roles — defence in depth on top of RLS.
4. **Public-safe RPC** `registry_company_people_public_safe(record_id)`
   (SECURITY DEFINER, search_path locked) returns only
   `id, record_id, role_kind, display_name, created_at` and only for
   rows where the parent record is publicly displayable and where the
   row carries no personal contact data. EXECUTE is granted to `anon`,
   `authenticated`, `service_role`.

## Access pattern after fix
| Caller | Read non-PII officer fields | Read personal_email/phone/address |
|---|---|---|
| anon | only via `registry_company_people_public_safe` RPC | never |
| authenticated (non-admin) | only via the RPC | never |
| `platform_admin` | yes (RLS `"platform admin reads all people"`) | yes (admin select) |
| `service_role` | yes (RLS `"service role manages people"`) | yes |

## Verification
- Prebuild guard: `scripts/check-registry-people-personal-contact-leak.mjs`
  — fails the build if any file under `src/` or `supabase/functions/`
  (other than the SSOT migrations, tests, and outreach PII detector
  allowlist) references `personal_email|phone|address` on a
  `registry_company_people` surface.
- Vitest suite: `src/tests/batch-12-registry-people-personal-contact.test.ts`
  asserts the policy drop, trigger presence, REVOKE statements, RPC
  shape, and that `registry-company-profile` never selects the
  forbidden columns.
- Manual: the existing `registry-company-profile` edge function already
  selects only `role_kind, display_name`. No public response carries
  personal contact data.

## Result
There is no public or standard-authenticated path that can read
`personal_email`, `personal_phone` or `personal_address` from
`registry_company_people`, even if `public_visible = true` is set by
mistake — the trigger blocks the write, the REVOKE blocks the read, and
the public RPC excludes the columns entirely.
