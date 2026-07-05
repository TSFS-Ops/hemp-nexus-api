# CLIENT_SMOKE_TEST_REMAINING_ITEMS.md

## Batch V-UI-Fix-3 — Admin Review Route, Smoke-Test Access, and Remaining Fixture Confirmation

This is a source-code review and repository-evidence pass only. No staging login, credential handling, live database query, or live provider log access was performed or attempted.

### Client test results received

- Test 1 (South Africa IDV route): PASS
- Test 2 (Nigeria IDV route): PASS
- Test 3 (Unsupported country / manual review): PASS
- Test 4 (WaD sealing blocked while IDV unresolved): PAUSED — no WaD-ready staging trade available
- Test 5 (Accept & Bind fixture): PAUSED — pending fixture confirmation
- Test 6 (Admin manual review releases the IDV blocker): FAILED — blank page at /desk/admin/idv/review
- Test 8 (Person IDV does not verify the company): PASS
- Test 9 (Funder-safe view): SKIPPED — no funder account / grant reference available
- Test 10 (API readiness returns ready=false while IDV unresolved): PENDING developer confirmation
- Test 11 (Old providers not called for new IDV checks): PENDING developer confirmation

### A. Confirmed from source

1. The canonical admin manual-review route is `/admin/idv/review`, registered in `src/App.tsx` as `<Route path="/admin/idv/review" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><IdvReviewQueue /></RequireAuth>} />`.
2. `/desk/admin/idv/review` was never registered as its own route. Because `<Route path="/desk/*" element={<Desk />} />` is declared immediately after the IDV routes, any unmatched path under `/desk/` (including `/desk/admin/idv/review`) falls into the `Desk` shell, whose internal `<Routes>` (in `src/pages/Desk.tsx`) has no matching child route either — this produces the blank page Daniel saw. This is the confirmed root cause of the Test 6 failure.
3. `RequireAuth` (`src/components/RequireAuth.tsx`) redirects unauthenticated users to `/auth?returnTo=...` and authenticated users lacking the required role to `/desk?denied=1`. The `/admin/idv/review` route already enforces `role="platform_admin"`, so non-admin users are safely blocked today.
4. The admin review case opens inline inside `IdvReviewQueue` (`src/pages/admin/idv/IdvReviewQueue.tsx`) — there is no separate `/admin/idv/review/:id` detail route. An admin selects a row and a case panel expands in place.
5. `IdvReviewQueue` queries `p5scr_subjects` joined against `p5scr_check_results`, filtered to `category="idv_person"` and a set of reviewable states. The manual-review-opener edge function, `idv-open-manual-review` (`supabase/functions/idv-open-manual-review/index.ts`), writes its record into the `p5scr_manual_reviews` table, not `p5scr_check_results`. This is a data-source mismatch: a case created by the Test 3 manual-review path may not surface in the admin queue's read query, because the queue reads check-result state rather than the manual-review table. This is flagged as a high-priority open finding requiring team review; it has NOT been fixed in this PR (see Section C).
6. `AcceptBindCard` (`src/components/match/AcceptBindCard.tsx`), mounted on `/desk/match/:matchId` via `src/pages/MatchDetails.tsx`, is the Test 5 surface. It shows "You've been invited to this intent" and an "Accept & Bind as Buyer/Seller" button, and mounts `IdvBlockerNotice`, parsing 409 responses from the `match` edge function's accept-bind action via `extractIdvBlockerFromError`. This UI path exists and is logically independent of Test 4 — it does not require a WaD-ready trade, only a pending match invitation.
7. `WadStepper` (`src/components/wad/WadStepper.tsx`), reached through `DealWizard` → `WadModule` on the deal wizard's Signed Deal step, contains the "Seal Signed Deal" button and mounts `IdvBlockerNotice`, parsing 409 blocker codes from the `wad/:id/seal` call via `consequence/index.ts`'s `sealWad()`. This confirms the Test 4 UI path exists in source; a WaD-ready staging trade fixture is still required to exercise it, and none currently exists per the client report.
8. `idv-verify` (`supabase/functions/idv-verify/index.ts`) is the pre-existing entity/company verifier (Companies House / CIPC / Onfido-oriented) and expects an `entity_id` in its request body. It is a separate code path from the new person-subject IDV flow, which identifies subjects by `subject_id` / `person_external_ref`. This is a second high-priority open finding: the new subject-based flow and `idv-verify`'s expected request shape do not align, and `idv-verify` was not modified in the original Batch V-UI work. This is flagged for team review; it has NOT been fixed in this PR (see Section C).
9. `FunderIdvSummary` (`src/components/idv/FunderIdvSummary.tsx`) is a read-only component intended for funder-facing surfaces. Confirming its exact mount point(s) and whether it always receives a live status value versus a hardcoded null requires a further pass keyed to the specific funder route(s) in use; not conclusively confirmed in this pass (see Section C).
10. Source review found no import of Dilisense, Sanctions.io, Sumsub, Didit, ComplyCube, Onfido, or Companies House code paths inside the new Batch V-UI person-IDV files (`IdvStart.tsx`, `idv-subject-provision`, `idv-open-manual-review`, `IdvReviewQueue.tsx`). The pre-existing `idv-verify` function does reference Companies House / Onfido, but that is the older entity-verification path described in item 8, not the new person-IDV flow.

### B. Fixed in source (this PR)

1. Added a new route, `/desk/admin/idv/review`, registered in `src/App.tsx` directly above the `/desk/*` wildcard route. It is wrapped in `RequireAuth role="platform_admin" fallbackRoute="/desk"` (identical guard to `/admin/idv/review` itself) and renders the existing `LegacyRedirect` component pointed at `/admin/idv/review`, with the label "Admin IDV Review".
2. This follows the exact pattern already used elsewhere in `src/App.tsx` for legacy `/admin/*` sub-routes redirecting into `/hq/*`: `RequireAuth` is evaluated first, so anonymous users are sent to `/auth?returnTo=...` and authenticated non-admins are sent to `/desk?denied=1` — they never reach the redirect logic. Only an authenticated `platform_admin` is forwarded to `/admin/idv/review`, and `LegacyRedirect` additionally shows a one-time dismissable banner explaining the URL changed.
3. This change does not alter `RequireAuth`, `IdvReviewQueue`, provider routing, VerifyNow logic, or any IDV gate. It only adds one route entry that reuses existing, already-reviewed components. No permissions were changed, no new provider was added, and no production data was touched.

### C. Requires manual staging verification

1. Whether `/desk/admin/idv/review` correctly redirects to `/admin/idv/review` in a running staging environment, and whether the `LegacyRedirect` banner displays as expected.
2. Whether Daniel's admin account actually has the `platform_admin` role assigned in the staging database (source review cannot confirm live role assignments).
3. Whether the Test 3 manual-review case actually appears in the `/admin/idv/review` queue in staging — this depends on runtime data and the `p5scr_manual_reviews` vs `p5scr_check_results` mismatch flagged in Section A item 5, which has NOT been fixed in this PR and needs team review before a fix is attempted.
4. Whether a WaD-ready staging trade or Accept-and-Bind fixture can be created safely for Tests 4 and 5 — this PR does not create or modify any staging data or fixtures.
5. Whether a funder account and grant reference can be made available for Test 9, and whether `FunderIdvSummary` receives a live status value at runtime rather than a hardcoded null (Section A item 9).
6. Test 10 (API readiness returns ready=false while IDV unresolved) — requires runtime/log confirmation against a live `registry-readiness-transition` call; not verifiable from source alone with certainty about current deployed behaviour.
7. Test 11 (old providers not called for new IDV checks) — source review found no such calls in the new person-IDV files (Section A item 10), but confirming no live provider call occurs at runtime requires log/runtime evidence this environment does not have access to.
8. The `idv-verify` entity_id/subject_id mismatch (Section A item 8) — requires a team decision on whether/how to reconcile the two flows; not addressed in this PR.

### Final recommendation

Once merged and deployed to staging, direct Daniel to the canonical admin route `/admin/idv/review` on the staging domain going forward. Any existing bookmark or resent link to `/desk/admin/idv/review` will redirect there instead of showing a blank page. Do not consider Test 6 fully resolved until the manual-review data-source mismatch (Section A item 5 / Section C item 3) is investigated by the team, since a fixed route does not by itself guarantee the Test 3 case is visible in the queue.

Tests were not run because this environment does not allow test execution.

**Verdict: SOURCE_REVIEW_COMPLETE_MANUAL_STAGING_VERIFICATION_REQUIRED**
