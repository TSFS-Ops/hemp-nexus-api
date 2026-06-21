# Batch 15B — Institutional API Admin UI & Test Console

Status: COMPLETE
Scope: UI-only. No Batch 15 backend contract changes.

## What was built

### New admin routes (platform_admin gated)
- `/admin/registry/api-clients` — safe summary list of institutional API clients with status / mode / countries / use-cases / rate-limit profile / review/expiry. Filters: search, lifecycle status, mode, country.
- `/admin/registry/api-clients/:clientId` — client detail with scopes, countries, use cases, **separated sandbox and production key panels**, production approval checklist with SSOT acknowledgement copy and gated submit, approval & audit history.
- `/admin/registry/api-usage` — safe view of `registry_api_usage_events` + `registry_api_blocked_events` with client / endpoint / scope / mode filters and blocked-only / rate-limited-only toggles.
- `/admin/registry/api-test-console` — runs Batch 15 `registry-api-profile-status` and `registry-api-payment-status` and renders only the safe envelope + gate decisions.

### UI SSOT
- `src/lib/registry-api-hardening-ui.ts` — `REGISTRY_API_UI_COPY` (canonical safety strings), lifecycle/mode/blocked-reason labels, `paymentStatusLabel`, `safeKeyReference`, `buildScopeOptions` (forbidden scopes visible but non-selectable), `isProductionApprovalReady`.

### Guards
- `scripts/check-batch-15b-ui-no-raw-bank.mjs` — no raw or masked bank fields on UI surfaces.
- `scripts/check-batch-15b-ui-no-full-key.mjs` — no full-key field references; detail page must render keys through `safeKeyReference`.
- `scripts/check-batch-15b-ui-forbidden-scopes.mjs` — forbidden scopes are visible, non-selectable and accompanied by explanation copy.
- `scripts/check-batch-15b-ui-prod-ack.mjs` — production approval requires SSOT acknowledgement copy and an explicit checkbox before submit.

### Tests
- `src/tests/batch-15b-institutional-api-admin-ui.test.ts` — UI SSOT + helper tests (acknowledgement parity, lifecycle, scopes, safe key, production checklist, payment-status labelling for every non-final state, summariseList).

## Safety evidence

| Concern | Mitigation | Proof |
|---|---|---|
| No raw bank in API admin UI | guard `check-batch-15b-ui-no-raw-bank.mjs` | scans 5 files for forbidden tokens |
| No full API keys | `safeKeyReference` + guard `check-batch-15b-ui-no-full-key.mjs` | sandbox/production panels render reference only |
| Forbidden scopes visible but non-selectable | `buildScopeOptions` returns `{selectable:false, forbidden:true}` for `registry.bank.raw.read`, `registry.bank.unmasked.read`, `registry.personal_contact.raw.read`, `registry.evidence.raw.read` | guard + unit test |
| Production approval requires acknowledgement | `REGISTRY_API_PRODUCTION_ACKNOWLEDGEMENT_TEXT` rendered via `REGISTRY_API_UI_COPY.productionAcknowledgement`; submit disabled until `isProductionApprovalReady` | guard + unit test |
| Sandbox / production key separation | `sandbox-keys-panel` and `production-keys-panel` are distinct sections; production controls disabled until `production_active` | test-ids + visual gating |
| Suspended/revoked/expired/disabled never render active | `isClientLifecycleActive` returns false for these; `blocked-banner` shown | unit test |
| Payment-status non-final mapping | `paymentStatusLabel` returns `Verified` ONLY for `usable + final + unexpired`. Every other state including `manual_verified`, `provider_matched`, `expired`, `revoked`, `disputed`, `failed`, `provider_error` renders `Not verified` | unit test (8 cases) |
| Test console envelope-only | calls Batch 15 edge functions and renders the response envelope; SSOT warning copy `testConsoleWarning` is shown above the response | code review + guard |
| Batch 5 compatibility | `/admin/registry/api` (Batch 5 page) untouched and still linked from the new list page | route diff |

## Out of scope (unchanged)
- No Batch 15 backend contract changes.
- No new backend tables, no new edge functions.
- No raw bank, masked bank, personal contact or evidence exposure.
- No forbidden scope can be granted (DB CHECK constraint from Batch 15 still enforces this).
- No outreach, no provider integration.
