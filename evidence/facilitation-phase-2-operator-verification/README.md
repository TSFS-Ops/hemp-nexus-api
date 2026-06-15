# Facilitation Phase 2 — Operator Verification Evidence

**Status:** `PHASE_2_PARTIAL — NOT CLIENT_UAT_READY`
**Last updated:** 2026-06-15

## Cosmetic UI surface

**CLEAN (live-verified).** All EMB-1..EMB-6 label leaks are resolved and live-verified.
No further UI-label fixes are required based on the latest live re-audit.

## What this pass covered (live, platform_admin only)

| # | Screenshot | What it shows |
|---|---|---|
| 01 | `01-platform-admin-hq-facilitation.png` | `/hq/facilitation` queue with 6 cases, queue header, search/status/urgency filters |
| 02 | `02-platform-admin-case-drawer-triage.png` | Case drawer Triage tab — post-EMB-6 fix, Timeline renders plain-English actions/statuses, OwnerPicker renders "Platform admin", outcome picker renders plain-English outcomes |
| 03 | `03-platform-admin-case-drawer-outreach.png` | Case drawer Outreach tab |
| 04 | `04-platform-admin-templates-and-dnc-panels.png` | Templates + DNC panels |

## Remaining blockers (operator-verification only)

These three are the **only** remaining blockers. Use **seeded UAT fixtures only** — do not run
destructive checks against live client or production-like data, and do not send real outreach
to a real counterparty during verification unless explicitly authorised.

1. **OPERATOR-VERIFY-1** — `compliance_analyst` live click-through.
   Run `compliance-analyst-checklist.md`.
2. **OPERATOR-VERIFY-2** — `requester` / `trader` live click-through.
   Run `requester-trader-checklist.md`.
3. **OPERATOR-VERIFY-3** — `platform_admin` destructive end-to-end flow against seeded fixtures.
   Run `platform-admin-checklist.md` (template approve/archive, candidate add green/warn/block,
   warn-ack-then-send, duplicate-send guard, escalation open, send-blocked-while-open,
   add DNC rule, confirm platform_admin cannot revoke DNC rule).

## How to complete this evidence pack

1. Seed UAT fixtures (test case, draft template, clean / previously-contacted / DNC-blocked
   counterparties) in a non-production org.
2. Execute `platform-admin-checklist.md` end-to-end; capture screenshots 05–13.
3. Sign in as a `compliance_analyst` fixture in a clean browser; run
   `compliance-analyst-checklist.md`; capture screenshots 14–17.
4. Sign in as a `requester` / `trader` fixture in a clean browser; run
   `requester-trader-checklist.md`; capture screenshot 18.
5. Update `summary.json` verdict to `PHASE_2_CLIENT_UAT_READY` only when every checklist item
   is `PASS (live)` and all screenshots are present.
