# P-4 Point 4 — Client-Visible Cross-Consistency & Embarrassment Audit

**Overall status:** `CLIENT_SAFE_WITH_MINOR_FIXES`

This audit checks whether the backend burn engine delivered in
`P4_POINT_4_TOKEN_CREDIT_BURN_PER_CHARGEABLE_API_CALL_COMPLETE` is
matched by consistent, non-embarrassing client/admin/API/docs surfaces
against David's confirmed rule:

> Production API calls burn credits only when they create, return, update
> or confirm a governed commercial artefact. 1 Basic POI = USD $10 = 1
> credit. The Izenzo USD Artefact Price Book is the default schedule.

## Scope of this audit

- Pricing SSOT (`src/lib/registry-api-artefact-pricing.ts` and its Deno
  mirror).
- Burn wrapper (`supabase/functions/_shared/api-artefact-burn.ts`).
- Parity guard (`scripts/check-registry-api-artefact-pricing-parity.mjs`).
- Tests (`src/tests/p4-point-4-token-burn-per-chargeable-api-call.test.ts`).
- Docs (`docs/registry/api-artefact-pricing.md`, `RELEASE_GATE.md`,
  evidence indices).
- Client-visible usage / billing screens that already exist
  (`src/components/desk/billing/BillingOverview.tsx`,
  `src/components/desk/settings/TokenBalanceTab.tsx`,
  `src/pages/Billing.tsx`).
- Existing API docs (`src/pages/docs/*`).

## Verification performed

- Guard `npm run check:p4-point-4` — PASS (pricing parity, audit events,
  non-chargeable reasons, 402 path, atomic engine, ledger category).
- New guard `node scripts/check-p4-point-4-client-visible-wording.mjs` —
  PASS (no forbidden "every API call burns" / "per API call burns" /
  "smallest units of credit" / `atomic_token_burn` leakage to client
  docs).
- Tests `npx vitest run src/tests/p4-point-4-token-burn-per-chargeable-api-call.test.ts`
  — 36/36 PASS.
- Existing POI / payment-allocation burn sites — UNCHANGED in this audit.

## Embarrassment checklist

| # | Risk | Result | Notes |
|---|---|---|---|
| 1 | UI price differs from price book | PASS | No UI surface displays per-artefact USD prices yet. Single SSOT enforced by parity guard. |
| 2 | "tokens" in one place, "credits" in another | **RISK — readiness gap** | Existing wallet UI (`TokenBalanceTab`, `BillingOverview`) uses "tokens" / `tokens_burned`. New artefact engine uses "credits". Flagged as a readiness item below; does not affect burn correctness. |
| 3 | Client charged but cannot see what artefact caused the charge | **RISK — readiness gap** | Existing usage rows surface `endpoint` + `action_type` but not `artefact_code` / `artefact_label`. Wrapper writes both into `event_store.metadata`; client-visible projection of `artefact_label` is not yet wired. |
| 4 | Internal smallest-unit value shown to user | PASS | `credit_units` are internal-only; planner fails closed before any fractional burn reaches the wallet. |
| 5 | Sandbox call reduces real balance | PASS | Planner short-circuits to `skipped_sandbox` whenever `environment !== "production"` or `non_chargeable_reason = "sandbox"`. Tests cover this. |
| 6 | No-result call burns without explaining retained artefact | PASS | `artefact_was_produced=false` ⇒ skip. `artefact_was_produced=true` ⇒ artefact code recorded. |
| 7 | Failed technical call burns | PASS | `failed_technical_call` short-circuits to skip. |
| 8 | Insufficient-credit call creates the artefact anyway | PASS | 402 returned before downstream work. The wrapper is required to be called at the point where the artefact would be created. |
| 9 | Retried request double-burns | PASS | `p_reference_id = request_id` de-duplicates inside `atomic_token_burn`; `idempotent_replay` is surfaced. |
| 10 | Cross-client usage leak | PASS | Wrapper writes per-org rows only; existing RLS on `token_ledger` / `registry_api_request_logs` enforces scope. |
| 11 | Admin cannot reverse a wrong burn | PASS (existing path) | `api.token_burn.reversed` is registered for the existing admin reversal path; no client-facing reversal endpoint exposed. **Readiness note:** admin reversal UI does not yet surface the artefact label — flagged below. |
| 12 | Docs say "every API call burns" | PASS | New guard `check-p4-point-4-client-visible-wording.mjs` enforces this; current docs comply. |
| 13 | Client-facing UI looks incomplete vs backend | **RISK — readiness gap** | Burn wrapper exists but is not yet wired into any institutional API endpoint, so no client-visible burn rows are produced by it. Mark not for client demo of "live API charging" until at least one endpoint is wired. |
| 14 | API response omits credits burned / remaining balance | PASS (contract) | `BurnExecResult` exposes `credits_burned` and `remaining_balance`; the canonical 402 body shape is pinned in `buildInsufficientCreditsBody`. Endpoint wiring must surface these in responses. |
| 15 | Ranged artefact price burns without admin-resolved price | PASS | Variable artefacts fail closed with `VARIABLE_PRICE_UNRESOLVED` (HTTP 409). |
| 16 | Evidence README claims completion while UI not ready | PASS (with note) | The completion phrase is scoped to the backend burn engine; readiness gaps for endpoint wiring and UI relabelling are listed explicitly below. |

## Embarrassing risks found (with recommended fixes)

### R1 — Wallet UI says "tokens", burn engine says "credits"
- **Where:** `src/components/desk/settings/TokenBalanceTab.tsx`,
  `src/components/desk/billing/BillingOverview.tsx`,
  `src/pages/Billing.tsx`.
- **Why it matters:** David's rule is anchored on "credits". A client
  reading one screen and an admin reading another would see two unit
  names for the same wallet.
- **Recommended fix:** label sweep replacing visible "tokens" → "credits"
  in those components, keeping the underlying column name `tokens_burned`
  unchanged for compatibility.
- **Demo blocker?** No, but should be done before institutional API
  charging is demonstrated. **Not applied in this audit** (broader UI
  sweep is outside this batch's scope and would touch unrelated screens).

### R2 — Usage row does not show artefact label
- **Where:** `src/components/desk/billing/BillingOverview.tsx`,
  `src/components/desk/settings/TokenBalanceTab.tsx`.
- **Why it matters:** A client seeing a charge without an artefact name
  cannot self-explain the burn.
- **Recommended fix:** add an `artefact_label` column sourced from
  `event_store.metadata.artefact_code` once the wrapper is wired to at
  least one endpoint. **Not applied in this audit** — depends on
  endpoint wiring.

### R3 — Burn wrapper not yet called from any endpoint
- **Where:** `supabase/functions/_shared/api-artefact-burn.ts` is the
  only call site. No `registry-api-*` endpoint imports
  `burnArtefactForApiCall` yet.
- **Why it matters:** A reader who runs a chargeable-looking endpoint
  will see zero burns and zero usage rows; this can be misread as a
  silent bug.
- **Recommended fix:** wire the wrapper into the next chargeable
  institutional endpoint as its own batch and announce that batch
  explicitly. **Not applied in this audit** — wiring is the next
  scheduled task and would be miscategorised as a fix.

## Fixes applied in this audit

- **NEW guard:** `scripts/check-p4-point-4-client-visible-wording.mjs`
  blocks forbidden phrases ("every API call burns", "per API call
  burns", "smallest units of credit", leakage of `atomic_token_burn` to
  docs/client surfaces). Run with `node` or wire into CI alongside the
  existing parity guard.
- **NEW evidence README:** this file.
- No changes to the burn engine, the price book, the wallet RPC, or
  existing UI behaviour. No commercial-rule changes.

## Cross-surface consistency conclusion

| Surface | Tells the same story as David's rule? |
|---|---|
| Backend pricing SSOT | YES |
| Burn wrapper | YES |
| API response contract (`BurnExecResult`, 402 body) | YES |
| Audit events | YES |
| Docs (`docs/registry/api-artefact-pricing.md`) | YES |
| Release gate | YES (pricing & burn rule cited) |
| Admin usage view | PARTIAL — artefact label not yet surfaced (R2) |
| Client usage view | PARTIAL — tokens/credits wording drift (R1) and artefact label gap (R2) |
| Live endpoint behaviour | NOT YET WIRED (R3) |

## Completion

`P4_POINT_4_CLIENT_VISIBLE_CROSS_CONSISTENCY_AUDIT_COMPLETE`
