# Batch V — VerifyNow Multi-Country IDV Routing, Adapter, Result Mapping and Manual Review Fallback

Scope: identity verification routing and adapter. Enterprise-grade,
additive, inspection-safe. No migrations, no live provider calls, no
production data mutation, no secret changes, no weakening of Batch O or
Batch O Remainder trust-signal protections.

## 1. What was built

| Area | File(s) |
|---|---|
| IDV route table (browser SSOT) | `src/lib/idv/route-table.ts` |
| IDV route table (server mirror) | `supabase/functions/_shared/idv-route-table.ts` |
| VerifyNow server adapter | `supabase/functions/_shared/verifynow/adapter.ts` |
| Result mapping (browser) | `src/lib/idv/result-mapping.ts` |
| Result mapping (server) | `supabase/functions/_shared/verifynow/result-mapping.ts` |
| Controlled-action gate helper (browser) | `src/lib/idv/controlled-action-gate.ts` |
| Controlled-action gate helper (server) | `supabase/functions/_shared/idv-gate.ts` |
| WaD-seal IDV gate wire | `supabase/functions/_shared/idv-wad-seal-gate.ts` + edit in `supabase/functions/wad/index.ts` (post-challenge-guard, pre-fetch-attestations) |
| Active IDV provider registry | `src/lib/idv/provider-registry.ts` |
| Manual review shape (browser) | `src/lib/idv/manual-review.ts` |
| Manual review shape (server) | `supabase/functions/_shared/idv-manual-review-shape.ts` |
| Manual review edge function | `supabase/functions/idv-manual-review/index.ts` |
| Tests (Vitest, 6 files) | `src/tests/batch-v-*.test.ts` |
| Smoke test (Deno) | `supabase/functions/_shared/verifynow/adapter_smoke_test.ts` |

## 2. What was NOT built (per prompt)

OMB, full KYB, bank verification, CIPC, Dilisense/Sanctions.io/Sumsub/
Didit/ComplyCube/Onfido fallback, provider secret changes, schema
migrations, production calls, Memory writes of raw payloads, ID photo
storage. No historical records deleted.

## 3. Countries and routing

Routing is decided ONLY by `(document_issuing_country, document_type)`.
Nationality, country of residence, company country and transaction
country do NOT influence provider routing (proven by
`src/tests/batch-v-idv-routing.test.ts`).

**Live at launch (VerifyNow):**
- ZA — `za_home_affairs_enhanced` (full IDV, unlocks), `za_said_basic`
  (supporting only, does not unlock).
- NG — `ng_nin`, `ng_virtual_nin`, `ng_nin_slip` (full IDV, unlocks);
  `ng_bvn`, `ng_voter_id`, `ng_phone_lookup`, `ng_bank_account_check`
  (supporting only).

**Placeholders (not live yet, resolve to `provider_not_available` /
Manual review required):**
- GH, KE, UG, ZM, CI.

## 4. Result mapping

| Raw VerifyNow outcome | Internal status | User wording | Unlocks controlled actions |
|---|---|---|---|
| `clear_match` | `idv_completed` | Identity verification completed | yes (only on full-IDV route) |
| `possible_mismatch` | `manual_review_required` | Manual review required | no |
| `clear_mismatch` | `manual_review_required` | Manual review required | no |
| `not_found` | `retry_required` | Retry required / Alternative document required | no |
| `source_unavailable` | `provider_pending` | Provider pending | no |
| `timeout` | `provider_pending` | Provider pending | no |
| `provider_error` | `provider_error` | Manual review required | no |
| `unsupported_country` | `provider_not_available` | Manual review required | no |
| `unsupported_document_type` | `provider_not_available` | Manual review required | no |
| `blocked_id` | `blocked_pending_admin_decision` | Manual review required | no |
| `deceased` | `blocked_pending_admin_decision` | Manual review required | no |
| `suspected_fraud` | `blocked_pending_admin_decision` | Manual review required | no |

A clear match on a supporting-only route is downgraded to
`manual_review_required` (never `idv_completed`). No outcome
auto-rejects.

## 5. Adapter safety (VerifyNow server-only)

- Reads `VERIFYNOW_API_KEY`, `VERIFYNOW_BASE_URL`, `VERIFYNOW_MODE` from
  `Deno.env`. Base URL defaults to `https://www.verifynow.co.za/api/external`.
  Mode defaults to `sandbox`.
- Fail-closed with `PROVIDER_MISCONFIGURED` when the key is absent.
- Production requires a UUID v4 `Idempotency-Key` header; missing key →
  `IDEMPOTENCY_KEY_REQUIRED`; same-key/different-payload →
  `IDEMPOTENCY_CONFLICT` (mapped to `provider_error` → manual review).
- Unsupported route resolutions never trigger a network call.
- Unknown provider response body strings map to `provider_error`
  (Batch-O style conservatism — no false success).
- No new secrets were requested. When the key is provisioned in a
  follow-up, no code change is required.

## 6. Manual review fallback

Persistence wires into the existing `public.p5scr_manual_reviews` table
(category `idv_person`). The seven extended decisions
(`manual_review_accepted`, `manual_review_rejected`,
`more_information_required`, `alternative_document_required`,
`provider_retry_required`, `blocked_pending_admin_decision`,
`waived_with_reason`) map to the constrained column
(`cleared|cleared_with_conditions|failed|rejected`); the full extended
decision, reason, and structured context are preserved in
`notes_admin_only`. Only platform admins can call the function
(has_role check). Audit event `idv.manual_review_decision` is emitted
best-effort. No raw provider payload, no ID photo, no biometric data is
stored.

If the insert or update returns an error, the function returns
`MANUAL_REVIEW_STORE_NOT_WIRED` (501) rather than silently succeeding.

## 7. Controlled-action gates

`isIdvBlocking(status)` is the single predicate. Blocking states:
`pending`, `provider_pending`, `provider_not_available`, `retry_required`,
`alternative_document_required`, `manual_review_required`,
`blocked_pending_admin_decision`, `provider_error`, `failed`, `expired`,
`unsupported`, `error`, and `null`/`undefined` (fail-closed).

**Wired in this batch:**
- **WaD sealing** — `supabase/functions/wad/index.ts` (POST `/:id/seal`)
  calls `assertWadSealIdvGate` after the challenge-open guard and before
  fetching attestations. On any blocking party state, it throws
  `IDV_REQUIRED_WAD_SEAL` (HTTP 409). The gate is a no-op when a party
  org has no linked `p5scr_subjects` row — that wiring belongs to Batch
  V-Wire.

**Provided but not wired here (Batch V-Wire):**
- Finality actions, funder-ready grant, API `ready=true`, and POI
  binding call-sites. The helper (`isIdvBlocking`) and the server-side
  `assertIdvGate(admin, subjectId, action)` are ready to be consumed
  from each site. This scope split was chosen to avoid touching the
  finality / funder / API code paths in the same batch as the IDV
  primitives — Batch O and Batch O Remainder guarantee those surfaces
  cannot leak a "verified" trust signal in the meantime.

## 8. Person-only scope

Successful VerifyNow IDV updates the person layer only. Static scan of
all Batch V files proves no code writes `entities.status='verified'`,
`counterparties.verified=true`, `funder_ready=true`,
`finality_ready=true`, or `ready:true`
(`src/tests/batch-v-person-only.test.ts`).

## 9. Old-provider handling

`src/lib/idv/provider-registry.ts` declares `ACTIVE_IDV_PROVIDERS =
['verifynow']`. Dilisense, Sanctions.io, Sumsub, Didit, ComplyCube,
Onfido and Companies House are listed in `DECOMMISSIONED_FOR_NEW_IDV`.
No historical records are deleted; admin/audit surfaces are unchanged.

## 10. Data protection / Memory

The adapter and manual-review store do not persist raw provider
payloads, ID photos, selfies, or biometric data. The manual-review
notes field records only: extended decision, reason, decision reason,
document country/type, provider attempted, provider status, and a
`recorded_by_batch: "batch_v"` marker.

## 11. Tests and commands run

Vitest (79 assertions, all pass):

```
bunx vitest run \
  src/tests/batch-v-idv-routing.test.ts \
  src/tests/batch-v-result-mapping.test.ts \
  src/tests/batch-v-controlled-action-gate.test.ts \
  src/tests/batch-v-verifynow-client-boundary.test.ts \
  src/tests/batch-v-person-only.test.ts \
  src/tests/batch-v-wording.test.ts
# → 6 files passed, 79 tests passed
```

Deno smoke (fetch tripwire, 9 tests):

```
deno test --allow-net --allow-env \
  supabase/functions/_shared/verifynow/adapter_smoke_test.ts
# → 9 passed | 0 failed
```

Batch O regression suite:

```
bunx vitest run src/tests/batch-o-idv-kyb-lockout-guard.test.ts
# → 25 passed | 0 failed
```

Typecheck:

```
bunx tsgo --noEmit
# → clean
```

## 12. Confirmation of no side effects

- **No provider calls.** The Deno smoke test installs a global fetch
  tripwire that throws on any uninjected network call and all tests
  pass — proving the adapter does not call VerifyNow (or any URL) in
  local runs.
- **No production data mutation.** No migrations were run. No
  `supabase--migration` was invoked. The manual-review edge function is
  admin-only and requires an authenticated `platform_admin`; it was
  deployed only as source (not invoked live).
- **No secret changes.** No `add_secret`, `set_secret`,
  `generate_secret`, or `update_secret` calls were made.
- **No email / storage / cron / payment side effects.**
- **Batch O / Batch O Remainder protections intact** (regression suite
  green).

## 13. Residual risks

1. **Gate-wiring coverage.** Finality, funder-ready, API `ready=true`
   and POI-bind call-sites consume `isIdvBlocking` in Batch V-Wire.
   Until then, those gates rely on their existing checks — none of
   which regressed in this batch.
2. **VerifyNow credentials not yet provisioned.** Adapter fails closed
   with `PROVIDER_MISCONFIGURED` until `VERIFYNOW_API_KEY` is set.
3. **p5scr subject linkage.** `assertWadSealIdvGate` requires a
   `p5scr_subjects` row keyed on `org_id`. Where the subject is not
   linked, the gate is a no-op (documented).
4. **Manual-review persistence** uses the existing
   `p5scr_manual_reviews` shape; if a schema change lands upstream, the
   edge function returns `MANUAL_REVIEW_STORE_NOT_WIRED` (501)
   rather than silently succeeding.

## 14. Recommended next batch

**Batch V-Wire** — wire `isIdvBlocking` into remaining controlled-action
call sites (finality, funder-ready, API `ready=true`, POI-bind);
provision `VERIFYNOW_API_KEY`; wire `p5scr_subjects` linkage; add an
end-to-end reroute + manual-review integration test.

## Final status

`BATCH_V_VERIFYNOW_MULTICOUNTRY_IDV_ROUTING_DEPLOYED_AND_LOCAL_SMOKE_TESTED`
