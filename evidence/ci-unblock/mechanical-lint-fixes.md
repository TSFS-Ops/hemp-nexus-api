# CI Unblock: Mechanical Lint Fixes

## CI runs reviewed
- PR #16 CI run (run 28752810284, job 85254778537 on commit bed7b93) — used to enumerate the full 35-error lint baseline via the GitHub Actions log viewer (search for "error" matches, cross-checked against warnings).
- Post-merge CI run on `main` (workflow "CI", run following merge of PR #16, commit a8d8e30) — confirmed the same 35 residual errors persist on `main` after the PR #16 parse-blocker fix, establishing this branch’s starting baseline.
- This branch (`ci-unblock-mechanical-lint-fixes`) has not yet had its own CI run at the time this evidence file was written; the fixes below were verified by direct source-level inspection of each committed file on the branch (via the GitHub API / raw content, fetched after each commit), not by executing `eslint` locally.

## The 34 lint errors addressed

### Category A — react-hooks/rules-of-hooks false positives (2 errors)
- `e2e/helpers/evidence-rn.ts`:97:13
- `e2e/helpers/evidence.ts`:117:13

### Category B — no-unused-expressions (1 error)
- `src/pages/registry/BankDetails.tsx`:71:32

### Category C — no-require-imports (31 errors across 16 files)
- `src/tests/admin-export-controls-batch-4.test.ts`:42
- `src/tests/admin-legal-holds-panel.test.tsx`:210, 211
- `src/tests/batch-1-registry-foundation.test.ts`:170
- `src/tests/batch-2-registry-provenance-coverage-imports.test.ts`:175
- `src/tests/batch-3-public-registry-claim-workflow.test.ts`:88
- `src/tests/batch-b-phase2-schema.test.ts`:95, 96
- `src/tests/batch-b-phase3-rpcs.test.ts`:203, 204, 223, 224, 254, 255, 288, 289
- `src/tests/batch-m-notifications-prefs.test.ts`:109
- `src/tests/batch-o-data-retention-privacy.test.ts`:45
- `src/tests/data-002-sweeper-behavioural.test.ts`:171, 172
- `src/tests/data-004-phase3-enforcement-guard.test.ts`:202, 203, 364, 365, 430, 431
- `src/tests/data-009-phase-2-review-workflow.test.ts`:129
- `src/tests/ops-010-demo-isolation.test.ts`:84, 98
- `src/tests/p5-batch2-stage3-edge-and-rpc.test.ts`:104
- `src/tests/p5-batch3-stage5-isolation.test.ts`:174

Total: 2 + 1 + 31 = 34.

## Why each category is mechanical/safe

**Category A:** In both `e2e/helpers` files, `use` is the standard Playwright fixture-extension callback parameter (e.g. `base.extend({ ev: async ({ page }, use) => { ... await use(...) } })`), not a React Hook. The `react-hooks/rules-of-hooks` plugin flags it as a false positive because the enclosing function is not named with a `use` prefix. Fix: a scoped `eslint-disable-next-line` comment directly above each `await use(...)` call, with an inline reason. No logic changed — this is Playwright test-fixture infrastructure, not application or production code.

**Category B:** `const n = new Set(scopes); n.has(s) ? n.delete(s) : n.add(s); setScopes(n);` used a ternary purely for its side effects, which `no-unused-expressions` flags as a likely mistake even though the logic is correct. Fix: rewritten as an equivalent `if (n.has(s)) { n.delete(s); } else { n.add(s); }` block. Behaviour is byte-for-byte identical; only the statement form changed.

**Category C:** All 31 occurrences are `require("node:fs")`/`require("node:path")` calls used synchronously, at module/describe/it scope, to read migration or source files for static test assertions (never conditionally or lazily required based on runtime branching). Each occurrence was individually inspected in its source context before being changed. Fix: the needed named exports (`readdirSync`, `existsSync`, `statSync`, `readFileSync`, `join`, `basename`, `resolve` as applicable per file) were added to that file’s existing top-level ES `import` statement (or a new one added if none existed), the `require(...)` lines were deleted, and call sites were updated from `fs.xxx(...)`/`path.xxx(...)` to the directly-imported names. In 5 of the 16 files (including all 4 occurrences in `batch-b-phase3-rpcs.test.ts`) the needed names were already imported at the top of the file for other reasons, so the local `require` lines were simply redundant duplicates and were deleted outright. No test assertions, migration paths, or runtime behaviour were changed.

## Files changed (18 files, 18 commits)
- e2e/helpers/evidence-rn.ts
- e2e/helpers/evidence.ts
- src/pages/registry/BankDetails.tsx
- src/tests/admin-export-controls-batch-4.test.ts
- src/tests/admin-legal-holds-panel.test.tsx
- src/tests/batch-1-registry-foundation.test.ts
- src/tests/batch-2-registry-provenance-coverage-imports.test.ts
- src/tests/batch-3-public-registry-claim-workflow.test.ts
- src/tests/batch-b-phase2-schema.test.ts
- src/tests/batch-b-phase3-rpcs.test.ts
- src/tests/batch-m-notifications-prefs.test.ts
- src/tests/batch-o-data-retention-privacy.test.ts
- src/tests/data-002-sweeper-behavioural.test.ts
- src/tests/data-004-phase3-enforcement-guard.test.ts
- src/tests/data-009-phase-2-review-workflow.test.ts
- src/tests/ops-010-demo-isolation.test.ts
- src/tests/p5-batch2-stage3-edge-and-rpc.test.ts
- src/tests/p5-batch3-stage5-isolation.test.ts

## Exclusion confirmation
`src/components/admin/AdminApiSupportTicketsPanel.tsx` was deliberately excluded from this PR. Source inspection showed its `useMemo` call at line 101 is invoked after an early `if (!canRead) return <div>...</div>;` at line 97–99 — a genuine React Rules-of-Hooks violation (conditional hook call), not a mechanical/cosmetic lint issue. Fixing it correctly requires restructuring component control flow and is deferred to its own separate, carefully-reviewed PR as agreed.

## PR #15 files confirmation
Confirmed via the GitHub API (`GET /repos/TSFS-Ops/hemp-nexus-api/pulls/15/files`) that PR #15’s changed-file list is: evidence/batch-v-ui-idv-smoke-test-readiness/CLIENT_SMOKE_TEST_REAL_IDV_AND_QUEUE_FIX.md, src/components/idv/IdvStatusWidget.tsx, src/pages/admin/idv/IdvReviewCase.tsx, src/pages/admin/idv/IdvReviewQueue.tsx, src/pages/desk/idv/IdvStart.tsx, src/tests/batch-v-ui-fix-4-real-idv-and-queue.test.ts, supabase/functions/_shared/idv-manual-review-shape.ts, supabase/functions/_shared/idv-wad-seal-gate.ts, supabase/functions/idv-manual-review/index.ts, supabase/functions/idv-person-verify/idv_person_verify_smoke_test.ts, supabase/functions/idv-person-verify/index.ts. None of these 11 files overlap with the 18 files changed in this PR.

## IDV / VerifyNow / provider-routing / admin-review confirmation
No files under `supabase/functions/idv-*`, `supabase/functions/_shared/idv-*`, `src/pages/admin/idv/*`, `src/components/idv/*`, or `src/pages/desk/idv/*` were touched. No VerifyNow adapter, provider-routing, or admin manual-review-queue logic was read, referenced, or modified. The only "admin" file touched is `src/pages/registry/BankDetails.tsx`, which is a user-facing registry page (bank-detail capture), not an admin review surface, and only its client-side Set-toggle helper was rewritten with identical behaviour.

## Tests run or not run
Tests were NOT executed in this browser-only environment (no terminal/`npm`/`vitest` execution tool is available). All 34 fixes were verified by: (1) static source-level inspection of each file’s context before and after editing, (2) automated post-commit re-fetch of each file from the branch via the GitHub API/raw content to confirm the exact expected text landed and no stray `require(` or dangling `fs.`/`path.` references remained, and (3) confirming via the PR #16 CI baseline exactly which 35 errors existed and cross-matching all 34 addressed here against that list, leaving only the 1 deliberately-deferred `AdminApiSupportTicketsPanel.tsx` error remaining. CI (lint → typecheck → test → build) has not yet been run on this branch; that is the next step after this PR is opened.

## Final verdict
MECHANICAL_LINT_FIXES_READY_FOR_CI_RERUN
