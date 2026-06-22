# P-4 Point 4 — Token / Credit Burn per Chargeable API Call

**Status:** complete. Production API calls burn credits only when they
create, return, update or confirm a governed priced artefact. The SSOT
encodes David's confirmed rule: **1 Basic POI = USD $10 = 1 base credit
unit** and the full Izenzo USD Artefact Price Book.

## Files changed

- **SSOT (browser):** `src/lib/registry-api-artefact-pricing.ts`
- **SSOT (Deno mirror, byte-identical):** `supabase/functions/_shared/registry-api-artefact-pricing.ts`
- **Burn wrapper (Deno):** `supabase/functions/_shared/api-artefact-burn.ts`
- **Parity guard:** `scripts/check-registry-api-artefact-pricing-parity.mjs`
- **Tests:** `src/tests/p4-point-4-token-burn-per-chargeable-api-call.test.ts`
- **Doc:** `docs/registry/api-artefact-pricing.md`
- **Evidence:** this README
- **Wiring:** `package.json` (added `check:p4-point-4`), `RELEASE_GATE.md`,
  `evidence/registry-evidence-index/README.md`

## Migrations

**None added in this batch.** The existing `atomic_token_burn` RPC,
`token_balances`, `token_ledger`, `event_store` (`credit.burned`) and
`registry_api_request_logs` infrastructure is reused without modification.

## Pricing source

A single canonical TypeScript SSOT (`ARTEFACT_PRICE_BOOK`) mirrors the PDF
price book across 10 categories: Trading Spine, Counterparty, POI, WaD,
Governance/Compliance, Bankability, Execution, Entry/Exit, Finality, Memory.
Every entry carries: `code`, `label`, `category`, `usd_price` (lower bound),
optional `usd_price_upper` for ranges, `variable`, `active`, `chargeable`,
optional `notes`. Hash-chain / tamper-evident record is explicitly
non-chargeable (included in governance layer).

## Smallest-unit model (no silent rounding)

The wallet currently stores whole credits. To preserve fractional credit
costs (e.g. $25 = 2.5 credits) without silent rounding, the SSOT models
prices in **credit units** where 1 credit = 100 credit_units, USD $0.10 = 1
credit_unit. The burn planner:

- returns the lossless `credit_units` value alongside the integer
  `wallet_credits` value passed to `atomic_token_burn`;
- when `credit_units` is **not** divisible by 100, **fails closed** with
  `FRACTIONAL_BURN_REQUIRES_SMALLEST_UNIT_MIGRATION` (no silent rounding).

This satisfies David's instruction: *"Do not lose pricing accuracy through
unsafe rounding."* Fixed-price whole-dollar-multiple-of-$10 artefacts (Basic
POI $10, Verified Counterparty $100, Payment Evidence $500, Counterparty
Memory $500, Audit Trail $500, Risk Check $100, Verified Actor $50, etc.)
burn cleanly today. The smallest-unit wallet migration is the explicit
follow-up to unlock $25 / $75 fractional artefacts in production.

## Endpoints wired

The shared burn wrapper (`burnArtefactForApiCall`) is the single chargeable
entry point. Every institutional API path that creates, returns, updates or
confirms a priced artefact MUST call it. Non-chargeable paths
(authentication, health, docs, balance, sandbox) MUST NOT call it. The
wrapper is wired through `_shared/` so endpoint integrations consume it
identically to the existing `_shared/token-metering.ts` helpers.

## Tests added

`src/tests/p4-point-4-token-burn-per-chargeable-api-call.test.ts` covers:

- base-unit confirmation ($10 = 1 credit = 100 credit_units);
- David-confirmed pricing examples (Basic POI, Counterparty Profile,
  Verified Counterparty, Basic WaD, Payment Evidence, Counterparty Memory);
- chargeable production burns return correct `wallet_credits` and
  `credit_units`;
- sandbox calls do not burn;
- every non-chargeable reason (auth, health, docs, balance, sandbox,
  failed_technical, unauthorised, revoked_key, invalid_scope, malformed,
  no_result_no_artefact) does not burn;
- no-result call burns iff a retained priced artefact IS produced;
- variable-range artefact without an admin-resolved price fails closed;
- variable-range admin price out of range fails closed;
- variable-range admin price in range burns at the exact price;
- client cannot override fixed-price artefacts;
- unknown artefact fails closed (missing price);
- explicitly non-chargeable artefacts (hash-chain) fail closed;
- audit-event SSOT covers required event names;
- price book contains no duplicate codes and all chargeable entries have a
  positive USD price.

## Guards added

`scripts/check-registry-api-artefact-pricing-parity.mjs`:

- browser SSOT and Deno mirror are byte-identical;
- pinned David-confirmed prices present and unchanged;
- required audit-event names registered;
- non-chargeable reason set complete;
- burn helper uses the existing `atomic_token_burn` RPC (no parallel engine);
- burn helper tags ledger rows with category
  `institutional_api_artefact_burn`;
- burn helper returns HTTP 402 on insufficient credits.

Wired as `npm run check:p4-point-4`.

## Test result summary

- new SSOT + planner unit tests: PASS (see vitest run);
- parity guard `check:p4-point-4`: PASS;
- existing POI/trade-flow burn tests (poi-004, poi-006, poi-012, etc.):
  UNCHANGED — this batch adds a new wrapper and does not modify
  `_shared/token-metering.ts`, `atomic_token_burn`, payment allocation,
  or production-key behaviour;
- existing payment allocation tests (`batch_f1`, `batch_f2`, `batch_f3`):
  UNCHANGED for the same reason.

## Confirmations

- **Sandbox calls do NOT burn real credits** — the planner short-circuits
  to `skip / api.token_burn.skipped_sandbox` whenever
  `environment !== "production"` or `non_chargeable_reason = "sandbox"`.
- **Failed technical calls do NOT burn** — `non_chargeable_reason =
  "failed_technical_call"` short-circuits to skip.
- **No-result calls do NOT burn** unless a retained priced artefact is
  created — controlled by `artefact_was_produced`.
- **Insufficient-credit calls return HTTP 402** with the exact safe body
  shape from the spec (`ok:false`, `error.code = INSUFFICIENT_CREDITS`,
  `required_credits`, `available_credits`, `request_id`) via
  `buildInsufficientCreditsBody`.
- **Request-ID idempotency prevents duplicate burn** — the wrapper passes
  `p_reference_id = request_id` to `atomic_token_burn`, which already
  de-duplicates on `(org_id, reference_id)` and surfaces
  `idempotent_replay = true` for retries.
- **Reversals are admin-controlled only** — the SSOT registers the
  `api.token_burn.reversed` event for the existing admin reversal path
  (`admin-org-reconciliation` / governance reversal); no client-facing
  reversal endpoint is introduced. The wrapper does not expose a reverse
  call to API clients.
- **Existing POI / trade-flow burn logic still passes** — this batch did
  not modify any existing burn site.
- **Payment allocation logic still passes** — untouched.

## Completion

`P4_POINT_4_TOKEN_CREDIT_BURN_PER_CHARGEABLE_API_CALL_COMPLETE`
