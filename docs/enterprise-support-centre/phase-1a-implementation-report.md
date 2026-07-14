# Enterprise Support Centre — Phase 1A Implementation Report

Status: implemented, migration applied, backend-only. No visible frontend was added, no support provider or trigger was mounted, and the existing API support UI and its four legacy RPCs were not modified.

Authoritative sources:
- Izenzo_Enterprise_Support_Client_Decision_Questionnaire_Completed.docx
- docs/enterprise-support-centre/phase-0-correction-addendum.md

Migration file: `supabase/migrations/20260714192318_8b393ae8-8842-4337-8a46-84b062a1fb3c.sql`

---

## 1. Confirmation-gate result

The Phase 0 addendum flagged two prerequisites. Both classified as internal engineering choices; neither would alter approved business behaviour.

1. Support permission model — Option D (capabilities separate from `app_role`). Chosen because it introduces no new `app_role` enum values (avoiding subsystem-wide RLS impact), is additive and revocable, and naturally supports the effective-dated pattern needed for Decision 57 (Vericro). In Phase 1A the capability table (`support_capabilities_grants`) and helper (`has_support_capability`) are created as scaffolding; no RLS in Phase 1A depends on capability grants (specialist expansion happens in Phase 2).
2. Ownership registry schema — `support_role_assignments` created empty. No names, emails or holders are populated. All RLS, functions, notification templates and frontend constants remain free of hardcoded ownership.

No confirmation was resolved by asking the client.

---

## 2. Files changed

- `supabase/migrations/20260714192318_8b393ae8-8842-4337-8a46-84b062a1fb3c.sql` — new (Phase 1A backend).
- `src/tests/phase-1a-support-schema-conformance.test.ts` — new (structural conformance tests).
- `docs/enterprise-support-centre/phase-1a-implementation-report.md` — this document.

No existing file was modified.

---

## 3. Enums, tables, policies and functions added

Enums (all `public.`):
`support_ticket_source`, `support_ticket_status`, `support_ticket_priority`, `support_customer_impact`, `support_priority_source`, `support_restriction_class`, `support_message_kind`, `support_event_kind`, `support_linked_record_kind`, `support_capability`.

Tables:
- `support_categories` — 19 rows seeded (Decision 14 — all 18 approved categories plus subcategory-only distinctions preserved).
- `support_subcategories` — 42 rows seeded (Decision 15).
- `support_priority_rules` — v1 seeded, active.
- `support_capabilities_grants` — scaffolding; empty.
- `support_role_assignments` — configurable ownership registry; empty.
- `support_tickets` — new unified ticket record.
- `support_ticket_events` — append-only lifecycle.
- `support_ticket_messages` — immutable messages, `kind` in {customer_visible, internal_note}.
- `support_ticket_linked_records` — safe reference only (record_kind, source_id, safe_label, visibility, permission_checked_at).
- `support_ticket_access_audit` — restricted-view audit trail (no `authenticated` grant).

Trigger function: `_support_reject_mutation()` installed on every append-only table for both UPDATE and DELETE.

Security-definer helpers:
- `has_support_capability(uuid, support_capability)`
- `_support_caller_org_id()`
- `_support_next_ticket_number()` — format `IZ-YYYY-XXXXXXXX`, 8-char base32 alphabet excluding `0,1,I,L,O`, uniqueness-checked with retries.
- `_support_resolve_restriction(text,text)` — restriction inherited from category or subcategory.
- `_support_calculate_priority(text, support_restriction_class, support_customer_impact, int)` — v1 rules.
- `_support_record_access(uuid, uuid, text, text)`

Mutating RPCs (SECURITY DEFINER, `SET search_path = public`, atomic, event-writing, EXECUTE granted to `authenticated` only after PUBLIC revoke):
- `create_support_ticket(...)` — writes `ticket_created` + `priority_calculated`.
- `post_support_ticket_customer_message(uuid,text)` — writes `customer_message_added`.
- `post_support_ticket_internal_note(uuid,text)` — writes `internal_note_added`; platform_admin only.
- `add_support_ticket_linked_record(uuid, support_linked_record_kind, text, text, text)` — writes `linked_record_added`.
- `update_support_ticket_status(uuid, support_ticket_status, text)` — writes `status_changed`; platform_admin only.

Read-only RPCs (STABLE SECURITY DEFINER; no writes to core tables; `get_support_ticket_internal` calls `_support_record_access` only when the ticket is restricted):
- `list_own_support_tickets()`
- `list_org_support_tickets()`
- `get_support_ticket(uuid)`
- `get_support_ticket_internal(uuid, text)`
- `list_support_ticket_customer_messages(uuid)`
- `list_support_ticket_internal_notes(uuid)`

Policies (no permissive fallback; every visibility resolved server-side):
- `support_tickets`: creator read; org_admin read of non-restricted org tickets; platform_admin read; auditor_read_only read.
- `support_ticket_events`: readable when the parent `support_tickets` row is readable (RLS on the parent enforces the filter).
- `support_ticket_messages`: customer_visible visible via parent-ticket rule; internal_note visible only to platform_admin or auditor_read_only.
- `support_ticket_linked_records`: readable when parent ticket is readable and (visibility='customer_visible' OR platform_admin OR auditor).
- `support_ticket_access_audit`: no `authenticated` policy → no direct client visibility.
- Catalogue tables: read active rows to `authenticated`.
- `support_role_assignments` and `support_capabilities_grants`: platform_admin read (and self-read for own grants).

---

## 4. RPC contracts (summary)

| RPC | Auth | Effect | Event(s) |
| --- | --- | --- | --- |
| `create_support_ticket` | authenticated; `on_behalf_of_*` requires platform_admin | insert ticket, server-resolved `org_id`, restriction and priority calculated, both fields required together for on-behalf-of | `ticket_created`, `priority_calculated` |
| `post_support_ticket_customer_message` | creator OR platform_admin OR org_admin on non-restricted org ticket | insert immutable message | `customer_message_added` |
| `post_support_ticket_internal_note` | platform_admin | insert immutable internal note | `internal_note_added` |
| `add_support_ticket_linked_record` | creator OR platform_admin OR org_admin on non-restricted org ticket | insert safe link | `linked_record_added` |
| `update_support_ticket_status` | platform_admin | status change with optional reason; sets `resolved_at`/`closed_at` when appropriate | `status_changed` |
| `list_own_support_tickets` | authenticated | read | none |
| `list_org_support_tickets` | authenticated org_admin | read non-restricted org tickets | none |
| `get_support_ticket` | see visibility rule; returns customer-safe projection or empty | read | none |
| `get_support_ticket_internal` | platform_admin OR auditor_read_only | read full row | none on tickets/events; `_support_record_access` writes access-audit only when the ticket is restricted |
| `list_support_ticket_customer_messages` | anyone with ticket read permission | read | none |
| `list_support_ticket_internal_notes` | platform_admin OR auditor_read_only | read | none |

---

## 5. Audit and event model

- `support_ticket_events` (append-only) records lifecycle: `ticket_created`, `status_changed`, `priority_calculated`, `customer_message_added`, `internal_note_added`, `linked_record_added`. Read-only RPCs never write here.
- `support_ticket_access_audit` (append-only) records restricted-view access. Written only by `_support_record_access`, called from `get_support_ticket_internal` when the ticket is restricted.
- No existing platform audit tables were modified. Administrative or security-significant actions belonging to other subsystems (e.g. UI-010 supersession, incident declarations) remain out of Phase 1A scope and continue to use their existing pathways.

Why not duplicate to both: the repository convention already couples subsystem audit tables to their subsystem. Duplicating support events into `audit_logs` would produce parallel truths and complicate retention. Cross-subsystem admin actions (Phase 2+) can raise their own audit-log entries at the point they occur.

---

## 6. Ticket number format

`IZ-YYYY-XXXXXXXX` — prefix `IZ-`, four-digit year, 8-character random suffix drawn from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (excludes `0/1/I/L/O` to prevent misreading). Generated server-side by `_support_next_ticket_number` with uniqueness re-check and up to 10 retries. Not sequential, not enumerable, not derived from row count, unique-indexed. Safe for inclusion in future email templates and exports.

---

## 7. Priority calculation (v1)

Version 1 rules, stored in `support_priority_rules(version=1, is_active=true)` and stamped onto every new ticket via `priority_rules_version`:

1. If `restriction_class = 'security'` or `category_key = 'security'` → `urgent` with `priority_source = 'security_default'`.
2. Otherwise base:
   - `blocks_transaction_or_deadline` → `high`
   - `affects_organisation` → `medium`
   - `affects_me` → `medium`
3. If `affected_users_count >= 10` → bump one level (cap at `urgent`).

Deterministic and pure over inputs; each result is written into `support_ticket_events(event_kind='priority_calculated', payload={...})`. Manual override is intentionally not implemented in Phase 1A (Decision 19 belongs to Phase 2).

---

## 8. Restricted visibility (Phase 1A temporary)

Approved restricted classes: `compliance_verification`, `identity` (subcategory-level within compliance), `security`, `funder_evidence`, `payment_dispute`. Assigned per Decision 14/15.

Phase 1A rule (before specialist teams and capabilities exist): restricted tickets are visible only to the creator, platform administrator and auditor_read_only. Organisation administrators explicitly do NOT gain access to another user's restricted ticket (`support_tickets_org_admin_read_nonrestricted` policy). Phase 2 broadens specialist access via capabilities.

---

## 9. Funder behaviour

`support_tickets.funder_org_id` is present as a nullable column so the schema can carry funder scope, but no policy grants access to funder rows. All funder-related visibility remains denied until Phase 2 introduces the grant-aware capability check and Phase 3 introduces the funder UI. No FK is added yet to avoid coupling to a specific funder table before the grant model is finalised.

---

## 10. On-behalf-of creation

- No impersonation. The authenticated actor's own permission is required; only `platform_admin` may create on behalf of another user.
- Both `on_behalf_of_user_id` and `on_behalf_of_reason` must be provided together (CHECK + RPC guard).
- `created_by` remains the actual actor; `on_behalf_of_user_id` records the represented customer separately.
- `org_id` is server-resolved from the represented customer's profile when on-behalf-of, otherwise from the actor's profile. Client-supplied org is never trusted.
- Represented customer identity has no effect on the actor's RLS privileges.

---

## 11. Tests

New file: `src/tests/phase-1a-support-schema-conformance.test.ts` — structural conformance suite covering:
- Existence of all core tables.
- RLS enabled on every new support table.
- Least-privilege grants: only SELECT to `authenticated` on ticket lifecycle tables; no direct INSERT/UPDATE/DELETE; no `authenticated` grant on `support_ticket_access_audit`.
- Append-only triggers on events, messages and access-audit for both UPDATE and DELETE.
- Every mutating RPC writes exactly the expected lifecycle event kind.
- Read-only RPCs never insert/update on core tables.
- Customer-safe list restricts `kind = 'customer_visible'`; internal-note list requires `platform_admin` or `auditor_read_only`.
- `org_admin` read policy excludes restricted tickets.
- No changes to `api_support_tickets` or its four legacy RPCs.
- No `ALTER TYPE public.app_role` in this migration.

Live database verification performed against the current backend:
- Seed counts: 19 categories, 42 subcategories, 1 active priority-rules row.
- Restriction inheritance: `security` and `compliance_verification` categories flagged restricted; `funder__evidence_*`, `compliance__identity_verification`, `payments__formal_dispute` subcategories flagged restricted.
- Priority calculation samples: security → urgent; blocks_transaction → high; affects_me → medium; affects_organisation + 15 users → high.
- Ticket number sample: `IZ-2026-KZYDX9JZ` (correct format).
- Append-only triggers physically present on all three tables for both UPDATE and DELETE.
- All 11 support RPCs present.

Behavioural end-to-end RLS tests (multi-role integration) require an authenticated test client and are out of Phase 1A scope; they are recommended for the CI layer alongside Phase 1B.

Not runnable in this environment:
- Multi-role RLS integration tests (no authenticated Playwright session infrastructure for anonymous-cloud validation of the new RPCs yet).
- Full CI pipeline; test file is added and will be picked up by the standard vitest run.

---

## 12. Regression result

- `api_support_tickets` schema unchanged. Search confirms the migration contains no reference to it.
- Legacy RPCs (`create_api_support_ticket`, `list_api_support_tickets_for_client`, `list_api_support_tickets_internal`, `update_api_support_ticket_internal`) unchanged.
- `Status.tsx`, UI-010 guard test and public holding pages untouched.
- `app_role` enum unchanged.
- No attachment storage bucket or upload route created.
- No notification dispatch, inbound email or GitHub integration created.
- No public or authenticated support UI added.
- Supabase generated types will be regenerated by the project's standard post-migration workflow.

---

## 13. Isolated deferred items

None. All Phase 1A scope items were implemented. Specifically deferred items belong explicitly to later phases and were not required by Phase 1A:
- Manual priority override (Decision 19) — Phase 2.
- Specialist / team access to restricted tickets — Phase 2.
- Funder trigger, funder support UI and grant-aware visibility — Phase 2/3.
- Notifications, SLA, teams/queues, attachments, incidents, KB, exports — subsequent phases per Decision 64.

---

## 14. Rollback

Rollback drops only Phase 1A objects; it must never touch `api_support_tickets` or any existing customer data.

Recommended manual rollback (do not run automatically against a populated environment):

```
BEGIN;
DROP FUNCTION IF EXISTS public.list_support_ticket_internal_notes(uuid);
DROP FUNCTION IF EXISTS public.list_support_ticket_customer_messages(uuid);
DROP FUNCTION IF EXISTS public.get_support_ticket_internal(uuid,text);
DROP FUNCTION IF EXISTS public.get_support_ticket(uuid);
DROP FUNCTION IF EXISTS public.list_org_support_tickets();
DROP FUNCTION IF EXISTS public.list_own_support_tickets();
DROP FUNCTION IF EXISTS public.update_support_ticket_status(uuid,public.support_ticket_status,text);
DROP FUNCTION IF EXISTS public.add_support_ticket_linked_record(uuid,public.support_linked_record_kind,text,text,text);
DROP FUNCTION IF EXISTS public.post_support_ticket_internal_note(uuid,text);
DROP FUNCTION IF EXISTS public.post_support_ticket_customer_message(uuid,text);
DROP FUNCTION IF EXISTS public.create_support_ticket(text,text,public.support_customer_impact,text,text,text,timestamptz,int,boolean,jsonb,text,text,uuid,text);
DROP FUNCTION IF EXISTS public._support_record_access(uuid,uuid,text,text);
DROP FUNCTION IF EXISTS public._support_calculate_priority(text,public.support_restriction_class,public.support_customer_impact,int);
DROP FUNCTION IF EXISTS public._support_resolve_restriction(text,text);
DROP FUNCTION IF EXISTS public._support_next_ticket_number();
DROP FUNCTION IF EXISTS public._support_caller_org_id();
DROP FUNCTION IF EXISTS public.has_support_capability(uuid,public.support_capability);
DROP TABLE IF EXISTS public.support_ticket_access_audit;
DROP TABLE IF EXISTS public.support_ticket_linked_records;
DROP TABLE IF EXISTS public.support_ticket_messages;
DROP TABLE IF EXISTS public.support_ticket_events;
DROP TABLE IF EXISTS public.support_tickets;
DROP TABLE IF EXISTS public.support_role_assignments;
DROP TABLE IF EXISTS public.support_capabilities_grants;
DROP TABLE IF EXISTS public.support_priority_rules;
DROP TABLE IF EXISTS public.support_subcategories;
DROP TABLE IF EXISTS public.support_categories;
DROP FUNCTION IF EXISTS public._support_reject_mutation();
DROP TYPE IF EXISTS public.support_capability;
DROP TYPE IF EXISTS public.support_linked_record_kind;
DROP TYPE IF EXISTS public.support_event_kind;
DROP TYPE IF EXISTS public.support_message_kind;
DROP TYPE IF EXISTS public.support_restriction_class;
DROP TYPE IF EXISTS public.support_priority_source;
DROP TYPE IF EXISTS public.support_customer_impact;
DROP TYPE IF EXISTS public.support_ticket_priority;
DROP TYPE IF EXISTS public.support_ticket_status;
DROP TYPE IF EXISTS public.support_ticket_source;
COMMIT;
```

Because Phase 1A only creates new objects and does not alter existing ones, rollback removes only what this migration introduced.

---

## 15. Risks

- Auditor role: `auditor_read_only` currently sees all ticket rows and internal notes globally, which matches the "read-only auditor" behaviour approved in Decision 1/5 for support access. If a narrower scope is required later, tighten the policy without changing table shape.
- Capability scaffolding is unused in Phase 1A; take care not to grant capabilities that RLS doesn't yet consult, or expectations may drift.
- The Postgres linter reports `RLS Enabled No Policy` for `support_ticket_access_audit`. This is intentional (no authenticated visibility).

---

## 16. Recommendation for Phase 1B

Proceed with the Historical API adapter as scoped in the Phase 0 correction addendum:
- Read-only projection over the existing `api_support_tickets` with `source_type = 'legacy_api_ticket'` and `source_id = api_support_tickets.id`.
- Preserve legacy fields with `legacy_*` labels; do not synthesise messages, authors or timestamps.
- No FK on `support_tickets` to `api_support_tickets`; no physical migration.
- Reuse the read RPCs and RLS pattern from Phase 1A.
- Add API regression tests that show existing API-support flows remain unchanged and that the adapter never leaks `internal_notes` to customer-facing surfaces.

No prerequisite from Phase 1A is missing.
