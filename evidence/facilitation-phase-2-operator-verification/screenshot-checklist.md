# Screenshot Checklist

Drop captures into `./screenshots/` using the filenames below. PNG preferred. Redact PII before committing.

## Platform Admin

1. `pa-A2-template-approved.png` — Template Registry row showing `approved` status.
2. `pa-A3-template-archived.png` — Template Registry row showing `archived` status.
3. `pa-B1-candidate-green-gate.png` — Outreach tab with a green gate result.
4. `pa-B2-candidate-warning-gate.png` — Outreach tab with a warning gate result + ack checkbox visible.
5. `pa-B3-candidate-blocked-email.png` — Outreach tab with a hard-block (email DNC) gate result.
6. `pa-B4-candidate-blocked-domain.png` — Outreach tab with a hard-block (domain DNC) gate result.
7. `pa-B5-candidate-blocked-suppressed.png` — Outreach tab with a suppressed-email block.
8. `pa-C3-idempotent-replay.png` — `facilitation_outreach_sends` row (DB or admin view) showing exactly one send for the Idempotency-Key, plus the replay audit row.
9. `pa-C4-open-escalation-blocks-send.png` — Send action disabled with an open escalation visible.
10. `pa-D1-escalation-opened.png` — Escalation queue showing the newly opened escalation.
11. `pa-E1-resolve-hidden.png` — UI confirming resolve/reopen controls are NOT shown to platform_admin.
12. `pa-E2-resolve-403.png` — Network/console capture of the direct API call returning 403.
13. `pa-F1-dnc-rule-added.png` — DNC panel showing the newly added rule.
14. `pa-F2-revoke-hidden.png` — DNC panel showing no revoke control for platform_admin.
15. `pa-F3-dnc-revoke-403.png` — Network capture of direct DNC revoke call returning 403.
16. `pa-G1-owner-picker.png` — Case drawer owner field rendered as a dropdown.
17. `pa-H1-trader-milestone-coarse.png` — Requester view of milestone showing only `coarse_outreach_state`.

## Compliance Analyst

1. `ca-A1-template-readonly.png` — Template Registry visible without approve/archive controls.
2. `ca-A2-send-hidden.png` — Outreach tab visible without the Send button.
3. `ca-B1-dnc-rule-added.png` — DNC rule added by compliance_analyst.
4. `ca-B2-dnc-revoked.png` — DNC rule revoked (`revoked_at` populated).
5. `ca-B3-gate-reevaluated.png` — Previously blocked candidate now showing OK / downgraded gate.
6. `ca-C2-escalation-resolved.png` — Escalation row showing `resolved` status.
7. `ca-C3-escalation-reopened.png` — Escalation row showing `open` again after reopen.
8. `ca-D2-template-status-403.png` — Direct call to `facilitation-outreach-template-status` returning 403.
9. `ca-D3-send-403.png` — Direct call to `facilitation-outreach-send` returning 403.
10. `ca-D4-escalate-403.png` — Direct call to `facilitation-outreach-escalate` returning 403.
