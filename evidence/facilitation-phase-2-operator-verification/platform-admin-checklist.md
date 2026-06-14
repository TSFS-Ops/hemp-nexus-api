# Platform Admin — Manual Operator Checklist (Facilitation Phase 2)

**Sign-in identity required:** `platform_admin` (e.g. `@test.izenzo.co.za` admin fixture).
**Route:** HQ → Facilitation tab and the case drawer.

For each line item, perform the action, observe the UI / response, and capture a screenshot named per `screenshot-checklist.md`.

---

## A. Template Registry (HQ → Template Registry panel)

- [ ] **A1.** Open the Template Registry panel. Confirm the list of templates renders.
- [ ] **A2.** Transition a `draft` template to `approved`. Confirm the row updates and an `facilitation_outreach.template_status_changed` audit row is visible in admin audit (or DB).
- [ ] **A3.** Transition an `approved` template to `archived`. Confirm the row updates and audit emitted.
- [ ] **A4.** Confirm no Resend / send call is triggered by template lifecycle actions.

## B. Candidate Registration (Case Drawer → Outreach tab)

- [ ] **B1. Green gate.** Add a candidate with a clean email + clean org name (no DNC match). Confirm the gate result renders `OK` (green) and the candidate appears in the list.
- [ ] **B2. Warning gate.** Add a candidate with an org-name partial match against an existing DNC rule. Confirm the gate result renders `WARNING` with the matched rule cited, and the send button is disabled until acknowledgement.
- [ ] **B3. Hard-block (email).** Add a candidate whose email matches an active DNC email rule. Confirm the gate result renders `BLOCKED` and the send action is fully disabled.
- [ ] **B4. Hard-block (domain).** Add a candidate whose email domain matches an active DNC domain rule. Confirm the gate result renders `BLOCKED`.
- [ ] **B5. Suppressed email.** Add a candidate whose email is in `suppressed_emails`. Confirm gate renders `BLOCKED` citing suppression.

## C. Send Flow (Case Drawer → Outreach tab)

- [ ] **C1. Approved-template required.** Attempt to send with an unapproved template selected (if UI permits selection). Confirm send is rejected with a clear error.
- [ ] **C2. Warning acknowledgement.** With a warning-gate candidate, attempt send without ticking the acknowledgement. Confirm send is rejected. Tick acknowledgement, retry, confirm send succeeds.
- [ ] **C3. Idempotency.** Click send twice in quick succession (same Idempotency-Key). Confirm exactly **one** row in `facilitation_outreach_sends` and exactly one `facilitation_outreach.send_succeeded` audit; the second attempt logs `send_idempotent_replay`.
- [ ] **C4. Open escalation blocks send.** Open a compliance escalation for the same target. Confirm send is now blocked until escalation is resolved by a compliance analyst.

## D. Compliance Escalation — Opening

- [ ] **D1.** From the Outreach tab, raise a new compliance escalation against a candidate. Confirm the escalation appears in the queue with status `open`.
- [ ] **D2.** Audit row `facilitation_outreach.escalation_opened` emitted.

## E. Compliance Escalation — Resolve/Reopen DENIED

- [ ] **E1.** Locate the resolve / reopen UI affordances. Confirm they are **not** available to platform_admin (button hidden or disabled with role tooltip).
- [ ] **E2.** Attempt to call `facilitation-outreach-escalation-resolve` directly (e.g. via curl). Confirm response is `403` with `not_compliance_analyst` (or equivalent) error.

## F. DNC Rule Management

- [ ] **F1.** Add a new DNC rule (email or domain) via the DNC panel. Confirm row created and `facilitation.dnc.rule_added` audit emitted.
- [ ] **F2.** Locate the revoke affordance. Confirm it is **not** available to platform_admin.
- [ ] **F3.** Attempt to call `facilitation-outreach-dnc-revoke` directly. Confirm `403`.

## G. Owner Picker (Case Drawer)

- [ ] **G1.** Open a facilitation case drawer. Confirm the owner field renders as a **dropdown** populated from `facilitation-case-eligible-owners`, not a freehand UUID input.
- [ ] **G2.** Reassign the case via the dropdown and confirm the change persists.

## H. Trader Milestone Redaction

- [ ] **H1.** Sign out and sign in as the requester user that raised the original facilitation case. Confirm the milestone view shows only `coarse_outreach_state` (e.g. `in_progress`) and no PII, template body, gate logs, candidate emails, or DNC details.

## I. Sign-off

- [ ] **I1.** All A–H items ticked.
- [ ] **I2.** Screenshots attached per `screenshot-checklist.md`.
- [ ] **I3.** Signed by: _________________________ Date: __________
