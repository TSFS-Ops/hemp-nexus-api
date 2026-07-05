# Batch V-UI-Fix-2 — Client Smoke Test Failure Fix

## Client-reported blockers

1. **Test 2 (Nigeria)** — `/desk/idv/start` submission returned the generic toast "Could not start identity verification. Please try again." after selecting Nigeria + a document type and submitting.
2. **Test 3 (Ghana / manual review)** — Same generic toast despite the page correctly showing "Manual review required" + "Provider not available for this selection. Submitting will open a manual review case."
3. **Test 4 (WaD sealing)** — Tester's only working accounts (`trade@`, `test2@`) have no trade far enough for the Seal Signed Deal button to appear, so the IDV blocker on WaD sealing cannot be triggered via the UI.

## Root causes (from codebase scan)

### A. CORS headers were passed as a function, not the object
`supabase/functions/idv-subject-provision/index.ts`, `idv-manual-review/index.ts` and `idv-resubmit/index.ts` did:

```ts
import { corsHeaders } from "../_shared/cors.ts";
return new Response("ok", { headers: corsHeaders });        // ← function ref
headers: { ...corsHeaders, "Content-Type": "application/json" }  // spread of a function
```

`corsHeaders` is actually a **factory** — `corsHeaders(allowedOrigins, origin)`. Passing the function itself produced a Response with no `Access-Control-Allow-Origin` header. Browsers on `izenzo.co.za` therefore blocked the response, `supabase.functions.invoke` surfaced this as `provisionErr`, and the UI fell into the generic-toast branch. This was the actual reason both Nigeria and Ghana submissions failed.

### B. `p5scr_subjects.party_role` CHECK constraint rejected the value the UI inserted
The provision function inserted `party_role: 'authorised_representative'`, but the CHECK on `p5scr_subjects_party_role_check` only allowed `buyer_authorised_representative`, `seller_authorised_representative`, etc. Even after fixing (A), the insert would have failed with a constraint violation.

### C. UI called an admin-only function on the user's behalf
For the provider-not-available branch, `IdvStart` invoked `idv-manual-review` — which requires `platform_admin` — so any non-admin caller would get a `403` even after (A) and (B) were fixed.

## Fixes shipped

1. **Rewrote CORS handling** in the three functions above so each response computes `corsHeaders(ALLOWED_ORIGINS, request_origin)` per-request and includes the correct `Access-Control-Allow-Origin` echo.
2. **Widened the CHECK constraint** on `public.p5scr_subjects` via migration `batch_v_ui_fix2_party_role` to allow the neutral `'authorised_representative'` value used by the person-only IDV start screen.
3. **Created a new user-callable edge function** `idv-open-manual-review` (JWT-verified) that lets an authenticated user open (but not decide) a manual review case for a subject they own. Decision recording remains restricted to `platform_admin` via the unchanged `idv-manual-review`.
4. **Updated `src/pages/desk/idv/IdvStart.tsx`** to:
   - call `idv-open-manual-review` (not the admin function) for provider-not-available submissions;
   - map generic verify errors to a safe `manual_review_required` outcome plus a "Manual review required" toast instead of the old generic failure;
   - keep all safe wording routed through `idvSafeLabel(...)` (no banned wording introduced).
5. **Deployed** `idv-subject-provision`, `idv-manual-review`, `idv-resubmit`, `idv-open-manual-review`.

## What is now client-runnable

| # | Test | Route | Expected result |
|---|------|-------|-----------------|
| 1 | South Africa route (as before) | `/desk/idv/start` → South Africa | Safe outcome label from `idvSafeLabel` |
| 2 | Nigeria route | `/desk/idv/start` → Nigeria | Safe outcome — either provider-pending or **Manual review required** fallback. No generic failure toast. |
| 3 | Unsupported country → manual review | `/desk/idv/start` → Ghana (or any `(manual review)` country) | "Manual review has been opened" toast, `Provider not available` outcome card, case visible in `/admin/idv/review`. |
| 6 | Admin manual review accepts case | `/admin/idv/review` (platform_admin) | Case created in step 3 appears, admin can save a decision. |
| 8 | Person-only wording | `/desk/idv/start` | "This is a person-only check…" copy present. |
| 9 | Funder-safe view | `/funder/p5-batch7/funder-dashboard`, `/funder/p5-batch3/readiness/:grantId` | `FunderIdvSummary` renders safe placeholder; no private IDV data. |

## Still developer-confirmed only

- **Test 4 — WaD sealing IDV blocker via UI.** No staging fixture currently exists with `trade@` / `test2@` that has a trade past POI at the Seal Signed Deal step. Wiring itself is in `WadStepper.tsx` (`sealWad` → `extractIdvBlockerFromError` → `<IdvBlockerNotice />`), verified by `src/tests/batch-v-ui-fix-idv-mount.test.ts`. Marking this as developer-confirmed only until a fixture trade is staged.
- **Test 5 — Accept & Bind IDV blocker via UI.** Same reason: no cross-org invited trade fixture available for the working accounts. Wiring lives in `AcceptBindCard.tsx`.
- **Tests 7 (finality), funder-ready grant, API ready-flag, evidence approval, transaction approval.** Backend gates confirmed by prior Batch V/V-Wire tests; no direct client-triggerable button in the current UI.

## Safety proofs

- VerifyNow **not called** on any path touched here — the manual-review path never invokes `idv-verify`, and the fallback verify branch also opens a manual review instead of retrying with fake data.
- No provider secret referenced in `src/**` (existing boundary test `src/tests/batch-v-ui-client-boundary.test.ts` still passes).
- No production data mutated by this change (schema-only constraint widening + new function).
- No banned wording introduced (all user-facing strings routed via `idvSafeLabel` or explicit safe copy).

## Final verdict

`CLIENT_SMOKE_TEST_READY_AFTER_FAILURE_FIX` — for Tests 1, 2, 3, 6, 8, 9. Tests 4 and 5 remain developer-confirmed only until a staging trade fixture is provided for the tester's working accounts.
