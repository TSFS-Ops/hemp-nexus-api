# Phase 3B — Minimal Challenge UI Surfaces

Phase 3A (server gates + notification suppression) is closed. Phase 3B introduces the **minimum** UI required for users to perceive and act on challenges from the match page only. **No admin queue, no admin outcome controls, no notification UI, no client guide, no fixtures.** Server gates are not modified.

## In-scope (this phase)

1. **Match Page Challenge Status Card** — neutral, institutional, read-only summary of the current challenge for the match.
2. **Progression Paused Banner** — a banner that appears above progression CTAs when the match has a challenge in `open` or `under_review`.
3. **Raise Challenge Entry Point** — a single CTA on the match page that opens a minimal raise dialog.
4. **Role-based visibility** — applied uniformly across the three surfaces above.

## Explicitly out-of-scope

- Admin queue, admin filters, outcome controls, evidence viewer (Phase 3C).
- Notification settings UI / toast surfaces for `progression.*` events.
- New server-side gates, new RPCs, new edge functions, schema changes.
- Fixtures, manual walkthroughs, client guide, regression CSV exports.
- Touching legacy `disputes` UI.

---

## 1. Surfaces (UI only)

### 1.1 ChallengeStatusCard

- Location: match details page, **above** the existing match hero card (sits above Deal Wizard per match-layout-hierarchy memory).
- Renders only when `match_challenges` has a row for this `match_id` whose `status ∈ {open, under_review, outcome_recorded, withdrawn}`.
- Shows: challenge ID short, `status` badge (neutral colour palette — no red/danger), `subject_code` (human label), `summary` (truncated to 240 chars + "Read more" expander), `raised_at`, `raised_by_role`, and (if terminal) `outcome_code` + `closed_at`.
- Read-only. No actions inside the card itself.
- Wording: must pass the same wording guard scanned in Phase 3A T10 (no "dispute raised", "accusation", "guilty", "wrongdoing").

### 1.2 ProgressionPausedBanner

- Location: rendered immediately above any progression CTA cluster on the match page (Generate POI, Transition POI, Create WaD, Seal WaD, Attest, Collapse, Reveal Counterparty, Complete, Settle).
- Renders only when the match has a challenge with `status ∈ {open, under_review}`.
- Copy: "Progression is paused while a challenge is open on this match." Neutral, institutional, no danger colour.
- Disables (`aria-disabled`, visually muted) all progression CTAs in the cluster — does not hide them. CTA `onClick` still calls server, which will return canonical 409 CHALLENGE_OPEN; the banner is a UX hint, **not** the gate.

### 1.3 RaiseChallengeButton + RaiseChallengeDialog

- Button location: inside ChallengeStatusCard when no `open`/`under_review` challenge exists, OR on the match page Action menu when the card isn't shown. One entry point per match — no duplication.
- Dialog: minimal — `subject_code` (select from existing enum), `summary` (textarea, 60–4000 chars, required), Submit / Cancel. Modal must have a Close (×) button per Modal Dismissal Standard memory.
- Submits to existing `match-challenges` POST `/raise` endpoint. **No** new server endpoint.
- On 200: optimistic refetch of the match-challenges query; banner + card appear immediately.
- On error: toast with the server message. Standard Zero Swallowed Errors try/catch/finally pattern.

---

## 2. Role-based visibility (single source of truth)

Add `src/hooks/useChallengePermissions.ts` that resolves three booleans for `(match, currentUser, currentOrg)`:


| Role on match                        | canViewCard     | canRaise | canSeeBanner |
| ------------------------------------ | --------------- | -------- | ------------ |
| Party `org_admin` (buyer or seller)  | yes             | yes      | yes          |
| Party `org_member` (buyer or seller) | yes (read-only) | **no**   | yes          |
| Platform admin (`is_admin = true`)   | yes             | yes      | yes          |
| Unrelated org                        | **no**          | **no**   | **no**       |
| Unauthenticated                      | **no**          | **no**   | **no**       |


Hook reads from already-loaded `match`, `useUserOrg`, and `is_admin` — no extra DB queries.

`canRaise=false` users still see the card and banner if applicable; the Raise button is simply absent. **No client-side trust:** server already enforces raise permissions; the hook only decides what to render.

---

## 3. Wiring (where edits land)

- `src/components/match/ChallengeStatusCard.tsx` — new, read-only.
- `src/components/match/ProgressionPausedBanner.tsx` — new, presentational.
- `src/components/match/RaiseChallengeDialog.tsx` — new, minimal modal.
- `src/hooks/useChallengePermissions.ts` — new, derived booleans.
- `src/hooks/useMatchChallenge.ts` — new, react-query wrapper around existing `match-challenges` GET endpoint, returns `{ open, terminal, latest, all }` slices.
- `src/pages/MatchDetails.tsx` (or whichever currently hosts Deal Wizard / hero / progression CTAs) — slot the card above the hero, wrap progression CTA cluster with banner, mount dialog. Per match-layout-hierarchy memory: card sits above hero card; Deal Wizard remains above hero too — card slots **between Deal Wizard and hero** to keep gating visible at first glance.

No changes to: `match-challenges` edge function, any other edge function, any migration, any RPC, `disputes` legacy code paths, Phase 3A guard helpers, notification dispatch.

---

## 4. Phase 3B Test Matrix

Phase 3B is UI-only, so the matrix is split into static checks + render-level assertions. **No new live edge-function harness.**

### 4a. Static / build-time


| ID  | Check                                                                                                                                   | Expected                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| S1  | `rg "dispute raised|accusation|guilty|wrongdoing"` over the four new files                                                              | zero hits                                        |
| S2  | `rg` over the four new files for direct calls to progression edge functions (poi-transition, wad, p3-wad, attestation, collapse, match) | zero hits — UI must never bypass existing wiring |
| S3  | `rg` for new migrations under `supabase/migrations/` since 3A close                                                                     | zero new files (3B introduces no schema)         |
| S4  | `tsc --noEmit` (via existing build)                                                                                                     | clean                                            |
| S5  | `scripts/check-edge-function-paths.mjs` (existing prebuild)                                                                             | passes                                           |


### 4b. Render assertions (vitest + React Testing Library)

For each row, mock `useMatchChallenge` + `useChallengePermissions` and assert presence/absence:


| ID  | Scenario                                            | Card                | Banner  | Raise button                                   |
| --- | --------------------------------------------------- | ------------------- | ------- | ---------------------------------------------- |
| R1  | Party org_admin, no challenge                       | hidden              | hidden  | visible (in card-empty / action-menu fallback) |
| R2  | Party org_admin, status=open                        | visible             | visible | hidden (already raised)                        |
| R3  | Party org_admin, status=under_review                | visible             | visible | hidden                                         |
| R4  | Party org_admin, status=outcome_recorded (terminal) | visible             | hidden  | visible (new challenge allowed)                |
| R5  | Party org_member, status=open                       | visible (read-only) | visible | hidden                                         |
| R6  | Platform admin, no challenge                        | hidden              | hidden  | visible                                        |
| R7  | Platform admin, status=open                         | visible             | visible | hidden                                         |
| R8  | Unrelated org, status=open                          | hidden              | hidden  | hidden                                         |
| R9  | Unauthenticated                                     | hidden              | hidden  | hidden                                         |


### 4c. Behavioural


| ID  | Test                                                                                                                                           | Expected                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| B1  | RaiseChallengeDialog Close (×) and Cancel both dismiss without submit                                                                          | passes Modal Dismissal Standard                                               |
| B2  | Submit with summary < 60 chars                                                                                                                 | client-side validation error; no network call                                 |
| B3  | Submit with valid payload, mocked 200                                                                                                          | dialog closes; query invalidates; card appears                                |
| B4  | Submit with mocked 409 / 500                                                                                                                   | toast error; dialog stays open; loading state cleared (Zero Swallowed Errors) |
| B5  | Banner present → progression CTAs are `aria-disabled` and visually muted; clicking still routes through existing handlers (server is the gate) | passes                                                                        |


### 4d. Invariants carried from 3A (must remain true)


| ID  | Check                                                                                                                                                                               | Expected                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| I1  | `rg "auth.getUser\(\)"` across `supabase/functions/`                                                                                                                                | zero hits — positional form only (per new memory) |
| I2  | `rg "is_admin"` arg shape                                                                                                                                                           | `{ user_id }` form preserved                      |
| I3  | `git diff` touches no file under `supabase/functions/` (except possibly an added comment), no migration, no `src/lib/wad-state.ts`, no `src/lib/match-state.ts`, no `disputes` code | passes                                            |
| I4  | Phase 3A live harness `phase3a-progression-e2e` re-run                                                                                                                              | still 12/12 PASS                                  |


---

## 5. Stop conditions

After Phase 3B implementation:

- Run S1–S5, R1–R9, B1–B5, I1–I4.
- Report results.
- **Do not start Phase 3C** (admin queue, outcome controls) without explicit approval.
- If any UI test exposes a clear server-side defect, surface it and stop — do not silently re-open Phase 3A.

## 6. Deliverables at 3B close

- 5 new client files (4 components + 2 hooks).
- 1 edited host page (`MatchDetails`).
- Vitest suite for R1–R9 + B1–B5.
- Static-check report (S1–S5).
- Confirmation I1–I4 still hold.
- No edge function changes, no migrations, no fixtures.  
  
This Phase 3B plan is mostly solid, but I would **not approve it exactly as written**. There are a few contradictions and implementation risks that should be tightened before Lovable writes code.
  ## **Main corrections before implementation**
  ### **1.**
  `useMatchChallenge` **cannot use a GET endpoint unless one exists**
  The plan says:
  `useMatchChallenge.ts` — react-query wrapper around existing `match-challenges` GET endpoint
  But the existing `match-challenges` edge function, from the Phase 2 work, was POST-route based: `/raise`, `/comment`, `/transition`, `/upload-evidence`, `/break-glass`.
  So either there is no GET endpoint yet, or it has not been mentioned/proven.
  **Correct approach for 3B:** do not create a new edge function unless strictly necessary. The hook should read directly from Supabase using RLS:
  ```text
  match_challenges
    select id, match_id, status, subject_code, summary, raised_by_role,
           raised_by_org_id, raised_by_user_id, outcome_code,
           created_at, closed_at
    where match_id = current match id
    order created_at desc
  ```
  RLS already decides whether the user can see the row. If unrelated org gets zero rows, the UI shows nothing.
  So change:
  wrapper around existing `match-challenges` GET endpoint
  to:
  react-query wrapper around direct Supabase RLS-protected `match_challenges` select; no new edge function.
  ### **2. Summary length conflicts with server rules**
  The plan says dialog summary is:
  60–4000 chars
  But Phase 1 schema says `summary` is **20–2000 chars**. If the UI enforces 60–4000, the client and DB are inconsistent.
  I recommend using **60–2000 chars** in the UI. That is stricter than DB on the minimum, but respects the DB maximum. It also encourages meaningful challenge reasons.
  Change to:
  ```text
  summary textarea: 60–2000 chars, required.
  ```
  ### **3. The card render statuses should include**
  `closed_no_action`
  The card currently renders for:
  ```text
  open, under_review, outcome_recorded, withdrawn
  ```
  But the locked state machine also includes:
  ```text
  closed_no_action
  ```
  If a challenge is closed with no action, the card should still show the historical challenge outcome. Otherwise users may wonder where the challenge went.
  Add `closed_no_action` to the card-visible statuses.
  ### **4. Terminal**
  `admin_override_recorded` **is not a status**
  The test matrix refers to terminal statuses like:
  `admin_override_recorded`
  That is an **outcome_code**, not a `status`. The terminal status is:
  ```text
  outcome_recorded
  ```
  with:
  ```text
  outcome_code = admin_override_recorded
  ```
  Make sure the UI and tests do not treat `admin_override_recorded` as a status.
  ### **5. “No challenge → raise button visible” needs a defined home**
  The plan says the Raise button appears:
  inside ChallengeStatusCard when no open/under_review challenge exists, OR on the match page Action menu when the card isn’t shown
  But if the card is hidden when there is no challenge, the button cannot be “inside ChallengeStatusCard”. This creates ambiguity.
  Better:
  ```text
  ChallengeStatusCard renders only when there is a challenge.
  Raise Challenge button renders in the match page action area when canRaise=true and no open/under_review challenge exists.
  If there is a terminal challenge card, the Raise button may render below or beside that card as a separate action, not inside the read-only card.
  ```
  This keeps the card read-only and avoids duplication.
  ### **6. “Disable CTAs but clicking still calls server” is contradictory**
  The plan says progression CTAs are disabled with `aria-disabled`, but:
  CTA onClick still calls server
  A truly disabled `<button disabled>` will not fire. `aria-disabled` can still fire if it is not actually disabled.
  So be precise:
  ```text
  Do not use the HTML disabled attribute if the click should still reach the existing handler.
  Use aria-disabled="true", muted styling, and tooltip/help text.
  The existing handler remains attached so the server gate remains authoritative.
  ```
  This is slightly odd UX, but it matches the stated goal: UI hint, not client-side gate.
  ### **7. Do not rerun the live Phase 3A harness as part of every UI iteration unless necessary**
  I4 says:
  Phase 3A live harness re-run — still 12/12 PASS
  That is good before closing 3B, but not necessary on every small UI compile. Keep it as a **final close-out check**, not part of the inner loop.
  ## **Revised instruction to Lovable**
  Use this:
  ```text
  Proceed with Phase 3B only, with the following corrections to the plan:

  1. Do not create or modify any edge function, RPC, migration, notification logic, progression gate, WAD state, match state, or legacy disputes code.

  2. `useMatchChallenge` must not assume a GET edge endpoint exists. Implement it as a React Query hook that reads directly from Supabase using the existing RLS-protected `match_challenges` table:
     - filter by `match_id`
     - order by `created_at desc`
     - return `{ open, terminal, latest, all }`
     - unrelated orgs should naturally receive no rows via RLS.

  3. Challenge card visible statuses are:
     - `open`
     - `under_review`
     - `outcome_recorded`
     - `withdrawn`
     - `closed_no_action`

  4. Treat `admin_override_recorded` as an `outcome_code`, not a `status`.

  5. Raise dialog summary validation must be 60–2000 characters. DB allows 20–2000, but UI should require 60 minimum for meaningful submissions and must not exceed the DB maximum.

  6. Keep `ChallengeStatusCard` read-only. Do not place action buttons inside the card unless they are purely external wrapper actions. The Raise Challenge button should appear in the match action area when:
     - `canRaise=true`
     - no `open` or `under_review` challenge exists.
     If a terminal challenge exists, show the card and still allow a separate Raise Challenge button outside/near the card.

  7. ProgressionPausedBanner should use `aria-disabled`, muted styling, and tooltip/help text. Do not use a native `disabled` attribute if the click is intentionally meant to still route to the existing handler and let the server return canonical `409 CHALLENGE_OPEN`.

  8. Add:
     - `src/components/match/ChallengeStatusCard.tsx`
     - `src/components/match/ProgressionPausedBanner.tsx`
     - `src/components/match/RaiseChallengeDialog.tsx`
     - `src/hooks/useChallengePermissions.ts`
     - `src/hooks/useMatchChallenge.ts`
     - one edited host page only, likely `src/pages/MatchDetails.tsx`
     - one Vitest/RTL suite covering R1–R9 and B1–B5.

  9. Tests must prove:
     - party org_admin can see raise when no open challenge exists
     - party org_admin sees card/banner and no raise when open/under_review exists
     - party org_member sees card/banner but no raise
     - platform_admin can raise
     - unrelated org and unauthenticated see nothing
     - terminal challenge shows card but no banner
     - close/cancel dismiss dialog without submit
     - short summary blocks submit with no network call
     - valid submit invalidates/refetches query
     - server error shows toast and clears loading state
     - no forbidden wording appears in the new files.

  10. Do not start Phase 3C. No admin queue, no outcome controls, no fixtures, no client guide, no manual walkthrough.
  ```
  My verdict: **approved after these corrections**. The most important fix is the hook: use direct RLS table reads, not a non-existent GET endpoint.