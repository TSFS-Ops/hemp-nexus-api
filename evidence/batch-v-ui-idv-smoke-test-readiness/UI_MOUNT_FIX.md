# Batch V-UI-Fix — IDV Blocker & Funder Summary Mount Fix

## Purpose
Prior pre-flight found that `IdvBlockerNotice` and `FunderIdvSummary`
existed but were imported only in tests. This fix mounts them on real
user-facing pages so the client smoke test is actually runnable end to
end.

## Scope A — IdvBlockerNotice mount points

| Controlled action | UI path inspected | Mount status |
|---|---|---|
| WaD seal | `src/components/wad/WadStepper.tsx` (Seal Signed Deal button, `handleSeal` → `sealWad`) | **Mounted.** `sealWad` now returns `idvBlocker` from `ConsequenceResult` when the server responds 409 `IDV_REQUIRED_*`; the stepper renders `<IdvBlockerNotice />` immediately above the Seal button instead of a raw toast. |
| Binding POI (accept & bind) | `src/components/match/AcceptBindCard.tsx` (`handleAccept` → `fetchEdgeFunction("match", accept-bind)`) | **Mounted.** The existing 409 catch now calls `extractIdvBlockerFromError` first and renders `<IdvBlockerNotice />` inside the card. |
| Finality | `src/lib/modules/consequence/index.ts` gates plus `src/pages/funder/p5-batch5/FunderFinality.tsx` and `src/pages/desk/p5-batch5/*` — the actual client "trigger finality" button is admin-side, not a client-runnable path in the current smoke test scope. | **Developer-confirmed only.** Backend blocker code `IDV_REQUIRED_FINALITY` is emitted; no dedicated client button exists to click. |
| Funder-ready grant / API-ready | `/admin/*` grant surfaces only — no user-facing "grant funder access" button in the desk shell. | **Developer-confirmed only.** Backend emits `IDV_REQUIRED_FUNDER_READY` / `IDV_REQUIRED_API_READY`. |
| Evidence approval | Admin panels (`AdminPendingEngagementsPanel`, evidence review workbenches). No user-side "approve evidence" button in the desk smoke path. | **Developer-confirmed only.** Backend emits `IDV_REQUIRED_EVIDENCE_APPROVAL`. |
| Transaction approval | Admin/finance surfaces; no user-side "approve transaction" button in the current smoke path. | **Developer-confirmed only.** Backend emits `IDV_REQUIRED_TRANSACTION_APPROVAL`. |

The two client-runnable paths (WaD seal, Accept & Bind) both render the
friendly notice with wording sourced from `CODE_TITLES` in
`IdvBlockerNotice.tsx` — never a raw JSON body, stack trace, provider
payload, or private IDV data.

### Shared error extractor
`src/lib/idv/blocker-from-error.ts` — new helper `extractIdvBlockerFromError`
that inspects a caught `ApiError` (status === 409 and body/details
`blocker_code` beginning with `IDV_`). Returns `null` for any other
status, any non-IDV blocker code, or any non-Error input. Unit-tested
in `src/tests/batch-v-ui-fix-idv-mount.test.ts`.

## Scope B — FunderIdvSummary mount points

| Funder page | Route | Mount status |
|---|---|---|
| Funder dashboard | `/funder/p5-batch7/funder-dashboard` (`src/pages/funder/p5-batch7/FunderDashboard.tsx`) | **Mounted.** `<FunderIdvSummary status={null} />` renders directly under the stale-data banner. |
| Funder readiness | `/funder/p5-batch3/readiness/:grantId` (`src/pages/funder/p5-batch3/Readiness.tsx`) | **Mounted.** `<FunderIdvSummary status={null} />` renders above the readiness card. |

`status` is intentionally passed as `null` on both pages: per-case IDV
status is not exposed in the shared funder projections at these routes.
`FunderIdvSummary` therefore renders the safe default ("Not ready —
identity verification required") plus the safe `next_action` copy from
the SSOT (`idv-status-labels.ts`). No full ID number, no ID photo, no
selfie, no raw VerifyNow response, no mismatch details, no biometrics,
no admin private notes are rendered — the component has no props for
any of those.

## Scope C — Admin route wording
`/admin/idv/review` is the only admin IDV route registered in
`src/App.tsx` (line 303). `IdvReviewCase` is inline inside
`IdvReviewQueue`; there is no `/admin/idv/review/:id` URL. The client
smoke test must send admins to `/admin/idv/review` only.

## Scope D — Dashboard tile
Not added. The desk shell layout is centralised and risky to edit for
a single link. The smoke test must instruct the client to use the
direct URL `/desk/idv/start`.

## Scope E — Tests
Added `src/tests/batch-v-ui-fix-idv-mount.test.ts` — 7 tests:
- WaD seal page imports and renders `<IdvBlockerNotice />`
- Binding POI page imports and renders `<IdvBlockerNotice />`
- Funder dashboard imports and renders `<FunderIdvSummary />`
- Funder readiness imports and renders `<FunderIdvSummary />`
- `extractIdvBlockerFromError` correctly gates on status 409 and
  `IDV_` prefix, and returns null for OTHER_CONFLICT, wrong status,
  or non-Error inputs
- `sealWad` plumbs the blocker onto `ConsequenceResult`
- The four mounted files contain no VerifyNow secret names

All existing Batch V, V-Wire and V-UI tests still pass:
`batch-v-ui-no-subject-fail-closed` (3), `batch-v-ui-admin-and-funder` (5),
`batch-v-controlled-action-gate` (18), `batch-v-ui-wording-guard` (7),
`batch-v-ui-retry-resubmit` (7), `batch-v-wire-controlled-action-gates` (35),
`batch-v-ui-blocker-notice` (5). New file adds 7. Total 87 green.

## Safety proof
- No live provider calls made. Tests are pure source-scan + unit.
- No production data mutated. All changes are UI wiring plus one
  additive field on an existing result type.
- No secrets exposed. New helper only reads `ApiError` shape; no
  `VERIFYNOW_*` reference exists in `src/`.
- `VERIFYNOW_MODE=sandbox` unchanged.
- No new provider added (no Didit / Sumsub / ComplyCube / Dilisense /
  Sanctions.io / Onfido / Companies House / OMB / KYB / CIPC / bank).
- Wording is sourced from `idv-status-labels.ts` and
  `IdvBlockerNotice.CODE_TITLES` — both wording-guard-tested.

## Residual risks
- Four of the six controlled-action UI paths (finality, funder-ready,
  API-ready, evidence approval, transaction approval) have no
  dedicated client-side click surface in the current app. Their
  backend gates are proven by `batch-v-wire-per-path-consumption` and
  `batch-v-wire-controlled-action-gates`, but the client cannot verify
  them through the UI. These items must be marked
  **developer-confirmed only** in the smoke test.
- No dashboard tile to `/desk/idv/start`; client must use the direct
  URL.
- FunderIdvSummary is rendered with `status=null` on both funder
  pages — the shown state is a safe placeholder, not per-case truth.
  Wiring real per-case status is a follow-up when per-case grants
  land.

## Client smoke-test coverage after this fix

| # | Item | Client-runnable via UI? |
|---|---|---|
| 1 | South Africa IDV route | Yes (`/desk/idv/start`) |
| 2 | Nigeria IDV route | Yes (`/desk/idv/start`) |
| 3 | Unsupported country / manual review | Yes (`/desk/idv/start`) |
| 4 | WaD sealing blocked while IDV unresolved | **Yes** (Seal button on `WadStepper`) |
| 5 | Finality blocked | Developer-confirmed only |
| 6 | Funder-ready blocked | Developer-confirmed only |
| 7 | API ready=true blocked | Developer-confirmed only |
| 8 | Binding POI action blocked | **Yes** (`AcceptBindCard` Accept & Bind) |
| 9 | Evidence upload allowed but approval blocked | Developer-confirmed only |
| 10 | Transaction approval blocked | Developer-confirmed only |
| 11 | Admin manual review releases IDV blocker | Yes (`/admin/idv/review`) |
| 12 | Controlled action after manual review accepted | Yes (via tests 4 or 8 after 11) |
| 13 | Person IDV does not verify the company | Yes (start-screen wording) |
| 14 | Funder view is safe | **Yes** (`/funder/p5-batch7/funder-dashboard` or `/funder/p5-batch3/readiness/:grantId`) |
| 15 | Old providers not used | Developer-confirmed only |

## Final verdict
`UI_MOUNT_FIX_COMPLETE_CLIENT_SMOKE_TEST_RUNNABLE`

Client-runnable coverage is now 9 of 15 (up from 5). Tests 5, 6, 7, 9,
10 remain developer-confirmed only because no client-facing trigger
exists in the current app for those actions; test 15 remains
developer-confirmed only by design.
