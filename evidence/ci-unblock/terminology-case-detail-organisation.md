# CI Unblock: Terminology Guard Fix — CaseDetail.tsx Organisation Wording

## CI run reviewed
- PR #15 (`batch-v-ui-fix-4-real-idv-and-queue-alignment`), run #1950 (workflow run 28806854065), after PR #15's branch was updated with latest `main` (merge commit `ea6ee30`, via PR #19).
- Also confirmed the identical failure on PR #18's CI run (workflow run 28804741564) and directly on `main` at commit `068135a`.

## Failing workflow / job / command
- Workflow: `ci.yml` (`CI`)
- Job: `Lint → Typecheck → Test → Build`
- Step: `Terminology guard`
- Command: `node scripts/terminology-guard.mjs`

## Failing file and line
- `src/pages/admin/p5-governance/CaseDetail.tsx:197`

## Exact wording issue
The terminology guard flags US-spelling "Organization" where the project's house style requires the UK/AU spelling "Organisation":

```
src/pages/admin/p5-governance/CaseDetail.tsx
L197: [Organization (US spelling)] -> Organisation
<div>Organization: {c.organization_id ?? "—"}</div>
```

## Exact fix made
Changed only the visible display label text on line 197 from "Organization" to "Organisation". The underlying data field reference `c.organization_id` (a real Supabase column/schema name) was deliberately left unchanged, since renaming it would be a functional/schema change, not a wording fix.

Before:
```tsx
<div>Organization: {c.organization_id ?? "—"}</div>
```

After:
```tsx
<div>Organisation: {c.organization_id ?? "—"}</div>
```

Commit: `302d9ce` ("Update CaseDetail.tsx"), branched from `main` at commit `3310f11` (PR #18's merge commit). Net diff: 1 line changed, 0 lines added/removed elsewhere.

## Confirmation: no PR #15 files touched
Confirmed. This branch (`ci-unblock-terminology-case-detail-organisation`) was created fresh from `main` and contains exactly one commit on top of `main`, touching only `src/pages/admin/p5-governance/CaseDetail.tsx`. None of PR #15's 11 changed files (IdvStart.tsx, IdvReviewQueue.tsx, IdvReviewCase.tsx, IdvStatusWidget.tsx, idv-person-verify/index.ts, idv-wad-seal-gate.ts, idv-manual-review-shape.ts, batch-v-ui-fix-4-real-idv-and-queue.test.ts, idv_person_verify_smoke_test.ts, and the PR #15 evidence file) were touched.

## Confirmation: no IDV / VerifyNow / provider-routing / admin-review / permission logic touched
Confirmed. `CaseDetail.tsx` is part of the unrelated P-5 Governance module (readiness cases, not IDV). This fix only changes a display-label string. It does not touch:
- IDV logic or routing
- VerifyNow adapter or secrets
- Provider routing/allow-lists
- Admin-review decision logic
- Permission checks (`permissions.canViewAdmin`, `canMutate`, etc. — all unchanged)
- Any RPC calls (`p5Rpc.*` — all unchanged)

## Tests run or not run
Not run locally. This is a browser-only environment with no code-execution tool available. CI (lint, terminology guard, typecheck, unit tests, build) must confirm the fix in the next CI run.

## Final verdict
TERMINOLOGY_GUARD_FIX_READY_FOR_CI_RERUN
