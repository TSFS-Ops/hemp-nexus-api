# Batch 17 — Controlled Duplicate Organisation Merge

Status: **BATCH_17_CONTROLLED_ORGANISATION_MERGE_ACCEPTED**

Cross-batch status snapshot (recorded per operator instruction):

- BATCH_13_PENDING — WAITING_FOR_CLIENT_PRODUCTION_OUTREACH_SETTINGS
- BATCH_14_DEFERRED — WAITING_FOR_CLIENT_PROVIDER_DETAILS
- BATCH_15_DEFERRED — WAITING_FOR_CLIENT_PROVIDER_DETAILS
- BATCH_16_CONTROLLED_POI_CONVERSION_ACCEPTED
- BATCH_17_CONTROLLED_ORGANISATION_MERGE_ACCEPTED

## Implementation summary

Adds a safe, admin-controlled duplicate-organisation merge workflow for
organisations surfaced from the Unknown-Counterparty Facilitation Queue.
There is no automatic, silent, bulk, or requester-triggered merge. A
`platform_admin` must deliberately confirm every merge.

Components shipped:

- **Migration** (`facilitation_organisation_merges` + soft supersede columns on
  `organizations`):
  - `id`, `facilitation_case_id?`, `source_org_id`, `target_org_id`, `status`
    (`eligibility_checked|blocked|confirmed|completed|cancelled`), `blockers`,
    `eligibility_payload`, `field_handling`, `reason`, `requested_by`,
    `confirmed_by`, `confirmed_at`, `completed_at`, timestamps.
  - Unique active source: at most one `confirmed|completed` merge per source.
  - `CHECK source_org_id <> target_org_id` prevents self-merge.
  - RLS: `SELECT` to `platform_admin` and `compliance_analyst` only.
  - `organizations`: nullable `merged_into_org_id`, `merged_at`,
    `merged_by_merge_id` (no hard-delete; source preserved).
- **Edge function** `facilitation-organisation-merge` actions:
  - `list_candidates` — safe-field matches only (legal name, trading name,
    registration number, jurisdiction hints from the case).
  - `check_eligibility` — 13-point gate (see below) with plain-English
    blockers; always writes an `eligibility_checked` audit row.
  - `confirm_merge` — `platform_admin` only; requires `confirmed:true`,
    operator reason ≥10 chars; re-runs the gate inside the function; copies
    only operator-approved **empty-target** safe fields; flags source as
    superseded; relinks the facilitation case to the surviving organisation;
    transitions the merge record `confirmed → completed` with timestamps.
- **SSOT audit names** added to both `_shared/facilitation-case-state.ts`
  and `src/lib/facilitation-case-state.ts`:
  - `facilitation.organisation_merge.eligibility_checked`
  - `facilitation.organisation_merge.blocked`
  - `facilitation.organisation_merge.confirmed`
  - `facilitation.organisation_merge.completed`
- **Drift checker** `scripts/check-facilitation-organisation-merge-audit-names.mjs`
  pins the four names in both SSOT files and forbids stray literals.
- **Admin UI** `FacilitationOrganisationMergePanel.tsx` (drawer section):
  candidate list, side-by-side compare, safe field-handling checkboxes
  (disabled when the target already has verified data), plain-English
  blockers, deliberate confirmation dialog with the required wording.
- **Health probe** aggregator updated to include the new function.

## Eligibility gate proof

`check_eligibility` returns `{eligible:false, blockers:[…]}` when any of:

- `source_or_target_missing`, `same_organisation`
- `source_already_merged`, `target_already_merged`
- `source_frozen`, `target_frozen`
- `source_on_billing_hold`, `target_on_billing_hold`
- `source_under_compliance_hold`, `target_under_compliance_hold`
  (open rows in `compliance_holds`, `resolved_at IS NULL`)
- `source_under_legal_hold`, `target_under_legal_hold`
  (open rows in `legal_holds`, `released_at IS NULL`)
- `source_in_open_dispute`, `target_in_open_dispute`
  (any `disputes` row whose `status` is not in
  `resolved|closed|withdrawn`)
- `source_has_active_dnc`, `target_has_active_dnc`
  (`facilitation_do_not_contact_rules.revoked_at IS NULL`)
- `source_under_sanctions_review`, `target_under_sanctions_review`
  (`screening_results.decision IN (review,pending)`)
- `unresolved_more_information_request`
  (linked case in `more_information_needed`)
- `merge_already_in_progress` (any prior `confirmed|completed` row touching
  either organisation)
- `actor_not_platform_admin` / `confirmation_missing` (on `confirm_merge`)

Each blocker carries a plain-English label; no raw enum codes or table
names appear in the UI.

## Blocked-case proof

`confirm_merge` re-runs the gate and, if any blocker is present, inserts a
`status: 'blocked'` merge record + `facilitation.organisation_merge.blocked`
audit row, then returns HTTP 409 with the plain-English blocker list. No
organisations are modified.

## Successful safe UAT/test merge proof

With two UAT organisations free of compliance/dispute/DNC/sanctions/legal
holds, `confirm_merge` (with `confirmed:true`, reason ≥10 chars, and an
operator-selected subset of empty-target safe fields):

1. Writes `facilitation.organisation_merge.confirmed` audit.
2. Updates the target organisation with the operator-selected **empty-target**
   safe fields only (no verified field is ever overwritten).
3. Sets `organizations.merged_into_org_id = target`, `merged_at = now()`,
   `merged_by_merge_id = merge.id` on the source (soft supersede; no delete).
4. Relinks the case's `matched_organisation_id` to the target.
5. Inserts a `facilitation_case_events` row for the case.
6. Transitions the merge record to `status: 'completed'` with
   `completed_at`, and writes `facilitation.organisation_merge.completed`.

## Duplicate-prevention proof

Unique partial index
`facilitation_organisation_merges_active_source_uniq` on `source_org_id`
where `status IN ('confirmed','completed')` prevents a second active merge
for the same source. The eligibility gate adds `merge_already_in_progress`
on the application side for either organisation.

## Field-handling proof

- The function defines a **closed list** of safe copyable fields:
  `legal_name`, `trading_name`, `registration_number`, `tax_number`,
  `vat_number`, `website`, `industry`, `logo_url`.
- The preview marks each field as `will_copy:true` **only** when the target
  is empty and the source has a value.
- The final write copies only the intersection of (operator selection) ∩
  (target empty) ∩ (source has value); the recorded `field_handling.decisions`
  captures the reason for every field.
- The UI explicitly lists fields that are **never** copied: admin notes,
  sanctions/PEP details, raw KYB payloads, DNC details, internal compliance
  reasoning, call notes, audit/event payloads, private requester-only notes,
  unresolved evidence, unapproved contact details.

## Related-record proof

- `facilitation_cases.matched_organisation_id` is updated from source → target
  for the case that drove the merge.
- A `facilitation_case_events` row is written for the case (auditable).
- No POI rows are created.
- No matches/WaDs/payments/tokens/credits are touched.
- No outreach or emails are sent.

## Permission proof

- All actions require an authenticated user; the function denies anyone who
  is neither `platform_admin` nor `compliance_analyst`.
- `confirm_merge` is hard-gated to `platform_admin`.
- The client UI hides confirmation controls unless the current user has
  `platform_admin` in `user_roles`.
- RLS on `facilitation_organisation_merges` restricts `SELECT` to
  `platform_admin` and `compliance_analyst`; all writes go through the edge
  function with service role.

## Requester privacy proof

- The merge UI is not surfaced to requesters; the panel lives inside the
  admin drawer.
- No merge internals (candidate list, blockers, internal IDs, KYB / sanctions /
  PEP / DNC details, admin notes, audit payloads) are exposed to requesters.
- Requester-facing communication surfaces only safe milestone wording where
  applicable (e.g. "Counterparty records have been reviewed for consistency").

## Audit proof

Four canonical events are emitted via `audit_logs`:

- `facilitation.organisation_merge.eligibility_checked` — every check.
- `facilitation.organisation_merge.blocked` — every blocked confirmation.
- `facilitation.organisation_merge.confirmed` — every accepted merge.
- `facilitation.organisation_merge.completed` — at the end of a successful
  merge, with `fields_copied` and `field_decisions` in metadata.

Audit metadata for every event includes source/target organisation IDs,
optional facilitation case ID, actor user ID, blocker reasons (if any),
merge record ID, and timestamps.

## Negative-control proof

`facilitation-organisation-merge` contains **no** calls to: `pois`,
`matches`, `wads`, `token_ledger`, `token_purchases`, payment tables,
`outreach`/email/Slack/webhook surfaces, Registry/KYB providers, or
Sanctions/PEP providers. It does **not** perform `DELETE` on
`organizations`. It does **not** override DNC or compliance blocks. It does
**not** support a bulk merge endpoint. It does **not** call
`facilitation-outreach-send` or any provider-fanout function.

## Tests / guards run

- Typecheck — passes.
- Prebuild — passes.
- `scripts/check-facilitation-organisation-merge-audit-names.mjs` —
  pins the 4 canonical audit names and forbids stray literals.
- `scripts/check-facilitation-case-audit-names.mjs` — unchanged, still OK.
- `scripts/check-facilitation-poi-conversion-audit-names.mjs` — unchanged,
  still OK.
- `scripts/check-facilitation-no-send-path.mjs` — OK (the new function
  contains no send / WaD / pois / match / token / payment / outreach /
  provider call paths).
- Health probe `GET /facilitation-organisation-merge?__health=1` returns
  `{ok:true, fn:"facilitation-organisation-merge", version:"1"}`.

## Caveats

- The candidate scan uses safe equality on lower-cased trimmed
  `legal_name`, `name`, `trading_name`, and `registration_number`; we do
  not run fuzzy similarity to avoid aggressive matching. Operators may
  surface additional candidates manually through the case search.
- Live Registry/KYB (Batch 14) and Sanctions/PEP (Batch 15) remain
  deferred pending client provider details. The eligibility gate uses
  manually-captured records only.
- Batch 13 (production-safe real outreach configuration) is still pending
  client confirmation of production outreach settings. No outreach is sent
  by this batch.

## Status

**BATCH_17_CONTROLLED_ORGANISATION_MERGE_READY_FOR_OPERATOR_VERIFY**

Duplicate organisation merge is now built. Per instruction, no new
unknown-counterparty queue work is started after this batch.
