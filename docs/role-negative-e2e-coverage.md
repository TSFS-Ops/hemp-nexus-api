# Role-Negative & E2E Test Coverage — Release Gate

**Status:** Build-complete (Phase 1). Internal dry-run pending (needs
operator to run the seeder + suite on staging — sandbox cannot reach
staging credentials).

**Authority:** Daniel's approved Role-Negative & E2E Test Coverage
questionnaire. This document is the controlling release-gate reference.

---

## 1. Approved role labels (use exactly)

`platform_admin`, `compliance_analyst`, `requester_trader`,
`counterparty_user`, `api_client_admin`, `normal_non_admin_user`,
`other_tenant_user`, `logged_out_user`.

Drift is blocked by `scripts/check-role-negative-e2e-coverage.mjs`.

## 2. Seeded TEST/UAT data

Phase 1 (this build, idempotent via `seed-role-negative-e2e-fixtures`):

| Asset | Count | Naming |
|---|---|---|
| Organisations (`is_demo=true`) | 2 | "Organisation A TEST/UAT", "Organisation B TEST/UAT" |
| Users (`@test.izenzo.co.za`, email_confirm=true) | 10 | "RN <role> (TEST/UAT)" |
| `user_roles` rows | 10 | match approved labels |

Phase 2 (deferred — see deferral register §6):

- 1 trade request per org
- 1 match per org
- 1 POI per org
- 1 WaD per org
- 1 protected document per org
- 1 refund / dispute record per org
- 1 governance export candidate per org
- 1 API key + usage-log row per org

## 3. Direct-link route matrix

Single source of truth: `e2e/fixtures/routes.ts`. Routes covered:

```
/hq, /hq/audit, /hq/compliance, /hq/governance-export, /hq/refunds,
/hq/api-clients, /developer, /developer/api-keys, /developer/usage,
/governance, /governance/export/:id, /trades/:id, /matches/:id,
/poi/:id, /wad/:id, /refunds/:id, /documents/:id/download,
/exports/:id/download, /api/keys/:id, /api/usage
```

Add a route here ⇒ guard fails until a spec covers it.

## 4. Action / wrong-action matrix

Single source of truth: `e2e/fixtures/permissions.ts`. 23 sensitive
actions encoded with allowed roles, target RPC/edge function, record
dependency, and side-effect checks. Iterated by
`e2e/role-negative/wrong-actions.spec.ts`.

## 5. Safety rails

- All seeded orgs `is_demo=true` — lifecycle/billing crons skip.
- Test client sends `X-E2E-Safe-Mode: 1` header on every backend call.
- `e2e/helpers/state.ts` refuses to run unless `E2E_RN_ENV ∈ {staging,test}`.
- `scripts/seed-role-negative-e2e.sh` requires `SUPABASE_SERVICE_ROLE_KEY`
  + `E2E_RN_PASSWORD (≥12)` and writes ONLY to `@test.izenzo.co.za`
  accounts.
- No real email, SMS, WhatsApp, webhook, Payfast, Paystack, KYB, KYC,
  sanctions or registry call permitted. Edge functions that don't yet
  honour `X-E2E-Safe-Mode` are flagged in the Phase-2 deferral list.

## 6. Deferral register

| ID | Item | Reason | Owner | Target |
|---|---|---|---|---|
| RN-DEF-01 | Phase-2 seeded records (trade/match/POI/WaD/document/refund/export/api_key) | Each requires per-table column knowledge + non-trivial state setup; doing it blind risks the very mutations §4 forbids. | platform_admin | Next batch |
| RN-DEF-02 | `notification_dispatches` / `webhook_deliveries` / `email_send_log` / `fund_flows` automated diff in wrong-actions | Needs per-action filters Phase-2 seeder will emit | platform_admin | Next batch, paired with RN-DEF-01 |
| RN-DEF-03 | Cross-direction Org B → Org A wrong-tenant spec | Symmetric by RLS; one direction proves the gate. Add explicit reverse coverage when Org-B requester login helper is needed elsewhere. | platform_admin | When Org B suites grow |
| RN-DEF-04 | `X-E2E-Safe-Mode` honoured by every mutating edge function | Some functions need a small code change to short-circuit notifications when the header is present. | platform_admin | Phase 2 |
| RN-DEF-05 | Internal dry-run on staging | Requires staging service-role key + password; cannot run from sandbox. | platform_admin | Before sending to Daniel |

**Hard non-deferrable items** (per §1 of brief — must not be deferred):
production access, tenant isolation, protected documents, governance
exports, POI/WaD sealing, refunds, compliance clearing, API key
controls. These are all structurally covered by the matrix today; full
proof depends on RN-DEF-01 landing.

## 7. CI scripts

```
npm run test:e2e                  # full Playwright run
npm run test:e2e:roles            # role-negative suite only
npm run test:e2e:critical         # critical journeys + role-negative
npm run test:evidence             # full run with list,junit,html reporters
npm run test:e2e:coverage-guard   # matrix completeness guard (release gate)
npm run test:e2e:evidence-pack    # zips latest run to /mnt/documents/
```

Release-gate definition: `test:e2e:coverage-guard` must pass, and
`test:e2e:critical` must pass in Chromium against staging with seeded
TEST/UAT data.

## 8. Evidence schema

Per-test row written to
`test-evidence/role-negative-e2e/<run_id>/<slug>/summary.json`
and aggregated into `evidence.jsonl`. Fields match §11 of the brief:
`run_id, test_suite, test_name, test_type, role_used,
organisation_used, route_or_action_tested, record_type,
seeded_record_reference, expected_result, actual_result,
pass_fail_status, failure_reason, environment, browser, date_time,
build_id, before_state, after_state, screenshot_or_trace_path, notes`.

Scrubber strips `sk_*` keys, JWTs, Bearer tokens and passwords before
write.

## 9. Approval rule for matrix changes

Any change to `e2e/fixtures/routes.ts` or `e2e/fixtures/permissions.ts`
must include:

1. Matching spec update.
2. Updated role matrix entry above.
3. Evidence the revised matrix passed `test:e2e:critical`.
4. Approval by David Davies (Izenzo CEO/product-security owner) or
   written delegate.

Silent role-matrix changes are blocked by the coverage guard at build
time.
