# Batch V-UI — VerifyNow IDV Client-Facing Screens & Admin Review

Purpose: make the Batch V backend usable by David/Daniel/James through the UI so the client smoke test is runnable. No backend routing logic changes; only the surfaces and one narrow fail-closed hardening on the gate.

## Deliverables

### 1. User IDV start screen — `/desk/idv/start`

New page `src/pages/desk/idv/IdvStart.tsx` (registered in `src/App.tsx` under `/desk/*` via Desk router, or as a top-level `RequireAuth` route).

Fields, using existing SSOT `src/lib/idv/route-table.ts`:

- Country selector labelled "Select the country that issued your ID document" — reads countries from `IDV_ROUTE_TABLE` plus placeholders (GH/KE/UG/ZM/CI) plus "Other".
- Document type selector — filtered by chosen country from the route table; disabled until country picked.
- Details textarea (document number etc.) — plain text, no validation beyond length.
- Consent checkbox: "I confirm that I have permission to submit this identity check".
- Submit button: "Submit identity check".

On submit:

- Resolves route via `resolveIdvRoute({ document_country, document_type })`.
- If `provider_not_available` → posts to `idv-manual-review` to open a `manual_review_required` case (no live provider call), then shows safe status.
- Otherwise → posts to `idv-verify` (existing edge function).
- Renders safe status wording from `IDV_OUTCOME_MAP` and never displays raw provider payload.

Banned wording guard: unit test scans page source for verified/cleared/approved/passed/risk-free/KYB cleared/company verified/sanctions clear/live-provider verified.

### 2. IDV status widget — `IdvStatusWidget.tsx`

Component under `src/components/idv/IdvStatusWidget.tsx`. Reads latest `p5scr_subjects` + latest check for the current user. Shows: document country, document type, current safe status label, next action, last updated. Never renders full ID number, provider payload, photos, selfies, biometrics, private notes.

Mounted on:

- `/desk` landing (top of user dashboard).
- User profile/settings sidebar entry.

### 3. Subject provisioning + fail-closed hardening

Two-pronged fix for the "no subject → soft allow" gap:

- On IDV start submit, call a new edge function `idv-subject-provision` (or extend `idv-verify`) that upserts a `p5scr_subjects` row for the actor (`user_id`, `org_id`).
- Harden `supabase/functions/_shared/idv-actor-gate.ts` so `no_subject` becomes fail-closed for all 7 controlled actions. Blocker code `IDV_REQUIRED_NO_SUBJECT`, user wording "Identity verification required before this action".
- Add DB migration only if needed to allow upsert; existing table has `user_id`/`org_id` columns per current code.

### 4. Friendly blocker messages on controlled actions

Shared component `src/components/idv/IdvBlockerNotice.tsx` — renders a warning banner given a blocker code, using SSOT wording from `controlled-action-gate.ts`.

Wire into the six client-triggered action buttons/screens:

- WaD seal (WaD detail page).
- Finality (`/desk/p5-batch4/…`).
- Funder-ready (`/funder/p5-batch3/…`).
- POI binding action (POI detail page).
- Evidence approval (registry claim review admin/desk page).
- Transaction approval (trade approval page).

Each caller catches HTTP 409 with `blocker_code` starting `IDV_` and renders `IdvBlockerNotice`. No raw JSON, no stack traces.

### 5. Admin manual-review queue — `/admin/idv-review`

New page `src/pages/admin/idv/IdvReviewQueue.tsx` + detail `IdvReviewCase.tsx`. `RequireAuth role="platform_admin"`.

- List view: cases where `p5scr_subjects.status ∈ {manual_review_required, blocked_pending_admin_decision, provider_error, provider_pending, provider_not_available}`. Filter by category `idv_person`.
- Detail view: person, document country/type, provider state, reason, admin note textarea, decision dropdown (existing enum from `idv-manual-review-shape.ts`). Save → calls existing `idv-manual-review` edge function.
- Post-decision: safe status displayed ("Identity review completed" for `manual_review_accepted`).

### 6. Funder-safe IDV summary

Component `src/components/idv/FunderIdvSummary.tsx`. Mounted in `src/pages/funder/p5-batch3/components/P5B3FunderShell.tsx` (existing shell). Uses same status label whitelist as user widget. Never renders private data.

### 7. Person-only wording on company screens

Add small "Representative identity review completed — Company readiness still depends on other requirements" note wherever a representative IDV status is shown on a company profile. Reuse existing `P5B4ProviderSafeLabel` / `P5B3FunderSafeLabel` for label safety.

### 8. Tests — `src/tests/batch-v-ui-*.test.ts`

- `batch-v-ui-idv-start.test.ts` — renders start screen; ZA/NG routes visible; placeholders route to provider_not_available; nationality/residence/company country are not present as inputs; consent + submit exist.
- `batch-v-ui-blocker-notice.test.ts` — six controlled actions render `IdvBlockerNotice` on 409 with `IDV_*` blocker codes; no raw JSON/stack trace.
- `batch-v-ui-admin-queue.test.ts` — queue renders, decision form submits to `idv-manual-review`, safe status shown.
- `batch-v-ui-funder-summary.test.ts` — funder view only shows whitelisted status labels; no private fields.
- `batch-v-ui-wording-guard.test.ts` — scans all new UI files for banned wording.
- `batch-v-ui-no-subject-fail-closed.test.ts` — updated `idv-actor-gate.ts` returns/raises fail-closed when no subject row.
- `batch-v-ui-client-boundary.test.ts` — no VerifyNow secret/adapter referenced in new UI files.

All existing Batch V, V-Wire, and Batch O tests must remain green.

### 9. Evidence

`evidence/batch-v-ui-idv-smoke-test-readiness/README.md` — what shipped, where each user role clicks, subject-provisioning behaviour, smoke-test coverage (which of the 15 items are now UI-runnable vs dev-only, expected Test 7 API + Test 15 log check remain dev-only), files changed, test results, residual risks, final marker `BATCH_V_UI_CLIENT_SMOKE_TEST_READY`.

## Technical notes

```text
src/
  pages/desk/idv/IdvStart.tsx                    (new)
  pages/admin/idv/IdvReviewQueue.tsx             (new)
  pages/admin/idv/IdvReviewCase.tsx              (new)
  components/idv/IdvStatusWidget.tsx             (new)
  components/idv/IdvBlockerNotice.tsx            (new)
  components/idv/FunderIdvSummary.tsx            (new)
  components/idv/idv-status-labels.ts            (SSOT label whitelist)
  App.tsx                                        (register /desk/idv/start and /admin/idv/*)
  tests/batch-v-ui-*.test.ts                     (7 files)

supabase/functions/
  _shared/idv-actor-gate.ts                      (fail-closed on no_subject)
  idv-subject-provision/index.ts                 (new, or fold into idv-verify)

evidence/batch-v-ui-idv-smoke-test-readiness/README.md   (new)
```

Hard rules honoured:

- No new provider; VerifyNow adapter untouched.
- `VERIFYNOW_MODE=sandbox` unchanged; no secret ever imported into `src/**`.
- All new UI reads status from server; no client-side gate decisions.
- Company/funder/finality/API-ready remain untouched by IDV alone.
- Banned wording enforced by test.

## Out of scope

- Any real live VerifyNow call.
- KYB, CIPC, Companies House, Onfido, Sumsub, Didit, ComplyCube, Dilisense, Sanctions.io, OMB, bank verification.
- Changes to Batch O trust-signal containment or Batch V routing rules.
- Production mode switch.  
  
This is the right scope.
  It is clean, practical, and it solves the exact problem Lovable found: **the backend exists, but the client cannot click through it yet.**
  I would proceed with this, but I would make **three small changes before giving final approval**.
  ## **1. Be careful with “DB migration only if needed”**
  I would avoid giving permission for a migration unless absolutely unavoidable.
  Change this:
  Add DB migration only if needed to allow upsert.
  To this:
  ```text
  Do not add a migration unless the existing schema makes subject provisioning impossible.

  First use the existing `p5scr_subjects` structure.

  If the existing table cannot safely support the required subject upsert, stop and report the exact missing field or constraint before adding a migration.
  ```
  Reason: you are trying to avoid new schema risk right before client smoke testing.
  ## **2. Funder-ready UI path may be admin-side, not funder-side**
  This part may be slightly confused:
  Funder-ready (`/funder/p5-batch3/…`)
  A funder view usually **sees** readiness. It should not necessarily **grant** funder-ready status.
  I would change it to:
  ```text
  Funder-ready gate:
  - wire friendly blocker rendering wherever an admin/internal user attempts to grant or expose funder-ready status;
  - on funder-facing pages, show only the safe not-ready/readiness summary.
  ```
  Reason: funders should not be controlling readiness unless the platform already works that way.
  ## **3. Evidence approval path needs to be specific**
  “registry claim review admin/desk page” may be correct, but if there are several evidence approval paths, they may only wire one.
  Add:
  ```text
  Search for every existing evidence approval / accept / review-complete action that changes readiness or accepts evidence.

  Wire the IDV blocker notice on each user/admin screen that can trigger a controlled evidence approval.

  If any approval path is not wired, list it clearly in evidence with the reason.
  ```
  Reason: you do not want hidden approval paths left untested.
  ## **Final approval note to send**
  Use this:
  ```text
  Please proceed with Batch V-UI, subject to these three clarifications.

  1. Subject provisioning / schema

  Do not add a migration unless the existing schema makes subject provisioning impossible.

  First use the existing `p5scr_subjects` structure.

  If the existing table cannot safely support the required subject upsert, stop and report the exact missing field or constraint before adding a migration.

  2. Funder-ready wording

  Please distinguish between the internal/admin action that grants or exposes funder-ready status and the external funder view.

  Wire friendly blocker rendering wherever an admin/internal user attempts to grant or expose funder-ready status.

  On funder-facing pages, show only the safe not-ready/readiness summary.

  Do not give funders raw provider detail or readiness-control powers unless such powers already exist.

  3. Evidence approval coverage

  Search for every existing evidence approval / accept / review-complete action that changes readiness or accepts evidence.

  Wire the IDV blocker notice on each user/admin screen that can trigger a controlled evidence approval.

  If any approval path is not wired, list it clearly in the evidence README with the reason.

  Everything else in the Batch V-UI scope is approved.

  The goal remains:

  - make the client smoke test runnable by normal users and admins;
  - keep VerifyNow in sandbox;
  - do not add new providers;
  - do not change routing logic;
  - do not weaken Batch O / Batch V protections;
  - keep person IDV separate from company verification;
  - no raw provider/private data leakage;
  - final evidence marker should only be `BATCH_V_UI_CLIENT_SMOKE_TEST_READY` if the UI is actually runnable.
  ```