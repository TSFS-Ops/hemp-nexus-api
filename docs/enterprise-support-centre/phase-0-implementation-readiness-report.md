# Enterprise Support, Ticketing & Incident Management Centre

## Phase 0 — Implementation Readiness Report

**Status:** READ-ONLY PLANNING DELIVERABLE. No code, migrations, data, branches, RLS or features have been changed. This document is the engineering blueprint for the subsequent Phase 1+ build batches.

**Sources of truth (binding):**

1. `Izenzo_Enterprise_Support_Client_Decision_Questionnaire_Completed.docx` — the completed client-answer fields in that document are binding business and operating requirements. Where the client has ticked an option or written a "Client decision / selected option(s)" paragraph, that is the approved decision and is not to be reopened.
2. `Fourth_Email_-_Support_ticketing_and_incident-management_gap.pdf` — states the operational rationale and the enterprise capability list that must ultimately be delivered ("customer support portal … enterprise audit export").

**Parse-scope caveat.** The completed questionnaire is more than 50 pages. The current parsed extract confirms verbatim client answers up to and including Decision 52 (production-release approval) and covers every "BLOCKS schema / RLS / SLA / notification / release" decision. Decisions 53–64 (incidents/status/maintenance/knowledge/reporting/delivery) are approved in outline by the client's answers to Decisions 34–36 (Slack), 47–52 (technical lifecycle) and by the Fourth-Email capability list, and by the UI-010 constraint already enforced in this repository. Any Phase 8/9/12 batch that touches those decisions must re-open the questionnaire and confirm the exact ticked options before schema is finalised.

---

## 1. Executive summary

Izenzo has one narrow ticketing subsystem (Public API V1 Batch 11 — `api_support_tickets`, `create_api_support_ticket`, `list_api_support_tickets_for_client`, `list_api_support_tickets_internal`, `update_api_support_ticket_internal`, `AdminApiSupportTicketsPanel`, `ClientSupportPanel`). It covers API-client users only. It has no threaded messages, no queues, no teams, no SLA clocks, no incident model, no technical-issue linkage and no attachment surface.

The client has approved a **hybrid unified model** (Decision 8): a single ticket schema and single customer/internal experience, with the existing API-support fields, permissions and history preserved and exposed **through a read adapter** in the first phase (Decision 9), and physical migration only after mapping is verified. Historical API tickets must never be deleted or overwritten.

The build must be delivered in **ten controlled batches** (Phases 1–10 in the client-approved sequence). Phase 0 delivers no code — only the map below.

**Key architectural constants (client-approved, non-negotiable):**

| Item | Decision | Approved answer |
|---|---|---|
| Trigger placement | 6 | Option C: one shared support provider + shell-specific trigger buttons. Never mounted on `/auth`, `/reset*`, `PublicHolding.tsx`, `MarketplaceHolding.tsx`, or unapproved public routes. |
| Public pages | 7 | Keep email-only guidance on marketing/docs pages. Require sign-in for tracked tickets. **Do not** change the holding-page no-hyperlink rule. |
| API subsystem | 8 | Hybrid unified model; preserve API compatibility until migration is tested. |
| Historical tickets | 9 | Read-only adapter in Phase 1; no deletion; no overwriting. |
| Unknown-counterparty dialog | 10 | Keep specialist facilitation workflow. Create a linked background support record — do not replace. |
| Support timezone | 26 | `Africa/Johannesburg`. Business hours Mon–Fri 08:00–17:00 SAST (Dec. 25). |
| After-hours | 28 | Critical outages + security concerns only. Primary: David Davies. Fallback: Daniel Davies. Technical: Nicole Myburgh (Vericro). |
| SLA labelling | 29–30 | **Internal targets for first 90 days.** Not contractual until performance is measured and separately approved. |
| Priority model | 17–19 | Customer picks impact (3 levels). Platform calculates priority. Override permitted only for Support Lead, Specialist Lead, Incident Commander, Platform Admin — with mandatory reason and append-only event. |
| SMS / WhatsApp / inbound email / reply-by-email | 37, 38, 39, 40 | **Deferred**. Portal-only + outbound email in first release. |
| Attachments | 41 | **Deferred** until malware scanning + private-bucket + signed-URL controls exist. |
| GitHub integration | 48 | Manual audited URL link only. No API/App/webhook in the first release. |
| Slack | 36 | Critical incidents, security reports, and high/critical SLA breaches/escalations only. Sanitised summaries. Slack is an alert channel, not the record. |
| Public status page | (UI-010 enforced) | Preserved. Do not alter the signed holding message or the guard scripts and tests during Phases 1–8. Any change is a separate Decision-Form supersession. |

---

## 2. Approved-decision validation matrix

Each row lists the approved client answer, existing code that supports it, existing code that conflicts (empty = none found), and what has to be built.

| # | Decision | Client answer (verbatim) | Existing support | Existing conflict | To build (schema / backend / frontend / RLS / notif / audit / test) |
|---|---|---|---|---|---|
| 1 | Who may create tickets | All authenticated participants + Izenzo staff on behalf; unauth = public contact path only | `api_support_tickets.created_by`, API-client role check | Only API path exists; org_admin/org_member/funder/registry claimant have no intake | new `tickets` table with `created_by`, `org_id`, `funder_org_id`, `on_behalf_of_user_id`; RPC `create_ticket_v1` with role gate matching Decision 1 |
| 2 | Visibility per role | Own / org / grant-linked / assigned queue / all / auditor read-only | `list_api_support_tickets_for_client` (client-safe projection), `list_api_support_tickets_internal` (internal shape); auditor SELECT policy | No org-wide non-admin visibility, no queue, no grant-scoped funder view | 6 RLS branches on `tickets`; `list_my_tickets`, `list_org_tickets`, `list_assigned_queue`, `list_all_tickets` RPCs; funder branch joins `p5_batch3_funder_access_grants` |
| 3 | Org-admin org-wide visibility | Yes, **except restricted categories** (compliance, identity, security, funder evidence, formal disputes) | Single-org model in `profiles.org_id`; specialist patterns in `p5_batch2/6/7` | No `restricted` flag on any ticket concept | `tickets.is_restricted boolean`, restricted-branch policy; category → restricted mapping table |
| 4 | Funder support visibility | Grant-scoped; funder admin also same funder-org non-restricted | `p5_batch3_funder_organisations`, `p5_batch3_funder_access_grants`, funder-role model | No support surface on funder shells | funder-aware ticket linkage; grant-check helper; funder RLS branch; trigger mount on `/funder/*` shells |
| 5 | Internal permissions | Agent / Lead / Specialist / Engineer / Platform Admin / Auditor; least-privilege | `AdminApiSupportTicketsPanel` `canManage` vs `canRead`; auditor SELECT | No `support_agent`, `support_lead`, `support_specialist` roles; no team concept | new roles (or team+role hybrid — see §7); `has_ticket_role()` security-definer helper; AAL2 gate on internal export RPC |
| 6 | Trigger architecture | Option C: shared provider, shell triggers | `Desk.tsx`, `DeveloperCenter.tsx`, `HQ.tsx`, funder/registry shells declared | Existing Desk has no support UI; DeveloperCenter has `ClientSupportPanel` (API-only) | `<SupportProvider>` in `App.tsx` guarded by route allowlist; `<SupportTriggerButton scope="…" />` in each approved shell |
| 7 | Public pages | Email-only on marketing/docs; sign-in required; holding pages unchanged | `PublicHeader.tsx`, `Landing.tsx`, `Developers.tsx` email links; UI-010 tests + `scripts/check-public-availability-claims.mjs` | None (existing rule matches decision) | do **not** mount trigger on excluded routes; static test that mirrors `ui-010-public-status-and-availability-claims.test.ts` and forbids `SupportTriggerButton` on `Auth.tsx`, `ResetPassword.tsx`, `PublicHolding.tsx`, `MarketplaceHolding.tsx`, `Landing.tsx`, `PublicHeader.tsx`, `Developers.tsx` |
| 8 | API subsystem | Hybrid unified | `api_support_tickets` table + 4 RPCs + panel + test `admin-api-support-tickets-panel-hook-order.test.tsx` and `public-api-v1-batch11-support-intake-status.test.ts` | Direct table INSERT is intentionally blocked; only RPC. Any migration must preserve this. | leave `api_support_tickets` in place; add `historical_api_ticket_id` FK column on `tickets` (nullable) for later physical move |
| 9 | Historical adapter | Read-only through adapter | Both RPC projections already return client-safe vs internal shapes | None | `list_unified_tickets_v1(scope)` view/RPC that UNION-ALL selects from `tickets` and `api_support_tickets` with adapter mapping (category, status, severity → priority, internal_notes → internal_message) |
| 10 | Unknown-CP dialog | Keep + link | `ContactSupportDialog.tsx` linked to `facilitation_cases` | None | on submit, create a linked `tickets` row + `ticket_linked_records(facilitation_case_id, …)`; keep original dialog UX intact |
| 11 | Auto record links | Org, match, POI+hash, WaD, API client, request ID, webhook endpoint/delivery, invite, notification, payment ref, facilitation case | Tables all exist and have RLS | Current API panel captures none of these | `ticket_linked_records(ticket_id, kind, target_id, safe_label, permission_check_at, created_at)`; per-shell context adapters that read only what the user can already see |
| 14 | Categories | Approved subcategories (verification / payments / security / provider-specific) | `api_support_tickets.category` enum | Only 10 API-oriented values | new `ticket_category` (parent) + `ticket_subcategory` enums; routing table mapping (sub)category → team + default priority |
| 15 | Subcategory-driven conditional intake | Approved | none | none | per-subcategory JSON schema for conditional fields; server-side validator |
| 16 | Mandatory questions | Approved list (intended action, actual result, time, impact, affected users, workaround, affected record; category-specific IDs; captured identity) | `api_support_tickets` has environment, severity, subject, description, contact | Missing impact/affected-users/workaround/affected-record | add `intended_action`, `actual_result`, `occurred_at`, `impact`, `affected_users`, `workaround_available`, `affected_record_ref` columns; enforce in RPC |
| 17 | Customer impact | 3 levels: me / my organisation / blocks a live transaction or deadline | none | Current API path lets clients pick severity directly | `ticket_customer_impact` enum; drop customer-selectable severity from the general path |
| 18 | System priority | Automatic calc + Support-lead review; default Medium; security = Urgent pending triage | none | none | `calculate_ticket_priority()` immutable helper reading routing rules; versioned `priority_rules` table |
| 19 | Priority override | Support Lead, Specialist Lead, Incident Commander, Platform Admin. Reason mandatory. | Audit-per-change pattern in existing API panel | none | `set_ticket_priority(ticket_id, priority, reason)` RPC; `ticket_events(kind='priority_override', …)` append-only |
| 20 | Teams | 9 approved teams | none | No team/queue concept | `support_teams`, `support_team_members`, `support_team_categories` (routing) |
| 21–24 | Ownership, escalation, fallback | approved via team model | none | none | `tickets.assigned_team_id`, `assigned_user_id`; `escalate_ticket_v1`; `fallback_owner_id` per team |
| 25 | Support hours | Mon–Fri 08:00–17:00 SAST, RSA public holidays excluded | none | none | `support_business_hours` config table + RSA public-holiday calendar seed |
| 26 | Timezone | `Africa/Johannesburg` | none | none | fixed constant `SUPPORT_TZ = 'Africa/Johannesburg'` |
| 27 | Weekend | Critical only | none | none | SLA calendar excludes Sat/Sun for L/M/H/U |
| 28 | After-hours | Critical outage + security only. David (primary), Daniel (fallback), Nicole (technical) | none | none | `after_hours_escalation_contacts` config (seed with exact emails); `SupportRoleAssignment` UI restricted to Platform Admin |
| 29 | First-response targets | L 2 bd / M 8 bh / H 4 bh / U 1 bh / C 30 min bh, 60 min AH — **INTERNAL, first 90 days** | none | none | `sla_policies(priority, first_response_min, resolution_min, kind='internal')`; every customer-facing surface must label these "Internal target" until a client-signed conversion to contractual |
| 30 | Resolution / workaround targets | L 10 bd / M 5 bd / H 2 bd / U 8 bh / C 4 clock-hours restore + permanent-fix plan within 1 bd. Workaround stops restoration clock, does not close ticket. | none | none | `resolution_target_min`; `restoration_target_clock_hours`; separate `workaround_accepted_at` timestamp that pauses only the restoration clock |
| 31 | SLA pauses | (per client answer) | none | none | `ticket_sla_pauses(ticket_id, started_at, ended_at, reason)` append-only |
| 32 | Warnings / breaches | 75% warning; breach event | none | none | `sla_events(kind='warning_75'|'breach'|'resumed', …)` + cron `sla-monitor` |
| 33 | In-app notifications | Approved matrix, sanitised + user-scoped | `notifications`, `notification_preferences`, `notification_dispatches`, `NotificationBell` | none | new `notification_kind` values for the 15 ticket events |
| 34 | Customer emails | 11 approved events. Never emails internal notes. | `send-transactional-email`, `process-email-queue`, `email_send_log`, `suppressed_emails`, `email_unsubscribe_tokens` | none | new transactional templates per event; hard filter — internal-note event never routes to customer email |
| 35 | Internal Slack | Critical incidents / security / high+critical SLA breaches / escalations. Sanitised. | `infra-alerts` edge function + admin Slack webhook + dispatch audit | none | reuse `infra-alerts` gateway; new `support_slack_dispatch()` with allow-list of fields; do **not** route customer messages through it |
| 36 | Slack event set | Same as above | same | none | same |
| 37 / 38 | SMS / WhatsApp | **No** in first release | notification-channel-readiness scaffolding exists | none | keep disabled; no new provider integration |
| 39 / 40 | Inbound / reply-by-email | Deferred | outbound email only | none | keep portal authoritative; do not open an inbound webhook |
| 41–46 | Attachments | Deferred until malware scanning + private bucket + signed URLs + retention | Storage buckets and signed-URL patterns exist for evidence packs; no support attachment surface | none | do not add an upload button in Phases 1–9; Phase 10 gates on separately approved malware scanner |
| 47 | Technical escalation | Yes | none | none | `technical_issues`, `technical_issue_events`, `technical_issue_ticket_links` |
| 48 | GitHub | Manual URL only | none | none | audited `technical_issues.github_issue_url` text field; no Octokit; forbid outbound HTTP to github.com from edge functions in this batch |
| 49 | Customer-visible defect stages | 12-stage approved list | none | none | `ticket_customer_status` enum with the 12 values; mapper from internal engineering status |
| 50 | Internal engineering stages | Approved with mandatory reason for Unable-to-reproduce / Rejected / Duplicate | none | none | `technical_issue_status` enum + `resolution_reason text NOT NULL` when status in that set |
| 51 | QA sign-off | Independent QA required; tester ≠ developer; four-eyes for production; regression + rollback evidence for high-risk | CI exists but no DB record | none | `technical_issue_test_runs(evidence_url, tester_user_id CHECK ≠ developer_user_id, passed_at)`; `technical_issue_qa_signoffs` |
| 52 | Production-release approval | Engineering lead + platform admin for high-risk; two-person for high risk | none | none | `releases(id, technical_issue_id, approver_ids uuid[], risk_level, released_at)`; policy enforces `array_length(approver_ids,1) >= 2` when `risk_level='high'` |

**Decisions 53–64** are outlined in the completed questionnaire beyond the 50-page parse window. The Phase-8/9/12 batches must re-parse the questionnaire and confirm the exact ticked options before finalising schema for incidents, maintenance, reporting, exports and knowledge base. The **UI-010 public-status constraint currently enforced by `src/tests/ui-010-public-status-and-availability-claims.test.ts` and `scripts/check-public-availability-claims.mjs` remains in force** and any Phase 8 change to public status wording is a separate signed supersession.

---

## 3. Existing code to preserve (do not touch during Phases 1–2)

| Asset | Path | Reason |
|---|---|---|
| API tickets table | `supabase/migrations/20260619133236_9b33ccc5-259e-4e30-aded-f98479ac62ee.sql` | Table + RLS + trigger + 4 RPCs; contract with `api_clients`; migration must extend, not rewrite |
| Client panel | `src/components/developer/ClientSupportPanel.tsx` | 391 LOC, live in DeveloperCenter |
| Admin panel | `src/components/admin/AdminApiSupportTicketsPanel.tsx` | 301 LOC, live in HQ |
| Panel hook-order fix | `src/tests/admin-api-support-tickets-panel-hook-order.test.tsx` | Guard against regressions |
| API tickets contract | `src/tests/public-api-v1-batch11-support-intake-status.test.ts` | Test envelope for existing RPCs |
| Unknown-CP dialog | `src/components/unknown-cp/ContactSupportDialog.tsx` | Linked to facilitation cases per Decision 10 |
| Public-status guard | `src/tests/ui-010-public-status-and-availability-claims.test.ts`, `scripts/check-public-availability-claims.mjs`, `src/pages/Status.tsx`, `src/lib/status-audit.ts` | Client-signed UI-010 policy; unaffected by this build |
| Notifications infrastructure | `send-transactional-email`, `process-email-queue`, `notification-dispatch`, `notification-events`, `email_send_log`, `notification_preferences`, `notifications`, `notification_dispatches` | Reused for customer + internal events |
| Slack surface | `infra-alerts` edge function | Reused for Decision 35 sanitised alerts |
| Roles model | `user_roles`, `app_role` enum, `public.has_role()` | Extended, never bypassed |
| Funder access | `p5_batch3_funder_organisations`, `p5_batch3_funder_access_grants`, funder shells under `src/pages/funder/*` | Source of truth for Decision 4 grant scoping |
| Route matrix | `e2e/fixtures/routes.ts` | Any new protected route added here in Phase 2 |

---

## 4. Conflicts and risks identified

1. **Role model is minimal.** `APP_ROLES` currently exposes `PLATFORM_ADMIN`, `ORG_ADMIN`, `ORG_MEMBER`, `BUYER`, `AUDITOR`, `COMPLIANCE_ANALYST`. Decision 5 needs `support_agent`, `support_lead`, plus per-specialism scoping (billing, compliance, security, funder, facilitation, incident). Two safe paths — see §7. **Recommendation: hybrid** — keep a single `support_agent` role and derive specialism from `support_team_members` membership. Rejects proliferation of enum values, keeps least-privilege at the team level, and matches Decision 20 which is queue-centric, not role-centric.
2. **Direct-INSERT prohibition on `api_support_tickets`.** Any Phase 1 migration that "extends" that table with new columns must not accidentally add a permissive INSERT policy. All writes must remain via SECURITY DEFINER RPCs.
3. **Client-picked severity in `ClientSupportPanel`.** Decision 17 forbids customer-set priority for the general system. The API panel may keep its severity picker (compatibility) but its output must be **remapped** to the new impact model on adapter read, and the new unified form must not offer a priority picker.
4. **Public-status route.** Any attempt to add an incident banner to `/status` in Phase 8 will trip `ui-010-public-status-and-availability-claims.test.ts`. Phase 8 must either scope incident visibility to authenticated shells only (client's stated preference) or land a separate signed Decision-Form supersession that also updates the guard scripts.
5. **Trigger leakage risk.** A shared `<SupportProvider>` mounted in `App.tsx` will render on **every** route unless the trigger button itself is opt-in. The design must be provider-in-root, trigger-in-shell — never provider-adds-button.
6. **Cross-shell context adapters.** Each shell that mounts a trigger must supply context via a strongly-typed adapter, or the auto-linked record can leak a UUID the user has no permission to see. Every adapter must be paired with an RLS re-check on the server.
7. **Funder RLS.** Funder grant scoping (`p5_batch3_funder_access_grants`) is time-bounded. Support visibility must **re-evaluate** the grant on every read, not cache membership at ticket creation.
8. **AAL2 export.** Decision 5 requires AAL2 for full internal-history export. Confirm the current auth stack supports AAL2 challenge before Phase 9. If not, defer full-internal export until AAL2 is available; customer-facing export can ship earlier.
9. **UI-010 vs. Slack (Decision 35).** Slack alerts may contain incident context; they must not leak into a customer-facing surface. Sanitisation must be a server-side allow-list, not a client-side redaction.
10. **`AppSidebar.tsx`, `RequireAuth.tsx`, `DashboardLayout.tsx`.** All three currently assume a fixed set of roles. Adding `support_agent`/`support_lead` requires touching sidebar visibility in a single, reviewable diff.

---

## 5. Proposed architecture (high level)

```
                    ┌───────────────────────────────────────┐
                    │            <App.tsx>                  │
                    │  <SupportProvider>                    │
                    │    - context store                    │
                    │    - modal (form + history + linked)  │
                    │  </SupportProvider>                   │
                    └──────────┬────────────────────────────┘
                               │  (no trigger here — provider only)
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
   Desk.tsx             DeveloperCenter.tsx      HQ.tsx / funder / registry
   <SupportTrigger      <SupportTrigger          <SupportTrigger scope="…">
    scope="desk"         scope="developer">
    context={desk}>      context={devcentre}
                                                (each shell provides its
                                                 own context adapter that
                                                 only exposes records the
                                                 signed-in user can see)
```

Backend:

```
tickets ─┬─ ticket_events (append-only)
         ├─ ticket_messages (customer + internal, is_internal flag)
         ├─ ticket_linked_records (typed, permission-checked on write)
         ├─ ticket_assignments
         ├─ ticket_sla_events (warning / breach / resumed)
         └─ ticket_sla_pauses

support_teams ── support_team_members
              └─ support_team_categories (routing)

sla_policies (priority → first_response_min, resolution_min)

technical_issues ─┬─ technical_issue_events
                  ├─ technical_issue_ticket_links
                  ├─ technical_issue_test_runs
                  └─ technical_issue_qa_signoffs

releases ── release_approvals (two-person for high-risk)

incidents ─┬─ incident_components
           ├─ incident_updates
           └─ incident_ticket_links

maintenance_windows ── maintenance_notifications

Unified read: list_unified_tickets_v1(scope) UNION ALL from tickets
              + adapter over api_support_tickets (Phase 1 only)
```

All new public tables follow the mandated `CREATE TABLE → GRANT → ENABLE RLS → CREATE POLICY` order and include `created_at`/`updated_at` with `update_updated_at_column` triggers.

---

## 6. New schema summary (Phase 1 + Phase 2 scope only)

Only the tables required for Phases 1 and 2 are listed. Later phases add their own.

**Phase 1 — Unified ticket foundation:**

* `tickets` — id, org_id, funder_org_id (nullable), created_by, on_behalf_of_user_id (nullable), historical_api_ticket_id (nullable, FK `api_support_tickets`), category, subcategory, is_restricted (bool), customer_impact enum, priority enum, priority_source enum('calculated','override'), status enum, resolved_at, closed_at, first_response_at, permanent_resolution_plan_at, restoration_at, workaround_accepted_at, subject, intended_action, actual_result, occurred_at, affected_users_count, workaround_available bool, affected_record_ref jsonb, contact_name, contact_email.
* `ticket_events` — id, ticket_id, kind enum (append-only), actor_user_id, actor_role, payload jsonb, created_at.
* `ticket_messages` — id, ticket_id, author_user_id, is_internal bool, body text, sanitised bool, created_at.
* `ticket_linked_records` — id, ticket_id, kind enum, target_table, target_id, safe_label, permission_check_at, created_at.
* `ticket_categories` — parent/subcategory catalogue driving routing + default priority + is_restricted.

**Phase 2 — Roles, teams, queues, RLS:**

* `support_teams` — id, code, name, is_restricted (Security Response = true).
* `support_team_members` — team_id, user_id, is_lead, is_fallback.
* `support_team_categories` — team_id, category, subcategory (nullable), default_priority.
* `ticket_assignments` — id, ticket_id, assigned_team_id, assigned_user_id, assigned_by, reason, created_at (append-only history).

RLS policies (drafts) attach to §7.

---

## 7. RLS and permission plan

**Recommended role/team hybrid**

* Extend `app_role` with **two** values only: `support_agent`, `support_lead`. No per-specialism enum values.
* Specialism (billing, compliance, security, funder, facilitation, engineering, incident) is expressed by `support_team_members` membership. Restricted-category access is derived from `support_teams.is_restricted`.

**Helper functions (SECURITY DEFINER):**

* `public.has_ticket_role(_uid, _role)` — wraps `has_role`.
* `public.is_ticket_team_member(_uid, _team_code)` — joins `support_team_members`.
* `public.can_read_ticket(_uid, _ticket_id)` — the single arbiter (own / org non-restricted / org restricted only if in specialist team / funder-grant-linked / assigned team member / platform_admin / auditor read-only).
* `public.can_write_ticket_message(_uid, _ticket_id, _internal bool)`.

**Six SELECT branches on `tickets`:**

1. Own tickets (`created_by = auth.uid()`).
2. Org non-restricted (`org_id` visible via `profiles`, `NOT is_restricted`).
3. Org restricted (org member AND team membership matching category).
4. Funder-grant-linked (join through `ticket_linked_records` to `p5_batch3_funder_access_grants` active at read time).
5. Assigned team member.
6. `platform_admin` OR `auditor` (auditor is SELECT only, everywhere).

**UPDATE / INSERT** exclusively via SECURITY DEFINER RPCs. Direct DML by `authenticated` is forbidden.

**GRANTs (per new table, in same migration):**

```
GRANT SELECT, INSERT, UPDATE ON public.tickets TO authenticated;
GRANT ALL ON public.tickets TO service_role;
-- append-only tables: no UPDATE/DELETE to authenticated
GRANT SELECT, INSERT ON public.ticket_events TO authenticated;
GRANT ALL ON public.ticket_events TO service_role;
```

Ledger/event tables reuse the append-only convention documented in `supabase/tests/event_ledger_append_only_convention_proof.sql`.

---

## 8. RPC and edge-function plan

**Phase 1:**

* `create_ticket_v1(payload jsonb) → uuid` — role gate per Decision 1, priority calculation, event write, notification enqueue.
* `add_ticket_message_v1(ticket_id, body, is_internal)` — enforces `can_write_ticket_message`.
* `link_ticket_record_v1(ticket_id, kind, target_id, safe_label)` — server re-checks permission on the linked record.
* `list_my_tickets_v1`, `list_org_tickets_v1`, `list_assigned_queue_v1`, `list_all_tickets_v1`, `get_ticket_v1`.
* `list_unified_tickets_v1(scope)` — Phase 1 adapter over `tickets` + `api_support_tickets`.

**Phase 2:** `assign_ticket_v1`, `reassign_ticket_v1`, `escalate_ticket_v1`, `set_ticket_priority_v1(reason)`.

**Phase 5:** edge functions `send-ticket-notification`, `dispatch-support-slack` (delegates to `infra-alerts`).

**Phase 6:** cron `support-sla-monitor` — reads `sla_policies`, computes 75% + breach, writes `ticket_sla_events`, dispatches Slack for high/critical only.

**Phase 7:** `create_technical_issue_v1`, `attach_technical_issue_v1`, `record_test_run_v1`, `record_qa_signoff_v1`, `approve_release_v1`.

Every RPC:

* runs SECURITY DEFINER with `SET search_path = public`;
* writes exactly one append-only `ticket_events` row;
* enqueues notifications via the existing dispatcher — never direct SMTP;
* rejects with `permission_denied` (never data-shape) when auth check fails.

---

## 9. Frontend integration plan

**Phase 3 (customer surface) mount points:**

| Shell | File | Trigger scope | Excluded routes inside shell |
|---|---|---|---|
| Desk | `src/pages/Desk.tsx` | `desk` | — |
| Developer Centre | `src/pages/DeveloperCenter.tsx` | `developer` | keep `ClientSupportPanel` intact under Developer > API Support tab |
| HQ (internal console) | `src/pages/HQ.tsx` | `hq_internal` | Phase 4 lands the console itself |
| Funder shells | `src/pages/funder/**` | `funder` (grant-aware) | funder holding/unavailable pages |
| Registry shells | `src/pages/registry/**` (approved routes only, e.g. `/registry/authority`, `/registry/claims/*`, `/registry/my-companies`, etc.) | `registry` | landing/holding registry routes |
| Selected workflow pages | Match detail, POI detail, WaD detail, Trade wizard | inherited from shell | — |

**Never mounted on:** `Auth.tsx`, `ResetPassword.tsx`, `PublicHolding.tsx`, `MarketplaceHolding.tsx`, `Landing.tsx`, `Developers.tsx` (public marketing), `PublicHeader.tsx`, `Status.tsx`, `Pricing.tsx`, `Trust.tsx`, `Welcome.tsx`, `Unsubscribe.tsx`, `WalkthroughReport.tsx`.

Enforced by a static test mirroring `ui-010-public-status-and-availability-claims.test.ts`.

---

## 10. Notification plan (Decision 33 / 34 / 35 / 36)

| Event | In-app | Customer email | Slack |
|---|:-:|:-:|:-:|
| Ticket received | ✅ | ✅ receipt | — |
| Support reply to customer | ✅ | ✅ | — |
| Customer reply | internal | — | internal |
| Info request / waiting-for-customer | ✅ | ✅ | — |
| Assigned / reassigned | internal | — | — |
| Priority changed (material) | ✅ | ✅ if material | — |
| Escalation | internal | — | if critical or security |
| SLA warning 75% | internal | — | high/critical only |
| SLA breach | internal | — | high/critical only |
| Fix released | ✅ | ✅ | — |
| Resolved | ✅ | ✅ | — |
| Confirmation requested | ✅ | ✅ | — |
| Reopened | ✅ | ✅ | — |
| Closure warning + auto-close | ✅ | ✅ | — |
| Incident update | ✅ (authenticated) | ✅ (affected only) | ✅ |
| Internal note | internal | **never** | mention triggers Slack DM only |

All customer email routes through `send-transactional-email` + `process-email-queue`. Slack goes through `infra-alerts` with a server-side allow-list. SMS/WhatsApp/inbound email/reply-by-email: **not built**.

---

## 11. SLA plan

* `sla_policies(kind='internal', priority, first_response_min, resolution_min)` seeded with the Decision 29 + 30 values.
* Business-hours calendar table `support_business_calendar(date, is_business_day, opens_at, closes_at)` pre-seeded with SAST 08:00–17:00 Mon–Fri and RSA public holidays through Dec 2027; a cron `seed-support-calendar-year` extends it annually.
* Every customer-facing SLA display must render the string **"Internal target"** for the first 90 days (Decision 29 quality bar).
* Pauses: `ticket_sla_pauses` opened on info-request state, closed on customer reply.
* Restoration clock (Critical) is 24×7 wall-clock; all other clocks are business-hour.
* `support-sla-monitor` cron runs every 5 minutes and writes `ticket_sla_events` when 75% or breach is crossed.

---

## 12. Technical-issue / release plan

* `technical_issues.status` covers the client-approved internal engineering lifecycle.
* `technical_issues.customer_status` is the mapped 12-value enum (Decision 49) exposed on the linked customer ticket.
* `technical_issue_test_runs.tester_user_id` has a CHECK constraint preventing `= developer_user_id`.
* `releases.risk_level = 'high'` requires ≥ 2 distinct approvers in `release_approvals`.
* Emergency release: `release_approvals.is_emergency = true` allowed with post-hoc second approval within 24 h — enforced by `check-emergency-release-audit` cron.
* GitHub: `technical_issues.github_issue_url text` only, validated `^https://github\.com/[^\s]+/issues/\d+$`. No outbound HTTP.

---

## 13. Incident / maintenance plan (Phase 8, outline only)

* `incidents`, `incident_components`, `incident_updates`, `incident_ticket_links`, `maintenance_windows`, `maintenance_notifications`.
* Initial visibility: **authenticated shells only**. `<AuthenticatedIncidentBanner>` added to Desk / Developer / Funder / Registry shells only.
* **Public `/status` remains unchanged.** No wording change until UI-010 supersession is signed.
* Incident commander + communication owner recorded; every update is append-only.
* Maintenance banner reuses `MaintenanceBanner.tsx` display component with a new source table.

---

## 14. Reporting / export plan (Phase 9)

* Management dashboard (open / unassigned / overdue / by team / by category).
* Customer-facing "My Support History" export → CSV.
* AAL2-protected internal audit export → CSV + jsonl bundle, streamed from an edge function.
* All exports write a `ticket_events(kind='exported', payload={scope, requester})` audit row.

---

## 15. Migration sequence

| # | Migration name | What it does | Break-risk |
|---|---|---|---|
| 1 | `phase1_ticket_core` | new `tickets`, `ticket_events`, `ticket_messages`, `ticket_linked_records`, `ticket_categories`; enums; GRANT + RLS + policies; `list_unified_tickets_v1` adapter | none — `api_support_tickets` untouched |
| 2 | `phase1_ticket_rpcs` | `create_ticket_v1`, `add_ticket_message_v1`, `link_ticket_record_v1`, list/get RPCs | none |
| 3 | `phase2_teams_and_routing` | `support_teams`, `support_team_members`, `support_team_categories`, `ticket_assignments`; new `app_role` values `support_agent`, `support_lead`; routing helpers | needs sidebar update in same PR |
| 4 | `phase2_assignment_rpcs` | assign/reassign/escalate/set-priority RPCs; permission override audit | none |
| 5 | Phase 5 notification wiring migration | new notification kinds, templates seeded, dispatch rules | none |
| 6 | Phase 6 SLA schema | `sla_policies`, `support_business_calendar`, `ticket_sla_events`, `ticket_sla_pauses`; cron `support-sla-monitor` heartbeat table | none |
| 7 | Phase 7 tech-issue schema | `technical_issues` etc.; `releases`; CHECK constraints; QA + release RPCs | none |
| 8 | Phase 8 incident + maintenance | authenticated-only surfaces | must not alter `/status` |
| 9 | Phase 9 exports | export jobs table; AAL2 gate on internal export | none |
| 10 | Phase 10 attachments (gated) | private bucket + malware-scan integration | only if scanner is live |

Every migration follows the mandatory 4-step order (CREATE TABLE → GRANT → ENABLE RLS → CREATE POLICY) and includes `update_updated_at_column` triggers where relevant.

---

## 16. Automated test plan

Copied here at the required level of specificity for CI:

* Organisation isolation — Org A user cannot see Org B tickets (all 6 RLS branches).
* Funder grant isolation — funder without active grant cannot see linked tickets; ticket disappears when grant expires (time-bounded re-eval).
* Own-ticket visibility — creator always sees own tickets.
* Org-admin visibility — sees org non-restricted; blocked from `is_restricted=true`.
* Restricted-category visibility — only members of the specialist team see restricted tickets.
* Support agent — sees only assigned queue.
* Specialist — restricted only within their team's categories.
* Auditor — SELECT-only across every branch; no INSERT/UPDATE ever.
* Internal note privacy — never appears in `list_my_tickets_v1`, `list_org_tickets_v1`, `list_unified_tickets_v1(scope='client')`, or in customer email payload.
* Customer message privacy — internal notes never routed to customer email/Slack.
* API compatibility — every existing `public-api-v1-batch11-support-intake-status.test.ts` assertion still passes after Phase 1 migration.
* Historical API-ticket rendering — `list_unified_tickets_v1` returns adapter shape identical to `list_api_support_tickets_for_client`.
* Linked-record access — server re-checks permission on `link_ticket_record_v1`; unauthorised link rejected with `permission_denied`.
* Assignment / fallback routing — round-robin only within a team; falls back to `is_fallback=true` member when no one is on shift.
* Priority calculation — 8 golden cases covering each category × impact × affected-users combination.
* Priority override — reason mandatory; unauthorised role rejected; event appended.
* SLA warning + breach — cron writes exactly one event per threshold crossing (idempotent).
* Customer + internal notifications — matrix table above verified end-to-end.
* Slack sanitisation — allow-list rejects any field not on the list; test tries to smuggle `internal_notes` and asserts rejection.
* Technical-issue linkage — attaching to a ticket updates `customer_status` via mapper; internal engineering statuses never leak.
* QA + release sign-off — tester CHECK constraint fails when tester = developer; high-risk release fails with < 2 approvers.
* Customer confirmation + auto-close — closure warning at day N, auto-close at day M (per client answer to Decision 34), reopens on reply.
* Incident creation — authenticated shells only; `/status` snapshot test proves wording unchanged.
* UI-010 public-status preservation — reuses existing `ui-010-public-status-and-availability-claims.test.ts`; must remain green through Phase 8.
* Export safety — CSV headers never contain `internal_notes`; internal-export requires AAL2 challenge.
* No attachment surface — Phase-1-through-9 build has no `POST /tickets/:id/attachments` route (grep test).
* No impersonation — no RPC accepts a `user_id` override; `on_behalf_of_user_id` is metadata only, never used for auth.

---

## 17. Build batches (client-approved sequence, with the safety refinement below)

The client's Phase 1 → Phase 10 sequence is correct. One refinement: **land the notification wiring (Phase 5) AFTER assignment (Phase 2) but BEFORE SLA (Phase 6)**, because SLA breach notifications reuse the notification pipeline. The client's document already reflects this ordering.

For each batch, the delivery must include:

* scope (as summarised above);
* dependencies (previous batch);
* migration file (exactly one per batch, following the 4-step rule);
* backend RPC list;
* frontend surfaces added;
* tests added;
* acceptance criteria;
* explicit exclusions ("no attachments," "no inbound email," "no /status changes," etc.).

---

## 18. Acceptance criteria (overall centre)

The centre is considered complete when:

1. Every approved authenticated role in Decision 1 can create a ticket from an approved shell in Decision 6.
2. No user can see a ticket outside their Decision 2 branch (proven by the RLS test suite).
3. No customer surface ever contains an internal note (proven by test).
4. Every ticket event, priority override, assignment, technical-issue transition, test run, QA sign-off, release approval, and export is present in an append-only event table.
5. SLA labelling reads "Internal target" until a client-signed Decision-Form supersession converts it to contractual.
6. `/status` wording is unchanged; the UI-010 test suite is green.
7. Slack, SMS, WhatsApp, inbound email, reply-by-email, GitHub API, and attachments remain deferred (or gated on separately approved dependencies) exactly as their decisions state.
8. `api_support_tickets` history is fully visible through the read adapter with no data loss.

---

## 19. Deferred capabilities (do not build in Phases 1–9)

* Attachments — gated on malware scanning + private bucket + signed URLs + retention (Decisions 41–46).
* Inbound email-to-ticket (Decision 39).
* Reply-by-email (Decision 40).
* SMS (Decision 37).
* WhatsApp (Decision 38).
* Automatic GitHub creation / two-way sync (Decision 48).
* Public status page changes / public subscribers (UI-010 remains in force).
* Full knowledge base + known-issues publication.
* Scheduled enterprise support packs.
* Customer satisfaction survey (only if the completed Decision 62–64 confirms).

---

## 20. Exact recommended first implementation batch (Phase 1)

**Scope:** Unified ticket foundation only. No teams, no queues, no SLA, no notifications beyond the existing dispatcher, no incidents, no attachments.

**Migration (single file):**

1. Create enums: `ticket_category`, `ticket_subcategory`, `ticket_customer_impact`, `ticket_priority`, `ticket_status`, `ticket_event_kind`, `ticket_linked_record_kind`.
2. `CREATE TABLE public.tickets` (columns per §6).
3. `GRANT SELECT, INSERT, UPDATE ON public.tickets TO authenticated; GRANT ALL ON public.tickets TO service_role;`
4. `ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;`
5. Six SELECT policies (own / org-non-restricted / org-restricted-placeholder / funder-grant / assigned-user / admin+auditor). Restricted branch is a stub in Phase 1 that permits only `created_by = auth.uid()` or `platform_admin`, since teams don't exist yet — tightened in Phase 2 without breaking anyone.
6. Same 4-step block for `ticket_events`, `ticket_messages`, `ticket_linked_records`, `ticket_categories`.
7. `updated_at` triggers on `tickets` and `ticket_messages`.
8. Seed `ticket_categories` from Decisions 14 + 15.
9. `CREATE OR REPLACE FUNCTION public.list_unified_tickets_v1(scope text) RETURNS SETOF …` — UNION ALL `tickets` + adapter over `api_support_tickets`.
10. RPCs: `create_ticket_v1`, `add_ticket_message_v1`, `link_ticket_record_v1`, `list_my_tickets_v1`, `list_org_tickets_v1`, `get_ticket_v1`.

**Frontend (single PR):**

* `<SupportProvider>` mounted in `App.tsx` (no visible UI).
* `<SupportTriggerButton scope="desk">` mounted **only** in Desk shell.
* Modal renders the unified intake form with Decision 16 mandatory fields, Decision 17 impact selector (no priority picker), and automatic Decision 11 record link for the currently-visible record on `desk` pages.

**Backend safety:**

* `api_support_tickets` and its four RPCs untouched.
* `ClientSupportPanel` and `AdminApiSupportTicketsPanel` unchanged.
* `ContactSupportDialog` unchanged — Phase 1 does NOT yet write the background link (Phase 3 does).

**Tests:**

* Isolation across all six SELECT branches (Phase 1 subset).
* Adapter parity between `list_unified_tickets_v1(scope='client')` and `list_api_support_tickets_for_client` for pre-existing rows.
* Internal-note privacy (Phase 1 has no internal notes yet, but the test seeds one and confirms it never appears in customer scope).
* Static test asserting no `<SupportTriggerButton>` import appears in the excluded files enumerated in §9.
* API contract test `public-api-v1-batch11-support-intake-status.test.ts` still green.

**Acceptance criteria for Phase 1:**

* An `org_admin` and an `org_member` in Desk can each create a ticket about a match and see it later in "My Support History."
* An unrelated Org B user sees nothing.
* The existing DeveloperCenter API-support experience is unchanged and passes all existing tests.
* Migration is idempotent (Phase 1 re-run on a fresh database + prod-shape database both succeed).

**Explicit exclusions for Phase 1:** teams, queues, assignment, priority override, SLA, notifications beyond in-app, attachments, technical issues, releases, incidents, maintenance banners, exports, GitHub links, changes to `/status`, changes to holding pages, any change to `api_support_tickets` or its RPCs.

---

*End of Phase 0 implementation-readiness report.*
