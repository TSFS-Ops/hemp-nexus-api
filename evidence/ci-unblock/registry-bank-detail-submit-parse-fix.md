# CI Unblock: registry-bank-detail-submit Parse Fix

## 1. CI run reviewed

- PR #15 (Batch V-UI-Fix-4) CI run: "CI #1938" (workflow run 28751504369), job "Lint -> Typecheck -> Test -> Build".
- Confirmed the identical failure pre-exists on `main` itself, independent of PR #15: latest push CI run on `main` is "CI #1936" (workflow run 28733799055, commit 47000e1), which fails with the same four jobs (Lint -> Typecheck -> Test -> Build, Schema drift check, E2E - POI mint soft-route, Dependency audit).
- This confirms the parse blocker is a pre-existing defect on `main`, not something introduced by PR #15.

## 2. Failing command

```
npm run lint
```
(the "Lint" step of the "Lint -> Typecheck -> Test -> Build" job in `.github/workflows/ci.yml`), exit code 1. Because this job runs its steps sequentially in one job, the "Typecheck", "Run unit tests", "Notification regression suite", and "Build production bundle" steps never executed (each reported 0s / skipped) as a direct result of this single Lint failure.

## 3. Failing file and line

`supabase/functions/registry-bank-detail-submit/index.ts:228:4`

Reported error:
```
228:4  error  Parsing error: 'try' expected
```

## 4. Root cause

Inside the `Deno.serve(async (req) => { try { ... } catch (err) { ... } });` handler, the outer loop below was missing its closing brace:

```
for (const c of allConsentScopes) {
  ...
  for (const evName of [...]) {
    ...
  }
}   <- this closing brace for the OUTER "for (const c ...)" loop was missing
```

The inner `for (const evName of [...])` loop closed correctly, but the outer `for (const c of allConsentScopes)` loop’s own closing brace was never written. This left every subsequent statement in the function (the second `for (const ev of [...])` loop, the duplicate-fingerprint block, and the final `return json(...)`) nested one brace level deeper than intended. By the time the parser reached `} catch (err) {`, it was still one level too deep inside the unclosed `for` loop, so it could not match the `catch` to its `try`, producing "Parsing error: 'try' expected".

Verified independently with a string/comment-aware brace-balance scan of the file: before the fix, exactly one brace remained unmatched at end-of-file (the outer `Deno.serve` callback’s opening brace, which could never close because of the missing brace upstream). After the fix, the same scan reports zero unmatched braces.

## 5. Exact fix made

Inserted a single missing closing brace, `    }` (4-space indent, matching the indentation of the `for (const c of allConsentScopes) {` line it closes), immediately after the line that closes the inner `evName` loop and before the blank line that precedes the next `for (const ev of [...])` loop.

No other lines were added, removed, or modified. The file grew from 233 lines to 234 lines, and from 11,877 to 11,883 characters (exactly the 6 added characters of `    }` plus its newline).

## 6. Confirmation: no IDV/VerifyNow/provider-routing files changed

This PR touches exactly one file: `supabase/functions/registry-bank-detail-submit/index.ts` (plus this evidence file). It does not touch any file under `supabase/functions/idv-*`, `supabase/functions/_shared/verifynow/**`, `supabase/functions/_shared/idv-*`, `src/pages/desk/idv/**`, `src/pages/admin/idv/**`, `src/components/idv/**`, or any file changed by PR #15 (Batch V-UI-Fix-4). It does not change IDV logic, VerifyNow logic, provider routing, admin review logic, or smoke-test logic. It does not change bank-detail runtime behaviour, validation rules, consent wording, or event names - only restores the originally-intended brace structure.

## 7. Tests run or not run

Tests were NOT executed in this browser-only environment (no local npm/Vitest/Deno execution available here). This fix was verified structurally instead: a custom string/comment-aware brace-balance scan was run against both the original and fixed file content, confirming zero unmatched braces after the fix (previously one unmatched brace). This is not a substitute for actually running `npm run lint`, `tsc`, and the test suites in CI. This PR’s own CI run (which will trigger automatically on `pull_request`) must be reviewed to confirm the Lint step now passes and that Typecheck/Test/Build proceed. This PR does not attempt to fix the Schema drift check, Dependency audit, or E2E secret-configuration failures, which are separate pre-existing issues out of scope here.

## Final verdict

CI_PARSE_BLOCKER_FIXED_READY_FOR_CI_RERUN
