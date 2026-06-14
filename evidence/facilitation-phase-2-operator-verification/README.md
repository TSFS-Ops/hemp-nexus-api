# Facilitation Phase 2 — Operator Verification Pack

**Status:** `PHASE_2_HEADLESS_VERIFICATION_PASS — MANUAL_OPERATOR_CHECKS_PENDING`

This directory holds the closeout evidence for Phase 2 of the Unknown-Counterparty Facilitation Outreach system (DNC + Compliance Escalation + Send + Owner Picker + Trader Redaction). No new features were added during verification — this is observation only.

## Contents

| File | Purpose |
| --- | --- |
| `summary.json` | Machine-readable headless verification result (prebuild, typecheck, gate unit tests, RLS inspection, send-path uniqueness, negative controls, audit-name SSOT). |
| `platform-admin-checklist.md` | Manual operator checks to be performed while signed in as a `platform_admin`. |
| `compliance-analyst-checklist.md` | Manual operator checks to be performed while signed in as a `compliance_analyst`. |
| `screenshot-checklist.md` | Exact list of UI states to capture and drop into `./screenshots/`. |

## Headless verification — what passed

1. **Full `npm run prebuild`** (not only the new guards) — PASS. Three new facilitation guards added to `RELEASE_GATE.md` so the gate-sync check is happy.
2. **TypeScript typecheck** (`npx tsc --noEmit`) — PASS, 0 errors.
3. **Gate unit tests** (`src/tests/facilitation-outreach-gate.test.ts`) — 11/11 PASS, covering green / warning / hard-block / suppressed-email / open-escalation-dominates / warning-ack-required / approved-template-required / duplicate-detection / DNC separation-of-duties.
4. **RLS inspection** of all 5 Phase 2 tables (`facilitation_outreach_templates`, `facilitation_outreach_candidates`, `facilitation_outreach_sends`, `facilitation_do_not_contact_rules`, `facilitation_compliance_escalations`) — RLS ENABLED on every table, ordinary requester/trader users have no SELECT policy, UPDATE on DNC rules and escalations is `compliance_analyst`-only.
5. **Send-path uniqueness** — Resend / `send-transactional-email` / `notification-dispatch` only appear in `facilitation-outreach-send`. Verified by `check-facilitation-outreach-audit-names.mjs`.
6. **Negative controls** — no SLA cron, no reporting dashboard, no CSV export, no audit-pack PDF, no bulk send, no auto-send, no inbound reply handling, no auto-onboarding, no POI / WaD / match / token / credit / payment / `poi_engagements` / `compliance_cases` mutation, no platform-admin compliance override path. Each enforced by a wired prebuild guard.
7. **Audit-name SSOT** — 10 canonical `facilitation_outreach.*` codes and 2 canonical `facilitation.dnc.*` codes pinned across edge + browser SSOT files.

## What is not yet covered

Live runtime observations (template approve, candidate add, DNC block, escalation block, idempotent replay, trader milestone view) — these belong to the two manual operator checklists below and must be completed before the system can be declared `PHASE_2_CLIENT_UAT_READY`.

## How to close out

1. Sign in as a `platform_admin` test user, walk through `platform-admin-checklist.md`, tick every line, attach screenshots.
2. Sign in as a `compliance_analyst` test user, walk through `compliance-analyst-checklist.md`, tick every line, attach screenshots.
3. Re-run `npm run prebuild` and capture the final clean output.
4. Update `summary.json.status` to `PHASE_2_CLIENT_UAT_READY` and commit the closeout.
