# Backend-to-UI Congruence Audit — Governance Record (Phase 1)

## Executive summary

Every Phase 1 Governance Record claim is **fully visible** in the UI under the correct role, with a corresponding source-level proof and a passing test. The single deferred-by-design surface is the **AAL2 step-up flow**, which is enforced by every sensitive backend endpoint but surfaced in the UI only as a toast — there is no dedicated stand-alone AAL2 modal in Phase 1, and the brief does not require one.

Nothing in the audit scope is "backend only", "UI only / mock-risk", or "data-state missing" when test data exists. Non-HQ access is correctly hidden by both the route guard (`RequireAuth role="platform_admin"`) and the deep-link component (`OpenGovernanceRecordLink` returns `null` for non-HQ).

Three deliverables are produced: this report, `docs/ui-visibility-matrix.md` (20-row traceability table), and `docs/ui-uat-script-governance-record.md` (41-step manual UAT to be executed by HQ in staging).

## Feature visibility matrix

See `docs/ui-visibility-matrix.md`. 20 rows, columns 1–11 per the brief.

## Fully visible features

All 20 rows in the matrix are **Fully visible** or, where the brief explicitly excludes UI work, **Correctly hidden**. Highlights:

- HQ-only Governance Records route at `/hq/governance-records` mounted via `HQ.tsx` tab `governance-records`, guarded by `RequireAuth role="platform_admin" fallbackRoute="/desk"` (`src/App.tsx:218-219`).
- Merged timeline reading all four canonical sources (`audit_logs`, `admin_audit_logs`, `event_store`, `match_events`) via `useGovernanceEvents` with a 500-row per-source cap and a visible `row-cap-warning` when hit.
- Top summary card with 13 fields, deterministic non-AI full-story paragraph, Demo/Test/Live pill, current risk flag, verification posture.
- Event drawer with redacted metadata (`redactMetadata` strips all `password`, `secret`, `*_token`, `*_payload`, document URLs, ID numbers, private keys, service-role tokens, plus a regex sweep for `token|secret|password|payload`).
- Manual HQ notes and append-only corrections via `hq-note-add` edge function, with controlled reason codes (`HQ_NOTE_REASON_CODES`) and minimum-length guards.
- Corrected-event badge with tooltip that explicitly states "Original event is preserved unedited."
- Waivers/bypasses visible and grantable via `GovernanceWaiversPanel` with AAL2 enforced server-side.
- Deep-link entry points from `MatchDetails`, `AdminPendingEngagementsPanel`, `AdminVerificationQueuePanel`.

## Backend-only features

**None** in audit scope. Earlier P-4 closeout claims about 18/18 atomic admin RPCs are surfaced in the timeline as `HQ decision` category rows with the controlled `HQ_DECISION_COPY` paragraph rendered inline (`GovernanceRecordDetail.tsx:841-848`).

## UI-only or mock-risk features

**None.** Every panel reads real Supabase queries; no mock data is wired into production code paths. The "Memory record" summary field intentionally renders the literal string "Not wired in this build" with an HQ tooltip — this is a **correctly labelled absence**, not a UI-only mock.

## Role/access issues

**None blocking.** Two observations worth flagging:

1. The global `AppSidebar` does not link directly to `/hq/governance-records`. Entry is exclusively via the HQ tab strip and via the per-record deep links. This is consistent with the Phase 1 contract ("HQ-only view") and is not a defect.
2. `AAL2 step-up` UI is **toast-only**. If a `platform_admin` user attempts a sensitive mutation (waiver grant, manual override) on an AAL1 session, the failure surfaces as a toast — there is no dedicated step-up modal in Phase 1. The prebuild guard `scripts/check-admin-aal2-coverage.mjs` proves the backend coverage is complete (18/18). Whether to add a step-up modal is a Phase-2 product decision, not a current bug.

## Data-state issues

**None.** All five categories required by the brief (normal, blocked, demo/test, corrected, manual HQ note, waiver granted/expired, POI event, admin decision event, empty state) map cleanly to existing source rows. The UAT script in `docs/ui-uat-script-governance-record.md` lists exactly which test records must exist before the run.

## Navigation issues

**None.** Verified callsites of `OpenGovernanceRecordLink`:

- `src/pages/MatchDetails.tsx:344` (matchId)
- `src/components/admin/AdminPendingEngagementsPanel.tsx:1912`
- `src/components/admin/AdminVerificationQueuePanel.tsx:479`

All build hrefs of the form `/hq/governance-records?<anchor>=<uuid>` (`OpenGovernanceRecordLink.tsx:27-37`). The Phase 1 route is registered as `/hq/:tab` so the deep links arrive at `HQ.tsx` with tab `governance-records`, which then reads `?match=…` from `useSearchParams`.

## Wording/copy issues

No banned terms found in Governance Record UI. Specifically verified:

- No "AI Memory", "Trust Score", "Reputation Engine", "Predictive Risk", "Legally binding", or "Fully automated compliance" anywhere in the surface.
- "Memory record" field uses the conservative copy "Not wired in this build" (constant `MEMORY_NOT_WIRED_COPY`).
- `HQ_DECISION_COPY` is the controlled paragraph rendered inline for every HQ decision row.
- `HQ_CORRECTED_BADGE_COPY` is the controlled label on the corrected badge tooltip.
- WaD is referenced only as "WaD" — no expansion to "Warrant of Diligence" anywhere in the Governance Record components (consistent with the project memory rule that WaD must always mean "Without a Doubt").

## Screenshots / proof receipts

Browser automation against an authenticated `platform_admin` session is not available to this audit agent (no HQ credentials in the sandbox; the preview is an unauthenticated public landing page). The visible-proof receipts therefore rely on:

1. **Source-level traceability** — every row in the matrix cites a file:line for the rendered component, the test-id it carries, and the test file that exercises it.
2. **Existing test suite** — the following pre-existing tests already render and assert the Governance Record UI in jsdom:
   - `src/tests/governance-record-route-guard.test.tsx` (HQ-only route guard, 4 cases)
   - `src/tests/governance-record-phase1-fixes.test.tsx` (deep-link href shapes, HQ-only visibility)
   - `src/tests/governance-record-phase2-ui.test.tsx`
   - `src/tests/governance-record-detail.test.tsx`
   - `src/tests/governance-record-batch-b-ui.test.tsx`
   - `src/tests/governance-record-alignment-patch.test.ts`
   - `src/tests/governance-record-logic.test.ts`
   - `src/tests/governance-record-batch-b.test.ts`, `batch-c.test.ts`, `batch-d.test.ts`
   The most recent full regression (per the previous closeout step) is **1067/1067 passing**.
3. **Manual UAT** — `docs/ui-uat-script-governance-record.md` is a 41-step receipt pack that HQ executes in staging. Screenshots from steps 7, 18, 21, 22, 25-27, 31, 40, 41 should be attached to the run.

## Manual UAT script

See `docs/ui-uat-script-governance-record.md`. 41 numbered steps covering route + nav, list, top summary, HQ notes, corrections, blocked/demo/manual-review filters, drawer + redaction check, waivers, per-source cap warning, empty + error states, deep links from related screens, and non-HQ negative proof.

## Do-not-claim list

Pending HQ-executed UAT in staging, **do not** claim:

- That a particular `platform_admin` user has been observed completing the full UAT pack end-to-end. (Audit is source-level + jsdom tests only.)
- That a dedicated **AAL2 step-up modal** exists. It does not — Phase 1 surfaces MFA failures via toast. Backend AAL2 coverage is proven (18/18) but UI step-up is Phase 2.
- That **counterparty-facing** Governance Record exists. It does not — explicitly out of scope.
- That **PDF / SIEM / external export** exists. None exist — explicitly out of scope.
- That **reason-code hard-BLOCK enforcement** is wired through the UI. It is not — reason codes are displayed only.
- That **waivers enforce progression gates from the UI**. They do not — enforcement is backend hooks; UI is visibility + grant only.
- That **payment webhook atomicity** has any UI surface. It does not — payment events are visible in the timeline but webhooks are sequential by design (already documented in `docs/governance-rollback-proof.md`).
- That **Basic Memory Record** is wired. It is not — field intentionally labelled "Not wired in this build".

## Smallest next fixes

None required by this audit. The Governance Record UI is congruent with the backend claims. The only **optional** next item, **outside this audit's scope**, would be to add a dedicated AAL2 step-up modal (currently toast-only) — but that is a Phase 2 design decision and not a defect.
