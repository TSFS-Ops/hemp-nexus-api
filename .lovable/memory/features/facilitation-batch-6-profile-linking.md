---
name: Facilitation Batch 6 — Profile linking & ready-for-POI
description: Admin controls to link a facilitation case to an existing organisation, record a counterparty profile, mark ready for POI with a readiness checklist, and manually record a POI conversion. No automatic POI creation, no organisation merge, no live integrations.
type: feature
---
Implemented 2026-06-16.

**Edge functions**
- `facilitation-case-admin-action` gained 4 actions:
  - `link_organisation` — platform_admin or assigned case owner. Requires `organization_id` (must exist) + `reason`; optional `evidence_summary`. Sets `linked_organization_id` + `linked_organization_reason/evidence_summary/linked_at/linked_by`.
  - `record_profile_created` — platform_admin or assigned case owner. Stores `profile_record_*`; if `organization_id` supplied, also links it using the approved field path.
  - `mark_ready_for_poi` — platform_admin or assigned case owner. Server-computed blockers: `active_hard_block` (blocked_by_compliance), `unresolved_compliance_review`, `unresolved_more_information_request`, `confirmed_sanctions_pep_block` (latest sanctions row), `active_do_not_contact_block` (DNC rules by org_name/email/email_domain), `missing_profile_or_organisation_link`. Returns `409 { blockers }` if any. On success transitions to `ready_for_known_counterparty_poi` and notifies requester ("The counterparty is ready for POI. You may proceed under the stated terms.").
  - `record_poi_conversion` — platform_admin only. Requires `poi_reference` + `reason`; only allowed from `ready_for_known_counterparty_poi`. Transitions to terminal `converted_to_known_counterparty_poi` and notifies requester ("This opportunity has been converted into a known-counterparty POI.").
- New `facilitation-case-search-organisations` — read-only org search (`name` / `legal_name` / `registration_number` ILIKE) for the link dialog. Platform_admin, compliance_analyst, or assigned case owner only.
- `get-facilitation-case` now returns `linked_organisation: { id, name }` for admins, and strips all Batch 6 admin-only free-text fields plus `linked_organization_id` from the `case` payload when caller is not platform_admin/compliance_analyst/owner.

**Schema** (`facilitation_cases` columns added): `linked_organization_reason`, `linked_organization_evidence_summary`, `linked_organization_linked_at/_by`, `profile_record_reference/_note/_evidence_summary/_recorded_at/_by`, `ready_for_poi_at/_by/_authority_summary`, `poi_conversion_reference/_reason/_evidence_summary/_recorded_at/_by`. `linked_organization_id` already existed.

**Audit names** (added to canonical list + `scripts/check-facilitation-case-audit-names.mjs`): `facilitation_case.organisation_linked`, `facilitation_case.profile_created_recorded`, `facilitation_case.ready_for_poi_marked`, `facilitation_case.poi_conversion_recorded`. Mirrored in `src/lib/facilitation-case-state.ts` and `supabase/functions/_shared/facilitation-case-state.ts`.

**UI** — `src/components/facilitation/FacilitationCaseProfileLinkPanel.tsx` mounted in `FacilitationCaseDrawer` after the Manual Checks panel. Four sub-cards: Linked organisation, Counterparty profile, Ready-for-POI checklist (mirrors server-side blockers), POI conversion (manual). All labels plain English; mirrored requester-visible wording lives in `USER_FACING_LABELS.ready_to_proceed` and `.poi_started`.

**Out of scope (still)**: automatic POI creation, organisation creation/merge, live registry/KYB/sanctions integration, SLA cron, reminders, dashboards, CSV/PDF export, WhatsApp/SMS, bulk outreach, automatic email send, mutation of POI/WaD/match/payment/token/credit records.
