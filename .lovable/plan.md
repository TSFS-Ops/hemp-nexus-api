## Unknown-Counterparty SLA Hardening — Gap Analysis & Scoping

Before implementing anything, you should know: **most of Batches 1–8 of your master spec already exist in this codebase and have been formally accepted by the client (per memory: "Facilitation Batch 8 — Management View & Exports — ACCEPTED 2026-06-16. Batch 9 held.").** Re-building them would duplicate live tables, edge functions, audits and UI and risk regressing accepted UAT evidence.

This plan maps your master spec to what is live, and identifies the genuine remaining gaps so you can decide what to actually build.

### What is already live (do NOT rebuild)

Tables present and in use:

- `facilitation_cases` (81 cols — covers intake, dual statuses, owner, SLA due_at fields, overdue flag/reasons, closing_reason, final_outcome, linked_organization_*, ready_for_poi_*, poi_conversion_*)
- `facilitation_case_events`, `facilitation_case_evidence`, `facilitation_case_contact_attempts`, `facilitation_case_sla_reminders`, `facilitation_case_registry_checks`, `facilitation_case_sanctions_checks`
- `facilitation_outreach_templates`, `facilitation_outreach_candidates`, `facilitation_outreach_sends`, `facilitation_do_not_contact_rules`, `facilitation_compliance_escalations`

Edge functions present:

- `create-facilitation-case`, `get-facilitation-case`, `list-facilitation-cases`
- `facilitation-case-admin-action`, `facilitation-case-eligible-owners`, `facilitation-case-search-organisations`
- `facilitation-case-sla-evaluate` (SAST + ZA holidays, near-breach + overdue)
- `facilitation-management-metrics`, `facilitation-export-csv`, `facilitation-export-evidence-pack`
- `register-facilitation-case-evidence`
- `facilitation-outreach-*` family (template status, candidate add, DNC add/revoke, send, escalate, escalation resolve)

UI present:

- `FacilitationCaseIntakeForm`, `FacilitationCaseDrawer`, `FacilitationCaseSlaPanel`, `FacilitationCaseProfileLinkPanel`, `FacilitationCaseMilestoneView`, `FacilitationCaseManualChecksPanel`, `FacilitationQueuePanel`, `FacilitationManagementMetrics`, `AdminFacilitationQueueBadges`, `FacilitationOutreachTab`, `FacilitationOutreachTemplatePanel`, `FacilitationDncRulePanel`

Cross-cutting:

- Dual status model with safe requester labels (`facilitation-labels.ts`, `facilitation-case-state.ts`)
- SLA timer engine (`facilitation-sla.ts` + tested)
- POI verification gate respected (manual `ready_for_poi` + `poi_conversion_*` fields, no auto-mint)
- Audit via `audit_logs` + `facilitation_case_events`; CSV + evidence pack exports gated to `platform_admin` / `compliance_analyst`

### Mapping your spec → current state


| Your batch                                                                                                                | Status                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Data model + intake validation                                                                                          | LIVE                                                                                                                                                                                                                                                                                                                                   |
| 2 Roles / RLS (Trade Ops, platform_admin, compliance, requester)                                                          | LIVE                                                                                                                                                                                                                                                                                                                                   |
| 3 17 internal statuses → 8 requester labels                                                                               | LIVE (with minor naming deltas, see gaps)                                                                                                                                                                                                                                                                                              |
| 4 SAST business-hour SLA, weekends, ZA holidays, near-breach, overdue, exact missed deadline                              | LIVE                                                                                                                                                                                                                                                                                                                                   |
| 5 Manual ownership, shared unassigned queue, SLA continues unassigned                                                     | LIVE                                                                                                                                                                                                                                                                                                                                   |
| 6 Reminders + near-breach + breach notifications, requester-safe wording                                                  | LIVE (reminder dispatch path = email; in-app reminder UI is partial)                                                                                                                                                                                                                                                                   |
| 7 Approved templates, manual contact only, approval required, no auto-send/WhatsApp/SMS                                   | LIVE                                                                                                                                                                                                                                                                                                                                   |
| 8 Hard vs warning blocks; compliance-only clearance; owner cannot clear own compliance block                              | LIVE (DB-enforced via `facilitation_compliance_escalations`)                                                                                                                                                                                                                                                                           |
| 9 Closure final outcomes + required evidence + positive-response next-step task                                           | PARTIAL — `final_outcome` enum exists but does **not** include your exact set (`no_response`, `invalid_details`, `duplicate_merged`, `closed_by_admin` — current enum uses `more_information_not_provided`, `outside_supported_scope`, `closed_by_admin_decision`, `duplicate_case`); positive-response admin task is not auto-created |
| 10 Audit trail                                                                                                            | LIVE (canonical `facilitation.*` audit names enforced by prebuild script)                                                                                                                                                                                                                                                              |
| 11 Notifications                                                                                                          | PARTIAL — admin/management notifications via email exist; requester-facing in-app notification cards for "Response received" / "Ready for next step" / "Unable to proceed" not yet wired                                                                                                                                               |
| 12 Management dashboard incl. exact breached deadline type, conversion rate, avg time-to-first-contact, avg time-to-close | PARTIAL — `facilitation-management-metrics` exposes core counts + age; the three time-based KPIs (avg first-review / first-contact / close) and the conversion-rate tile are not all surfaced                                                                                                                                          |
| 13 POI verification gate cannot be bypassed via facilitation lane                                                         | LIVE (no facilitation path mints POI; `ready_for_poi` is a marker only)                                                                                                                                                                                                                                                                |
| 14 Manual link-to-existing-org / create-new-org with duplicate check                                                      | LIVE (`facilitation-case-search-organisations` + `FacilitationCaseProfileLinkPanel`)                                                                                                                                                                                                                                                   |
| 15 Test plan                                                                                                              | PARTIAL — Vitest covers SLA, gate, role-negatives, deeplinks; full role-matrix + closure-evidence + positive-response tests pending                                                                                                                                                                                                    |


### Genuine remaining gaps (candidates for new work)

A. **Closure vocabulary alignment** — extend `facilitation_cases.final_outcome` CHECK constraint to add `no_response` and explicit `closed_by_admin` aliases, plus require evidence/notes for `blocked_by_compliance`, `invalid_details`, `duplicate_merged`, `unable_to_contact`, `no_response` (enforced server-side in `facilitation-case-admin-action`).

B. **Positive-response next-step task** — on `counterparty_responded` → admin action that creates a structured "next-step" task (verify details / create or update org / invite / notify requester / prepare POI step). New table `facilitation_case_next_steps` or reuse `facilitation_case_events` with a typed `next_step` payload. No auto-POI.

C. **Requester-facing in-app notifications** — emit `notifications` rows on the four safe transitions (response_received, ready_for_next_step, unable_to_proceed, closed) using the existing `facilitation-labels.ts` mapping.

D. **Management dashboard KPI tiles** — add to `facilitation-management-metrics`:

- avg time to first review
- avg time to first contact
- avg time to close
- conversion rate (cases ending in `converted_to_known_counterparty_poi` / total closed)
- exact-breached-deadline-type breakdown
   Surface in `FacilitationManagementMetrics`.

E. **Test pack completion** — add Vitest specs for (i) closure-evidence enforcement, (ii) positive-response next-step creation, (iii) requester-visibility role matrix on the new notification rows, (iv) compliance-owner-self-clear block.

These five items are the only places where your master spec exceeds what is already accepted.

### Why I am NOT auto-building the full 15 batches

1. Memory record (`features/facilitation-batch-8-management-exports`) shows Batches 1–8 ACCEPTED 2026-06-16 and **"Batch 9 held"** pending explicit approval — re-implementing the existing batches would breach that hold and could invalidate the accepted UAT evidence pack already delivered to Izenzo.
2. The current schema, edge functions, audit names and exports are referenced by live prebuild guards (`check-data-002-audit-names.mjs`, facilitation audit guard, identity/tenant-boundary guards). Rebuilding them risks CI failure and regressions.
3. Several spec items contradict current accepted decisions (e.g. closure-reason vocabulary, the canonical audit name set). These need an explicit "supersede" instruction, not a silent rewrite.

### Recommended next step (please pick one)

**Option 1 — Build only the five gaps (A–E) as "Batch 9".** Smallest, safest, keeps accepted UAT intact. Estimated: 1 migration (closure enum + evidence enforcement), ~3 edge function edits, ~2 UI edits, ~4 new tests.

**Option 2 — Treat your master spec as a formal supersede of Batches 1–8.** Requires re-running the full UAT evidence pack with Izenzo, replacing the audit-name canon, and migrating existing facilitation rows to new vocabulary. Multi-day effort and re-opens accepted scope.

**Option 3 — Discovery only.** I produce a written delta document mapping every line of your 15-batch spec to a file/line/table reference in the current build, with no code changes, for Izenzo sign-off before any build.

Please confirm Option 1, 2 or 3 before I touch code.  
  
Yes — choose **Option 1**.

Do **not** rebuild Batches 1–8. If they are already live and accepted, rebuilding them would create unnecessary risk. The correct instruction is to treat this as **Facilitation Batch 9: Close the remaining gaps only**.

You can send this:

Proceed with **Option 1 — Build only the five confirmed gaps as Facilitation Batch 9**.

Do not rebuild or alter the accepted Batches 1–8. Preserve the existing tables, edge functions, audit names, UI components, RLS patterns, exports and accepted evidence.

The scope for Batch 9 is limited to the following:

1. Closure vocabulary alignment  
Extend the existing `facilitation_cases.final_outcome` handling only where needed. Add support for the missing outcomes/aliases identified in the gap analysis, including `no_response` and explicit `closed_by_admin` handling, without breaking existing accepted values. Enforce server-side closure evidence/notes for sensitive outcomes such as blocked by compliance, invalid details, duplicate, unable to contact and no response.
2. Positive-response next-step task  
When a case reaches `counterparty_responded` with a positive response, create a structured internal next-step task or typed event. The task should cover: verify details, create or update organisation, invite counterparty where appropriate, link to trade/match, notify requester using safe wording, and prepare the next POI-related step. This must not create a POI, WaD, verification status, compliance clearance or binding commercial state automatically.
3. Requester-facing in-app notifications  
Wire requester-safe in-app notifications for the safe transitions only: response received, ready for next step, unable to proceed and closed. Use the existing requester-safe label mapping. Do not expose internal notes, breach wording, compliance details, escalation details or risk comments.
4. Management dashboard KPI tiles  
Extend `facilitation-management-metrics` and the management UI to surface: average time to first review, average time to first contact, average time to close, conversion rate, and exact breached-deadline-type breakdown.
5. Test pack completion  
Add tests for closure-evidence enforcement, positive-response next-step creation, requester notification visibility/role matrix, and compliance-owner-self-clear blocking.

Important constraints:

- Do not supersede or rewrite Batches 1–8.
- Do not change canonical audit names unless strictly necessary and guarded.
- Do not migrate accepted live vocabulary unless backwards-compatible.
- Do not create duplicate tables or duplicate workflow logic.
- Do not introduce automatic sending, WhatsApp, SMS, automatic assignment, automatic verification, automatic compliance clearance, automatic POI creation or automatic WaD creation.
- Preserve the POI verification gate.
- Preserve requester-safe visibility.
- Preserve existing exports and management access rules.
- Build against the live accepted facilitation architecture.

Please implement Batch 9 in small, reviewable commits or changesets:

Batch 9A — closure vocabulary and closure-evidence enforcement  
Batch 9B — positive-response next-step task/event  
Batch 9C — requester-safe in-app notifications  
Batch 9D — management KPI tiles  
Batch 9E — test pack completion

After each sub-batch, provide a concise summary of files changed, database changes, edge function changes, UI changes, and tests added or updated.

The important point is: **this is no longer a 15-batch build**. It is a **targeted Batch 9 completion** on top of accepted work.