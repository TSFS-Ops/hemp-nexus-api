# Enterprise Support Centre — Phase 0 Correction Addendum

Status: read-only. No code, migrations, data, RLS, routes or branches were changed.
Scope: corrects the Phase 0 Implementation Readiness Report against the completed questionnaire
(Izenzo_Enterprise_Support_Client_Decision_Questionnaire_Completed.docx) and the corrective directives issued.
Encoding: clean UTF-8. All mojibake ("—", "…", "→", "24×7", broken box characters) is removed.

Authoritative source for all client answers below: the completed questionnaire, Decisions 1–64.
Where the source is an engineering proposal it is labelled as such and never presented as a client decision.

---

## 1. Decisions 53–64 — Exact Validation

The prior report described Decisions 53–64 as "unavailable" or "approved in outline". That statement is retracted.
All twelve are fully answered in the completed questionnaire. Exact validation follows.

### Decision 53 — Emergency-release process
- Approved answer: Permit emergency release only during a formally declared critical incident.
  Incident Commander authorises; Platform Administrator and Engineering Lead concurrence where available.
  Every emergency change requires stated reason, tested rollback plan, audit evidence, post-release verification,
  and retrospective review within 1 business day. A developer may not release unilaterally.
- Current repo position: no emergency-release workflow exists.
- Required build: `emergency_releases` record linked to an active incident + release; approval capture;
  rollback-plan field (required, non-empty); post-release verification event; scheduled retrospective task.
- Required permissions: Only Incident Commander (or fallback) may authorise, via a SECURITY DEFINER RPC.
  Platform Administrator concurrence recorded but not required to unblock during declared incident.
- Required audit evidence: `event_store` entries for propose → authorise → deploy → verify → retrospective.
- Required tests: unit — cannot authorise outside declared critical incident; RPC rejects developer role;
  rollback plan required; retrospective task auto-created; audit chain complete.
- Phase: Later phase (release/incident tooling). Not in Phase 1A/1B/1C.

### Decision 54 — Customer confirmation before closure
- Approved answer: Always require customer confirmation. Ticket sits in "Confirmation requested" until customer
  confirms or auto-closure period expires. Customer may reopen.
- Current position: No confirmation or reopen exists.
- Required build: Ticket status `confirmation_requested`; `confirm_resolution` and `reopen_ticket` RPCs;
  reopen preserves original ticket ID.
- Permissions: only the ticket's authenticated customer or delegated org member may confirm/reopen.
- Audit: `resolution_requested`, `resolution_confirmed`, `ticket_reopened` lifecycle events.
- Tests: cannot confirm as non-owner; reopen restores prior owner + timeline; auto-closure blocked while confirmation pending until timer elapses.
- Phase: Core release (part of Phase 1 sequence; specific batch in Phase 2 after teams/SLA).

### Decision 55 — Automatic closure after resolution
- Approved answer: Auto-close resolved tickets after 7 calendar days without customer response.
  Warning at least 2 days before closure. Record auto-close event. Reopening permitted.
- Current position: No timer exists.
- Required build: scheduled worker (cron) that emits warning at T-2d and closure at T=7d; templated notification;
  `ticket_auto_closed` event with the timer parameters snapshotted.
- Permissions: worker runs under service role; RPC exposes only read of pending closures to internal roles.
- Audit: `closure_warning_sent`, `ticket_auto_closed`, with the exact wait period recorded on the event
  (not read from a mutable setting later).
- Tests: warning fires exactly once; closure blocked if customer replies; reopen works after auto-close.
- Phase: Core release. Depends on scheduler infra; slot after Phase 1C.

### Decision 56 — When a wider incident is created
- Approved answer: Manual declaration at launch. Automation may recommend an incident from clustered tickets or
  critical health/API signals but never publish without review. Confirmed security or data-integrity concern
  immediately creates a restricted internal incident. Humans control declaration and publication.
- Current position: infra-alerts exists; no incident table.
- Required build: `incidents`, `incident_recommendations`, `incident_ticket_links`, `incident_components`;
  RPC `declare_incident` (Incident Commander only); `security_incident_auto_open` triggered by SECURITY DEFINER
  helper called from confirmed security events (restricted visibility).
- Permissions: declaration restricted; recommendations visible to support lead + IC; restricted incidents
  visible only to platform admin, IC, and security-cleared roles.
- Audit: `incident_recommended`, `incident_declared`, `incident_restricted_opened`, `incident_published`.
- Tests: automation cannot publish; restricted incidents invisible to ordinary support; recommendation → declaration flow.
- Phase: Later phase (incident workstream). Not in Phase 1.

### Decision 57 — Incident commander
- Approved answer: Primary — David Davies (david@izenzo.co.za). Fallback — Daniel Davies (daniel@izenzo.co.za).
  James Davies (james@izenzo.co.za) owns the incident record and approved communications when delegated.
  Nicole Myburgh (contact@vericro.com) leads technical response while Vericro is the appointed engineering provider.
- Current position: No incident-commander model exists.
- Required build: Configurable ownership registry (see Section 9). No name is hardcoded in migration, RLS,
  functions, frontend or notification templates.
- Permissions: registry write restricted to platform admin; effective-dated rows; delegation supported.
- Audit: `commander_assigned`, `commander_delegated`, `commander_revoked`.
- Tests: only active-window commander can authorise; Vericro rows automatically inactive when the support mandate is ended.
- Phase: Later phase (with incidents). Configuration model itself is designed in Phase 1A.

### Decision 58 — Status page audience
- Approved answer: Authenticated clients only in phase one, after formally superseding UI-010.
  Public status page keeps its current non-publication wording until reliable signals + governance approval + tested publication process exist.
- Current position: `Status.tsx` + UI-010 guard/test enforce the non-publication wording.
- Required build: Authenticated status route; UI-010 supersession recorded via governance; guard/test replaced
  with a scoped guard that preserves public wording.
- Permissions: only authenticated users of participating orgs; no anon read.
- Audit: `status_page_viewed` sampled; component state changes emit events; supersession is a governance record.
- Tests: public page byte-identical to current wording; authenticated page shows only approved components; UI-010 test replaced, not deleted.
- Phase: Later phase. Not in Phase 1.

### Decision 59 — Status components
- Approved answer (exact initial authenticated components):
  1. Izenzo Platform / web application — Automatic.
  2. API — Automatic.
  3. Payments and credit allocation — Manual, with monitored provider inputs.
  4. Email notifications — Manual or Automatic where delivery signals are reliable.
  Authentication is included within Platform initially.
  Finer components added only when each has a trustworthy signal or an assigned manual owner.
- Current position: infra-alerts checks for platform and API; no component registry.
- Required build: `status_components` seeded with exactly these four rows; `component_signals` mapping; manual override capture.
- Permissions: read authenticated; write platform admin only.
- Audit: `component_state_changed`, `component_manual_override`.
- Tests: exactly the four approved rows; unlisted components cannot be published without governance record.
- Phase: Later phase (with status page).

### Decision 60 — Third-party provider wording
- Approved answer: Neutral wording by default ("payment provider", "verification provider"). Name a provider only
  after root cause confirmed and IC or Platform Administrator approves the wording. No blame before verification.
- Required build: `incident_wording_templates` with approval field; publish RPC blocks provider names without
  an attached approval record.
- Audit: `provider_wording_approved`, referencing IC/admin decision.
- Tests: publish RPC rejects unapproved provider names; templated neutral wording accepted.
- Phase: Later phase (with incidents).

### Decision 61 — Incident and maintenance communications
- Approved answer: In-app banner, email to affected customers, authenticated status page, internal Slack.
  Planned maintenance: at least 48 hours' notice where practical. Critical incidents: approved update at least
  every 60 minutes and immediately on material change. Urgent incidents: at least every 2 hours. Send
  completion, cancellation and overrun notifications. Public status page not used in phase one.
- Required build: `incidents`, `incident_updates`, `maintenance_windows`, `subscribers` (org-scoped only in phase one),
  templated update RPCs, cadence timers.
- Audit: every update writes `incident_update_published` with the audience selection snapshot.
- Tests: cadence enforcement; overrun triggers notice; public channel disabled.
- Phase: Later phase (incident + maintenance workstream).

### Decision 62 — Knowledge base and known-issue publication
- Approved answer: Help articles public/authenticated/role-/org-restricted as appropriate.
  Known issues authenticated with role restriction where necessary. Technical staff may draft.
  Publishing approval — Daniel Davies (Support/Product Lead), with David Davies approval for security,
  compliance or availability content. Customer ratings enabled. Suggested articles before submission enabled.
  Internal runbooks and evidence never publish directly.
- Required build: `kb_articles`, `kb_article_versions`, `kb_categories`, `kb_approvals`, `kb_ratings`,
  `kb_suggestion_events`; publishing RPC enforces approver role via configurable ownership registry;
  a hard deny-list guarantees runbooks and evidence cannot be published.
- Audit: draft/approve/publish/rate/suggestion-shown events.
- Tests: cannot publish without approver of the required class; deny-list enforced; suggestions never leak restricted articles.
- Phase: Later phase (full KB deferred per Decision 64).

### Decision 63 — Reporting, retention and enterprise exports
- Approved answer: Full core reporting set (management, open/unassigned, SLA, response, resolution, trend,
  workload, recurring-issue, incident/maintenance, org history, ticket-to-fix-to-release evidence,
  customer/internal audit exports). Monthly enterprise pack produced manually or on request in the core phase;
  scheduling automated later. Retention: ticket data, customer-visible replies and internal notes — 7 years
  after closure, subject to lawful deletion or legal hold. Attachments follow Decision 46. Internal full
  exports require AAL2 and exclude data outside authorised scope. Customer exports use a strict safe allow-list.
- Required build: append-only event history sufficient for every listed report; retention policy tables
  wired to the existing per-org retention shell and legal-hold model; export RPCs — one per audience (customer-safe,
  internal-full) enforcing AAL2 on the internal path; customer allow-list is code-reviewed and versioned.
- Approved formats: **not specified by client**. See Section 11 below (engineering proposals separated from approvals).
- Audit: `export_requested`, `export_generated`, `export_downloaded`; internal export writes AAL2 evidence.
- Tests: customer export never contains internal notes, UUIDs, security data, GitHub content, other-org data or provider responses;
  AAL2 enforced for internal export; legal hold blocks purge; 7-year clock keyed to closure timestamp.
- Phase: Reporting core in mid-programme; exports paired with reporting; scheduled packs deferred.

### Decision 64 — Delivery phases and final acceptance criteria
- Approved answer: Phased delivery. Core acceptance: every approved authenticated role can submit;
  tested organisation/grant isolation; working customer and internal threads; permanent separation of internal notes;
  teams, assignment and escalation; notifications and delivery logs; SLA clocks and warnings; technical issue /
  release linkage; append-only audit history; customer-safe export. Later phases: attachments after malware
  scanning; inbound email and reply-by-email; automated GitHub integration; public status and subscribers;
  full knowledge base and scheduled enterprise packs. No unresolved security-dependent feature enters core launch.
- Consequence for this addendum: Phase 1 in this programme covers only submission foundations (1A), API-compatibility
  adapter (1B) and initial Desk customer experience (1C). Teams, SLA, technical lifecycle, incidents and exports
  are subsequent phases (2+), still within core launch acceptance.

---

## 2. Decision-Numbering Corrections

The completed questionnaire uses this canonical numbering. Every reference in the earlier report is
re-anchored to it.

- Section 8 — Notifications and email communication (Decisions 33–40):
  - 33: automatic acknowledgement (in-app and email).
  - 34: customer email notifications (which ticket events email the customer).
  - 35: in-app notifications (which events surface in-app).
  - 36: internal Slack alerts (critical incidents, security reports, high/critical SLA breaches).
  - 37: SMS — No SMS in the first release.
  - 38: WhatsApp — No WhatsApp integration in the first release.
  - 39: email-to-ticket — phased: outbound first, inbound later.
  - 40: reply-by-email — deferred until inbound subsystem is operational.

Any prior text that said "Decision 33 covers email templates" or shifted 34/35/36 by one is corrected.
The report's Section 8 must use exactly the mapping above; no other numbering is permitted.

---

## 3. Binding Approved Requirements vs Engineering Proposals

### A. Binding approved requirements (verbatim from completed answers)
- Roles that may submit (Decision 1): org_admin, org_member, authorised API contact, funder viewer/reviewer/approver,
  funder org admin, external adviser with active funder grant, authenticated registry claimant, internal staff on behalf of customer.
  Unauthenticated public visitors NOT permitted.
- Restricted-record specialist access (Decisions 5, 13).
- Organisation isolation (Decision 3), funder grant scoping (Decision 4).
- Category, subcategory, mandatory question sets, customer-impact and system-calculated priority (Decisions 14–18).
- Priority override permitted only by named roles (Decision 19).
- Teams and queues, membership, primary owner per category, fallback and escalation recipients (Decisions 20–24).
- Named support hours, timezone, weekend and after-hours critical support (Decisions 25–28).
- First-response and resolution targets per priority; SLA pause only for customer waiting; SLA warning at 75%
  and breach handling (Decisions 29–32).
- Notification event sets: customer email (Decision 34), in-app (Decision 35), Slack (Decision 36).
- No SMS, no WhatsApp in first release (Decisions 37, 38).
- Attachments deferred until malware scanning approved (Decisions 41–46).
- Emergency release only during declared incident (Decision 53).
- Customer confirmation mandatory before closure; auto-close at 7 days with 2-day warning (Decisions 54–55).
- Manual incident declaration; restricted internal incident on confirmed security concern (Decision 56).
- Named IC/fallback/comms owner/technical response lead (Decision 57) — via configurable registry.
- Authenticated-only status page after superseding UI-010 (Decision 58).
- Exactly four initial status components (Decision 59).
- Neutral third-party wording; provider naming only after root-cause confirmation and IC/admin approval (Decision 60).
- Communications channels and cadences (Decision 61).
- KB publishing approvers named; runbooks/evidence never publish directly (Decision 62).
- Full core reporting set; 7-year retention for tickets, customer-visible replies, internal notes;
  AAL2 for internal full export; strict customer-safe allow-list (Decision 63).
- Phased delivery with the stated core-acceptance list (Decision 64).

### B. Engineering proposals (not client decisions)
These are proposals made by the implementer where the questionnaire is silent. They must not be presented as approved.
- Round-robin auto-assignment inside a queue.
- On-shift logic and holiday-calendar seeding strategy.
- Cron-based annual holiday extension.
- Export file formats (CSV, JSONL, PDF, ZIP).
- JSONL bundle format for internal exports.
- Post-hoc emergency-approval deadlines beyond the stated 1-business-day retrospective.
- Slack direct messages (as opposed to channel alerts).
- Customer satisfaction survey records.
- Specific GitHub URL validation regex.
- Any new role enum names (`support_agent`, `support_lead` — see Section 8).

Rule: where a proposal does not alter approved business behaviour, choose the most secure and maintainable option.
Where it would alter behaviour, defer until the client confirms.

---

## 4. Corrected Database-Privilege Model

The earlier report's `GRANT SELECT, INSERT, UPDATE ON public.tickets TO authenticated` contradicts its own
"writes must go through SECURITY DEFINER RPCs". Corrected model uses least privilege throughout.

Rule set:
- Ordinary clients (`authenticated`) never receive INSERT/UPDATE/DELETE on ticket lifecycle tables.
- Writes occur via narrowly scoped SECURITY DEFINER RPCs owned by a hardened role with `SET search_path = public`.
- Append-only tables (events, messages, audit) are never directly mutable by `authenticated`.
- `service_role` receives full privileges for edge functions and schedulers.
- `anon` receives no grants on any support-centre table.
- Auditor role (a Postgres role or an app-level capability, TBD in Phase 1A design) is read-only.

Per-table proposed GRANTs (Phase 1A tables only; later-phase tables listed for completeness with the same rule):

- `public.tickets`
  - `GRANT SELECT ON public.tickets TO authenticated;`  — required so RLS-scoped reads work via PostgREST.
  - `GRANT ALL ON public.tickets TO service_role;` — required for edge functions.
  - No INSERT/UPDATE/DELETE to `authenticated`. Creation via `rpc.create_ticket(...)`; updates via
    `rpc.update_ticket_status(...)`, `rpc.assign_ticket(...)`, etc.

- `public.ticket_events` (append-only lifecycle)
  - `GRANT SELECT ON public.ticket_events TO authenticated;` — for read via RLS on the parent ticket.
  - `GRANT ALL ON public.ticket_events TO service_role;`
  - No INSERT for `authenticated`. Writes only from SECURITY DEFINER RPCs.

- `public.ticket_messages` (append-only)
  - `GRANT SELECT ON public.ticket_messages TO authenticated;`
  - `GRANT ALL ON public.ticket_messages TO service_role;`
  - No INSERT/UPDATE for `authenticated`. Message creation via `rpc.post_ticket_message(ticket_id, body, kind)`.

- `public.ticket_access_audit` (view-audit; separate from lifecycle)
  - `GRANT SELECT ON public.ticket_access_audit TO service_role;` only.
  - No `authenticated` grant.
  - Writes via SECURITY DEFINER helper `_record_ticket_access(...)` called from restricted-record read RPCs.

- `public.ticket_status_enum`, `public.ticket_priority_enum`, `public.ticket_category_enum`: enum types, no grants required.

Why each privilege is required:
- SELECT to `authenticated`: PostgREST performs the SELECT under the caller's role; RLS then scopes it. No SELECT = the RPC-fetched data cannot be re-read by the client.
- ALL to `service_role`: edge functions, schedulers and admin scripts must be able to write freely.
- Withheld INSERT/UPDATE/DELETE to `authenticated`: forces every mutation through an auditable, SECURITY DEFINER
  RPC that validates the caller's role and writes the correct event.

---

## 5. Corrected Event-Writing Rules

The earlier statement "every RPC writes one ticket event" is retracted.
Corrected rule: only state-changing RPCs write to `ticket_events`. Read/list RPCs never mutate the timeline.
Where viewing a restricted record must be audited, `ticket_access_audit` (a separate access-audit table) is written
via `_record_ticket_access(...)` — not via a lifecycle status.

RPC matrix (Phase 1A scope; later RPCs follow the same rule):

| RPC | Read or write | Lifecycle event written | Access audit written | Reason |
| --- | --- | --- | --- | --- |
| `create_ticket` | write | `ticket_created` | no | State-changing. |
| `post_ticket_message` (customer or internal note) | write | `ticket_message_posted` (with `kind`) | no | Append-only message; single lifecycle event. |
| `get_ticket` (non-restricted) | read | no | no | Pure read; RLS enforces scope. |
| `get_ticket` (restricted category, e.g. security) | read | no | yes (`_record_ticket_access`) | View of restricted content is audited separately. |
| `list_tickets` | read | no | no | Read; volume makes per-row audit inappropriate. |
| `assign_ticket` | write | `ticket_assigned` | no | State-changing. |
| `update_status` | write | `ticket_status_changed` | no | State-changing. |
| `confirm_resolution` (D54) | write | `resolution_confirmed` | no | State-changing. |
| `reopen_ticket` (D54) | write | `ticket_reopened` | no | State-changing. |
| `auto_close_ticket` (D55, worker) | write | `ticket_auto_closed` | no | State-changing. |

---

## 6. Append-Only Message Model

No `updated_at` editing model is added to `ticket_messages`. Customer messages and internal notes are
immutable after creation.

Core release policy: **Messages are immutable. No redaction mechanism is included in the core release.**

Rationale: the questionnaire does not approve redaction. Adding a redaction path invents policy the client
did not authorise. If redaction is later required, its design must specify: which role may perform it,
that original content is preserved (or cryptographically evidenced via hash retained in `ticket_events`),
what customers see afterwards (a placeholder with reason + redactor + timestamp), and a `ticket_message_redacted`
audit event that is itself immutable. Until that decision is approved, redaction remains out of scope.

---

## 7. Corrected Historical API-Ticket Adapter

The earlier proposal to synthesise threaded messages from the accumulated `internal_notes` field is retracted.

Corrected approach:
- Do not fabricate authors, timestamps or conversation history.
- Adapter preserves and labels legacy fields exactly as they exist:
  - `legacy_description`, `legacy_client_visible_response`, `legacy_internal_notes` (single blob, unchanged),
    `legacy_owner`, `legacy_status`, `legacy_created_at`, `legacy_updated_at`.
- Historical `api_support_tickets` rows are exposed through a **normalised read projection** (a database view
  or a virtual model surfaced via the read RPC) using a `source_type` + `source_id` pair:
  `source_type = 'legacy_api_ticket'`, `source_id = api_support_tickets.id`.
- A `historical_api_ticket_id` FK on the new `tickets` table is **not required** during the read-adapter phase
  and is not added. Only add it if and when a physical migration is approved.

Consequence for Phase 1B: no schema mutation of `api_support_tickets`; adapter is read-only.

---

## 8. Recommended Internal Permission Architecture

The questionnaire approves the operational permissions but does not mandate any specific role names.
Options assessed against the existing repo (`app_role`, `user_roles` table, `has_role()` security-definer function,
existing separate funder-role model, capability-style policies elsewhere):

| Option | Migration impact | RLS complexity | Compatibility | Least-privilege quality | Specialist access | Auditor read-only | External provider on/off |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A. Existing roles + support-team membership only | Lowest — no enum change | Low, but overloads existing roles | Highest | Weak (permissions leak from broad roles) | Team membership | Requires new capability | Team add/remove |
| B. Add one general `support_staff` role + team membership | Small enum add | Low | High | Medium | Team membership | Distinct read-only role possible | Role assign + team |
| C. Add `support_agent` + `support_lead` roles + team membership | Two enum adds | Medium | Medium (touches every policy that inspects `app_role`) | Higher | Team + lead role | Distinct read-only role | Role assign + team |
| D. Capability table separate from `app_role` (`support_capabilities`) | New table + helper `has_support_capability()` | Medium | Highest (no enum change) | Highest | Capability rows | Capability = `support_read` | Grant/revoke capability rows with effective dates |

Recommendation: **Option D — capability-based support permissions stored separately from `app_role`.**
- Best least-privilege alignment; capabilities are additive and revocable.
- No enum change, so migration risk on other subsystems is zero.
- Naturally supports effective-from/effective-until (matches Decision 57's Vericro/temporary-provider requirement).
- Auditor is expressed as a `support_read` capability grant.
- External engineering provider access is expressed as time-boxed capability grants tied to the current support mandate; revocation removes access with no enum churn.

Do not add any new `app_role` enum values until this option is confirmed and reviewed.

---

## 9. Configurable Ownership Model

No approved owner, fallback or contact is hardcoded in migrations, RLS, functions, frontend constants or
notification templates. All named roles from Decisions 22–24, 57 and 62 resolve via a single registry.

Design (schema-level intent, not code):
- `support_role_assignments(role_key text, subject_kind text, subject_ref text, email text,
   effective_from timestamptz, effective_until timestamptz, is_delegated boolean, delegated_by uuid,
   assignment_reason text)`.
- `role_key` examples: `incident_commander_primary`, `incident_commander_fallback`,
  `incident_comms_owner`, `technical_response_lead`, `support_lead`, `kb_general_approver`,
  `kb_security_approver`, `queue_primary_owner:<category>`, `queue_fallback_owner:<category>`, `escalation_recipient:<category>`.
- `subject_kind` in `{ 'platform_user', 'external_contact' }`. `subject_ref` is the `profiles.id` for platform users,
  or NULL when only an email is held.
- Resolution: `resolve_role(role_key, at timestamptz default now())` returns the row whose
  `effective_from <= at < effective_until` (or open-ended).
- Delegation: additional rows with `is_delegated = true` and `delegated_by` recorded; delegation cannot exceed
  the delegator's own active window.
- Replacement: superseded rows are closed (`effective_until = now()`); history preserved.
- Vericro rule (Decision 57): rows for external engineering contacts are automatically inactive when the
  "engineering-provider mandate" flag is off. Flag itself is a governance record with the same effective-date shape.
- Notification templates reference `role_key` tokens, resolved at send time. Never bake in an email address.
- Frontend consumes a read RPC returning the current holder and effective window; never imports a constant.

---

## 10. Corrected Status-Component Requirements

Exact approved initial authenticated components (Decision 59) — the only rows seeded initially:

1. Izenzo Platform / web application — Automatic (signal: platform health).
2. API — Automatic (signal: API error rate + latency).
3. Payments and credit allocation — Manual, with monitored provider inputs.
4. Email notifications — Manual, or Automatic where delivery signals are reliable.

Authentication is included within Platform initially. No further public or authenticated components may be
added until each has a reliable signal or a named manual owner.

Public `/status` route and UI-010 wording are unchanged. The public page continues to display exactly:
"Status information is not currently published. Please contact Izenzo support for platform availability queries."
The UI-010 guard test remains in place until a governance record formally supersedes it (part of the later Status workstream, not Phase 1).

---

## 11. Corrected Export Scope

Client-approved exports (Decision 63):
- Customer-facing support audit export.
- Internal full support audit export.
- Monthly enterprise support pack — manual/on request in core phase; scheduling automated later.
- Retention: 7 years after closure for ticket data, customer-visible replies, internal notes; attachments follow Decision 46.
- AAL2 required for internal full export.
- Strict customer-safe allow-list.

Not approved by the client, therefore not committed to:
- CSV, JSONL, PDF or ZIP as mandatory formats.

Format assessment (engineering recommendation, not a client decision):
- CSV — buildable today; `export_files` + `export_jobs` tables and existing export-audit pattern support it. Good for tabular reports.
- JSON — buildable today; same infra. Good for machine consumption.
- JSONL — buildable but adds streaming complexity; no repo precedent. Not recommended for core.
- PDF — no repo precedent for server-side PDF generation. Requires a new dependency and template pipeline. Not recommended for core.
- ZIP bundle (e.g. CSV + JSON + evidence) — buildable via existing storage patterns; useful for enterprise pack.

Recommendation for the core phase: **CSV for tabular reports, JSON for machine-readable exports, ZIP bundle for the manual monthly enterprise pack.** PDF and JSONL deferred pending client confirmation.

---

## 12. Phase 1 Split — Phase 1A / 1B / 1C

Phase 1 as previously described is replaced by three controlled sub-batches.

### Phase 1A — Ticket schema and backend foundation
- Scope:
  - Enums: `ticket_status`, `ticket_priority`, `ticket_category` (canonical values from Decisions 14, 17, 18).
  - Core tables: `tickets`, `ticket_events` (append-only), `ticket_messages` (append-only), `ticket_access_audit`.
  - Ownership registry table (Section 9) — schema only, not populated.
  - Capability model (Section 8, Option D): `support_capabilities`, `has_support_capability()` helper.
  - RLS on every new table + GRANTs per Section 4.
  - SECURITY DEFINER RPCs: `create_ticket`, `get_ticket`, `list_tickets`, `post_ticket_message`.
  - Access-audit helper `_record_ticket_access`.
- Explicit exclusions: no frontend, no notification wiring, no team assignment, no historical adapter,
  no incident/status/KB/export tables, no SLA timers, no attachments.
- Acceptance criteria:
  - Every approved role from Decision 1 can create and read own tickets under RLS tests.
  - Organisation isolation and funder-grant scoping pass automated tests.
  - Every state-changing RPC writes exactly one lifecycle event; read RPCs write none.
  - Restricted-category read writes `ticket_access_audit`.
  - Messages provably immutable (attempted UPDATE by any role fails).
- Rollback: single migration, reversible via a paired down-migration script that drops the new objects. No data in these tables at rollback time.
- Required tests: RLS matrix per role, RPC contract tests, immutability tests, event-vs-access-audit matrix test.

### Phase 1B — Historical API adapter and compatibility
- Scope: read-only projection over existing `api_support_tickets` with `source_type = 'legacy_api_ticket'`.
  Legacy fields preserved and labelled per Section 7. Current API RPC and UI continue to function unchanged.
- Explicit exclusions: no physical migration of legacy rows; no fabricated messages; no `historical_api_ticket_id`
  FK on `tickets`; no synthesised authors or timestamps.
- Acceptance criteria:
  - Existing API-ticket flows pass all current regression tests unchanged.
  - Unified list returns legacy rows correctly labelled with legacy field names.
  - Customer/internal separation is preserved: legacy `internal_notes` never appears in a customer-facing surface.
- Rollback: adapter is a view/projection only; drop or revert the view.
- Tests: API regression suite; adapter shape tests; internal/customer separation tests.

### Phase 1C — Initial Desk customer experience
- Scope: shared support provider (client-side context); a single "Get help" Desk trigger; the intake form
  (category, subcategory, mandatory questions, impact — from Decisions 14–17); safe active-record context
  passing (record IDs allow-listed); "My Support History" view for the authenticated customer.
- Explicit exclusions: no other shells (funder, API, admin) surfaced yet; no teams, SLA, attachments,
  technical issues or incidents in the UI.
- Acceptance criteria:
  - Ticket submission end-to-end from the Desk works for each approved role that has access in the current shell.
  - Active-record context populates only allow-listed identifiers; nothing sensitive from restricted records leaks.
  - "My Support History" shows only the caller's own tickets under RLS.
  - Frontend imports no owner/email/name constants — every named reference resolves via the ownership registry read RPC.
- Rollback: revert UI files; server surfaces from 1A remain and are harmless.
- Tests: Playwright submit-and-view flow; allow-list test for context; RLS-scoped history test.

---

## 13. Updated Risks

- Ownership registry design must land in 1A even though names are not populated until later phases; otherwise
  hardcoding pressure returns.
- Capability model (Option D) requires careful policy design so restricted-record reads still trigger access audit.
- Decision 63's 7-year retention interacts with existing per-org retention shell and legal-hold model; the retention
  clock must key to closure timestamp and honour holds. Design decisions here must be reviewed with the retention owner before Phase 2.
- Decision 55 auto-closure requires a scheduler. Confirm the current cron infrastructure covers this or plan the shim.
- UI-010 supersession is a governance action, not a code change. Do not remove or weaken the guard until the record exists.
- Decision 57 Vericro contact is time-bounded to the active engineering mandate — the registry must express this or access outlives the contract.

---

## 14. Authorisation Recommendation

Phase 1A is safe to begin, subject to two prerequisites:

1. Confirm the recommendation in Section 8 (Option D — capability-based support permissions) or select an alternative.
2. Confirm the ownership registry schema in Section 9 (registry lands empty in 1A; names populated in later phases).

No other Phase 1A element depends on client input beyond what is already approved in the questionnaire.

Phase 1B and 1C follow 1A sequentially, each gated by their own acceptance criteria.

Nothing in the later phases (SLA, teams, incidents, status, KB, exports) is authorised for build by this addendum.
