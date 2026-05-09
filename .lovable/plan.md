# Phase 3C — Admin Challenge Queue & Outcome Controls (Plan)

## 1. Scope

Phase 3C is **platform-admin-only UI** that consumes the server endpoints already shipped in Batch C Phase 2. **No new server gates, no new RPCs, no new schema, no fixtures, no client guide, no rating emission, no legacy `disputes` changes.**

In-scope surfaces:

1. **Admin Challenge Queue page** at `/hq/challenges` — list of all challenges, filterable by status.
2. **Admin Challenge Detail drawer** — read-only context (match, parties, summary, comment thread, evidence list).
3. **Review controls** — `transition open → under_review`.
4. **Outcome recording controls** — `transition under_review → outcome_recorded` (with required `outcome_code` + ≥40-char `outcome_summary`) and `transition → closed_no_action` (with ≥40-char summary).
5. **Break-Glass closure control** — `POST /match-challenges/break-glass` with ≥60-char reason; closes as `outcome_recorded` + `outcome_code=admin_override_recorded`.

Out-of-scope (explicit):

- Any new server endpoint, RPC, migration, or RLS change.
- Comment-write UI (Phase 3D candidate).
- Evidence upload UI (Phase 3D candidate).
- Notification UI surfaces.
- Rating emission.
- Touching Phase 3A/3B files except `App.tsx` route registration.

## 2. Server contract reused (verified, no changes)


| Endpoint                             | Purpose                                        | Validation already enforced server-side                                                                                  |
| ------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `POST /match-challenges/transition`  | All status moves                               | platform_admin required for `under_review`/`outcome_recorded`/`closed_no_action`; outcome_summary ≥40; outcome_code enum |
| `POST /match-challenges/break-glass` | Force-close active challenge as admin override | platform_admin only; reason ≥60 chars                                                                                    |
| `match_challenges` table (RLS)       | Read                                           | platform_admin sees all rows via `is_admin()`                                                                            |


## 3. Files to add

```
src/pages/hq/HqChallenges.tsx                       — queue page (route: /hq/challenges)
src/components/hq/challenges/ChallengeQueueTable.tsx — list + status filter
src/components/hq/challenges/ChallengeReviewDrawer.tsx — detail + action panel
src/components/hq/challenges/RecordOutcomeDialog.tsx  — outcome_code + summary form
src/components/hq/challenges/BreakGlassDialog.tsx     — ≥60-char reason confirmation
src/hooks/useAdminChallengeQueue.ts                   — list query (RLS-trusted)
src/hooks/useAdminChallengeMutations.ts               — transition + break-glass wrappers
```

## 4. Files edited (minimal)

- `src/App.tsx` — register `/hq/challenges` route behind existing platform_admin guard.
- `src/components/admin/HqSidebar.tsx` (or equivalent existing HQ nav) — add "Challenges" link.

Phase 3A/3B files are NOT touched. `useChallengePermissions`, `useMatchChallenge`, `RaiseChallengeDialog`, `ChallengeStatusCard`, `ProgressionPausedBanner`, `MatchChallengePanel`, and `MatchDetails.tsx` remain untouched.

## 5. Behaviour

### Queue page

- Default view: status filter chips (All / Open / Under review / Terminal). Default = Open.
- Columns: Raised at, Match ID (link to match), Subject, Raised by role, Status, Age.
- Newest first. Server-side ordering, page size 50, "Load more" pagination.
- Empty state: "No challenges in this view."

### Review drawer (right-side Sheet)

- Header: status badge, challenge ID short, raised at, raised by role.
- Body sections: Subject, Summary (full text), Match link, Outcome (if terminal).
- Action footer (mutually exclusive based on current status):
  - `open` → **Move to Under Review** button.
  - `open` or `under_review` → **Record Outcome** + **Close — No Action** + **Break-Glass Override**.
  - terminal → no actions; read-only.

### Record Outcome dialog

- Required fields: `outcome_code` (select), `outcome_summary` (textarea, 40–8000 chars, live counter).
- Submits `transition` with `to_status=outcome_recorded`. On 200: invalidate `["admin-challenges"]` + `["match-challenges", matchId]`, close drawer, toast success.

### Close — No Action dialog

- Required: `outcome_summary` ≥40. Submits `transition` with `to_status=closed_no_action`.

### Break-Glass dialog

- Required: `reason` ≥60 chars.
- **Two-step confirmation**: first screen explains override is audited and immediately closes the challenge; second screen accepts the reason.
- Submits `break-glass`. On 200: same invalidation as outcome.
- All three dialogs follow Modal Dismissal Standard (Close × + Cancel) and Zero Swallowed Errors (try/catch/finally + toast).

## 6. Visibility rules

- Route guarded by existing `RequireAuth` + platform_admin check (mirrors other `/hq/*` pages).
- Non-platform-admin reaching the URL directly: redirect (existing pattern) — no 3C-specific gate code.
- All action buttons additionally guard on `isPlatformAdmin` from `useAuth()` as belt-and-braces; the server is the authoritative gate.

## 7. Invariants preserved

- No `getUser()` regressions: all calls remain client-side via `supabase` SDK; no edge function code touched.
- `is_admin({ user_id })` arg shape untouched (no new server callers).
- No legacy `public.disputes` references.
- No rating emission imports (`challenge_rating_impact` stays disabled).
- `scripts/check-edge-function-paths.mjs` continues to pass — only the existing `match-challenges` paths are referenced.

## 8. Test matrix (Phase 3C close-out)

### Static (S1–S6)

- **S1**: rg the new HQ files for forbidden wording (`dispute raised`, `accusation`, `guilty`, `wrongdoing`, `Warrant of Diligence`).
- **S2**: rg the new HQ files for direct calls to progression edge functions (`poi-transition`, `wad`, `p3-wad`, `attestation`, `collapse`, `match`). Must be zero.
- **S3**: rg the new HQ files for legacy `public.disputes` / `from("disputes")`. Must be zero.
- **S4**: rg the new HQ files for `challenge_rating_impact` or rating emission imports. Must be zero.
- **S5**: tsc/build clean.
- **S6**: `scripts/check-edge-function-paths.mjs` passes.

### Render (R1–R6)

- **R1**: platform_admin sees `/hq/challenges` queue with rows.
- **R2**: non-platform-admin authenticated user is redirected away.
- **R3**: unauthenticated user is redirected to sign-in.
- **R4**: drawer for `open` shows Move-to-Under-Review + Record Outcome + Close — No Action + Break-Glass.
- **R5**: drawer for `under_review` hides Move-to-Under-Review and shows the rest.
- **R6**: drawer for terminal status (`outcome_recorded` / `closed_no_action` / `withdrawn`) shows zero action buttons.

### Behavioural (B1–B7)

- **B1**: Record Outcome with summary <40 chars blocks submit, no network call.
- **B2**: Record Outcome 200 → invalidates `["admin-challenges"]`, closes drawer, toast.success.
- **B3**: Record Outcome 403/409/500 → toast.error, dialog stays open, loading clears.
- **B4**: Break-Glass with reason <60 chars blocks submit, no network call.
- **B5**: Break-Glass 200 → invalidates `["admin-challenges"]` and `["match-challenges", matchId]`, closes drawer, toast.success.
- **B6**: Move-to-Under-Review submits `transition` with `to_status="under_review"` and no `outcome_*` fields.
- **B7**: All dialogs dismiss via Close (×) and Cancel without submitting.

### Invariants (I1–I5)

- **I1**: rg confirms no Phase 3A/3B files (`useChallengePermissions*`, `useMatchChallenge*`, `MatchChallengePanel*`, `ChallengeStatusCard*`, `ProgressionPausedBanner*`, `RaiseChallengeDialog*`, `MatchDetails.tsx`) modified.
- **I2**: rg confirms no `supabase/functions/**` modified.
- **I3**: rg confirms no new migrations.
- **I4**: Phase 3A live harness re-run → 12/12 PASS (final close-out only, not during dev).
- **I5**: Vitest full suite still green.

## 9. Stop conditions

- After Phase 3C implementation, run S/R/B/I matrix and report PASS/FAIL per row.
- **Do not start Phase 3D.** No comment-write UI, no evidence-upload UI, no notification surfaces.
- If a UI test exposes a clear server defect, stop and surface it — do not silently re-open Phase 3A/3B or modify edge functions.

## 10. Deliverables

- 7 new client files (1 page + 4 components + 2 hooks).
- 2 minimal edits (`App.tsx` route + HQ sidebar nav link).
- 1 new vitest file `src/components/hq/challenges/ChallengePhase3C.test.tsx` covering R/B matrix.
- Closeout matrix table with S1–S6, R1–R6, B1–B7, I1–I5 PASS/FAIL.  
  
This is a good Phase 3C plan. I would approve it, with **four tightening instructions** before implementation.
  The main plan is sound because it keeps 3C as a **client-side admin UI phase only**. It does not reopen gates, RPCs, migrations, rating, disputes, or fixtures. That is the right discipline.
  The four things I would tighten:
  1. **Route guard must use an existing, proven platform-admin guard**
    &nbsp;
    Do not invent a new admin-check pattern in `App.tsx`. Reuse the same guard already protecting the other `/hq/*` or platform admin pages. If there is no clean reusable guard, stop and report before creating one.
  2. **Do not say “Break-Glass Override” too casually in UI**
    &nbsp;
    It is accurate internally, but client/admin UI should be sober. Use something like **“Admin override closure”** or **“Record admin override”**. The dialog can explain that it is audited and immediately closes the challenge. Avoid language that sounds like a magic bypass.
  3. **Route path should match existing HQ conventions**
    &nbsp;
    `/hq/challenges` is fine only if existing HQ pages use `/hq/...`. If the existing admin area is under `/admin/...`, follow the existing route convention. Do not create a second admin namespace.
  4. **Outcome labels must come from the central catalogue**
    &nbsp;
    The outcome select should import the locked neutral labels from `src/lib/challenge-outcomes.ts`. Do not retype labels inside the dialog. This avoids wording drift.
  Send Lovable this:
  ```text
  Phase 3C plan approved with four tightening instructions:

  1. Use the existing proven platform-admin route guard for the HQ/admin area. Do not invent a new admin-check pattern. If there is no reusable guard, stop and report before creating one.

  2. In user-facing UI, do not label the control “Break-Glass Override” unless there is already established UI wording for that. Prefer “Admin override closure” or “Record admin override”. The dialog must explain that it is audited and immediately closes the challenge.

  3. Confirm the route namespace before adding it. Use /hq/challenges only if existing HQ pages already use /hq/*. If the existing admin area uses /admin/*, follow that convention instead.

  4. Outcome labels must be imported from the locked central catalogue in src/lib/challenge-outcomes.ts. Do not duplicate or retype outcome labels in the component.

  Proceed with Phase 3C implementation only. No new server endpoints, no RPCs, no migrations, no fixtures, no client guide, no notification UI, no rating emission, no legacy disputes changes, and do not start Phase 3D.
  ```