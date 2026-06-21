# Batch 12 — registry_bank_detail_submissions UPDATE hardening

## Issue
The RLS policy `rbd update own or admin` on
`public.registry_bank_detail_submissions` was defined with:

```
USING (
  submitter_user_id = auth.uid()
  OR has_role(auth.uid(),'platform_admin')
  OR has_role(auth.uid(),'compliance_owner')
)
WITH CHECK (TRUE)
```

A submitter who owned a row could therefore rewrite any column on that
row, including `submitter_user_id`, `claim_id`,
`authority_request_id`, `company_reference`, `company_name`,
`country_code`, verification/approval/dispute audit fields, and
`created_at`. The `status` column was already protected by
`trg_rbd_block_status`, but every other field was open.

## Fix (migration `20260621_rbd_update_hardening`)
1. **Replaced** `WITH CHECK (TRUE)` with a mirror of the USING clause so
   a normal user cannot transfer ownership of the row away from
   themselves and the row must remain owned by them after UPDATE.
2. **Added trigger** `trg_rbd_guard_update` (calling
   `public.registry_bank_detail_guard_update()`) that runs `BEFORE
   UPDATE` and, for callers without `platform_admin` or
   `compliance_owner`, blocks any change to:
   - `submitter_user_id`, `claim_id`, `authority_request_id`
   - `company_reference`, `company_name`, `country_code`, `currency_code`
   - `created_at`
   - `verified_at`, `verified_by`, `verification_method`, `expiry_at`,
     `revoked_at`, `revocation_reason`, `disputed_at`, `dispute_reason`,
     `failure_reason` (verification/approval/dispute audit fields)
3. **Lifecycle lock**: once `OLD.status` is not in `('not_provided','draft')`
   the trigger refuses any non-admin UPDATE. Material changes after
   submission must create a new row, not mutate the original.
4. The existing `trg_rbd_block_status` trigger continues to guard
   `status` mutations.

## Access matrix after fix
| Caller | UPDATE permitted | Can change ownership / linkage / audit | Can mutate after submission |
|---|---|---|---|
| anonymous | no (RLS) | no | no |
| authenticated non-owner | no (RLS USING) | no | no |
| owner, draft status | yes, only on safe fields | no (trigger) | no |
| owner, submitted/locked status | no (trigger) | no | no |
| `platform_admin` / `compliance_owner` | yes | yes (controlled) | yes |
| `service_role` | yes (bypasses RLS) | yes | yes |

## Verification
- Vitest suite `src/tests/batch-12-bank-detail-update-hardening.test.ts`
  asserts the policy drop, the new WITH CHECK shape (mirrors USING,
  contains `submitter_user_id = auth.uid()`, admin roles, no bare
  `WITH CHECK (true)`), the trigger creation, the immutable-field
  error strings, and the lifecycle-lock message.
- Prebuild guard `scripts/check-sensitive-rls-with-check-true.mjs`
  scans every migration for non-SELECT RLS policies on sensitive
  (bank/claim/authority/verification/payment/audit/identity/poi/kyc/ubo)
  tables that use `WITH CHECK (true)`. Only the existing
  `registry_claim_interest_events` anon-INSERT log is allowlisted with
  an in-script justification (tracked separately under the
  `anon_insert_claim_interest` finding).
- DB inspection confirms `pg_policies` now shows the strict WITH CHECK
  clause and `pg_trigger` lists `trg_rbd_guard_update`.

## Result
A submitter can no longer use UPDATE to:
- transfer the row to another user
- relink the row to another claim or authority request
- change company / currency / country reference fields
- change `created_at`
- change verification, approval, or dispute audit fields
- modify a row after it has left draft state

Ownership and audit integrity of bank detail submissions is preserved.
