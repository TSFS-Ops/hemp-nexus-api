# P012 — User-facing Unknown-Counterparty Status Timeline

## Summary

A finite, safe, user-facing facilitation timeline projected over the existing
`facilitation_cases` system. Requesters can see the current status, view a
visible timeline, add more information, contact support, or cancel — without
ever seeing internal notes, staff names, raw outreach logs, compliance notes,
or third-party contact details.

## Approach

Projection layer over the existing facilitation pipeline (Option A in the
approved plan). No duplication of `facilitation_case_contact_attempts`,
`facilitation_case_events`, `facilitation_outreach_*`, the SLA SSOT, or the
notification dispatch pipeline.

## Migration

`supabase/migrations/<timestamp>_p012_unknown_cp_timeline.sql`

- `public.unknown_cp_case_overlays` — 1-to-1 with `facilitation_cases`,
  finite `user_facing_status` (17 values, 1 internal-only), `status_group`,
  `reopen_allowed`, overdue/escalation flags, outcome/closure reason codes,
  `known_counterparty_id`, `visibility_version`.
- `public.unknown_cp_timeline_events` — projected user-safe event rows.
- `public.unknown_cp_user_messages` — requester-submitted messages
  (`message_body` ≥20 chars enforced at DB level), with category, attachment
  ids, visibility, support delivery ref.

All three tables: GRANTs to `authenticated` and `service_role`, RLS enabled,
scoped policies. Requester can `SELECT` only their own overlay, only
`user_visible = true` timeline rows, only their own messages. Requester can
`INSERT` only messages tied to their own case.

## Edge functions

- `unknown-cp-case-bootstrap` — idempotent; creates overlay + first two
  timeline events (`poi_created`, `facilitation_case_opened`).
- `unknown-cp-status-transition` — admin/platform_admin structured action
  router (13 actions). Role-gated; `reopen_case` requires `platform_admin`.
- `unknown-cp-user-action` — requester router for `add_more_information`,
  `contact_support`, `cancel_request`. Cancellation moves overlay to
  `cancelled_by_requester`.

All three emit canonical audit-event names and write rows to
`unknown_cp_timeline_events`. Internal-only status (`outreach_prepared`) is
written with `user_visible = false`.

## UI

- `src/components/unknown-cp/UnknownCpTimelinePanel.tsx`
- `src/components/unknown-cp/AddMoreInformationDialog.tsx`
- `src/components/unknown-cp/ContactSupportDialog.tsx`
- `src/components/unknown-cp/CancelRequestDialog.tsx`
- `src/components/unknown-cp/UnknownCpAdminPanel.tsx`
- `src/components/unknown-cp/adminActionList.ts`

Panel renders heading "Unknown-counterparty facilitation", subheading
"Track Izenzo support progress while the counterparty is not yet known or
engaged on the platform.", status badge, ordered visible timeline rows,
neutral SLA badge, blocked-progression message, and the three requester
action buttons. The SSOT block-matrix gates which buttons appear per status.

## SSOT

- `src/lib/unknown-cp-timeline.ts`
- `supabase/functions/_shared/unknown-cp-timeline.ts`

17 statuses, 11 audit event names, 7 forbidden user-facing words, block-matrix
function `getAllowedActions(status)`, and verbatim approved copy for every
status. SLA wording, panel heading/subheading, attachment limits, and minimum
message length are also defined here.

## Notification changes

Material status changes (per spec table) are emitted via the existing
`notification_dispatches` pipeline using the audit event names above.
Internal-only events (Outreach prepared, owner assignment, internal
escalation) are excluded from requester notifications.

## RLS summary

- `unknown_cp_case_overlays`: requester reads only their own; platform_admin
  reads all; only service role mutates.
- `unknown_cp_timeline_events`: requester reads only rows where
  `user_visible = true` AND linked to their own facilitation case.
- `unknown_cp_user_messages`: requester reads/writes only their own.

## Audit events

`unknown_cp_case_created`, `unknown_cp_status_changed`,
`unknown_cp_owner_assigned`, `unknown_cp_more_info_requested`,
`unknown_cp_user_message_added`, `unknown_cp_outreach_attempt_logged`,
`unknown_cp_invite_sent`, `unknown_cp_counterparty_linked`,
`unknown_cp_outcome_recorded`, `unknown_cp_case_closed`,
`unknown_cp_case_reopened`.

## Tests

`src/tests/p012-unknown-cp-timeline.test.ts` (≈25 assertions across status
enum integrity, internal-only visibility, verbatim approved copy,
forbidden-word absence, audit-event registration, and the full block matrix
for every status).

## Build guards (prebuild)

- `scripts/check-unknown-cp-audit-names.mjs` — TS ↔ Deno SSOT parity
- `scripts/check-unknown-cp-copy-drift.mjs` — internal-status leakage +
  forbidden words + SSOT-import requirement
- `scripts/check-unknown-cp-status-parity.mjs` — TS enum ↔ DB CHECK constraint

Wired into `package.json` `prebuild`, `RELEASE_GATE.md`, and the edge-function
deploy manifest.

## Gates untouched

No POI, WaD, verification, compliance, RLS, or tenant gate was weakened.
Progression to WaD is allowed only when the overlay status is
`converted_to_known_counterparty` AND every existing gate still passes.

## Intentional deferrals

- `unknown-cp-sla-sweep` cron job (overdue flags) — table columns exist; the
  cron worker will land in a follow-up batch. The SLA SSOT
  (`facilitation-sla.ts`) is reused; no second SLA engine was created.
