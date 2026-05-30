# Admin Export Controls · Batch 7C — Staging-Only Internal Smoke Runner

**Status (build):** harness shipped, prebuild guard green.
**Status (live run):** PENDING operator-equivalent invocation against staging.
**Successor of:** Batch 7B (operator live smoke, blocked because no technical operator is available).
**Predecessor of:** Batch 8 — Redaction Contract Implementation (BLOCKED until this evidence is green).

## Why this exists

Batch 7B required a human operator with service-role credentials, TOTP enrollment skills, and a shell on a workstation. That operator is not available. Batch 7A's helper seeder (`seed-smoke-batch-7-fixtures`) reduced the burden but still required somebody to run shell commands and consume the service-role key.

Batch 7C moves the **entire** smoke chain server-side into a single, tightly-guarded edge function that the platform itself can invoke. The function is **proof-only**: it never prepares, generates, downloads, destroys, or signs any export artefact.

## Runner

`supabase/functions/admin-export-batch-7c-smoke/index.ts`

### Trigger contract

| Guard | Enforcement |
|---|---|
| Staging-only | Calls `is_production_environment()`; refuses with HTTP 403 `production_refused` if it returns `true`. |
| Privileged auth | Requires `x-internal-key: $INTERNAL_CRON_KEY` **or** `Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY`. Anything else → HTTP 401. |
| Confirm phrase | Request body must be `{"confirm":"RUN_ADMIN_EXPORT_BATCH_7C_SMOKE"}`. Anything else → HTTP 400. |
| Fixture domain | All seeded users are `smoke-b7c-*@test.izenzo.co.za`, `user_metadata.fixture="smoke-b7c"`. |

### What it does (in order)

1. Verifies staging via `is_production_environment()`.
2. Idempotently upserts four fixtures + roles + TOTP:
   - `smoke-b7c-requester@test.izenzo.co.za`  — platform_admin, verified TOTP (AAL2)
   - `smoke-b7c-approver@test.izenzo.co.za`   — platform_admin, verified TOTP (AAL2)
   - `smoke-b7c-aal1-admin@test.izenzo.co.za` — platform_admin, no MFA factor (AAL1)
   - `smoke-b7c-non-admin@test.izenzo.co.za`  — no platform_admin role
3. Signs in via Auth REST, upgrades to AAL2 in-process for the two MFA fixtures, and exercises:
   - **A** — `admin-governance-export-request` as requester (AAL2) → expect 200, captures `request_id`.
   - **B1** — same call as AAL1 admin → expect 403 `MFA_REQUIRED`.
   - **B2** — same call as non-admin → expect 403 `NOT_PLATFORM_ADMIN`.
   - **C** — `admin-governance-export-approve` as approver (AAL2) → expect 200 with `new_status:"approved"`.
   - **D** — same approve call as requester → expect 409 `SELF_APPROVAL_BLOCKED`.
   - **E1** — `admin-governance-export-list` as approver (AAL2) → row visible, safe fields only.
   - **E2** — list as AAL1 admin → expect 403.
   - **E3** — list as non-admin → expect 403.
4. Reads `audit_logs` for the three canonical actions filtered by `request_id` or `governance_record_id`:
   - `data.admin_export_requested`
   - `data.admin_export_approved`
   - `data.admin_export_blocked_or_declined`
5. Runs the generation-leak regex on every response payload.
6. Returns evidence JSON as response body. Failure list and per-path checks included.

### What it does NOT do

- Does not call `admin-export-prepare`, `admin-export-download`, `admin-export-destroy`, `export-prepare`, `export-download`, `export-destroy`, or any file/CSV/Blob/signed-URL code path. **Enforced by `scripts/check-admin-export-controls-batch-7c.mjs`** (prebuild).
- Does not mutate `legal_holds`, `org_retention_policies`, or `export_requests` directly. The list/approve/request edge functions handle their own writes through the existing Batch 2/4/5 RPCs.
- Does not touch DATA-004: no cron mutation, no cold-storage path, no retention enforcement.
- Does not include `password` or `totp_secret` values in the evidence response — only user ids, emails, role, and AAL2 flag.

## Invocation

Triggered by the platform (no human shell required). Example:

```bash
# Anywhere the platform/internal scheduler can reach an edge function:
POST https://<staging-project>.supabase.co/functions/v1/admin-export-batch-7c-smoke
Headers:
  x-internal-key: $INTERNAL_CRON_KEY      # OR  Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY
  Content-Type: application/json
Body:
  { "confirm": "RUN_ADMIN_EXPORT_BATCH_7C_SMOKE" }
```

Response is the evidence JSON. On `ok:true` (no failures, all audit events present), Batch 7C is green and Batch 8 may proceed.

## Acceptance criteria (live)

- `evidence.failures` is empty.
- All paths `A`, `B1`, `B2`, `C`, `D`, `E1`, `E2`, `E3` carry at least one `{ ok: true }` check and no `{ ok: false }`.
- `evidence.audit_events_present` is `true` for all three actions, scoped to this run's `request_id` / `governance_record_id`.
- `evidence.no_generation_proof` is all `false` (no leak).
- `evidence.data_004_touched` and `evidence.cron_touched` are `false`.
- `evidence.request_id` populated.

## Cleanup

Cleanup is **not required**. Fixtures are clearly labelled (`smoke-b7c-*@test.izenzo.co.za`, `user_metadata.fixture="smoke-b7c"`) and the runner is idempotent. Operators may delete the four fixture users via `auth.admin.deleteUser` at any time — cascading FKs remove `user_roles` and `auth.mfa_factors`.

## Runner disposition

The runner stays deployed but remains guarded:
- production-refused (DB function),
- privileged-auth-only (service_role / INTERNAL_CRON_KEY),
- confirm-phrase-required.

This matches the policy applied to other staging-only test runners. It may be removed once Batch 8/9 acceptance is signed off.

## Live evidence

To be appended after the first staging invocation. Expected fields:

```json
{
  "batch": "7C",
  "staging_only": true,
  "failures": [],
  "request_id": "<uuid>",
  "paths": { "A_request_success": { "checks": [{ "ok": true, ... }] }, "B1_...": ..., "E3_...": ... },
  "audit_events_present": {
    "data.admin_export_requested": true,
    "data.admin_export_approved": true,
    "data.admin_export_blocked_or_declined": true
  },
  "no_generation_proof": {
    "file_generated": false, "download_link_present": false, "signed_url_present": false,
    "prepare_called": false, "destroy_called": false, "legal_holds_mutated": false
  },
  "data_004_touched": false,
  "cron_touched": false
}
```

## Files changed

- `supabase/functions/admin-export-batch-7c-smoke/index.ts` (new)
- `scripts/check-admin-export-controls-batch-7c.mjs` (new prebuild guard)
- `package.json` (prebuild chain: appended `check-admin-export-controls-batch-7c.mjs`)
- `evidence/admin-export-controls-batch-7c-internal-smoke-runner.md` (this file)

## Out of scope (and intentionally NOT done)

- No Batch 8 redaction contract implementation.
- No export prepare / download / destroy / signed URL / file generation.
- No DATA-004, cron, cold-storage, retention enforcement, or legal-hold mutation.
- No changes to `seed-smoke-batch-7-fixtures` or `scripts/admin-export-controls-batch-7-smoke.mjs` — Batch 7A/B artefacts remain frozen.
