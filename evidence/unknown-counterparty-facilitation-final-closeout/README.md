# Unknown-Counterparty Facilitation Queue — Final Closeout

**Status:** `UNKNOWN_COUNTERPARTY_FACILITATION_CLIENT_UAT_READY_WITH_RECORDED_CAVEATS`
**Date:** 2026-06-16
**Scope:** Batches 3–8 (intake → management exports). No new feature work in Batch 9.

This document is the single source of truth mapping Daniel's completed client questionnaire ("Unknown_Counterparty_Facilitation_Queue_Completed") to the implemented surfaces, recorded caveats, and remaining non-built items.

---

## 1. Accepted batches

| Batch | Scope | Acceptance status |
|-------|-------|-------------------|
| 3 | Intake form, lifecycle statuses, final outcomes, user-facing labels | Accepted |
| 4 | Request More Information action + basic in-app notifications | Accepted |
| 5 | Manual registry/KYB capture, manual sanctions/PEP capture, contact-result capture | Accepted |
| 6 | Organisation linking, profile-created record, "Ready for POI" control | Accepted (2 caveats) |
| 7 | SLA due dates, overdue badges, reminders, stale-no-activity logic | Accepted (2 caveats) |
| 8 | Management metrics, queue columns/filters, CSV export, evidence-pack export | Accepted (3 caveats) |

---

## 2. Questionnaire → implementation map

| # | Client requirement | Implementation location | Status | Caveat |
|---|--------------------|--------------------------|--------|--------|
| 1 | Trigger for the queue | `submit-facilitation-case` + `FacilitationIntakeForm` | Built | Auto-detector for "invite unopened ≥3 business days" is not wired — admins create the case manually when observed. |
| 2 | Required intake fields | `FacilitationIntakeForm.tsx` + Zod on `submit-facilitation-case` | Built | None. |
| 3 | Admin triage ownership | `FacilitationQueuePanel` + `FacilitationCaseDrawer` + `facilitation-case-assign-owner` | Built | None. |
| 4 | Queue statuses (11 lifecycle + Closed outcomes) | `_shared/facilitation-case-state.ts` `INTERNAL_STATUSES`; drift-guarded | Built | None. |
| 5 | Admin actions (24 canonical) | `facilitation-*` edge functions across Batches 3–8 | Built | "Approved outreach email" path uses operator-approved sends only; no auto-send. |
| 6 | User visibility (milestone only) | `get-facilitation-case` returns redacted view for requester role | Built | Requester live denial screenshot deferred (Batch 8). |
| 7 | Counterparty contact rules (approved system email + logged manual call only) | `facilitation-outreach-send` is the only Resend path; `check-facilitation-no-send-path` guard | Built | Live outreach to a real counterparty intentionally not exercised in UAT. |
| 8 | DNC + blocking rules | `facilitation-outreach-dnc-add/-revoke`, `facilitation-outreach-candidate-add` gate, `facilitation-compliance-escalation` | Built | Compliance escalation is event-driven (no separate scheduler). |
| 9 | Service-level expectations | `_shared/facilitation-sla.ts` SSOT + `facilitation-case-sla-evaluate` + `FacilitationCaseSlaPanel` | Built | Overdue-cleared live transition + compliance-review-due live path deferred (Batch 7). |
| 10 | Evidence & audit | `audit_logs` + `facilitation_case_events` append-only; evidence pack export | Built | Evidence-pack JSON is not SHA-256 sealed (underlying rows are append-only). |
| 11 | Duplicate & existing-org handling | `facilitation-suggest-matches`, `facilitation-link-organisation`, `facilitation-mark-duplicate` | Built | Verified-domain same-country is a warning, not a hard block. No auto-merge. |
| 12 | Final outcomes (11 codes) | `_shared/facilitation-case-state.ts` `OUTCOMES`; drift-guarded | Built | Manual POI conversion not exercised end-to-end (Batch 6 caveat). |
| 13 | Notifications | `facilitation_case_events` → `notification-dispatch` fan-out; SLA reminders | Built | No admin UI template editor per event. |
| 14 | Reporting & management view | `FacilitationManagementMetrics` + queue columns/filters + CSV + evidence pack | Built | Three Batch-8 live-probe caveats. |

---

## 3. Caveats register

### Batch 6
- **R6-C1** Requester live second-account screenshot not exercised — server-side privacy and RLS verified by code review.
- **R6-C2** Manual POI conversion not exercised end-to-end — no safe seeded POI reference existed at the time of operator verification.

### Batch 7
- **R7-C1** Overdue-cleared live transition deferred — requires a real status change on a seeded case.
- **R7-C2** Compliance-review-due live path deferred — no seeded case sat in compliance review.

### Batch 8
- **R8-C1** Requester live denial screenshot not exercised — server-side 403 returned by code path verified.
- **R8-C2** Compliance_analyst live access not exercised — code-level access is metrics + CSV allowed, evidence-pack denied.
- **R8-C3** Cross-tenant live probe not exercised against a second-organisation case — evidence pack is hard-scoped by `case_id`.

None of the seven caveats are functional blockers. All are deferred *live exercises* on seeded fixtures.

---

## 4. Negative controls (final state)

Confirmed **absent** in the codebase and enforced by the prebuild drift-guard suite:

- No automatic POI creation
- No automatic organisation creation
- No automatic organisation merge
- No automatic case closure
- No automatic outreach send
- No live registry/KYB integration
- No live sanctions/PEP integration
- No WhatsApp / SMS / social-media messaging
- No bulk outreach
- No payment / token / WaD / match / credit mutation

Active guards (all run in `npm run prebuild`):
- `check-facilitation-case-audit-names.mjs` (24 canonical `facilitation_case.*` audits pinned)
- `check-facilitation-no-send-path.mjs`
- `check-facilitation-outreach-audit-names.mjs`
- `check-facilitation-dnc-audit-names.mjs`
- `check-facilitation-status-drift.mjs`
- `check-facilitation-outreach-drift.mjs`
- `check-facilitation-sla-drift.mjs`

---

## 5. Not built / out of scope

### Built but caveated
See section 3.

### Not built (no client approval yet — deferred policy items)
- Automated detector for "invite unopened ≥3 business days" → auto-create facilitation case.
- SHA-256 sealing of the exported evidence-pack JSON.
- Admin UI for editing email-notification templates per event.

### Intentionally out of scope at launch (per questionnaire)
- Automatic merge of duplicate organisations.
- Bulk outreach.
- SMS, WhatsApp, social-media DMs.

### Requires external integration or client data
- Live registry/KYB providers — current implementation is manual capture via `facilitation-record-registry-check`.
- Live sanctions/PEP feeds — current implementation is manual capture via `facilitation-record-sanctions-check`.
- Real counterparty outreach — requires real counterparty data and consent.

---

## 6. Final recommendation

The Unknown-Counterparty Facilitation Queue is **ready for client UAT** with the seven deferred operator caveats recorded above.

Recommended UAT plan:
1. Operate against seeded `FAC-2026-*` cases on `/hq/facilitation`.
2. Exercise the seven deferred items in a controlled session with a second seeded account and a seeded POI reference.
3. Sign off; then schedule a separate decision session for the three not-built deferred items (auto-trigger detector, evidence-pack sealing, notification template editor) and the three external integrations.

No further feature batches should start until UAT sign-off is recorded.

---

## 7. Cross-references

- Memory: `mem://features/facilitation-batch-8-management-exports`
- Memory: `mem://features/facilitation-batch-7-sla-tracking` (acceptance recorded in chat 2026-06-16)
- Prebuild guard suite: `scripts/check-facilitation-*.mjs`
- SSOT: `supabase/functions/_shared/facilitation-case-state.ts`, `supabase/functions/_shared/facilitation-sla.ts`, `supabase/functions/_shared/facilitation-outreach-constants.ts`
- Release gate entries: `RELEASE_GATE.md` lines 65–70 (audit-name, send-path, status, outreach, DNC, SLA guards)
