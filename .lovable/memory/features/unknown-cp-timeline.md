---
name: P012 Unknown-Counterparty User-Facing Timeline
description: Finite, user-safe facilitation timeline projected over the existing facilitation_cases system. SSOT location, status list, internal-only status, and forbidden-words discipline.
type: feature
---

P012 is a **projection layer** over the existing `facilitation_cases` stack, NOT a parallel system. Do not duplicate the facilitation/outreach/SLA pipelines.

- **SSOT**: `src/lib/unknown-cp-timeline.ts` + `supabase/functions/_shared/unknown-cp-timeline.ts` (kept in parity by `scripts/check-unknown-cp-audit-names.mjs`).
- **Tables**: `unknown_cp_case_overlays` (1-to-1 with facilitation_cases), `unknown_cp_timeline_events` (user-safe projection), `unknown_cp_user_messages` (requester messages).
- **Status set (17)**: `poi_created`, `facilitation_case_opened`, `details_under_review`, `more_information_required`, `additional_information_received`, `outreach_prepared` (INTERNAL-ONLY — must never reach requester UI), `outreach_started`, `awaiting_counterparty_response`, `counterparty_invited`, `counterparty_onboarding_in_progress`, `converted_to_known_counterparty`, `counterparty_declined`, `no_response`, `unreachable`, `invalid_counterparty_details`, `cancelled_by_requester`, `closed_by_izenzo`.
- **Edge functions**: `unknown-cp-case-bootstrap`, `unknown-cp-status-transition` (13 admin actions; `reopen_case` requires `platform_admin`), `unknown-cp-user-action` (add_more_information / contact_support / cancel_request).
- **Progression**: WaD/POI progression is allowed ONLY when overlay status is `converted_to_known_counterparty` AND existing POI/WaD gates still pass. No bypass.
- **Forbidden user-facing words** outside SSOT: `guaranteed`, `verified`, `approved`, `cleared`, `accepted`, `contacted`, `onboarded`. Enforced by `scripts/check-unknown-cp-copy-drift.mjs`.
- **Audit events (11)**: `unknown_cp_case_created`, `unknown_cp_status_changed`, `unknown_cp_owner_assigned`, `unknown_cp_more_info_requested`, `unknown_cp_user_message_added`, `unknown_cp_outreach_attempt_logged`, `unknown_cp_invite_sent`, `unknown_cp_counterparty_linked`, `unknown_cp_outcome_recorded`, `unknown_cp_case_closed`, `unknown_cp_case_reopened`.
- **Approved client copy is verbatim** in `UNKNOWN_CP_STATUS_COPY` — never paraphrase in components.
