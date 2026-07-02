# Batch V — VerifyNow Multi-Country IDV Routing

Enterprise-grade IDV build. Read-only for existing schema; no migrations, no live provider calls, no production data mutation. Preserves Batch O / O-Remainder trust-signal guards.

## What will be built

### 1. IDV Route Registry (SSOT)

`src/lib/idv/route-table.ts` + mirror `supabase/functions/_shared/idv-route-table.ts`

- Central registry keyed by `(document_issuing_country, document_type)`.
- Live: **ZA** (SAID, Home Affairs Enhanced IDV), **NG** (NIN, Virtual NIN, NIN Slip — full IDV; BVN, voter ID, phone, bank — supporting only).
- Placeholders (live_enabled=false): **GH, KE, UG, ZM, CI** → resolve to `provider_not_available`.
- Each entry: `provider`, `live_enabled`, `api_supported`, `full_idv` vs `supporting_only`, `can_unlock_controlled_actions`, `required_fields`, `user_wording`, `admin_wording`.
- Pure function `resolveIdvRoute({ document_country, document_type })` — no IO.
- Explicitly does NOT read nationality / residence / company country.

### 2. VerifyNow server-side adapter

`supabase/functions/_shared/verifynow/adapter.ts`

- Reads `VERIFYNOW_API_KEY`, `VERIFYNOW_BASE_URL` (default `https://www.verifynow.co.za/api/external`), `VERIFYNOW_MODE` (sandbox default).
- `x-api-key` header. Production calls require `Idempotency-Key` (UUID v4, persisted alongside request).
- Same-key/different-payload conflict → `provider_error` → manual review + audit.
- Never imported by any `src/**` file (guard test).
- No new secrets requested in this batch — adapter fails closed with `PROVIDER_MISCONFIGURED` when keys absent (mirrors Batch O pattern).

### 3. Result mapping

`supabase/functions/_shared/verifynow/result-mapping.ts`

Table mapping VerifyNow raw outcomes → internal status → user-safe wording → controlled-action gate:


| Raw                          | Internal                         | User wording                                   | Unlock |
| ---------------------------- | -------------------------------- | ---------------------------------------------- | ------ |
| clear match (full IDV)       | `idv_completed`                  | Identity verification completed                | yes    |
| possible mismatch            | `manual_review_required`         | Manual review required                         | no     |
| clear mismatch               | `manual_review_required`         | Manual review required                         | no     |
| not found                    | `retry_required`                 | Retry required / Alternative document required | no     |
| source unavailable / timeout | `provider_pending`               | Provider pending                               | no     |
| provider error               | `provider_error`                 | Manual review required                         | no     |
| unsupported country/doc      | `provider_not_available`         | Manual review required                         | no     |
| blocked/deceased/fraud       | `blocked_pending_admin_decision` | Manual review required                         | no     |


No auto final rejection.

### 4. Manual review fallback

`src/lib/idv/manual-review.ts` (pure record shape + decision enum) plus a thin edge function `supabase/functions/idv-manual-review/index.ts` scaffolded to accept admin decisions. Decisions: `manual_review_accepted`, `manual_review_rejected`, `more_information_required`, `alternative_document_required`, `provider_retry_required`, `blocked_pending_admin_decision`, `waived_with_reason`.

No new tables in this batch — persist onto existing `p5scr_manual_reviews` shape where compatible; if fields don't align, the edge function returns 501 with `MANUAL_REVIEW_STORE_NOT_WIRED` so we surface the gap without silent success.

### 5. Controlled-action gate helper

`src/lib/idv/controlled-action-gate.ts` — `isIdvBlocking(status)` returns true for any of: pending, provider_pending, provider_not_available, retry_required, alternative_document_required, manual_review_required, blocked_pending_admin_decision, failed, expired, unsupported, error. Server mirror in `_shared/`. To be consumed by existing gate stacks; no rewrite of existing gates in this batch.

### 6. Person-only scope

Adapter result surfaces `person_idv_completed` only. Explicit guard test that success does NOT set `entities.status='verified'`, `counterparties.verified`, funder-ready, finality, or API ready=true.

### 7. Old-provider decommissioning (feature-flag only)

`src/lib/idv/provider-registry.ts` — `getActiveIdvProviders()` returns `['verifynow']`. Dilisense/Onfido/Sumsub/Didit/ComplyCube/Sanctions.io excluded for new IDV. Historical data untouched.

### 8. Wording guards

Extends existing Batch O guard test to scan new IDV surfaces for banned phrases and require the safe-wording catalogue.

## What will NOT be built (per prompt)

OMB, full KYB, bank verification, CIPC, Dilisense/Sanctions.io/Sumsub/Didit/ComplyCube/Onfido fallback, provider secret changes, schema migrations, production calls, Memory writes of raw payloads.

## Tests (Vitest + Deno)

- `src/tests/batch-v-idv-routing.test.ts` — route table: ZA/NG live, 5 placeholders disabled, unsupported → manual review, doc-country-only routing (nationality/residence/company-country ignored), reroute on change.
- `src/tests/batch-v-verifynow-client-boundary.test.ts` — scan src/** to prove `VERIFYNOW_API_KEY` not referenced client-side and adapter file not imported from src.
- `src/tests/batch-v-result-mapping.test.ts` — full mapping table.
- `src/tests/batch-v-controlled-action-gate.test.ts` — every non-completed status blocks.
- `src/tests/batch-v-person-only.test.ts` — success does not flip company/funder/API/finality flags (source scan + unit).
- `src/tests/batch-v-wording.test.ts` — banned phrases absent from new surfaces; Batch O suite still passes.
- `supabase/functions/_shared/verifynow/adapter_smoke_test.ts` — fetch tripwire proves zero network egress; production mode requires Idempotency-Key; missing key → PROVIDER_MISCONFIGURED; unsupported route never calls adapter.

All tests run offline. No provider calls. No DB mutation. No secrets set.

## Evidence

`evidence/batch-v-verifynow-multicountry-idv-routing/README.md` with sections mandated by the prompt (files changed, route table, mapping, fallback, gate, old-provider handling, data/Memory, tests, commands+results, residual risks, next batch).

## Residual risks (called out up front)

1. Manual-review persistence edge function returns 501 until table shape is confirmed — no silent success.
2. Controlled-action gate helper is provided but existing gate call-sites are not rewired in this batch (deliberate scope limit — separate wiring batch recommended so we don't touch WaD/finality/API logic under the "no-overbuild" constraint).
3. No new secrets requested; adapter fails closed until VerifyNow credentials are provisioned in a follow-up.

## Recommended follow-up batch

**Batch V-Wire** — wire `isIdvBlocking` into existing POI/WaD/finality/funder-ready/API-ready gate sites; provision VerifyNow secrets; wire manual-review persistence; add e2e reroute test.

---

Confirm to proceed, or tell me to adjust scope (e.g. include the gate-wiring in this batch, or wire manual-review persistence to a specific existing table).  
  
I would **adjust scope before proceeding**.

The proposed Batch V is good, but it stops one step too early.

The biggest issue is this line:

“Controlled-action gate helper is provided but existing gate call-sites are not rewired in this batch.”

That means we would build the routing and adapter, but the platform may still not actually block WaD/finality/funder/API correctly from the new VerifyNow statuses.

Given your “one-shot plus one refinement” limit, I would not accept a batch that only creates helpers and leaves gate wiring for later.

## **My recommendation**

Proceed, but change scope to include **minimum gate wiring now**.

Not a huge rewrite.

Just wire the new IDV blocking status into the existing controlled-action gates that matter:

- WaD sealing;
- finality;
- funder-ready;
- API `ready=true`;
- POI action only where the person binds a party.

Also, manual-review persistence should not return 501 if there is already a compatible P-5 manual-review table. The P-5 screening spine already has manual review structures, so the prompt should ask them to wire to the existing compatible table if available, and only fail closed if truly incompatible.

## **The revised instruction I would send back**

```text
Please proceed with Batch V, but adjust the scope before implementation.

The current plan is strong, but it stops too early in two places.

1. Controlled-action gate wiring

Do not only create `isIdvBlocking()` as a helper.

Wire the new VerifyNow IDV statuses into the existing controlled-action gates for the key launch blockers:

- WaD sealing;
- finality;
- funder-ready status;
- API ready=true;
- POI action where the person binds a party.

This does not need to be a broad rewrite of the gate stack. Keep the wiring minimal and additive.

Acceptance rule:

If required IDV is pending, provider_pending, provider_not_available, retry_required, alternative_document_required, manual_review_required, blocked_pending_admin_decision, failed, expired, unsupported or error, then:

- WaD sealing must be blocked;
- finality must be blocked;
- funder-ready must be blocked;
- API ready=true must be blocked;
- binding POI action must be blocked where that person is acting for a party.

Non-sensitive work must remain allowed.

2. Manual-review persistence

Do not return 501 by default if an existing P-5 manual-review table can safely support this.

First inspect the existing P-5 screening/manual-review structures, especially the existing `p5scr_manual_reviews` shape or equivalent.

If the existing table can safely store the manual review record, wire to it.

If fields are missing but can be safely stored in a metadata/details JSON field without schema changes, use that.

Only return `MANUAL_REVIEW_STORE_NOT_WIRED` if the existing schema truly cannot safely store the required manual-review record.

Do not create a new migration in this batch.

3. Evidence and tests

Add tests proving that the new IDV blocking status is actually consumed by the existing gate call-sites, not merely present as an unused helper.

The evidence README must clearly state:

- which gate call-sites were wired;
- which were not touched;
- what still remains for Batch V-Wire, if anything;
- whether manual-review persistence is wired or fail-closed;
- whether any production data was mutated;
- whether any provider was called.

Everything else in the Batch V plan is approved.

Do not add OMB.
Do not add full KYB.
Do not add bank verification.
Do not add CIPC/company verification.
Do not add Dilisense/Sanctions.io/Sumsub/Didit/ComplyCube/Onfido fallback.
Do not call production providers.
Do not expose VerifyNow secrets client-side.
Do not weaken Batch O / Batch O Remainder wording and trust-signal protections.
```

## **Why this adjustment matters**

Without gate wiring, Batch V is mostly infrastructure.

With minimal gate wiring, Batch V becomes operational.

That matters because the client’s confirmed rule is not just “route to VerifyNow”. The confirmed rule is:

**If IDV is unresolved, controlled actions must stay blocked.**

So I would not spend the first opportunity on a build that does not enforce that rule.