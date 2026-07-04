# Pre-flight embarrassment check — VerifyNow IDV client smoke test

- Date/time: 2026-07-04 (Sat)
- Environment: preview/staging (VERIFYNOW_MODE=sandbox)
- Final marker: `BATCH_V_UI_CLIENT_SMOKE_TEST_READY`

## 1. Route/page availability

- `/desk/idv/start` — registered in `src/App.tsx` line 302 as
  `<Route path="/desk/idv/start" element={<RequireAuth><IdvStart /></RequireAuth>} />`.
  Reachable by any authenticated user; no admin role required.
- `/admin/idv/review` — registered in `src/App.tsx` line 303 as
  `<Route path="/admin/idv/review" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><IdvReviewQueue /></RequireAuth>} />`.
  Platform-admin-only; normal user / funder is redirected to `/desk`.
- Both pages lazy-import cleanly (`src/App.tsx` lines 76–77). No 404, no
  broken import, no loading loop observed in the running preview.
- No dashboard nav tile is wired to `/desk/idv/start` — clients must use
  the direct URL supplied in the smoke test. This is called out in the
  final verdict.

## 2. User IDV start screen (`src/pages/desk/idv/IdvStart.tsx`)

- Country selector labelled "Select the country that issued your ID document".
- Document-type selector, details textarea, consent checkbox, submit
  button labelled "Submit identity check".
- Routes strictly by `document_country` + `document_type` via
  `resolveIdvRoute`. Nationality / residence / company country /
  transaction country are NOT captured. Enforced by
  `src/tests/batch-v-idv-routing.test.ts` (19 tests).
- South Africa live routes: 3 (`za_said_basic`, `za_smart_id`, `za_passport`).
- Nigeria live routes: 3 (`ng_nin`, `ng_virtual_nin`, `ng_nin_slip`).
- Placeholder countries (GH, KE, UG, ZM, CI) and "Other" route to
  `provider_not_available` → open manual review case.
- Missing / invalid details → safe `toast.error(...)` copy, no crash.

## 3. Subject provisioning and no-subject gate

- `idv-subject-provision` idempotently ensures a `p5scr_subjects` row
  keyed by `person_external_ref = auth.uid()`.
- `supabase/functions/_shared/idv-actor-gate.ts` fails closed when no
  subject exists: throws `IdvGateError` with state `no_subject` and
  blocker code `IDV_REQUIRED`. Wording: "Identity verification required
  before this action."
- Verified by `src/tests/batch-v-ui-no-subject-fail-closed.test.ts` and
  `src/tests/batch-v-wire-controlled-action-gates.test.ts`.

## 4. VerifyNow safety

- `rg -n "verifynow|VERIFYNOW" src/` returns matches only in the
  boundary test files (assertions that the secret name is NOT present).
  No runtime `src/**` file references `VERIFYNOW_API_KEY` or the
  adapter. Enforced by `batch-v-verifynow-client-boundary.test.ts` and
  `batch-v-ui-client-boundary.test.ts`.
- Adapter lives in `supabase/functions/_shared/verifynow/adapter.ts`
  (server-side only).
- `VERIFYNOW_MODE=sandbox` — no live provider call during tests.
- Misconfigured / missing provider → fail-closed
  `PROVIDER_MISCONFIGURED` path in `idv-verify` (allow-list + audit
  logs + optional admin_risk_items).
- No ID photo, selfie, biometric, raw provider payload, full ID number,
  raw mismatch detail, or private review note leaks to
  user/funder/API/Memory surfaces (guarded by
  `batch-v-person-only.test.ts` and `batch-v-wording.test.ts`).

## 5. User-safe wording

- `rg` for banned wording across `src/components/idv/`,
  `src/pages/desk/idv/`, `src/pages/admin/idv/` returns matches ONLY
  inside `idv-status-labels.ts` `IDV_BANNED_WORDING` (the guard list
  itself and its documentation comment). No user-facing surface renders
  banned wording.
- Safe labels come from the SSOT in `idv-status-labels.ts`:
  Identity verification required / pending / completed, Manual review
  required, Provider pending, Provider not available, Retry required,
  Alternative document required, Identity review completed.
- Enforced by `batch-v-ui-wording-guard.test.ts` (7 tests) and
  `batch-v-wording.test.ts` (11 tests).

## 6. Controlled-action blocker UI

- `IdvBlockerNotice` renders the friendly wording from
  `controlled-action-gate.ts` on 409 with any `IDV_*` blocker code.
- Wired via `assertActorIdvGate` in edge functions for:
  WaD sealing, finality, funder-ready release, POI binding,
  evidence approval, transaction approval, registry claim review,
  registry readiness transition. Verified by
  `batch-v-wire-per-path-consumption.test.ts` (9 tests) and
  `batch-v-wire-controlled-action-gates.test.ts` (35 tests).
- Non-binding POI preparation and non-binding evidence upload remain
  allowed (only the controlled binding/approval steps are gated).
- `manual_review_required`, `provider_pending`, `provider_not_available`
  do NOT release gates. Only `manual_review_accepted` /
  `idv_completed` release IDV — other non-IDV requirements may still
  block downstream.

## 7. Admin manual-review UI

- `/admin/idv/review` lists `manual_review_required`,
  `blocked_pending_admin_decision`, `provider_error/pending/not_available`
  cases via `IdvReviewQueue.tsx`.
- Case detail (`IdvReviewCase.tsx`) shows person, document country,
  document type, provider state (safe label), reason for review,
  admin note field, decision dropdown.
- Decisions supported: `manual_review_accepted`,
  `manual_review_rejected`, `more_information_required`,
  `alternative_document_required`, `provider_retry_required`,
  `blocked_pending_admin_decision` (waiver decisions gated by
  existing policy).
- Save calls `idv-manual-review` edge function.
- Post-accept, user-facing status becomes "Identity review completed".
- Admin UI copy is explicit that the review is person-only and does
  not verify the company. Verified by
  `batch-v-ui-admin-and-funder.test.ts`.

## 8. Person-only protection

- `p5scr_subjects.party_role` scopes review to the representative
  only. No branch in `idv-verify` or `idv-manual-review` writes
  `entities.status = "verified"` for the company on the strength of
  representative IDV.
- Company profile / readiness pages render "Representative identity
  review completed — Company readiness still depends on other
  requirements" (`FunderIdvSummary.tsx`, verified by
  `batch-v-person-only.test.ts`, 12 tests).

## 9. Funder-safe view

- `FunderIdvSummary.tsx` shows only safe status labels via
  `idv-status-labels.ts`.
- No full ID number, ID photo, selfie, raw provider payload, provider
  ref, private review note, or biometric surfaces on funder route.
- Funder-ready is not projected true while IDV is unresolved (gate at
  `p5-batch3-funder-summary` edge function).

## 10. API ready=true

- `p5-batch3-funder-summary` and `p5-batch4-execution-summary` return
  `ready=false` when `assertActorIdvGate` throws. Safe fields only:
  `idv_status`, `idv_required_action`, `blocker_code`, `blocker_label`.
- No raw provider or private data in API responses. Enforced by
  `batch-v-wire-per-path-consumption.test.ts`.

## 11. Old provider non-use

- New IDV path uses `verifynow` only (route table +
  `ACTIVE_IDV_PROVIDERS = ["verifynow"]` frozen in
  `src/lib/idv/provider-registry.ts`).
- Legacy Onfido / Companies House / CIPC branches in
  `supabase/functions/idv-verify/index.ts` are gated by the strict
  provider allow-list and audit log; they are unreachable from the
  new Batch V route table. Verified by `batch-v-wording.test.ts` and
  `batch-v-idv-routing.test.ts`.
- Historical provider records untouched.

## 12. Client smoke-test alignment

| # | Test | Client-runnable |
|---|---|---|
| 1 | South Africa route | runnable at `/desk/idv/start` |
| 2 | Nigeria route | runnable at `/desk/idv/start` |
| 3 | Unsupported country/manual review | runnable at `/desk/idv/start` |
| 4 | WaD seal blocker | runnable via existing WaD flow |
| 5 | Finality blocker | runnable via existing finality flow |
| 6 | Funder-ready blocker | runnable via admin readiness area |
| 7 | API ready=true | **developer-confirmed only** |
| 8 | Binding POI blocker | runnable via POI flow |
| 9 | Evidence upload allowed, approval blocked | runnable |
| 10 | Transaction approval blocker | runnable |
| 11 | Manual review release | runnable at `/admin/idv/review` |
| 12 | Controlled action after manual review | runnable |
| 13 | Person-only company protection | runnable |
| 14 | Funder-safe view | runnable (requires funder account) |
| 15 | Old-provider non-use | **developer-confirmed only** |

## 13. Backend/frontend consistency

- Route table (`src/lib/idv/route-table.ts`) is the SSOT for both the
  UI selector and the server-side dispatcher — no drift.
- Result mapping (`src/lib/idv/result-mapping.ts` +
  `supabase/functions/_shared/verifynow/result-mapping.ts`) share the
  same status keys; both feed `idv-status-labels.ts` on the client.
- Manual-review decision statuses in `IdvReviewCase.tsx` match those
  accepted by `idv-manual-review` edge function.
- Gate blocker codes emitted by `assertActorIdvGate` match the copy
  keys used by `IdvBlockerNotice`.
- Funder-safe projection in edge function matches
  `FunderIdvSummary.tsx` rendering.

## 14. Commands run

- `bunx vitest run src/tests/batch-v-` — **16 files, 191 tests, all
  passing** (Batch V, V-Wire, V-UI, wording, client-boundary, no-subject
  fail-closed, result-mapping, final reconciliation).
- `rg` scans:
  - VerifyNow secret in `src/**` → none (test-file assertions only).
  - Banned wording in IDV UI folders → none outside the guard list itself.
  - Old provider names in new IDV files → none reachable from new path.

## 15. Residual risks

- No in-app nav tile links to `/desk/idv/start` from the desk dashboard.
  The smoke test provides the direct URL, so this is a UX gap, not a
  smoke-test blocker.
- Dashboard/nav discovery is not required to run any of the 15 tests.

## Final recommendation

`SAFE_TO_SEND_CLIENT_SMOKE_TEST`

- Exact URLs:
  - User IDV start: `/desk/idv/start`
  - Admin manual review: `/admin/idv/review`
- Accounts required: normal business user, platform admin, funder user
  (for Test 14 only; skip if unavailable).
- Sandbox confirmed: `VERIFYNOW_MODE=sandbox`, secrets server-side only,
  no live provider call during any test.
- Developer-confirmed items: Test 7 (API `ready=true` blocker) and
  Test 15 (old-provider non-use).
