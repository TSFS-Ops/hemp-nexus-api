# Batch 15 — Institutional API Hardening (Phase 1, Backend)

**Status:** Phase 1 backend complete. Phase 2 (admin UI + test console) deferred.
**Returned status code:** `BATCH_15_INSTITUTIONAL_API_BACKEND_COMPLETE`

## Scope of Phase 1

Backend-only hardening of the institutional API layer that sits on top of
the accepted Batch 1–14B foundation. Phase 1 codifies:

- API operating modes (`disabled` default; `sandbox`, `demo`, `limited_production`, `production`).
- API client lifecycle statuses (10 states).
- API key types (`sandbox` / `production`, strictly separated).
- Canonical scopes (10 hardened scopes).
- Forbidden scopes (raw bank / unmasked bank / personal-contact / evidence — DB CHECK-blocked).
- Response result states (27 states).
- Safe response envelope helpers.
- Gate evaluation logic (lifecycle, scope, key, mode, country, use-case, rate limit).
- Payment-status mapping that uses Batch 14 final verification truth as the controlled source.
- Profile-status mapping that respects readiness, lifecycle, claim, authority, and Business Decision gates.
- Audit event catalog (24 hardened event names) and usage/blocked logging.
- Production-approval acknowledgement text (locked SSOT string).
- Edge functions for profile/payment/readiness/coverage status and key management.
- Database tables, RLS, GRANTs, and forbidden-scope CHECK.

## API mode matrix

| Mode | Default | Callable lifecycles | Required key_type | Notes |
|------|---------|---------------------|-------------------|-------|
| `disabled` | ✓ | none | — | Default for every new client; cannot call. |
| `sandbox` | — | `sandbox_active`, `demo_active`, `production_pending` | `sandbox` | Safe sample/demo responses only. |
| `demo` | — | `demo_active`, `sandbox_active` | `sandbox` | Demo-ready records only. |
| `limited_production` | — | `production_active` | `production` | Requires approval + business decision. |
| `production` | — | `production_active` | `production` | All production gates required. |

## API client status matrix

| Lifecycle | Can call? | Notes |
|-----------|-----------|-------|
| `draft` | ✗ | Pre-approval. |
| `pending_approval` | ✗ | Awaiting sandbox approval. |
| `sandbox_active` | ✓ (sandbox) | Sandbox key only. |
| `demo_active` | ✓ (sandbox) | Demo key only. |
| `production_pending` | ✓ (sandbox) | Sandbox-mode dress rehearsal only. |
| `production_active` | ✓ | Production key allowed. |
| `suspended` | ✗ | Blocked at `client_not_suspended` gate. |
| `revoked` | ✗ | Blocked. |
| `expired` | ✗ | Blocked. |
| `disabled` | ✗ | Blocked. |

## API scope matrix

| Scope | Allowed | Notes |
|-------|---------|-------|
| `registry.search` | ✓ | Discovery. |
| `registry.profile.status.read` | ✓ | Profile-status endpoint. |
| `registry.profile.summary.read` | ✓ | Safe summary fields only. |
| `registry.claim.status.read` | ✓ | Claim status. |
| `registry.authority.status.read` | ✓ | Authority status. |
| `registry.bank.status.read` | ✓ | Bank-status (safe-status only). |
| `registry.payment_status.read` | ✓ | Uses Batch 14 truth. |
| `registry.coverage.read` | ✓ | Country coverage. |
| `registry.readiness.read` | ✓ | Readiness state. |
| `registry.usage.read` | ✓ | Client portal usage (Phase 2). |
| `registry.bank.raw.read` | ✗ | **Forbidden.** CHECK-blocked. |
| `registry.bank.unmasked.read` | ✗ | **Forbidden.** CHECK-blocked. |
| `registry.personal_contact.raw.read` | ✗ | **Forbidden.** CHECK-blocked. |
| `registry.evidence.raw.read` | ✗ | **Forbidden.** CHECK-blocked. |

## Payment-status mapping proof

| B14 verification status | Hardened result state | Usable? |
|-------------------------|-----------------------|---------|
| `verified` (unexpired) | `usable` | ✓ |
| `verified` (expired) | `bank_verification_expired` | ✗ |
| `captured_unverified` | `bank_details_captured_unverified` | ✗ |
| `verification_requested` | `bank_verification_pending` | ✗ |
| `manual_review_required` | `bank_verification_pending` | ✗ |
| `provider_pending` | `bank_verification_pending` | ✗ |
| `provider_check_in_progress` | `bank_verification_pending` | ✗ |
| `provider_matched` | `bank_verification_pending` | ✗ |
| `manual_verified` | `bank_verification_pending` | ✗ |
| `failed` / `provider_mismatch` / `provider_error` | `bank_verification_failed` | ✗ |
| `expired` | `bank_verification_expired` | ✗ |
| `revoked` / `cancelled` | `bank_verification_revoked` | ✗ |
| `disputed` | `bank_verification_disputed` | ✗ |
| `provider_unavailable` | `bank_verification_unavailable` | ✗ |
| missing submission | `bank_details_not_submitted` | ✗ |

Tests assert that every state in `REGISTRY_API_NOT_VERIFIED_BANK_STATES`
maps to a non-`usable` result (see `batch-15-institutional-api-hardening.test.ts`).

## Profile-status mapping proof

The profile-status edge function evaluates, in order:
`disabled` → `archived` → `seed` → `imported_unverified` → `shell lifecycle` →
`claim approved` → `authority approved` → `api_output` business decision →
`api_output_allowed` flag → `usable`.

## No raw bank response proof

`scripts/check-batch-15-no-raw-bank.mjs` scans all five B15 edge functions
for any token in `REGISTRY_API_FORBIDDEN_RESPONSE_FIELDS` (raw bank fields,
masked bank fields, personal contact fields). The guard fails the build if
any token appears as a property name or string literal.

## Sandbox / production key proof

- `registry_api_keys.key_type` has a CHECK constraint of `('sandbox','production')`.
- `registry-api-client-key-manage` rejects production-key creation unless
  the client lifecycle is `production_active` (returns `422
  production_key_requires_production_active_lifecycle`).
- The gate evaluator (`evaluateApiGates`) requires `key_type === 'production'`
  when `requested_mode === 'production' | 'limited_production'` AND
  `client_lifecycle_status === 'production_active'`. Anything else returns
  `api_client_not_allowed`.

## Rate-limit proof (Phase 1)

Phase 1 wires the gate (`rate_limit_ok`) and provides three seeded
rate-limit profiles (`conservative_sandbox`, `conservative_demo`,
`conservative_production`). When the gate input is `rate_limited: true`
the request is blocked with `rate_limited` and logged to
`registry_api_blocked_events`. The active per-minute/per-day counter is a
Phase 2 deliverable (admin UI surfaces the counter).

## Blocked request proof

Every block path inserts a row into `registry_api_blocked_events` with:
`request_id`, `endpoint`, `scope`, `mode`, `country`, `block_reason`,
`block_category`, `status_code`, and `audit_reference`. The block path
also emits the `registry_api_request_blocked` audit event.

## Usage log proof

Every allowed request inserts a row into `registry_api_usage_events` with:
`request_id`, `client_id`, `key_id`, `endpoint`, `scope`, `mode`,
`country`, `identifier_type`, `result_state`, `usable`, `status_code`,
`ip_hash`, `user_agent`, `audit_reference`. The `api_request_logs`
no-payload guard remains active (no raw request/response bodies).

## Admin UI / test console proof

**Deferred to Phase 2.** Phase 1 ships the backend, SSOTs, edge functions,
guards, tests, manifest, and release gate updates. Phase 2 will add
`/admin/registry/api-clients`, `/admin/registry/api-usage`, and the
admin test console.

## Guard list

- `check-batch-15-ssot-parity.mjs`
- `check-batch-15-no-raw-bank.mjs`
- `check-batch-15-forbidden-scopes.mjs`
- `check-batch-15-audit-names.mjs`

All Batch 1–14B guards remain wired and green.

## Test summary

- `src/tests/batch-15-institutional-api-hardening.test.ts` covers SSOT
  shape, payment-status mapping (every non-verified bank state →
  non-usable), gate evaluation for happy path and every block path
  (suspended client, revoked key, sandbox key with production mode,
  forbidden scope, ungranted scope, country not allowed, use-case not
  allowed, rate-limit hit), and response envelope contract (request id,
  audit reference, safe reason, no forbidden fields).

## Out of scope (Phase 1)

- No admin UI changes (`/admin/registry/api-clients`, `/admin/registry/api-usage`).
- No admin test console UI.
- No client-portal UI for `registry.usage.read`.
- No live external provider integration.
- No raw / masked bank-detail responses.
- No outreach.
- No notification dispatch.
