# API Artefact Pricing & Burn (P-4 Point 4)

This document anchors the Izenzo USD Artefact Price Book inside the
production institutional API and explains how the burn engine consumes it.

## Client-confirmed rule

> Production API calls burn credits only when they create, return, update
> or confirm a governed commercial artefact.

> 1 Basic POI = USD $10 = 1 base credit unit.

Source: David (P-4 email, 2026-06).

## SSOT files

- `src/lib/registry-api-artefact-pricing.ts` — browser SSOT.
- `supabase/functions/_shared/registry-api-artefact-pricing.ts` —
  byte-identical Deno mirror (pinned by
  `scripts/check-registry-api-artefact-pricing-parity.mjs`).
- `supabase/functions/_shared/api-artefact-burn.ts` — shared burn wrapper.

## Smallest-unit pricing model

- 1 credit = 100 credit_units.
- USD $10 = 100 credit_units = 1 credit.
- USD $0.10 = 1 credit_unit.

The planner returns exact `credit_units` AND the integer wallet `credits`
passed to `atomic_token_burn`. If `credit_units % 100 !== 0` the planner
fails closed (`FRACTIONAL_BURN_REQUIRES_SMALLEST_UNIT_MIGRATION`) so client
money is never silently rounded.

## Variable-range artefacts

For ranges (e.g. Authority-backed POI $75–$150), the planner requires an
admin-resolved exact USD price (Option C). API clients cannot set the
price. Out-of-range or unresolved variable artefacts fail closed and
return HTTP 409 with `VARIABLE_PRICE_UNRESOLVED`.

## Non-chargeable paths

`authentication`, `health_check`, `documentation`, `balance_check`,
`sandbox`, `failed_technical_call`, `unauthorised`, `revoked_key`,
`invalid_scope`, `malformed_request`, `no_result_no_artefact`.

## Audit events

`api.token_burn.succeeded`, `api.token_burn.insufficient_credits`,
`api.token_burn.skipped_sandbox`, `api.token_burn.skipped_non_chargeable`,
`api.token_burn.skipped_no_result`, `api.token_burn.skipped_failed_call`,
`api.token_burn.idempotent_replay`, `api.token_burn.reversed`,
`api.token_burn.missing_price_fail_closed`,
`api.token_burn.variable_price_unresolved`.

## Insufficient-credit response

HTTP 402 body:

```json
{
  "ok": false,
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "Insufficient credits for this API call.",
    "required_credits": 1,
    "available_credits": 0,
    "request_id": "req_..."
  }
}
```

## Idempotency

The burn wrapper passes `p_reference_id = request_id` to
`atomic_token_burn`, which de-duplicates on `(org_id, reference_id)` and
surfaces `idempotent_replay = true` for retries. Two different request IDs
burn separately.

## Reversals

Admin-only. Use the existing admin reconciliation pathway; the wrapper
registers the `api.token_burn.reversed` event name. No client-facing
reversal endpoint is exposed.
