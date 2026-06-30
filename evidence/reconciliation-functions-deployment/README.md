# Reconciliation functions deployment repair

**Date:** 2026-06-30
**Status:** RECONCILIATION_FUNCTIONS_DEPLOYMENT_REPAIR_DEPLOYED_PENDING_TICK
**Classification:** BROADER_RECONCILIATION_FUNCTION_DEPLOYMENT_ISSUE (resolved by targeted deploy)

## Symptom

Three daily reconciliation cron jobs were returning HTTP 404 with
`{"code":"NOT_FOUND_FUNCTION_BLOB","message":"Requested function was not found"}`
at the edge runtime, before any function code executed:

| Job | Schedule (UTC) | Last failing run | HTTP | Error |
|---|---|---|---|---|
| `burn-poi-reconciliation-daily` | `30 3 * * *` | 2026-06-30 03:30:00.563541+00 | 404 | NOT_FOUND_FUNCTION_BLOB |
| `balance-drift-reconciliation-daily` | `15 3 * * *` | 2026-06-30 03:15:00.574143+00 | 404 | NOT_FOUND_FUNCTION_BLOB |
| `side-effect-reconciliation-daily` | `45 3 * * *` | 2026-06-30 03:45:00.691490+00 | 404 | NOT_FOUND_FUNCTION_BLOB |

`transaction-reconciliation-job` (`*/15 * * * *`, slug
`transaction-reconciliation`) was simultaneously reachable and returning HTTP
200 (last_run_at 2026-06-30 12:45:00.572494+00). This confirmed the edge
runtime itself was healthy and the issue was scoped to three missing
function blobs.

## Why this is deploy/registration, not source logic

Pre-deploy inspection confirmed:

- Source folders all exist under `supabase/functions/` with correct
  lower-kebab casing and valid `index.ts` entrypoints:
  - `supabase/functions/burn-poi-reconciliation/index.ts`
  - `supabase/functions/balance-drift-reconciliation/index.ts`
  - `supabase/functions/side-effect-reconciliation/index.ts`
- `cron.job.command` for each daily job posts to the URL slug that
  matches the source folder name exactly. No slug drift, no typo:
  - `/functions/v1/burn-poi-reconciliation`
  - `/functions/v1/balance-drift-reconciliation`
  - `/functions/v1/side-effect-reconciliation`
- `transaction-reconciliation` (no `[functions.*]` block in
  `supabase/config.toml` either) was reachable, so absence from
  `config.toml` is not the differentiator.
- The 404 was produced by the edge runtime before function code ran:
  no business-state writes, no acceptance receipts, no `pois` /
  `token_ledger` / `matches` / `wads` / `ledger_events` / `balances` /
  `payments` / `refunds` mutations. Only `cron_heartbeats` and a
  refresh of pre-existing `admin_risk_items` row `82b15c9b` advanced.

The previously deployed `matches.updated_at` source repair to
`burn-poi-reconciliation` is **not** the cause — that repair was
correct code that simply was not being exercised because the function
blob was missing from the active edge runtime.

## Applied repair (deploy-only)

Targeted deploy of the three missing function blobs using the platform
edge-function deploy mechanism:

- `burn-poi-reconciliation`
- `balance-drift-reconciliation`
- `side-effect-reconciliation`

Deploy result: `Successfully deployed edge functions: burn-poi-reconciliation, balance-drift-reconciliation, side-effect-reconciliation`.

## Coverage hardening

`burn-poi-reconciliation` was previously absent from
`scripts/edge-function-deploy-manifest.json`, so the existing prebuild
deploy-coverage guard would not have flagged its absence from deploys.
Added to the manifest. `balance-drift-reconciliation` and
`side-effect-reconciliation` remain listed (no removals).

`RELEASE_GATE.md` "Edge functions requiring deploy (Batch V REC reconciliation — C1/C2 404 deploy wiring)" section extended to mention
`burn-poi-reconciliation` so the manifest entry passes
`scripts/check-edge-function-deploy-coverage.mjs`.

## Explicit non-changes

- ❌ No edge function source code edited.
- ❌ No DB migrations added or run.
- ❌ No cron jobs altered. Cron URLs unchanged.
- ❌ No schema, RLS, grants, policies, indexes, or config changes.
- ❌ No reconciliation function invoked manually.
- ❌ No business / runtime data mutated.
- ❌ No emails or notifications sent.
- ❌ No credits burned.
- ❌ No provider calls.
- ❌ C6.5, C6.6, C6.7, C7.1, C7.2 untouched.

## Files changed

- `scripts/edge-function-deploy-manifest.json` — added `burn-poi-reconciliation` to `required`.
- `RELEASE_GATE.md` — added `burn-poi-reconciliation` bullet under the existing Batch V REC reconciliation deploy-wiring section.
- `evidence/reconciliation-functions-deployment/README.md` — this file.

## Guards / tests

- `scripts/check-edge-function-deploy-coverage.mjs` — confirms the
  three reconciliation functions are listed in the manifest, have
  source directories, and are mentioned in `RELEASE_GATE.md`.
- `scripts/check-edge-function-paths.mjs` — confirms no caller in
  `src/` references a non-existent function slug.
- Existing `src/tests/edge-function-deploy-coverage.test.ts` pins the
  Batch V REC reconciliation entries.

## Reachability check posture

No manual invocation of any reconciliation function was performed —
that would execute reconciliation logic. Runtime confirmation will
come from the next natural scheduled ticks:

- `balance-drift-reconciliation-daily` at 03:15 UTC
- `burn-poi-reconciliation-daily` at 03:30 UTC
- `side-effect-reconciliation-daily` at 03:45 UTC

Each must show `last_status = success`, `last_http_status = 200`,
`last_error = null`, no `NOT_FOUND_FUNCTION_BLOB`, no
`MINTED_MATCH_FETCH_FAILED`, and no new reconciliation failure
self-incidents in `admin_risk_items`. Only after that does the
status promote from
`RECONCILIATION_FUNCTIONS_DEPLOYMENT_REPAIR_DEPLOYED_PENDING_TICK`
to `RECONCILIATION_FUNCTIONS_DEPLOYMENT_REPAIR_RUNTIME_CONFIRMED`,
and the parallel `matches.updated_at` source repair can be
runtime-confirmed at the same tick.
