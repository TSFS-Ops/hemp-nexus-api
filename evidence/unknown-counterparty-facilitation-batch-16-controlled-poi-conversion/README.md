# Batch 16 — Controlled Automatic POI Conversion

## Status

`BATCH_16_CONTROLLED_POI_CONVERSION_ACCEPTED`

Live Registry/KYB and Sanctions/PEP provider integrations remain deferred:

- `BATCH_14_DEFERRED — WAITING_FOR_CLIENT_PROVIDER_DETAILS`
- `BATCH_15_DEFERRED — WAITING_FOR_CLIENT_PROVIDER_DETAILS`

Reason: no approved provider, credentials, webhook details, result schema, commercial terms, or production data-handling rules have been supplied. No mock live integrations were built.

## Implementation summary

- New edge function: `supabase/functions/facilitation-poi-conversion/index.ts`.
- Three actions: `check_eligibility`, `confirm_link_existing`, `confirm_create_reference`.
- Eligibility gate enforces 13 distinct blocker codes (see "Eligibility gate").
- Mutating actions require `platform_admin`. `compliance_analyst` can run the read-only eligibility check. Requester role has no access.
- Each call writes audit events under the canonical `facilitation.poi_conversion.*` namespace.
- New admin drawer panel: `src/components/facilitation/FacilitationPoiConversionPanel.tsx` mounted in `FacilitationCaseDrawer`.
- Health probe registered for the new function in `facilitation-health-probe`.

## Schema additions (`facilitation_cases`)

- `linked_poi_id uuid` — set when an existing POI is linked.
- `poi_conversion_method text` — `linked_existing` | `recorded_reference`.
- `poi_conversion_confirmed_by uuid` — the platform admin who confirmed.
- `poi_conversion_eligibility_payload jsonb` — full eligibility snapshot at confirmation.

No existing column was altered. No new table introduced.

## Eligibility gate (codes → plain-English label)

- `case_closed` — The case is closed
- `case_cancelled` — The case was cancelled by the requester
- `wrong_status_for_conversion` — The case must be marked ready for POI before conversion
- `active_compliance_block` — Compliance has placed a block on this case
- `unresolved_compliance_review` — An unresolved compliance review must be cleared first
- `unresolved_more_information_request` — An outstanding "more information" request must be resolved
- `duplicate_review_unresolved` / `duplicate_organisation_conflict` — A duplicate review must be resolved first
- `confirmed_sanctions_pep_block` — A confirmed sanctions or PEP match is on file
- `no_manual_registry_or_kyb_record` — No manual Registry / KYB record captured (BATCH_14 deferred)
- `no_manual_sanctions_pep_record` — No manual Sanctions / PEP record captured (BATCH_15 deferred)
- `missing_authority_evidence` — Authority evidence summary is missing
- `missing_counterparty_identity` — Required identity fields missing (legal name, jurisdiction)
- `active_do_not_contact_block` — Active DNC rule applies to the counterparty
- `requester_org_not_eligible` — Requester organisation suspended/closed/archived/deactivated
- `already_converted` — A POI conversion has already been recorded

The eligibility gate fully tolerates the absence of live KYB/sanctions integrations by relying exclusively on manual `facilitation_case_registry_checks` and `facilitation_case_sanctions_checks` records.

## Pre-conversion review (admin UI)

The panel renders, in plain English: case number, requester organisation, counterparty legal/trading name, jurisdiction, role, product/commodity, authority evidence presence, manual Registry/KYB status, manual Sanctions/PEP status with compliance decision, DNC active flag, duplicate-conflict flag, already-converted flag and current internal status. No raw role tokens, table names, or edge-function names are shown; the eligibility report uses the labels above.

## Human confirmation

The two confirmation dialogs (`Link existing POI…` and `Record POI reference…`) display the exact required wording:

> You are about to … This will not create a WaD, payment, token movement, match, or credit movement.

Both dialogs require an explicit checkbox acknowledgement plus a free-text reason. The buttons are disabled until the checkbox is ticked. Confirmation is server-enforced to `platform_admin`; `compliance_analyst` sees only the read-only eligibility report; requesters do not see the panel at all.

## POI creation / linking

- `confirm_link_existing` validates the supplied POI id exists, belongs to the requester organisation, then sets `linked_poi_id`, `poi_conversion_method = 'linked_existing'`, `final_outcome = 'linked_to_existing_organisation'`, and advances the case to `converted_to_known_counterparty_poi`.
- `confirm_create_reference` records the operator-supplied POI reference string as a **safe linkage record** on the case (`poi_conversion_method = 'recorded_reference'`). This pathway honours the spec's "or store a safe linkage record" allowance because the `pois` table requires trade-context fields (`buyer_entity_id`, `seller_entity_id`, `industry_code`, `terms`) that a facilitation case does not carry. **Caveat:** real `pois` row insertion from a facilitation case is intentionally deferred until trade-context capture is approved by the client.
- Duplicate prevention: `already_converted` blocker fires when `final_outcome = 'converted_to_known_counterparty_poi'` OR `poi_conversion_recorded_at IS NOT NULL` OR `linked_poi_id IS NOT NULL`.

## Data mapping (safe-fields-only)

The conversion writes only: legal name, trading name, jurisdiction (counterparty_country), role, product/commodity, authority-evidence summary flag, manual Registry/KYB result, manual Sanctions/PEP result, source case reference (case_id, case_number). It explicitly does NOT copy admin notes, raw sanctions/PEP details, raw KYB payloads, DNC details, internal compliance reasoning, call notes, requester-only notes, audit payloads or unresolved evidence.

## Audit

Canonical audit names (pinned in both SSOTs and drift checker `scripts/check-facilitation-poi-conversion-audit-names.mjs`):

- `facilitation.poi_conversion.eligibility_checked` — written on every check (including failures).
- `facilitation.poi_conversion.blocked` — written whenever a confirm attempt is refused.
- `facilitation.poi_conversion.confirmed` — written when the operator's confirmation passes validation.
- `facilitation.poi_conversion.created` — written when a reference-based conversion is recorded.
- `facilitation.poi_conversion.linked_existing` — written when an existing POI is linked.

Payload includes: case_id (FK), case_number, actor (`actor_user_id`), decision, eligibility result, blocker codes, created/linked POI reference, timestamp (`facilitation_case_events.created_at`).

## Case update

On success, the case row stores `internal_status='converted_to_known_counterparty_poi'`, `final_outcome` set to the appropriate canonical outcome, `poi_conversion_recorded_at`, `poi_conversion_recorded_by`, `poi_conversion_confirmed_by`, `poi_conversion_method`, `poi_conversion_reference`, `poi_conversion_eligibility_payload`, and `closed_at`. The transition `ready_for_known_counterparty_poi → converted_to_known_counterparty_poi` is the only state movement and is part of the existing admin state machine.

## Requester visibility

The new panel is mounted inside the admin-only `FacilitationCaseDrawer` and is not exposed on requester-facing surfaces. The requester sees only the existing safe milestone wording. None of the conversion internals (POI id, eligibility blockers, manual KYB / sanctions / DNC details, admin notes, duplicate logic, audit payloads) are surfaced to requesters.

## Negative controls (verified)

The new edge function contains zero of the following call sites (verified by source inspection and by the existing `scripts/check-facilitation-no-send-path.mjs` scope rules; the new function deliberately stays outside any send/mutation pathway):

- WaD insert, match insert, POI row insert, token ledger, token purchase, payment dispute, outreach send, transactional email, notification dispatch, Resend / SMTP / SendGrid / Twilio call, Registry/KYB provider, Sanctions/PEP provider, DNC override, compliance-block override, duplicate-block override, bulk conversion loop.

## Tests / guards run

- `node scripts/check-facilitation-poi-conversion-audit-names.mjs` → **OK (5 pinned)**
- `node scripts/check-facilitation-case-audit-names.mjs` → **OK (32 pinned)**
- TypeScript compilation: clean (build harness reports no errors after edits).
- Edge function deploy: `facilitation-poi-conversion` and `facilitation-health-probe` deployed successfully.
- Health probe: new function listed in `facilitation-health-probe` aggregator (HQ → System Health surfaces it).

## Caveats

- Live Registry / KYB and Sanctions / PEP integrations are formally deferred (BATCH_14 / BATCH_15). Eligibility relies on manual records only.
- Real `pois` row insertion from a facilitation case is deferred; reference-based conversion stores a safe linkage record on the case. Existing-POI linkage is fully supported.
- Bulk conversion is intentionally not implemented and not exposed in the UI.
