# Batch 11 — QA Results

**Run date:** 2026-05-30
**Lead tester:** platform_admin (AAL2)
**Second admin (approval test):** second platform_admin (AAL2)
**Non-admin tester:** non-admin user
**MFA-unelevated tester:** platform_admin (no AAL2)
**Overall result:** HUMAN REPORTED PASS — screenshots pending upload

> Human testers walked through all scenarios on the live system and verbally reported every scenario as passing. Per the Batch 11 guard contract, scenarios remain marked `human_reported_pass_screenshot_pending` until the matching PNG is uploaded to `./screenshots/`. The guard will refuse to allow status `passed` without a real PNG on disk.

## Anchors observed during walkthrough

- Governance Record route under test: `/hq/governance-records?match=147d997f-3af4-43ee-ba2a-d96d6ff0fe11`
- request_id: human reported — to be backfilled when the success-state screenshot is uploaded.
- Final status of the test request: approved (second-admin approval); no file, no link, no URL.

| # | Scenario | Tester role | Expected result | Actual result | Status | Screenshot | Blocker? | Notes |
|---|---|---|---|---|---|---|---|---|
| A  | Platform admin sees all four sub-tabs (`records`, `memory`, `export-requests`, `export-preview`) | platform_admin (AAL2) | All sub-tabs render; safety badges visible | All four sub-tabs rendered; safety badges visible | human reported pass — screenshot pending | `screenshots/b10-safety-badges.png` | — | Capture badges close-up too |
| B  | Non-admin denied at `/hq` | non-admin | Access denied / surfaces not visible | Access denied as expected | human reported pass — screenshot pending | `screenshots/b10-non-admin-blocked.png` | — | |
| C1 | MFA-unelevated admin blocked from list refresh | platform_admin (no AAL2) | `MFA_REQUIRED` | `MFA_REQUIRED` returned | human reported pass — screenshot pending | `screenshots/b10-mfa-required.png` | — | |
| C2 | MFA-unelevated admin blocked from preview | platform_admin (no AAL2) | `MFA_REQUIRED` | `MFA_REQUIRED` returned | human reported pass — screenshot pending | — | — | Same `MFA_REQUIRED` semantics |
| D  | Request created → awaiting approval; default redaction = `redacted_client_safe`; no file | platform_admin (AAL2) | Status awaiting approval; no file/link/URL | Request created; status awaiting approval; default redaction = `redacted_client_safe`; no file/link/URL observed | human reported pass — screenshot pending | `screenshots/b10-req-success.png` | — | Also capture `b10-req-before.png` |
| E1 | Self-approval blocked | platform_admin (AAL2) | Refusal message | Self-approval refused | human reported pass — screenshot pending | `screenshots/b10-approve-self-blocked.png` | — | |
| E2 | Second-admin approval succeeds; no file | second platform_admin (AAL2) | Status approved; no file/link/URL | Approval succeeded; status approved; no file/link/URL | human reported pass — screenshot pending | `screenshots/b10-approve-success.png` | — | |
| F  | List row shows approved request + safe-summary legal-hold indicator only | platform_admin (AAL2) | No raw legal-hold reason; no file/link | Row visible; safe-summary legal-hold indicator only; no raw reason; no file/link | human reported pass — screenshot pending | `screenshots/b10-list-approved.png` | — | |
| G  | Preview renders redacted payload + manifest; no raw payload | platform_admin (AAL2) | Manifest + redacted preview; no file/link | Redacted preview rendered with manifest; no raw payload; no file/link | human reported pass — screenshot pending | `screenshots/b10-preview.png` | — | |
| H  | Negative safety scan clean across C–G | all | None of the forbidden surfaces visible | None of the forbidden surfaces observed | human reported pass — screenshot pending | — | — | See §Negative safety scan below |

## Negative safety scan (Batch 10 §5.H)

Tester confirmed **each** of the following is **absent** on every export-controls surface (panels, list, preview, error states):

- [x] Download button — absent
- [x] Generate export button — absent
- [x] Prepare export button — absent
- [x] Destroy export button — absent
- [x] CSV export button — absent
- [x] PDF export button — absent
- [x] JSON export button — absent
- [x] Temporary link / signed link — absent
- [x] Visible file path — absent
- [x] Visible storage object / bucket reference — absent
- [x] Raw legal-hold reason — absent
- [x] Raw sanctions / PEP / adverse-media payload — absent
- [x] Raw upstream API response — absent

Additional negative confirmations from the human walkthrough:

- [x] Non-admin access — absent (denied)
- [x] Self-approval — absent (blocked)
- [x] Generated / prepared / downloaded status — absent

## Summary

| Metric | Count |
|---|---|
| Scenarios passed (PNG on disk) | 0 |
| Scenarios human reported pass — screenshot pending | 10 (A, B, C1, C2, D, E1, E2, F, G, H) |
| Scenarios failed | 0 |
| Scenarios not run | 0 |
| Blockers | 0 |
| Non-blocking issues | 0 |
| Dangerous export behaviour observed | none — confirmed absent by human walkthrough and by Batch 8/9/10 guards |
| DATA-004 touched | no |
| Batch 7C production guard intact | yes (verified by `scripts/check-admin-export-controls-batch-7c.mjs`) |

## Sign-off

| Field | Value |
|---|---|
| QA run date | 2026-05-30 |
| Lead tester | platform_admin (AAL2) — human reported |
| Second admin | second platform_admin (AAL2) — human reported |
| Non-admin tester | non-admin user — human reported |
| MFA-unelevated tester | platform_admin (no AAL2) — human reported |
| Overall result | HUMAN REPORTED PASS — screenshots pending upload |
| Evidence folder | `evidence/admin-export-controls-batch-11-qa-dry-run/` |

> Status will be promoted to `passed` per-scenario once the matching PNG is dropped into `./screenshots/` and the Batch 11 guard accepts the JSON update.
