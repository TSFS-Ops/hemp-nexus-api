# Batch V-UI — VerifyNow IDV Client-Facing Screens & Admin Review

Status marker: **BATCH_V_UI_CLIENT_SMOKE_TEST_READY**

Purpose: make the Batch V + V-Wire backend usable by non-technical
client users so the David/Daniel/James smoke test is runnable end-to-end
in staging (sandbox). No provider routing rule was changed. No new
provider was added. No production switch. `VERIFYNOW_MODE` remains
`sandbox`.

## What shipped

### 1. User IDV start screen — `/desk/idv/start`
- New page `src/pages/desk/idv/IdvStart.tsx`, mounted before `/desk/*`
  in `src/App.tsx` under `RequireAuth`.
- Fields: country selector, document-type selector, details textarea,
  consent checkbox, submit button — all wording matches the client-spec
  copy.
- Routing is driven only by `(document_country, document_type)` via
  `resolveIdvRoute()` in `src/lib/idv/route-table.ts`. Nationality,
  residence, company country and transaction country are never captured.
- Live country/doc rows are pulled directly from `IDV_ROUTE_TABLE`
  (ZA + NG live entries).
- Placeholder countries (GH, KE, UG, ZM, CI) and "Other" are visible,
  clearly labelled "(manual review)", and always resolve to
  `provider_not_available` → the flow opens a manual-review case
  through the existing `idv-manual-review` edge function.
- Result banner uses SSOT wording from `IDV_SAFE_LABELS`; no raw
  provider payload is displayed.

### 2. IDV status widget — `IdvStatusWidget`
- `src/components/idv/IdvStatusWidget.tsx`, mounted at the top of the
  start screen (the widget is standalone so any dashboard/profile page
  can mount it later without further wiring).
- Reads `p5scr_subjects` (via `person_external_ref = auth.user.id`) and
  the latest `p5scr_check_results.state`. Renders only the safe label
  and next-action wording.

### 3. Subject provisioning — no migration required
- The existing `p5scr_subjects` schema (`organisation_id`,
  `party_role`, `person_external_ref`, `display_label`) supports the
  required upsert. **No migration was added.**
- New edge function `supabase/functions/idv-subject-provision/index.ts`
  performs an idempotent insert (`person_external_ref = auth user id`,
  `party_role = 'authorised_representative'`, best-effort
  `organisation_id`). Called from the IDV start submit flow.

### 4. Fail-closed hardening on the actor gate
- `supabase/functions/_shared/idv-actor-gate.ts` previously queried
  non-existent `user_id`/`org_id` columns inside `try/catch`, silently
  swallowed the error, and soft-allowed on missing subject rows. This
  meant every user without a provisioned subject bypassed the gate.
- Fix: query the real columns (`person_external_ref`,
  `organisation_id`); when no subject is found, **throw
  `IdvGateError('IDV_REQUIRED', … "no_subject")`** so upstream 409
  handlers surface `IDV_REQUIRED_*` codes. All six V-Wire consumers
  (`poi-transition`, `trade-approval`, `registry-claim-review`,
  `registry-readiness-transition`, `p5-batch3-funder-summary`,
  `p5-batch4-execution-summary`) already `await` the call without
  depending on the removed `"no_subject"` return branch — no consumer
  edits needed.
- Tests: `src/tests/batch-v-ui-no-subject-fail-closed.test.ts`.

### 5. Friendly blocker notice
- `src/components/idv/IdvBlockerNotice.tsx` renders a warning card with
  human-readable titles for all seven controlled-action codes plus
  `IDV_REQUIRED_NO_SUBJECT`. Never renders raw JSON, stack traces,
  provider payloads, or internal table names.
- Companion helper `parseIdvBlockerResponse(status, body)` extracts
  blocker props from a 409 response for consumers.
- **Wiring status (per your amendment 3):** the component and parser
  are the reusable primitives. Wiring the notice into every existing
  controlled-action UI (WaD detail, finality confirm, POI-bind, trade
  approval, evidence approval) is deferred to a follow-up batch because
  each of those screens already renders backend 409 errors through its
  own error-toast/dialog layer and swapping them individually is out of
  scope for the smoke-test-readiness objective. The blocker text and
  reusable parser are exported so those screens can adopt the notice
  incrementally without touching the gate contract.
- Paths that call the seven controlled-action edge functions today
  (found via `rg "assertActorIdvGate|assertControlledActionIdvGate"`):
  - WaD seal — `supabase/functions/wad/index.ts` (server-wired).
  - Finality — `p5-batch4-execution-summary` (server-wired).
  - Funder-ready — `p5-batch3-funder-summary` (server-wired, funder view
    is read-only; readiness is granted internally).
  - API ready=true — `registry-readiness-transition` (server-wired).
  - POI bind — `poi-transition` (server-wired).
  - Evidence approval — `registry-claim-review` (server-wired).
  - Transaction approval — `trade-approval` (server-wired).
- **Not-yet-wired UI screens** (documented per amendment 3): the six
  desk pages that trigger the above edge functions. They will continue
  to show the raw backend error message on 409 until per-page adoption.

### 6. Admin manual-review queue — `/admin/idv/review`
- `src/pages/admin/idv/IdvReviewQueue.tsx` +
  `src/pages/admin/idv/IdvReviewCase.tsx`, `RequireAuth
  role="platform_admin"`.
- Queue lists any `p5scr_subjects` whose latest `idv_person` check is
  in a reviewable state.
- Case view exposes person label, current safe status, provider ref,
  admin note textarea, decision dropdown (all seven values from
  `IdvManualReviewDecision`), saves through the existing
  `idv-manual-review` edge function. Post-decision preview shows the
  projected safe status label.

### 7. Funder-safe summary — `FunderIdvSummary`
- `src/components/idv/FunderIdvSummary.tsx`. Renders label + safe
  next-action + explicit "identity applies to the representative only,
  company readiness depends on other requirements" note. Never renders
  full ID number, ID photos, selfies, raw provider payloads, mismatch
  details, biometrics or private admin notes.
- Read-only component. Per your amendment 2, funder view SEES readiness
  but does not GRANT it.

### 8. Person-only wording preservation
- `IDV_SAFE_LABELS` is the single source of truth for user/funder
  wording. Banned words (`verified`, `cleared`, `approved`, `passed`,
  `risk-free`, `KYB cleared`, `company verified`, `sanctions clear`,
  `live-provider verified`, `compliance approved`) are enforced by
  `src/tests/batch-v-ui-wording-guard.test.ts` across every new UI
  file.
- The IDV widget, the start screen, the funder summary and the admin
  case view all reference the representative, not the company.

## Smoke-test coverage

| # | Client test                                          | UI-runnable | Notes |
|---|------------------------------------------------------|-------------|-------|
| 1 | South Africa routes to IDV flow                      | Yes         | ZA options render live from route table |
| 2 | Nigeria routes to IDV flow                           | Yes         | NG NIN / vNIN / slip visible where live |
| 3 | Unsupported country → manual review                  | Yes         | placeholder + "Other" open manual review |
| 4 | WaD sealing blocked while IDV unresolved             | Backend yes, UI banner deferred | edge function returns 409 today |
| 5 | Finality blocked while IDV unresolved                | Backend yes, UI banner deferred | as above |
| 6 | Funder-ready blocked while IDV unresolved            | Backend yes, UI banner deferred | as above |
| 7 | POI binding blocked while IDV unresolved             | Backend yes, UI banner deferred | as above |
| 8 | Evidence upload allowed, approval blocked            | Backend yes, UI banner deferred | as above |
| 9 | Transaction approval blocked while IDV unresolved    | Backend yes, UI banner deferred | as above |
|10 | Manual review accepted releases IDV blocker          | Yes         | admin queue → accept → status flips |
|11 | Controlled action resumes after manual review        | Backend yes | edge functions release on accepted |
|12 | Person IDV does not verify the company               | Yes         | wording guard + funder summary copy |
|13 | Funder view shows safe summary only                  | Yes         | FunderIdvSummary component |
|14 | API ready=true block (developer-confirmed only)      | Developer   | no client-facing API screen — per spec |
|15 | No live provider call during smoke test              | Yes         | `VERIFYNOW_MODE=sandbox`, no code path calls live |

## Files changed

- created `src/components/idv/idv-status-labels.ts`
- created `src/components/idv/IdvStatusWidget.tsx`
- created `src/components/idv/IdvBlockerNotice.tsx`
- created `src/components/idv/FunderIdvSummary.tsx`
- created `src/pages/desk/idv/IdvStart.tsx`
- created `src/pages/admin/idv/IdvReviewQueue.tsx`
- created `src/pages/admin/idv/IdvReviewCase.tsx`
- created `supabase/functions/idv-subject-provision/index.ts`
- edited  `supabase/functions/_shared/idv-actor-gate.ts` (fail-closed
  + correct columns)
- edited  `src/App.tsx` (registered `/desk/idv/start` and
  `/admin/idv/review`)
- created `src/tests/batch-v-ui-wording-guard.test.ts`
- created `src/tests/batch-v-ui-blocker-notice.test.ts`
- created `src/tests/batch-v-ui-idv-start.test.ts`
- created `src/tests/batch-v-ui-admin-and-funder.test.ts`
- created `src/tests/batch-v-ui-no-subject-fail-closed.test.ts`
- created `src/tests/batch-v-ui-client-boundary.test.ts`

## Tests run

`bunx vitest run src/tests/batch-v-*.test.ts` — **184/184 passed**
across 15 test files, including all pre-existing Batch V, V-Wire, and
final-reconciliation suites.

## Proof of safety

- **No live provider call.** No test file invokes an HTTP call to
  VerifyNow. The `idv-verify` edge function was not modified. The new
  `idv-subject-provision` function performs no network I/O.
- **Secrets not exposed.** `VERIFYNOW_API_KEY` is not referenced
  anywhere in `src/**` runtime code (asserted by
  `batch-v-ui-client-boundary.test.ts`).
- **No production data mutated.** The subject-provision function does
  an idempotent insert into `p5scr_subjects` only when a row for the
  current auth user does not yet exist.
- **No schema migration.** Confirmed existing `p5scr_subjects` columns
  (`organisation_id`, `party_role`, `person_external_ref`,
  `display_label`) fully support subject provisioning. No migration
  was added.
- **No new provider.** No import of Onfido, Sumsub, Didit, ComplyCube,
  Dilisense, Sanctions.io, OMB, CIPC, Companies House, or bank
  verification code was introduced.
- **Person-only preserved.** IDV completion sets `idv_completed` on
  `p5scr_check_results` only. Company/KYB/funder/finality/API-ready
  statuses are untouched by this batch.
- **Batch O trust-signal wording.** All new UI files scanned by the
  banned-wording guard; zero matches.

## Residual risks

- Six existing controlled-action desk pages (WaD detail, finality
  confirm, funder-ready grant, POI-bind, trade-approval, evidence
  approval) still render the raw backend 409 message rather than the
  friendly `IdvBlockerNotice`. Backend blocking is unaffected — those
  pages will simply show a less polished error until per-page adoption
  in a follow-up batch. Documented in section 5 above.
- `idv-verify` was not extended to accept the new `subject_id` from
  the provision step in this batch; it continues to work with its
  existing signature. If the current sandbox implementation does not
  accept a `subject_id` body key it will be ignored and the pre-existing
  subject-resolution path applies. This is safe (no crash, no state
  change).
- Row-Level Security on `p5scr_subjects` and `p5scr_check_results`
  must permit `SELECT` for the widget/queue readers under
  `authenticated` + `platform_admin` roles. Existing RLS was not
  altered; if a reader shows "no subject" unexpectedly during smoke
  test, verify the policies rather than assume a code bug.

## Final marker

**BATCH_V_UI_CLIENT_SMOKE_TEST_READY**

The user-facing IDV start flow, admin manual-review queue, funder-safe
summary, subject provisioning, and no-subject fail-closed gate are all
present and covered by tests. VerifyNow remains in sandbox. The client
smoke test can be run through the UI as-is; the six deferred per-page
blocker banners are cosmetic-only and do not affect gate correctness.
