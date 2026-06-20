# Batch 5 — Institutional Verified Profile API, Payment Detail Status API, API Client/Admin Management

**Scope:** M008, M009, M016
**Status:** shell complete; no production registry data is ingested; no external provider integrated.

## What this batch delivers

1. **M008 — Institutional Verified-Profile Status API facade.** Edge function
   `registry-institutional-profile-status` returns ONLY safe status fields
   (`profile_status`, `claim_status`, `authority_status`, `provenance_summary`,
   `country_coverage_status`, `readiness_status`, `confidence_rating`,
   `result_state`, `safe_explanation`, `audit_reference`). The function
   consults the Business Decision Register (`category = api_output`,
   `status = approved`) and the `isProfileInstitutionallyUsable` gate
   before it can return `usable`. Claim approval alone does NOT satisfy
   the gate; authority approval alone does NOT satisfy the gate;
   seed-only coverage is hard-blocked.

2. **M009 — Institutional Payment-Detail Status API facade.** Edge function
   `registry-institutional-payment-status` returns ONLY the payment-status
   flag (`verified` / `not_verified` / `expired` / `disputed` / `unavailable`)
   plus optional masked reference. Raw bank-detail fields are never returned.
   The flag mapping is enforced by `mapBankStateToApiFlag` (Deno + browser
   SSOTs are byte-aligned). A `verified` result also requires a non-null
   verification method + verified-at + expiry AND an approved Business
   Decision. captured_unverified / pending / failed / not_provided /
   cancelled all map to `not_verified`.

3. **M016 — API Client / Admin Management.** Edge function
   `registry-api-client-manage` exposes `create_client`, `update_client`,
   `suspend_client`, `reactivate_client`, `create_key`, `revoke_key`. All
   status transitions are routed through this function — direct DB status
   updates from non-service roles are rejected by table triggers. New keys
   are returned to the caller once (the hash is stored). Admin UI lives at
   `/admin/registry/api`, lists clients, scopes, recent requests, and the
   audit trail. Internal helper `registry-api-usage-log` is gated by
   `INTERNAL_CRON_KEY` and writes rate-limit / usage rows.

## SSOTs

- Browser: `src/lib/registry-institutional-api.ts`
- Deno mirror: `supabase/functions/_shared/registry-institutional-api.ts`

The two are pinned byte-aligned by `scripts/check-registry-api-scope-parity.mjs`
across: environments, client statuses, key statuses, scopes, result states,
audit event names, payment-status flags, and the forbidden raw-bank-field list.

## Canonical scopes (Batch 5)

`registry.search`, `registry.profile.read`, `registry.profile.status.read`,
`registry.profile.verified.read`, `registry.payment_status.read`,
`registry.claim.status.read`, `registry.coverage.read`.

**No raw bank-detail scope exists in Batch 5.** Any future raw-detail
response would require its own contract decision and Business Decision.

## Canonical result states

`usable`, `not_usable`, `not_found`, `not_ready`, `seed_only`, `demo_only`,
`expired`, `disputed`, `revoked`, `insufficient_authority`,
`insufficient_provenance`, `business_decision_required`, `disabled`.

## Canonical audit events

`registry_api_client_created`, `registry_api_client_updated`,
`registry_api_client_suspended`, `registry_api_key_created`,
`registry_api_key_revoked`, `registry_api_profile_status_requested`,
`registry_api_payment_status_requested`, `registry_api_response_returned`,
`registry_api_request_blocked`, `registry_api_scope_denied`,
`registry_api_rate_limit_hit`.

## Tables (Batch 5 migration)

- `registry_api_clients` — RLS: admin/compliance read; status mutations
  trigger-blocked from non-service roles.
- `registry_api_keys` — `key_hash` column is column-revoked from the
  `authenticated` role; only `key_prefix` is exposed.
- `registry_api_request_logs` — append-only usage rows.
- `registry_api_audit_events` — append-only audit trail.

## Guards

- `check-registry-api-scope-parity.mjs` — TS ↔ Deno SSOT parity (8 arrays).
- `check-registry-api-audit-names.mjs` — every audit name in the SSOT is
  emitted by at least one Batch 5 edge function.
- `check-registry-api-no-raw-bank.mjs` — no raw bank-detail tokens in any
  Batch 5 surface.
- `check-registry-api-state-rules.mjs` — the verified-profile gate consults
  `business_decisions` + `isProfileInstitutionallyUsable`; the payment
  branch requires `verification_method` AND `verified_at`; the SSOT
  default branch returns `not_verified`.
- `check-registry-batch5-no-provider.mjs` — no CIPC / Onfido / GlobalDatabase
  / B2BHint / Dow Jones / Refinitiv / PayFast / Paystack / OpenAI / Resend
  / outreach token in any Batch 5 function.

## Tests

`src/tests/batch-5-institutional-api-management.test.ts` (vitest).

## Out of scope (explicitly NOT delivered in Batch 5)

- No real registry data ingestion.
- No external provider integration (CIPC, Onfido, GlobalDatabase, B2BHint,
  bank verification, Dow Jones, Refinitiv, PayFast, Paystack).
- No AI outreach drafter / no human outreach approval queue.
- No raw bank-detail API response.
- No raw bank-detail API scope.
- No billing / pricing collection (billing-readiness placeholder column only).
