# Role-Negative & E2E Test Coverage — Release Gate

**Status:** Phase 1 + Phase 2 fixture seeding build-complete.
Runtime proof is operator-run (requires `SUPABASE_SERVICE_ROLE_KEY` and
`E2E_RN_PASSWORD`); staging is **not** a precondition — the suite is
designed to run safely against the current build using TEST/UAT data.

**Authority:** Daniel's approved Role-Negative & E2E Test Coverage
questionnaire. This document is the controlling release-gate reference.

---

## 1. Approved role labels (use exactly)

`platform_admin`, `compliance_analyst`, `requester_trader`,
`counterparty_user`, `api_client_admin`, `normal_non_admin_user`,
`other_tenant_user`, `logged_out_user`.

Drift is blocked by `scripts/check-role-negative-e2e-coverage.mjs`.

## 2. Seeded TEST/UAT data

Idempotent via `seed-role-negative-e2e-fixtures` (default `phase=2` seeds
everything below; `phase=1` seeds only orgs/users/roles).

**Phase 1**

| Asset | Count | Naming |
|---|---|---|
| Organisations (`is_demo=true`) | 2 | "Organisation A TEST/UAT", "Organisation B TEST/UAT" |
| Users (`@test.izenzo.co.za`, email_confirm=true) | 10 | "RN <role> (TEST/UAT)" |
| `user_roles` rows | 10 | match approved labels |

**Phase 2 (per org, `is_demo=true` where supported; `rn_seeder` marker otherwise)**

| Asset | Per-org count | Notes |
|---|---|---|
| `entities` (COMPANY, VERIFIED) | 1 | `legal_name = "RN-TEST Org <X> Entity"` |
| `trade_requests` | 1 | `metadata.rn_marker`, `is_demo=true` |
| `matches` | 1 | `is_demo=true`, cross-tenant pair (A↔B) |
| `pois` (bilateral DRAFT) | 1 | `industry_code = "RN-TEST-<X>"`, `is_demo=true` |
| `match_documents` | 1 | deterministic sha256, `notes='rn_seeder'` |
| `api_clients` (sandbox_active) | 1 | `legal_entity_name` prefix `RN-TEST` |
| `api_keys` (sandbox, scope `read:usage`) | 1 | `key_hash` prefix `rn_test_` |
| `export_requests` (status `pending`) | 1 | `reason = "RN-TEST-<X>-export"`, never approved |

**Phase 2b — deferred, by design**

| Item | Why not synthesised |
|---|---|
| `wads` | Requires a sealed canonical payload, attestations, and an unbroken ledger hash chain. Must be created via the `issue_wad` RPC against a real POI lifecycle — a raw insert would corrupt the ledger chain. Specs that target WaD skip cleanly with this reason. |
| `refund_requests` | Requires a paid `token_purchase` row. Synthesising one bypasses Paystack/Payfast reconciliation and would surface in revenue reports. Specs that target refund skip cleanly with this reason. |

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
- `e2e/helpers/state.ts` accepts `E2E_RN_ENV ∈ {staging, test, live-demo}`.
  In `live-demo`, every snapshot read is gated: `trade_requests`,
  `matches`, `pois`, `wads` must be `is_demo=true`; `match_documents`,
  `refund_requests`, `export_requests`, `api_keys` must carry the
  `rn_seeder` / `rn_test` fingerprint. Any row that fails this check
  is refused — making it impossible for the suite to touch real
  tenant data even when running against the live DB.
- Seeder requires `SUPABASE_SERVICE_ROLE_KEY` + `E2E_RN_PASSWORD (≥12)`
  and writes only to `@test.izenzo.co.za` accounts and `RN-TEST` rows.
- No real email, SMS, WhatsApp, webhook, Payfast, Paystack, KYB, KYC,
  sanctions, registry or bank call is made by the suite.

## 6. Deferral register

| ID | Item | Reason | Owner | Target |
|---|---|---|---|---|
| RN-DEF-01 | Phase 2 record seeding | **Resolved** — `seed-role-negative-e2e-fixtures` now seeds entities, trade_requests, matches, pois, match_documents, api_clients, api_keys, export_requests. | platform_admin | Done |
| RN-DEF-02 | `notification_dispatches` / `webhook_deliveries` / `email_send_log` / `fund_flows` automated diff in wrong-actions | Needs per-action filters; covered today by `X-E2E-Safe-Mode` + no-mutation snapshot of the target row | platform_admin | Phase 3 |
| RN-DEF-03 | Cross-direction Org B → Org A wrong-tenant spec | Symmetric by RLS; A→B proves the gate. Add explicit reverse coverage if Org B suites grow. | platform_admin | When Org B suites grow |
| RN-DEF-04 | `X-E2E-Safe-Mode` honoured by every mutating edge function | Some functions need a small code change to short-circuit notifications when the header is present. | platform_admin | Phase 3 |
| RN-DEF-05 | Operator-run close-out | Operator must supply `SUPABASE_SERVICE_ROLE_KEY` + `E2E_RN_PASSWORD` (no staging required) and return run result + evidence zip. | platform_admin | Per release |
| RN-DEF-06 | `wads` and `refund_requests` seeding | Cannot be synthesised by a seeder without corrupting the ledger chain (WaD) or bypassing payment reconciliation (refund). Specs `test.skip` with a clear reason; close-out evidence reports the skip count for visibility. | platform_admin | Build via real RPC fixtures in Phase 3 |

**Hard non-deferrable items** (per §1 of brief): production access,
tenant isolation, protected documents, governance exports, POI sealing,
refunds, compliance clearing, API key controls — all structurally
covered by the matrix and (except WaD/refund seal-state) fully runnable
against the seeded fixtures.

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
`test:e2e:critical` must pass in Chromium against the current build
with seeded TEST/UAT data (`E2E_RN_ENV=live-demo` is supported).

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
