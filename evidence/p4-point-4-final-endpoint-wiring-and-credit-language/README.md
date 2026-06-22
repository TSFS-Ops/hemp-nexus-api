# P-4 Point 4 — Final Endpoint Wiring and Credit Language Sweep

**Status:** `P4_POINT_4_FINAL_ENDPOINT_WIRING_AND_CREDIT_LANGUAGE_COMPLETE`
**Builds on:** `P4_POINT_4_TOKEN_CREDIT_BURN_PER_CHARGEABLE_API_CALL_COMPLETE`
             `P4_POINT_4_CLIENT_VISIBLE_CROSS_CONSISTENCY_AUDIT_COMPLETE`

## What this batch closes

The previous batches proved the burn engine, pricing SSOT, parity guard, 402
contract, sandbox/failed/no-result skip paths, idempotency, ranged-price
fail-closed, and audit events.

This batch closes the three readiness risks identified in the audit:

- **R1** — client-visible wallet language sweep ("tokens" → "credits").
- **R2** — usage rows now carry `artefact_code` + `credits_burned`
  + `remaining_balance` so the artefact label can be derived from the
  pricing SSOT at display time.
- **R3** — a real institutional production endpoint
  (`registry-api-profile-status`) now calls `burnArtefactForApiCall`
  end-to-end. A live demo can show credits burning.

## Client-confirmed commercial rule (unchanged)

> Production API calls burn credits only when they create, return, update
> or confirm a governed commercial artefact.
> 1 Basic POI = USD $10 = 1 base credit unit. Use the Izenzo USD Artefact
> Price Book as the default pricing schedule.

## Endpoint inventory

| Endpoint                                              | Classification                         | Wired? | Reason                                                                                          |
| ----------------------------------------------------- | -------------------------------------- | :----: | ----------------------------------------------------------------------------------------------- |
| `registry-api-profile-status`                         | **chargeable_now**                     | ✅     | Returns a governed Verified-Counterparty status artefact when `result_state === "usable"`.      |
| `registry-api-payment-status`                         | future_chargeable_no_safe_wiring_yet   | ❌     | Returns a single flag (`verified` / `not_verified` / …), not a governed priced artefact.        |
| `registry-api-coverage-status`                        | non_chargeable                         | ❌     | Coverage metadata only — no governed priced artefact returned.                                  |
| `registry-api-readiness-status`                       | non_chargeable                         | ❌     | Readiness metadata only — no governed priced artefact returned.                                 |
| `registry-api-client-manage` / `*-key-manage`         | admin_only_not_client_billed           | ❌     | Admin lifecycle plane — never charged to API clients.                                           |
| `registry-api-usage-log`                              | non_chargeable                         | ❌     | Internal cron writer; not client-callable.                                                      |
| Health / docs / balance / auth / sandbox-only paths   | non_chargeable                         | ❌     | Explicitly non-chargeable per the SSOT.                                                         |

A future batch may promote `payment-status` to chargeable if/when David
confirms it returns a governed priced artefact (e.g. "Verified Payment
Detail"). Until then it stays deferred — the wiring guard blocks any
silent promotion.

## Wired endpoint — billing flow

`supabase/functions/registry-api-profile-status/index.ts`:

1. Authenticate API key → resolve `org_id`, scope, environment, mode.
2. Evaluate B15 gates (lifecycle, scope, country, use-case, key type, …).
3. Compute `resultState` against the recorded state machine.
4. **If** `resultState === "usable"` AND `mode === "production"` AND
   `key_type === "production"`:
   - Plan + execute the burn through `burnArtefactForApiCall`.
   - On `blocked_insufficient_credits` → return **HTTP 402** with the
     safe insufficient-credits body. **No artefact is returned. No credits
     are burned.**
   - On `fail_closed` → return 5xx / 409 with the safe config-error body.
     **No artefact is returned.**
   - On `burned` / `idempotent_replay` → attach `billing` metadata to the
     200 envelope.
5. Otherwise (sandbox/demo/no-artefact) → attach `billing.charged = false`
   metadata with a clear `reason`.
6. Write the usage row with `artefact_code`, `credits_burned`,
   `remaining_balance`.
7. Emit the standard audit events (`api.token_burn.*`,
   `registry_api_request_allowed`, `registry_api_profile_status_checked`).

### Response shape (200 — chargeable success)

```json
{
  "request_id": "…",
  "endpoint": "profile-status",
  "result_state": "usable",
  "usable": true,
  "billing": {
    "charged": true,
    "artefact_code": "basic_counterparty",
    "artefact_label": "Basic Counterparty",
    "credits_burned": 1,
    "remaining_balance": 99,
    "request_id": "…",
    "event_reference": "api.token_burn.succeeded"
  }
}
```

### Response shape (200 — skipped, not chargeable)

```json
{
  "billing": {
    "charged": false,
    "reason": "sandbox_or_demo" | "no_result_no_artefact",
    "credits_burned": 0,
    "request_id": "…"
  }
}
```

### Response shape (402 — insufficient credits)

```json
{
  "ok": false,
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "Insufficient credits for this API call.",
    "required_credits": 1,
    "available_credits": 0,
    "request_id": "…"
  }
}
```

## Usage-row schema additions

Migration adds three nullable columns to `registry_api_usage_events`:

- `artefact_code` (text) — null on non-chargeable calls.
- `credits_burned` (numeric) — 0/null on skipped calls.
- `remaining_balance` (numeric) — wallet balance immediately after the burn.

`artefact_label` is **derived** from `getArtefactPrice(artefact_code).label`
at display time (single source of truth, no hard-coded UI map).

## Client-visible credit language sweep (R1)

| Surface                                          | Status                                                     |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `src/components/desk/settings/TokenBalanceTab.tsx` | Visible copy already says "credits" (verified).            |
| `src/components/desk/billing/BillingOverview.tsx`  | Visible copy already says "credits" (verified).            |
| `src/pages/Billing.tsx`                            | Visible copy already says "credits" (verified).            |
| `src/components/TokenBalanceDisplay.tsx`           | Visible copy already says "credits" (verified).            |

Internal identifiers (`token_balances`, `token_ledger`, `token-purchase`,
`atomic_token_burn`, `tokens_burned` column, `TokenBalanceTab` component
filename) are **intentionally not renamed** — they are internal technical
identifiers, and renaming database tables / RPCs / edge-function paths
would be a high-risk change with no client-visible benefit. The wording
guard ignores these internal identifiers and only blocks user-facing
drift.

## Guards

- `scripts/check-registry-api-artefact-pricing-parity.mjs` — pricing SSOT
  parity (unchanged, still passing).
- `scripts/check-p4-point-4-client-visible-wording.mjs` — client-visible
  wording guard (unchanged, still passing).
- `scripts/check-p4-point-4-endpoint-wiring.mjs` — **NEW.** Asserts that
  every endpoint declared `chargeable_now` calls
  `burnArtefactForApiCall`, returns 402 via `buildInsufficientCreditsBody`,
  and exposes `billing` metadata. Also blocks silent promotion of a
  deferred endpoint to live billing.

## Tests

- `src/tests/p4-point-4-token-burn-per-chargeable-api-call.test.ts` —
  36 existing tests, still pass.
- `src/tests/p4-point-4-final-endpoint-wiring.test.ts` — **NEW.** Asserts
  static endpoint wiring contract (burn import, 402, billing metadata,
  usage-row columns, idempotency, prod-only gate, SSOT-derived label).

## Acceptance — what a live demo now shows

1. Client has a balance (`token_balances.balance > 0`).
2. Production API call to `/registry-api-profile-status` for a usable
   company returns 200 with `billing.charged = true` and shows
   `artefact_label = "Basic Counterparty"`, `credits_burned = 1`,
   `remaining_balance = <balance - 1>`.
3. `registry_api_usage_events` row exists with `artefact_code`,
   `credits_burned`, `remaining_balance`, `request_id`.
4. `token_ledger` shows the burn with `reason = "api_artefact:basic_counterparty"`.
5. Repeating the same `request_id` does NOT double-burn (idempotent replay).
6. Sandbox path returns `billing.charged = false, reason = "sandbox_or_demo"`.
7. Profile that returns `not_usable` / `not_ready` / etc. returns
   `billing.charged = false, reason = "no_result_no_artefact"`.
8. Insufficient balance returns 402 and the company artefact is NOT
   returned.

## Remaining risks

- The existing platform-wide POI flow still treats `1 credit = $1` in
  its own internal pricing (`POI cost = 1 credit`), while the
  institutional-API engine treats `1 credit = $10` per David's price
  book. Both speak the word "credit" but their per-unit value differs.
  This is **outside the scope of this batch** (the brief explicitly
  forbids changing the existing wallet architecture or commercial rule).
  Logged for the next commercial-reconciliation batch.
- Variable-priced artefacts (Trade Flow Pack, Verified Counterparty
  Pack, Institutional Counterparty Pack, etc.) are not exposed by any
  wired endpoint in this batch; they will require Option C
  (admin-resolved exact USD price) wiring before live use.
