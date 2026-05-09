## Phase 3D — Comments + Evidence UI

Client-side only. Reuses existing `match-challenges/comment` and `match-challenges/upload-evidence` endpoints. No edge function, migration, RPC, RLS, notification, rating, fixture, client-guide, or Phase 3A/3B/3C server changes.

### Scope

1. **Comment-write UI (party + admin surface)**
  - In `MatchChallengePanel` (party view) and `AdminChallengeReviewDrawer` (HQ view), add a `ChallengeCommentThread` showing existing `match_challenge_comments` for the challenge (direct RLS read by `challenge_id`, ordered `created_at asc`).
  - Add a `ChallengeCommentComposer` (textarea + Submit) that POSTs `match-challenges/comment` with `{ challenge_id, author_role, body, author_org_id? }`.
  - Visible only when challenge status is non-terminal (`open` or `under_review`) AND the viewer is `platform_admin` OR a party `org_admin` per `useChallengePermissions`. Read-only (thread visible, composer hidden) for ordinary `org_member` and unrelated viewers (unrelated viewers see nothing because the RLS read returns no rows).
  - Validation: trimmed body 1–2000 chars; submit disabled otherwise. Toast on 403/409/500. Invalidate the comments query on success.
  - `author_role` derived from `useChallengePermissions` (`platform_admin` | `buyer_org_admin` | `seller_org_admin`).
2. **Evidence-upload UI (party + admin surface)**
  - `ChallengeEvidenceUploader`: single-file `<input type="file">`, computes SHA-256 + base64 client-side, POSTs `match-challenges/upload-evidence` with `{ challenge_id, filename, mime_type, sha256, content_base64 }`. Server constructs the storage path — client never sends one.
  - Hard cap 25 MB (server enforces; client mirrors with friendly toast). Disabled when challenge terminal. Visibility identical to the composer (party `org_admin` or `platform_admin`).
  - Toast on 403/409/413/500; invalidate evidence query on success.
3. **Read-only evidence list (party panel + admin drawer)**
  - `ChallengeEvidenceList`: direct RLS read of `match_challenge_evidence` by `challenge_id` ordered `created_at desc`. Shows `filename`, uploader org tag, size, SHA-256 (mono, truncated), uploaded-at.
  - In `AdminChallengeReviewDrawer`: read-only — admins do not download or mutate evidence in 3D. (No signed-URL flow, no delete control.)
  - In `MatchChallengePanel`: read-only list for any viewer the RLS lets read (i.e., parties + platform_admin); unrelated orgs see an empty list.
4. **Read-only enforcement for ordinary org_member (test focus)**
  - Extend `useChallengePermissions` consumer logic to expose `canComment` and `canUploadEvidence` (both ≡ `canRaise || isPlatformAdmin` and challenge non-terminal).
  - Tests prove an `org_member` of a party org sees the thread + evidence list but no composer and no uploader, on both `open` and `under_review` challenges.

### Files

**New (client only)**

- `src/components/match/ChallengeCommentThread.tsx`
- `src/components/match/ChallengeCommentComposer.tsx`
- `src/components/match/ChallengeEvidenceList.tsx`
- `src/components/match/ChallengeEvidenceUploader.tsx`
- `src/hooks/useChallengeComments.ts` (RLS read + POST mutation)
- `src/hooks/useChallengeEvidence.ts` (RLS read + upload mutation)
- `src/lib/sha256.ts` (Web Crypto helper; or inline if trivial)
- `src/components/match/ChallengePhase3D.test.tsx`

**Edited (minimal wiring only)**

- `src/components/match/MatchChallengePanel.tsx` — mount thread + composer + evidence list/uploader.
- `src/components/admin/challenges/AdminChallengeReviewDrawer.tsx` — mount thread + composer + read-only evidence list.

**Untouched (asserted by tests)**

- All `supabase/functions/**`, all migrations, `src/lib/challenge-outcomes.ts`, Phase 3A files (`poi-transition`, `phase3a-progression-e2e`), Phase 3B/3C UI, legacy `disputes`, rating code.

### Test Matrix

**Static (S)**

- S1 No new files under `supabase/functions/**` or `supabase/migrations/**`.
- S2 No imports of `phase3a-progression-e2e`, `poi-transition`, or any rating module.
- S3 No string literal `"dispute"` (case-insensitive) in new files; reuse "challenge" wording.
- S4 `check-edge-function-paths` and tsc clean.
- S5 `useChallengeComments` / `useChallengeEvidence` POST only to `/functions/v1/match-challenges/comment` and `/functions/v1/match-challenges/upload-evidence`.

**Render / role visibility (R)**

- R1 platform_admin: thread + composer + evidence list + uploader visible (open).
- R2 platform_admin: composer + uploader hidden when challenge terminal (`outcome_recorded`).
- R3 buyer org_admin (party): thread + composer + uploader visible (open + under_review).
- R4 seller org_admin (party): same as R3.
- R5 party org_member: thread + evidence list visible; composer + uploader **hidden**.
- R6 unrelated org member: panel empty (no rows from RLS); no composer, no uploader.
- R7 Admin drawer evidence list is read-only — no download button, no delete button.

**Behavioural (B)**

- B1 Composer body trimmed empty → submit disabled.
- B2 Composer body > 2000 chars → submit disabled with helper text.
- B3 Composer 200 → invalidates comments query, clears textarea, success toast.
- B4 Composer 403/409/500 → toast.error, body retained.
- B5 Uploader > 25 MB → blocked client-side with toast.error, no network call.
- B6 Uploader 201 → invalidates evidence query, success toast, file input cleared.
- B7 Uploader 403/409/500 → toast.error.
- B8 SHA-256 sent matches client-computed hash of the file bytes (spy on fetch).

**Invariants (I)**

- I1 No file under `supabase/functions/**` modified.
- I2 No file under `supabase/migrations/**` added.
- I3 Phase 3A/3B/3C source files unchanged (git diff list asserted in test).
- I4 `src/lib/challenge-outcomes.ts` unchanged.
- I5 Phase 3A live harness re-run → 12/12 PASS.
- I6 Vitest green for the new 3D suite + existing 3B/3C suites.

### Stop Conditions

- Do **not** start fixtures, manual walkthrough, signed-URL download UI, evidence delete, or notification UI.
- If a UI test surfaces a server defect, stop and surface it — no silent edge-function edits.
- Phase 3D closes only when the full S/R/B/I matrix passes and 3A live harness still reports 12/12.  
  
Phase 3D plan is sound and in the right order.
  I would approve it **with two tightening points before implementation**:
  1. **Do not allow** `body` **length 1–2000 if server allows 5–4000.**  
  Phase 1 schema has `match_challenge_comments.body CHECK char_length BETWEEN 5 AND 4000`. So client-side validation should mirror the DB: **5–4000 chars**, not 1–2000. Otherwise the UI will allow 1–4 characters and the server will reject them. That creates a pointless error path.
  2. **Be careful with** `canComment` **/** `canUploadEvidence` **wording.**  
  The rule should be:
    - challenge is `open` or `under_review`; and
    - viewer is `platform_admin`; or
    - viewer is party `org_admin`.
    Do **not** define it as `canRaise || isPlatformAdmin` without checking challenge status, because `canRaise` may be true when the latest challenge is terminal and a new challenge can be raised. Comment/upload should not be allowed on terminal challenges.
  So I would amend the plan as follows:
  ```text
  Comment validation:
  - trimmed body 5–4000 characters, matching the database CHECK constraint.

  canComment / canUploadEvidence:
  - true only when challenge.status is open or under_review AND viewer is platform_admin or party org_admin.
  - false for terminal challenges, ordinary org_members, unrelated orgs, and unauthenticated users.
  ```
  Everything else is correct.
  Most important: **3D must stay client-only.** No edge changes, no migrations, no “quick fix” server edits. If something server-side breaks, stop and report it.
  You can proceed with Phase 3D implementation under those two corrections.