# Staging Verification — Paused Status

Date: 2026-07-07
Workstream: PR #15 / Batch V-UI IDV Client Smoke Test — Manual Staging Verification
Status marker: VERIFYNOW_STAGING_WORKSTREAM_PAUSED_PENDING_SANDBOX_VALUES_AND_AUTHENTICATED_TEST_ACCESS

This is a documentation-only status note. No code, schema, migration, RLS, RPC, secret, IDV/VerifyNow/provider-routing/manual-review/admin-review, or WaD-gate logic was changed to produce this record.

## Confirmed so far

1. PR #15 is merged into `main` (merge commit `7ee1afd`).
2. `idv-person-verify` is deployed and reachable (confirmed via direct unauthenticated request returning `401`, not `404`).
3. `VERIFYNOW_API_KEY` is present (existence confirmed only; value never inspected or exposed).
4. `p5scr_record_idv` RPC has `security_definer = true` with a `service_role` EXECUTE grant confirmed.
5. Manual staging verification is still incomplete — no live South Africa or Nigeria IDV sandbox run, no admin-review decision test, and no WaD gate check has yet been executed end-to-end against a live authenticated session.

## Blocked on

- Official VerifyNow sandbox test values for South Africa and Nigeria (from Daniel/Izenzo).
- Authenticated non-admin test-user access.
- Authenticated platform-admin test-user access.
- Confirmation of whether the active Supabase project (`ugrfyhwlonlmlcmcpcdm`) is staging, production, or shared.

## Client testing status

Client/Daniel testing must remain paused until the items above are resolved and manual staging verification passes.

## Final paused verdict

`VERIFYNOW_STAGING_WORKSTREAM_PAUSED_PENDING_SANDBOX_VALUES_AND_AUTHENTICATED_TEST_ACCESS`
