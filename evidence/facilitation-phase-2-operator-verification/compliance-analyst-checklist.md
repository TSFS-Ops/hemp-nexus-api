# Compliance Analyst — Manual Operator Checklist (Facilitation Phase 2)

**Sign-in identity required:** `compliance_analyst` (e.g. `@test.izenzo.co.za` compliance fixture).
**Route:** HQ → Facilitation tab and the case drawer.

---

## A. Read-only Surfaces

- [ ] **A1.** Open the Template Registry panel. Confirm templates are visible but lifecycle controls (approve / archive) are NOT available to compliance_analyst.
- [ ] **A2.** Open the Outreach tab on a case. Confirm candidates and gate results are visible; the `Send` button is NOT available to compliance_analyst.

## B. DNC Management

- [ ] **B1.** Add a new DNC rule (email, domain, or org-name). Confirm row created and `facilitation.dnc.rule_added` audit emitted.
- [ ] **B2. Revoke ALLOWED.** Revoke an existing DNC rule. Confirm `revoked_at` and `revoked_by` populate and `facilitation.dnc.rule_revoked` audit emitted.
- [ ] **B3.** Confirm a previously hard-blocked candidate's gate now re-evaluates to OK (or downgraded) after the relevant DNC rule is revoked.

## C. Compliance Escalation — Resolve/Reopen ALLOWED

- [ ] **C1.** Open an `open` compliance escalation from the queue.
- [ ] **C2. Resolve.** Resolve with a reason. Confirm status moves to `resolved`, `facilitation_outreach.escalation_resolved` audit emitted, and the underlying candidate's send path unblocks (subject to other gates).
- [ ] **C3. Reopen.** Reopen the same escalation. Confirm status returns to `open`, `facilitation_outreach.escalation_reopened` audit emitted, and the candidate's send path is blocked again.

## D. Separation of Duties Negative Checks

- [ ] **D1.** Confirm UI does NOT expose: template approve/archive, candidate add, send, or escalation-open actions to compliance_analyst.
- [ ] **D2.** Attempt to call `facilitation-outreach-template-status` directly. Confirm `403`.
- [ ] **D3.** Attempt to call `facilitation-outreach-send` directly. Confirm `403`.
- [ ] **D4.** Attempt to call `facilitation-outreach-escalate` (open). Confirm `403`.

## E. Sign-off

- [ ] **E1.** All A–D items ticked.
- [ ] **E2.** Screenshots attached per `screenshot-checklist.md`.
- [ ] **E3.** Signed by: _________________________ Date: __________
