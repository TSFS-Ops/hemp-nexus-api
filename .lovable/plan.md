# P012 — User-facing Unknown-Counterparty Status Timeline

A large, multi-surface build. Before implementing I want to confirm scope/approach so we don't conflict with the existing facilitation_cases system already in the schema.

## Key observation — reuse vs. parallel

The DB already has a mature facilitation stack:

- `facilitation_cases` (85 cols)
- `facilitation_case_events`
- `facilitation_case_contact_attempts`
- `facilitation_case_next_steps`
- `facilitation_outreach_*` (templates, candidates, sends)
- `facilitation_compliance_escalations`
- `facilitation_do_not_contact_rules`
- `engagement_outreach_*`

P012 describes essentially the same domain (unknown-counterparty facilitation with admin outreach, SLA, escalation, audit) but with a **finite, user-facing, safe-copy timeline** layered on top. Building a **second parallel system** (`unknown_counterparty_cases`, `unknown_counterparty_outreach_logs`, etc.) would duplicate the existing facilitation pipeline, fork SLA/audit logic, and conflict with the Facilitation SLA SSOT and Batch 7–12 closeout work in memory.

**Proposed approach (recommended):** implement P012 as a **user-facing projection layer** over the existing `facilitation_cases` system, not as a duplicate.

## Plan

### 1. Schema (additive, minimal)

- New column `facilitation_cases.user_facing_status` (enum-as-text, 16 visible + 1 internal status from the P012 list).
- New column `facilitation_cases.status_group` ('open' | 'awaiting' | 'outcome' | 'closed').
- New column `facilitation_cases.reopen_allowed boolean`.
- New table `unknown_cp_timeline_events` — projected, user-safe events with `user_visible`, `user_facing_copy`, `reason_code`, `previous_status`, `new_status`, `actor_role`, `source`, `audit_event_name`. Populated by triggers/RPC from real `facilitation_case_events` and admin actions. Requester-readable via RLS (only rows where `user_visible = true` AND requester owns the linked POI).
- New table `unknown_cp_user_messages` — requester-submitted "Add more information" / "Contact support" messages with attachments, category, visibility, support delivery ref.
- Reuse `facilitation_case_contact_attempts` for outreach logs (admin-only, already exists). No new outreach table.
- All new tables: GRANT + RLS + service_role.

### 2. SSOT module `src/lib/unknown-cp-timeline.ts` (mirrored to `supabase/functions/_shared/`)

- 17 canonical statuses with order, visibility, status_group, exact approved user-facing copy (verbatim).
- 11 canonical audit event names (`unknown_cp_case_created`, etc.).
- Forbidden user-facing words list (`guaranteed`, `verified`, `approved`, `cleared`, `accepted`, `contacted`, `onboarded`) when not status-backed.
- Block-matrix function: `getAllowedActions(status)` → { addMoreInfo, contactSupport, cancel, progressToWad } + disabled message.
- SLA wording constant + business-hours rules (reuse `facilitation-sla.ts`).

### 3. Edge functions

- `unknown-cp-case-bootstrap` — fires when an unknown-counterparty POI is created; opens facilitation case, sets `user_facing_status = 'poi_created'`, emits both timeline events.
- `unknown-cp-status-transition` — admin-driven structured status changes (Start review, Request more info, Log outreach, Send invite, Mark onboarding, Confirm linked, Record declined / no-response / unreachable / invalid, Close, Reopen). Validates source rules, role gates (platform_admin for reopen), writes timeline event + `event_store` audit row + dispatches notifications.
- `unknown-cp-user-action` — requester-driven: Add more information (min 20 chars, attachment validation), Contact support, Cancel request. Routes to [support@izenzo.co.za](mailto:support@izenzo.co.za) via existing transactional email pipeline.
- `unknown-cp-sla-sweep` — cron, marks `is_overdue_review` / `is_overdue_outreach` / `is_escalated_internal` per thresholds.

### 4. WaD/POI progression guard

Extend existing POI/WaD progression gates (`poi-verification-gate-wiring`, `compliance-freshness-guard`) so that when a POI has an unknown-counterparty facilitation case, progression requires `user_facing_status = 'converted_to_known_counterparty'` AND existing gates still pass. No bypass.

### 5. UI

- `src/components/unknown-cp/UnknownCpTimelinePanel.tsx` — heading "Unknown-counterparty facilitation", subheading, status badge (reuse `StatusBadge`), ordered visible events with timestamps, neutral SLA badge, blocked-progression message.
- `src/components/unknown-cp/AddMoreInformationDialog.tsx` — message (≥20 chars), reason dropdown, attachment (PDF/DOCX/PNG/JPG, ≤10MB, mime allowlist, banking-doc warning).
- `src/components/unknown-cp/ContactSupportDialog.tsx`.
- `src/components/unknown-cp/CancelRequestDialog.tsx` — confirmation gate.
- Mount panel on POI detail / trade-request pages where unknown-counterparty case exists; hide otherwise.
- `src/components/admin/UnknownCpAdminPanel.tsx` — structured admin actions (no free-text status changes); each action is a typed form mapping 1:1 to `unknown-cp-status-transition`.

### 6. Notifications

Wire material status changes (per table) into existing `notification_dispatches` + transactional email templates. Internal-only events (Outreach prepared, owner assignment, internal escalation) never notify requester.

### 7. Build guards (prebuild)

- `scripts/check-unknown-cp-copy-drift.mjs` — verifies UI/admin components import approved copy from SSOT only; scans for forbidden words outside SSOT/tests; ensures `outreach_prepared` never appears in any requester-facing component or route.
- `scripts/check-unknown-cp-audit-names.mjs` — parity between TS SSOT and Deno SSOT and edge-function emissions.
- `scripts/check-unknown-cp-status-parity.mjs` — TS enum ↔ DB CHECK constraint parity.
- Add to RELEASE_GATE.md + edge-function deploy manifest.

### 8. Tests

`src/tests/p012-unknown-cp-timeline.test.ts` — covers every backend, UI, RLS, notification, and gate test listed in the spec (≥40 cases).

### 9. Evidence

`evidence/p012-user-facing-unknown-counterparty-status-timeline/README.md` per spec.

### 10. Memory

Add `mem://features/unknown-cp-timeline` describing the projection-layer architecture, finite status list, and SSOT location. Update index.

## What I need from you before building

**Question:** Do you want me to (A) build P012 as a projection layer over the existing `facilitation_cases` system (recommended — no duplication, single SLA, single audit trail), or (B) build the standalone `unknown_counterparty_*` tables exactly as the spec literally lists them (parallel system, larger surface, will require ongoing sync with facilitation pipeline)?

If you don't reply, I will proceed with **(A) projection layer** since it preserves the existing SLA/audit SSOT and avoids breaking Batch 7–12 facilitation work already in production memory.  
  
Proceed with **A — projection layer over the existing** `facilitation_cases` **system**.

That is the correct enterprise approach.

Do **not** build a second parallel `unknown_counterparty_*` case/outreach system where it duplicates the existing facilitation stack. The goal of P012 is not to replace the facilitation pipeline; it is to add a **finite, safe, user-facing timeline projection** on top of the already-existing admin-led facilitation system.

Send this instruction back:

---

## **Approved approach for P012**

Proceed with **Option A: projection layer over the existing** `facilitation_cases` **system**.

Do not create a duplicate facilitation pipeline.

The existing stack already covers the operational domain:

- `facilitation_cases`
- `facilitation_case_events`
- `facilitation_case_contact_attempts`
- `facilitation_case_next_steps`
- `facilitation_outreach_*`
- `facilitation_compliance_escalations`
- `facilitation_do_not_contact_rules`
- `engagement_outreach_*`

P012 should sit on top of this as the **user-facing safe timeline layer**, not fork the domain.

## **Binding build decision**

Use the existing facilitation case as the source of operational truth.

Add only what is needed to safely expose a requester-facing timeline:

- finite `user_facing_status`
- status group
- reopen flag
- safe projected timeline events
- requester messages / support actions
- SSOT copy/status mapping
- admin structured transitions
- requester-safe RLS
- WaD/POI progression guard
- notifications
- audit events
- tests
- build guards
- evidence README

## **Important rules**

1. **No duplicated outreach system**  
Reuse `facilitation_case_contact_attempts` and existing outreach structures.
2. **No duplicated SLA engine**  
Reuse the existing facilitation SLA SSOT where possible.
3. **No duplicated audit model**  
Timeline events should project from or align with existing facilitation events and canonical audit/event-store patterns.
4. **No weakening existing gates**  
Unknown-counterparty POIs must remain blocked from WaD or counterparty-dependent progression until converted to a known counterparty and all normal POI/WaD gates pass.
5. **Requester sees only safe projection**  
The requester must never see internal notes, raw outreach logs, staff names, compliance notes, risk notes, private counterparty contact details, or internal escalation details.
6. `Outreach prepared` **remains internal-only**  
It must never appear in requester-facing UI, requester routes, evidence packs, or notifications.
7. **Build guards are mandatory**  
Add guards for copy drift, status parity, audit-name parity, forbidden wording, internal-status leakage, and requester-facing exposure of outreach/contact internals.

## **Scope clarification**

The literal table names in the earlier P012 spec were intended to describe the required capabilities. They are **not** an instruction to fork the already-built facilitation system.

The correct architecture is:

Existing facilitation system = operational source of truth  
P012 = controlled user-facing status projection + requester actions + gates + notifications + audit-safe evidence

## **Proceed**

Build P012 using the projection-layer approach, then test internally thoroughly. Client does not want UAT, so self-test backend, UI, RLS, notifications, route guards, build guards, and evidence output before marking complete.

Final completion phrase remains:

`P012_USER_FACING_UNKNOWN_COUNTERPARTY_STATUS_TIMELINE_COMPLETE`