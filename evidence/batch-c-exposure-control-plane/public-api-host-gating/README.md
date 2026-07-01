# Batch C2 — Public API V1 unrecognised-host gating

**Tracker item:** #48 — environment header can override host on unrecognised API host.

## Risk being fixed

On any host not in the recognised V1 set the previous behaviour was:

- `hostEnv = null`
- `env = headerEnv` (from `X-Izenzo-Environment`)

The API key's stored `environment` remains authoritative, so this did **not**
unlock cross-environment data access. The residual risk was:

- misleading audit / log labels;
- rate-limit tier shopping on non-canonical hosts
  (e.g. raw `<project>.functions.supabase.co`).

## Caller inventory result (from Batch C2 inspection)

No legitimate production, dashboard, cron, SDK, script, or test caller
invokes V1 routes through `*.functions.supabase.co`. All references to raw
Supabase function hosts point at non-V1 functions (payfast, paystack,
refund-request, list-org-purchases, seed/smoke jobs, retention/archive cron).

## Before → after

**Before**

```ts
if (hostEnv) return { env: hostEnv, ... };
return { env: headerEnv, ... };   // header-derived on unknown host
```

Gateway:

```ts
if (!detected.env) throw new V1Error("missing_required_field");
```

**After (Batch C2)**

```ts
if (hostEnv) return { env: hostEnv, hostRecognised: true, ... };
if (PUBLIC_API_ALLOW_HEADER_ENV === "1" && headerEnv) {
  return { env: headerEnv, hostRecognised: false, headerOptInUsed: true, ... };
}
return { env: null, hostRecognised: false, ... };
```

Gateway:

```ts
if (!detected.env) {
  await audit("api.v1.unrecognised_host_rejected", ...);
  throw new V1Error("unrecognised_host");   // HTTP 421
}
```

Response envelope on rejection:

- `error_code: "unrecognised_host"`
- `request_id` present
- headers include `X-Request-Id`, `X-Izenzo-Request-Id`, `X-Izenzo-Environment: unknown`

## Local/dev escape hatch

Setting `PUBLIC_API_ALLOW_HEADER_ENV=1` restores the previous
header-derived behaviour, and only for unrecognised hosts. Recognised hosts
always win — the header can never override them. Usage is audited via
`api.v1.header_env_opt_in_used`.

## Files changed

- `supabase/functions/_shared/public-api-v1.ts`
  - Added `unrecognised_host` V1 error code (HTTP 421) + public message.
  - `detectEnvironmentDetailed` returns `hostRecognised` / `headerOptInUsed`
    and rejects header-derived env on unknown hosts unless the dev opt-in
    is set.
  - `runGateway` step 1 rejects with `unrecognised_host` (was
    `missing_required_field`) and writes a security audit entry.
- `scripts/check-public-api-canonical-host.mjs` — new static guard.
- `src/tests/public-api-v1-batch-c2-host-gating.test.ts` — static shape
  tests covering the code changes above.
- `evidence/batch-c-exposure-control-plane/public-api-host-gating/README.md`
  — this record.

## Tests / guards added

- Vitest: `src/tests/public-api-v1-batch-c2-host-gating.test.ts`.
- Static: `scripts/check-public-api-canonical-host.mjs` (safe to wire into
  `prebuild` / `check-all`).

## Commands to run

```
node scripts/check-public-api-canonical-host.mjs
bunx vitest run src/tests/public-api-v1-batch-c2-host-gating.test.ts
```

Runtime proof (recognised-host + mismatched-header, raw-host rejection, and
opt-in escape hatch) requires a deployed edge-function context and is
tracked as pending privileged verification.

## Out-of-scope confirmations

- Item #13 (`counterparty_ratings` / `rating_signals`) — **not changed**.
  Batch C inspection classified it as ALREADY SAFE.
- No migrations. No RLS / grants / policies / schema / cron / storage
  changes.
- No changes to payments, refunds, credits, token ledger, WaD, POI,
  lifecycle, reconciliation, retention, legal holds, or any Batch B
  pending-verification item.
- No mutation of production data. No provider calls. No notifications.

## Final status

`BATCH_C2_PUBLIC_API_HOST_GATING_DEPLOYED_PENDING_VERIFICATION`
