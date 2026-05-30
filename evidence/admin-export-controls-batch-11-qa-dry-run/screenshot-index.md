# Batch 11 — Screenshot Index

Drop captures into `./screenshots/` using the filenames below. Do **not** fabricate screenshots — if a scenario is not run, leave the file absent and mark the row `not run` in `qa-results.md`.

Human walkthrough on 2026-05-30 reported all scenarios as passing. Screenshots are still pending upload — the rows below stay `no — pending upload` until the real PNGs are dropped in.

| # | Filename | What to capture | Captured? |
|---|---|---|---|
| 1 | `b10-req-before.png` | Export Requests panel before submit | no — pending upload |
| 2 | `b10-req-success.png` | Request success state (status awaiting approval) | no — pending upload |
| 3 | `b10-approve-self-blocked.png` | Self-approval refusal message | no — pending upload |
| 4 | `b10-approve-success.png` | Second-admin approval success state | no — pending upload |
| 5 | `b10-list-approved.png` | List row showing approved request + safe-summary legal-hold indicator | no — pending upload |
| 6 | `b10-preview.png` | Redaction preview panel with manifest visible | no — pending upload |
| 7 | `b10-mfa-required.png` | `MFA_REQUIRED` state on a gated action | no — pending upload |
| 8 | `b10-non-admin-blocked.png` | Non-admin denied at `/hq` | no — pending upload |
| 9 | `b10-safety-badges.png` | Close-up of `Preview only — no file generated`, `No download link`, `No temporary link`, `AAL2 required` badges | no — pending upload |

## Capture rules

- PNG only, full panel visible, no clipped tooltips.
- No personal data outside the platform UI (no email previews, no SMS, no third-party tabs).
- File names must match exactly; the guard checks for these names.
- If a scenario cannot be executed in the current environment (e.g. single-admin org), note it in `qa-results.md` notes column and leave the file absent.

## Negative confirmation

While capturing, the tester must visually confirm none of the following appear anywhere in the export-controls surface:

Download button · Generate export button · Prepare export button · Destroy export button · CSV export button · PDF export button · JSON export button · temporary link · signed link · file path · storage object · raw legal-hold reason · raw sanctions/PEP/adverse-media payload · raw upstream API response.

If any of the above appears, STOP, do not capture more screenshots, and escalate per Batch 10 §8.
