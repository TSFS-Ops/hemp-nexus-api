# Batch 11 — QA Results

**Run date:** _not yet executed_
**Lead tester:** _pending_
**Second admin (approval test):** _pending_
**Non-admin tester:** _pending_
**MFA-unelevated tester:** _pending_
**Overall result:** NOT RUN

> Scenarios below mirror Batch 10 §9. Status is `not run` until human testers populate Actual result and Pass / Fail. Do not mark `pass` without a captured screenshot or written witness statement.

| # | Scenario | Tester role | Expected result | Actual result | Status | Screenshot | Blocker? | Notes |
|---|---|---|---|---|---|---|---|---|
| A  | Platform admin sees all four sub-tabs (`records`, `memory`, `export-requests`, `export-preview`) | platform_admin (AAL2) | All sub-tabs render; safety badges visible | _pending_ | not run | `screenshots/b10-safety-badges.png` | — | Capture badges close-up too |
| B  | Non-admin denied at `/hq` | non-admin | Access denied / surfaces not visible | _pending_ | not run | `screenshots/b10-non-admin-blocked.png` | — | |
| C1 | MFA-unelevated admin blocked from list refresh | platform_admin (no AAL2) | `MFA_REQUIRED` | _pending_ | not run | `screenshots/b10-mfa-required.png` | — | |
| C2 | MFA-unelevated admin blocked from preview | platform_admin (no AAL2) | `MFA_REQUIRED` | _pending_ | not run | — | — | Same `MFA_REQUIRED` semantics |
| D  | Request created → awaiting approval; default redaction = `redacted_client_safe`; no file | platform_admin (AAL2) | Status awaiting approval; no file/link/URL | _pending_ | not run | `screenshots/b10-req-success.png` | — | Also capture `b10-req-before.png` |
| E1 | Self-approval blocked | platform_admin (AAL2) | Refusal message | _pending_ | not run | `screenshots/b10-approve-self-blocked.png` | — | Skip if single-admin env; note here |
| E2 | Second-admin approval succeeds; no file | second platform_admin (AAL2) | Status approved; no file/link/URL | _pending_ | not run | `screenshots/b10-approve-success.png` | — | |
| F  | List row shows approved request + safe-summary legal-hold indicator only | platform_admin (AAL2) | No raw legal-hold reason; no file/link | _pending_ | not run | `screenshots/b10-list-approved.png` | — | |
| G  | Preview renders redacted payload + manifest; no raw payload | platform_admin (AAL2) | Manifest + redacted preview; no file/link | _pending_ | not run | `screenshots/b10-preview.png` | — | |
| H  | Negative safety scan clean across C–G | all | None of the forbidden surfaces visible | _pending_ | not run | — | — | See §Negative safety scan below |

## Negative safety scan (Batch 10 §5.H)

Tester must confirm **each** of the following is **absent** on every export-controls surface (panels, list, preview, error states):

- [ ] Download button
- [ ] Generate export button
- [ ] Prepare export button
- [ ] Destroy export button
- [ ] CSV export button
- [ ] PDF export button
- [ ] JSON export button
- [ ] Temporary link / signed link
- [ ] Visible file path
- [ ] Visible storage object / bucket reference
- [ ] Raw legal-hold reason
- [ ] Raw sanctions / PEP / adverse-media payload
- [ ] Raw upstream API response

Expected outcome: all checkboxes ticked = absent. Any tick missing = blocker; STOP and escalate per Batch 10 §8.

## Summary

| Metric | Count |
|---|---|
| Scenarios passed | 0 |
| Scenarios failed | 0 |
| Scenarios not run | 10 (A, B, C1, C2, D, E1, E2, F, G, H) |
| Blockers | 0 (none yet — QA not executed) |
| Non-blocking issues | 0 |
| Dangerous export behaviour observed | none — surface does not exist in code (verified by Batch 8/9/10 guards) |
| DATA-004 touched | no |
| Batch 7C production guard intact | yes (verified by `scripts/check-admin-export-controls-batch-7c.mjs`) |

## Sign-off

| Field | Value |
|---|---|
| QA run date | _pending_ |
| Lead tester | _pending_ |
| Second admin | _pending_ |
| Non-admin tester | _pending_ |
| MFA-unelevated tester | _pending_ |
| Overall result | NOT RUN |
| Evidence folder | `evidence/admin-export-controls-batch-11-qa-dry-run/` |
