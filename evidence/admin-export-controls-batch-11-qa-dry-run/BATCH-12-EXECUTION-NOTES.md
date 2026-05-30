# Batch 12 — Execution Notes (Honest Status)

**Status:** PENDING HUMAN TESTERS. Not started. Not executable by the Lovable agent.

## Why the agent cannot execute Batch 12

Batch 12 is **human QA execution only**. The Lovable agent cannot perform it because:

- The agent does not have real `platform_admin` credentials.
- The agent does not have real non-admin user credentials.
- The agent cannot complete AAL2 / TOTP challenges.
- The agent cannot satisfy the second-platform-admin separation-of-duty approval test (E2).
- The agent cannot satisfy the MFA-unelevated admin test (C1 / C2).
- The agent must not fabricate screenshots, synthesise PNGs, or mark scenarios as passed.
- The Batch 11 guard (`scripts/check-admin-export-controls-batch-11.mjs`) actively blocks any scenario being marked `passed` or `captured` unless a matching real PNG exists in `screenshots/`.

## Current QA state

- All scenarios in `qa-results.md` and `qa-results.json` remain `not run`.
- No screenshots have been captured. `screenshots/` is empty.
- `screenshot-index.md` placeholders are unchanged.
- No runtime code has been changed in this batch.

## Rules for human testers

1. Do not mark any scenario as `passed` without:
   - A real PNG screenshot committed under `evidence/admin-export-controls-batch-11-qa-dry-run/screenshots/`, AND
   - A named human tester sign-off in `qa-results.md`.
2. Do not edit `qa-results.json` to bypass the Batch 11 guard.
3. Do not click, request, or attempt any `prepare`, `download`, `generate`, `signed URL`, `destroy`, CSV/PDF/JSON export, Blob, storage upload, or Content-Disposition action. None of those exist and none are authorised.
4. If a scenario fails, mark it `failed`, attach the screenshot, and stop. Do not expand scope.

## Authorisation envelope

- **Authorised:** Visibility, MFA/AAL2 gating, request submission, approval flow visibility, redaction preview shell, legal-hold auto-detection display.
- **NOT authorised:** Any actual export generation, download link, signed URL, file artefact, prepare action, destroy action, or any path that lets data leave the platform.
- **Untouched:** DATA-004, cron, retention, cold-storage, archive, legal-hold retention enforcement, Batch 7C production-refusal guard.

## Definition of "Batch 12 complete"

Batch 12 is complete only when **all** of the following are true:

- Every scenario (A–H) in `qa-results.md` is marked `passed` or `failed` (not `not run`) by a named human tester.
- Every required screenshot listed in `screenshot-index.md` exists as a real PNG in `screenshots/`.
- `scripts/check-admin-export-controls-batch-11.mjs` passes with scenarios marked accordingly.
- No runtime code was changed during QA execution.

Until then: **Batch 12 remains pending human testers.**
