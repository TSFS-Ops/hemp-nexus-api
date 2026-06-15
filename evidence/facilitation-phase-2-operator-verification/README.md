# Facilitation Phase 2 — Operator Verification Evidence

**Status:** `PHASE_2_PARTIAL — NOT CLIENT_UAT_READY`
**Last updated:** 2026-06-15

## What this pass covered (live)

The agent drove the preview browser as the **currently-logged-in platform_admin** only,
and captured four screenshots of the Phase 2 surface:

| # | Screenshot | What it shows |
|---|---|---|
| 01 | `01-platform-admin-hq-facilitation.png` | `/hq/facilitation` queue with 6 cases, queue header, search/status/urgency filters |
| 02 | `02-platform-admin-case-drawer-triage.png` | Case drawer Triage tab (intake, assign owner, change status, internal notes) |
| 03 | `03-platform-admin-case-drawer-outreach.png` | Case drawer Outreach tab (Candidates list, Add candidate form, pre-send check copy) |
| 04 | `04-platform-admin-templates-and-dnc-panels.png` | Outreach email templates panel + Do-not-contact rules panel below the queue |

## What this pass deliberately did NOT cover

- **compliance_analyst live click-through** — agent does not have a separate compliance_analyst
  test account, and refused to sign in/out of the user's own preview session to fake one.
- **requester/trader live click-through** — same reason.
- **Destructive platform_admin actions** — approving/archiving a template, adding a candidate,
  sending outreach, opening an escalation, adding a DNC rule. The agent did not commit
  destructive writes against the live preview org without seeded fixtures and explicit go-ahead.

These remain `OPERATOR-VERIFY-REQUIRED` and must be executed by a human operator (or QA with
provisioned `@test.izenzo.co.za` accounts) before declaring `PHASE_2_CLIENT_UAT_READY`.

## New defect found in this live pass

- **EMB-5** — Case drawer subtitle exposed internal role tokens:
  `Admin triage · Phase 2 outreach surface (platform_admin / compliance_analyst)`.
  Patched at `src/components/facilitation/FacilitationCaseDrawer.tsx:133` →
  `Review the case and run outreach`. **Screenshot 02 must be re-captured** after the next
  preview build to confirm.

## How to complete this evidence pack

1. Re-screenshot the case drawer (`02-...`) after the EMB-5 fix is live.
2. Run `platform-admin-checklist.md` against a seeded test case + approved template; capture
   gate-result (green/warn/block), warn-ack, duplicate-send guard, escalation, and DNC screenshots.
3. Sign in as a compliance_analyst test account in a clean browser; run
   `compliance-analyst-checklist.md`.
4. Sign in as a requester/trader test account in a clean browser; run the requester privacy
   checks against the same case.
5. Update `summary.json` verdict only when every checklist item is `PASS (live)`.
