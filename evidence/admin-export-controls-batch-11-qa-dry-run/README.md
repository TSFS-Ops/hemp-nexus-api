# Admin Export Controls — Batch 11 · QA Pack Dry-Run + Evidence Backfill

**Status:** Evidence shell prepared. Live QA execution **NOT YET PERFORMED** by a human tester.
**Source of truth:** [`evidence/admin-export-controls-batch-10-manual-qa-pack.md`](../admin-export-controls-batch-10-manual-qa-pack.md).
**Environment:** Live published HQ (`https://trade.izenzo.co.za`). No staging exists.

## Scope

Batch 11 turns the Batch 10 checklist into a structured evidence folder. It does **not** introduce any new product functionality.

No runtime code was changed by Batch 11. No edge functions, panels, RPCs, migrations, cron jobs, or guards aside from this batch's own files were touched.

## Contents

- [`qa-results.md`](./qa-results.md) — pass/fail table for scenarios A–H (currently `not run` pending human testers).
- [`qa-results.json`](./qa-results.json) — machine-readable mirror of the same.
- [`screenshot-index.md`](./screenshot-index.md) — the 9 expected screenshots with capture instructions and placeholder filenames.
- `screenshots/` — empty until human testers drop the PNGs in. **Do not fabricate screenshots.**

## What Batch 11 explicitly does NOT do

- No file generation, download link, signed URL, temporary link, storage upload, Blob, `Content-Disposition`, CSV/PDF/JSON output.
- No `export-prepare`, `export-download`, `export-destroy`, `admin-governance-export-prepare/download/destroy` invocation.
- No DATA-004 mutation (cron, cold-storage, archive, retention).
- No weakening of the Batch 7C production guard — the smoke runner must still refuse the production backend.
- No change to request / approval / list / preview behaviour.

## How to complete this batch (human testers)

1. Recruit testers A–D per Batch 10 §2.
2. Walk the click-paths in Batch 10 §5 (A–H) against the live HQ.
3. Capture the 9 screenshots listed in `screenshot-index.md` and drop them in `./screenshots/`.
4. Fill in the **Actual result** and **Pass / Fail** columns in `qa-results.md`. Mirror into `qa-results.json`.
5. If any blocker from Batch 10 §8 appears, STOP and escalate before continuing.
