# Batch 10 — Import-to-Claim Activation and Record Lifecycle Controls

**Status:** BATCH_10_IMPORT_TO_CLAIM_LIFECYCLE_COMPLETE

## Scope

Build the controlled lifecycle layer that decides when an imported registry
record may become claimable, how claim availability is reviewed over time,
how stale records are handled, and how admin/compliance users move records
through lifecycle states **without** implying verification, authority approval,
bank verification, production readiness or institutional usability.

## Lifecycle state matrix

```
imported_unverified
  → import_review_required
  → claim_pending_business_decision
  → claim_enabled

import_review_required → import_review_in_progress → claim_pending_business_decision
claim_pending_business_decision → claim_enabled

claim_enabled ↔ claim_suspended
claim_enabled ↔ claim_conflict_locked

any active → correction_under_review → prior active state
any active → source_refresh_required → import_review_required
any active → stale_review_required → prior active state
any active → disabled → import_review_required
any non-public → archived
```

Pinned in `src/lib/registry-record-lifecycle.ts` and mirrored in
`supabase/functions/_shared/registry-record-lifecycle.ts`.

## Claim availability engine

`evaluateClaimAvailability()` (mirrored SSOT) returns one of:

`available`, `not_available`, `business_decision_required`,
`country_not_ready`, `source_not_approved`, `duplicate_review_required`,
`record_disabled`, `record_archived`, `record_stale`,
`correction_under_review`, `claim_conflict_locked`, `insufficient_provenance`.

Every result carries a **safe public reason** plus an **internal reason**
visible only to admin/compliance surfaces.

## Claim activation gates

A record may only reach `claim_enabled` when **all** of the following hold:

- published from an approved import;
- not quarantined;
- not disabled / archived;
- has provenance;
- source file has permitted-use approval;
- approved business decision exists for claim activation;
- country coverage allows claims;
- no high-confidence duplicate is unresolved;
- no active correction on an identity field;
- no active claim-conflict lock;
- not stale (or admin override exists);
- approver is `platform_admin` or `compliance_owner` (AAL2 enforced).

`claim_enabled` **only** allows the claim workflow to start. It does not:

- verify the company;
- verify authority-to-act;
- verify bank details;
- enable API production output;
- enable institutional reliance.

## Stale review

Defaults (days):

| Cohort                                | Stale after |
| ------------------------------------- | ----------- |
| imported unverified (default)         | 180         |
| record with active claim              |  90         |
| record with dispute / correction      |  30         |

Public copy when stale:
> "This record may need review because its source data is no longer recent."

Internal-only state names (`claim_pending_business_decision`,
`claim_conflict_locked`, `import_review_required`, `import_review_in_progress`)
are translated to safe public labels.

## Public surfaces

Allowed public lifecycle labels:

- Imported record
- Claim available
- Claim not available yet
- Information under review
- Source refresh required
- Record disabled
- Not independently verified by Izenzo

Public claim button shows only when engine result is `available`; otherwise
either hidden or shown disabled with the safe public reason. Disabled and
archived records are excluded from public surfaces.

## Edge functions

- `registry-claim-availability-check` (mixed: public-safe response, admin sees internals)
- `registry-record-lifecycle-manage` (platform_admin | compliance_owner, AAL2)
- `registry-claim-activation-review` (platform_admin | compliance_owner)
- `registry-record-stale-review` (platform_admin | compliance_owner)
- `registry-record-lifecycle-summary` (platform_admin | compliance_owner)

All deploy-listed in `scripts/edge-function-deploy-manifest.json`.

## Database

New tables (RLS on, admin/compliance read, service-role write):

- `registry_company_record_lifecycle_events`
- `registry_claim_activation_reviews`
- `registry_claim_availability_checks`
- `registry_record_stale_reviews`
- `registry_record_lifecycle_notes`

New columns on `registry_company_records`:

`lifecycle_state`, `claim_activation_state`,
`claim_enabled_at/by`, `claim_suspended_at/by`,
`last_reviewed_at`, `next_review_due_at`, `stale_after_at`, `is_stale`,
`disabled_at/by`, `archived_at/by`.

## Audit events

```
registry_record_lifecycle_checked
registry_record_lifecycle_transition_requested
registry_record_lifecycle_transition_applied
registry_record_lifecycle_transition_blocked
registry_claim_availability_checked
registry_claim_activation_approved
registry_claim_activation_rejected
registry_claim_activation_suspended
registry_claim_activation_reenabled
registry_record_marked_stale
registry_record_stale_review_started
registry_record_stale_review_completed
registry_record_disabled
registry_record_archived
registry_record_lifecycle_note_added
```

Batch 1–9 audit names are unchanged.

## Guards

- `scripts/check-registry-record-lifecycle-parity.mjs`
- `scripts/check-registry-batch10-no-verified-claim-wording.mjs`

Both wired into `npm run prebuild`.

## Tests

`src/tests/batch-10-import-to-claim-lifecycle.test.ts` covers:

- imported_unverified is the default;
- transition matrix admits only allowed pairs;
- engine returns the correct blocker for every gate;
- stale records are blocked unless admin override is set;
- claim_enabled produces "Claim available" label — not verified wording;
- public reasons + public labels never contain Batch 10 forbidden words;
- approval roles restricted to `platform_admin` and `compliance_owner`;
- claim activation states never include "verified" or "production_ready".

## Admin UI

`/admin/registry/claim-activation` lists records, runs the availability
engine on demand, and provides reasoned transition actions.

## Out of scope (unchanged)

No verification of companies, no bank verification, no API production use,
no institutional reliance, no outreach, no external providers, no automatic
duplicate merge.
