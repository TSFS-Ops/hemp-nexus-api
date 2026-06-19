# Role-Negative & E2E Test Coverage Expansion

A testing/release-gate hardening package on top of the existing `e2e/` Playwright suite (currently only Smoke A–D). No new product functionality. Implements Daniel's approved questionnaire as a hard release gate.

## Scope

- New Playwright suites under `e2e/role-negative/` and `e2e/journeys/`
- Reusable helpers under `e2e/helpers/`
- Seeded TEST/UAT fixtures via a new `seed-role-negative-e2e` edge function (idempotent, mirrors `seed-smoke-a-d`)
- Evidence report under `/test-evidence/role-negative-e2e/<run_id>/`
- CI scripts wired into `package.json`
- Hard build guard: a new `scripts/check-role-negative-e2e-coverage.mjs` ensures every role × route in the matrix has a test

No product permission code is changed. If a test reveals a permission gap, it is reported as a failure, not silently patched.

## Roles, orgs, records (TEST/UAT only)

Roles (exact labels): `platform_admin`, `compliance_analyst`, `requester_trader`, `counterparty_user`, `api_client_admin`, `normal_non_admin_user`, `other_tenant_user`, `logged_out_user`.

Orgs: "Organisation A TEST/UAT" (`is_demo=true`), "Organisation B TEST/UAT" (`is_demo=true`).

Per-org seeded records (all names prefixed `TEST-` or `UAT-`): 1 trade request, 1 match, 1 POI, 1 WaD, 1 protected document, 1 refund/dispute, 1 governance export candidate, 1 API key + usage log row.

Credentials supplied via env (`E2E_RN_*`); password from `SMOKE_PASSWORD`-style env, never committed.

## Files to add

```
supabase/functions/seed-role-negative-e2e/index.ts          # idempotent fixture provisioner
scripts/seed-role-negative-e2e.sh                            # one-shot wrapper → .env.role-negative
scripts/check-role-negative-e2e-coverage.mjs                 # matrix completeness guard
scripts/pack-role-negative-evidence.mjs                      # zip evidence per run_id

e2e/helpers/
  roles.ts            # ROLES, ORGS, ROUTE_MATRIX, expected landing per role
  auth-roles.ts       # loginAsPlatformAdmin / ...AsComplianceAnalyst / ... / logout
  seeded-data.ts      # resolves seeded IDs from env (set by seeder)
  route-access.ts     # assertRouteAccess(role, route, expected)
  assertions.ts       # expectAllowed/Forbidden/RedirectToLogin/NoProtectedData{Visible,InNetwork}/NoMutation/SafeDenied/EvidenceWritten
  direct-actions.ts   # invokes RPC / REST directly with role JWT (proves backend gate, not just UI)
  state.ts            # captureBeforeState / captureAfterState / compareNoMutation
  evidence.ts         # extends existing evidence fixture; writeEvidenceResult/saveEvidenceSummary/attachScreenshotOrTrace

e2e/fixtures/
  users.ts            # env-driven role → credentials map
  organisations.ts    # ORG_A_ID / ORG_B_ID
  routes.ts           # full direct-link matrix (§7)
  records.ts          # seeded record IDs (trade/match/poi/wad/doc/refund/export/apiKey) per org
  permissions.ts      # action → allowed roles map (used by wrong-actions.spec)

e2e/role-negative/
  route-access.spec.ts            # role × route matrix
  direct-links.spec.ts            # deep-link → blocked / redirected
  tenant-isolation.spec.ts        # Org A user vs Org B records
  wrong-actions.spec.ts           # mutation attempts → before==after, no side effects
  protected-documents.spec.ts     # /documents/:id/download per role/tenant
  governance-export-access.spec.ts
  api-key-access.spec.ts

e2e/journeys/
  auth-role-landing.spec.ts
  trade-match.spec.ts
  poi-lifecycle.spec.ts
  wad-lifecycle.spec.ts
  refund-dispute.spec.ts
  governance-export.spec.ts
  api-developer-access.spec.ts

test-evidence/role-negative-e2e/.gitkeep
docs/role-negative-e2e-coverage.md   # matrix, deferral register, release-gate rules
```

## Helper contracts

```ts
// e2e/helpers/auth-roles.ts
export async function loginAs(page: Page, role: Role): Promise<void>
export const loginAsPlatformAdmin       = (p: Page) => loginAs(p, 'platform_admin')
// ...one per role; logged_out_user is a no-op + clear storage

// e2e/helpers/assertions.ts
export async function expectAllowed(page, route): Promise<void>
export async function expectForbidden(page, route): Promise<void>            // 403 OR safe-denied UI, never protected data
export async function expectRedirectToLogin(page, route): Promise<void>      // lands on /auth?returnTo=...
export async function expectNoProtectedDataVisible(page, needles: string[])
export async function expectNoProtectedDataInNetwork(page, needles: string[])// scans response bodies recorded since nav
export async function expectNoMutation(before, after)
export async function expectSafeDeniedResponse(response)                     // status 401/403/404, body has no PII/keys/IDs
export async function expectEvidenceWritten(testInfo)

// e2e/helpers/direct-actions.ts — invoke RPC/edge fn with role JWT, assert deny
export async function callRpcAs(role, fn, args): Promise<{status, body}>
export async function callEdgeAs(role, fn, body): Promise<{status, body}>
```

Direct-action helpers prove the *backend* denies (not just hidden UI) — required for all wrong-action tests.

## Route matrix (§7)

Encoded once in `e2e/fixtures/routes.ts` as `{ path, allowedRoles, tenantScoped, recordKey?, kind: 'page'|'download'|'api' }`. The matrix drives both `route-access.spec.ts` and the `check-role-negative-e2e-coverage.mjs` guard, so adding a route without a test fails CI.

Routes covered: `/hq`, `/hq/audit`, `/hq/compliance`, `/hq/governance-export`, `/hq/refunds`, `/hq/api-clients`, `/developer`, `/developer/api-keys`, `/developer/usage`, `/governance`, `/governance/export/:id`, `/trades/:id`, `/matches/:id`, `/poi/:id`, `/wad/:id`, `/refunds/:id`, `/documents/:id/download`, `/exports/:id/download`, `/api/keys/:id`, `/api/usage`. Routes not present in this build are skipped with `test.skip` + reason recorded in the evidence row (not a deferral).

## Wrong-action matrix (§9)

`e2e/fixtures/permissions.ts` lists each sensitive action with `{ allowedRoles, rpc, args, recordKey, sideEffectChecks: ['status','owner','tenant','ledger','seal','quota','docFields','notifications','providerCalls'] }`. `wrong-actions.spec.ts` iterates: for each action × each disallowed role → capture before → call via `direct-actions` → expect deny → capture after → `compareNoMutation` → assert no rows in `notification_dispatches`, `webhook_deliveries`, `email_send_log`, `fund_flows` for that record since the start marker.

## Safety rails (§4) — enforced in seeder + test setup

- Seeder marks org `is_demo=true` (lifecycle/billing crons already skip).
- `playwright.config.ts` sets env `E2E_RN_SAFE_MODE=1`; a tiny test-only edge-function side-effect guard refuses to send mail / call providers when this header/flag is present. Where guards don't exist yet, tests use `direct-actions` against RPCs that already short-circuit on `is_demo`.
- No real keys, no real money, no real notifications. CI scripts assert `process.env.E2E_RN_ENV ∈ {staging,test}` before running, mirroring the TOTP rule already in `e2e/helpers/totp.ts`.

## Evidence (§11–12)

Extends existing `e2e/helpers/evidence.ts`. Per-row `summary.json` is supplemented by a run-level `evidence.json` with the §11 schema (run_id, role_used, organisation_used, route_or_action_tested, before/after_state, etc.). HTML report grouped by: positive-path | role-negative | wrong-tenant | logged-out | direct-link | direct-backend. Scrubber strips: full keys (`sk_*` → `sk_***`), JWTs, emails-of-real-users, document bytes. `scripts/pack-role-negative-evidence.mjs` produces `/mnt/documents/role-negative-e2e-<ts>.zip`.

## CI / scripts (§13)

Add to `package.json`:

```json
"test:e2e": "playwright test",
"test:e2e:roles": "playwright test e2e/role-negative",
"test:e2e:critical": "playwright test e2e/journeys/auth-role-landing.spec.ts e2e/journeys/trade-match.spec.ts e2e/journeys/poi-lifecycle.spec.ts e2e/journeys/wad-lifecycle.spec.ts e2e/journeys/refund-dispute.spec.ts e2e/role-negative",
"test:evidence": "playwright test --reporter=list,junit,html",
"test:e2e:coverage-guard": "node scripts/check-role-negative-e2e-coverage.mjs",
"test:e2e:evidence-pack": "node scripts/pack-role-negative-evidence.mjs"
```

Release gate: the coverage-guard + the critical suite must both pass. Failures in: route-access, direct-link, tenant-isolation, wrong-actions, protected-documents, governance-export, refund/dispute, POI/WaD, api-key — block release. Deferrals only allowed for non-critical and only via entry in `docs/role-negative-e2e-coverage.md` deferral register (reason/route/risk/owner/follow-up date).

## Out of scope (§14 defers, restated)

Load/perf, mobile, visual regression, non-Chromium, live providers, real email/SMS/WhatsApp, real Payfast/Paystack, pen-testing, client UAT pack, AI anomaly detection, reporting dashboards.

## Acceptance check (§16)

Verified by:

1. `bash scripts/seed-role-negative-e2e.sh` → both orgs + all roles + all records present (idempotent re-run is a no-op).
2. `npm run test:e2e:coverage-guard` → green (matrix complete).
3. `npm run test:e2e:critical` → green in Chromium against staging preview.
4. Evidence zip generated; spot-check 3 rows (one positive, one role-negative, one direct-backend) contain before/after, request IDs, no PII.
5. Existing `e2e/smoke-a-d` suite still passes.
6. Build guard fails CI when a route is added to `e2e/fixtures/routes.ts` without a matching test (proven by a temporary unit test on the guard script).

## Delivery order

1. Seeder edge function + shell wrapper + env contract.
2. Fixtures (`users/organisations/routes/records/permissions`).
3. Helpers (`auth-roles/assertions/direct-actions/state/evidence`).
4. `role-negative/` suites (route-access → direct-links → tenant → wrong-actions → docs → export → api-key).
5. `journeys/` suites in the §10 order.
6. Coverage guard + evidence packer + `package.json` scripts.
7. `docs/role-negative-e2e-coverage.md` (matrix + deferral register + release-gate rules).
8. Internal dry-run on staging; attach evidence zip path; mark "internally tested and build-complete" only after green.

Confirm to proceed and I'll implement in this order.  
  
Confirmed — proceed with implementation in the delivery order stated.

One addition: before starting, please treat Daniel’s completed questionnaire as the controlling build authority. Do not broaden the work beyond the approved Role-Negative and E2E test package.

Key constraints remain:

```text
Proceed.

Implement this as a testing/release-gate hardening package only.

Do not add new product functionality.
Do not change product permission logic unless a failing test proves the current implementation does not match the approved role matrix.
Do not silently patch permission gaps during the test build. Report them as test failures.
Do not use real client data.
Do not call live payment, notification, KYB, KYC, sanctions, registry, bank or provider systems.
Do not create production API keys.
Do not grant production access.
Do not send real emails, SMS, WhatsApp messages or webhooks.

Use TEST/UAT seeded data only.
Use Organisation A TEST/UAT and Organisation B TEST/UAT.
Use the approved role labels exactly.
Generate evidence under /test-evidence/role-negative-e2e/<run_id>/.
Wire the coverage guard and critical suite into the release gate.

Delivery order approved:
1. Seeder edge function + shell wrapper + env contract.
2. Fixtures.
3. Helpers.
4. Role-negative suites.
5. Journey suites.
6. Coverage guard + evidence packer + package scripts.
7. Coverage documentation and deferral register.
8. Internal dry-run on staging.
9. Mark build-complete only after green tests and evidence zip are available.
```

Please proceed and return the build summary, changed files, test results, evidence path, and any failed permission gaps found during implementation.