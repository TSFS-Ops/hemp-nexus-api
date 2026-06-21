# Batch 19A — Client Claim/Search/Profile Decision Alignment

Status: **Alignment patch applied on top of Batches 1–18.**

## Client decision source

- `docs/registry/client-decisions/Izenzo_Business_Registry_Claim_Rules_Client_Questionnaire_Completed.docx`
- Signed by David Davies. Treated as controlling client build decision.
- Where the document gives an exact rule, that rule overrides earlier defaults.
- Where the document is silent, conservative defaults from Batches 1–18 stand.

## SSOT

`src/lib/registry-client-decisions-19a.ts` is the single source of truth for
this batch. All copy, state names, evidence categories and visibility tiers
introduced here must be imported from that file.

## Q1 — Claim starter rule (decision E)

Categories able to start a claim immediately:

- listed officer / director / member / proprietor / person with significant control
- verified company-domain email holder

Categories requiring extra gating:

- **third-party adviser** — claim only with mandate evidence
- **unlisted person** — may file an enquiry; remains `claim_pending_review`
  until `platform_admin` or `compliance_owner` approves

Audit events: `claim_enquiry_started`, `claim_pending_review`, `claim_rejected`,
`representative_claim_started`, `mandate_uploaded`.

No claim creates authority-to-act, bank-detail rights, API-sharing rights or
verified-company status.

## Q2 — Unregistered user state proof

```
enquiry_started -> account_required -> email_verified -> claim_started
  -> evidence_submitted -> under_review
  -> approved / rejected / more_information_required
```

Sensitive documents, bank details and authority requests are blocked until
account + email verification complete.

## Q3 — `claim_approved_limited` proof

Canonical copy (pinned in SSOT, enforced by guard):

> Claim reviewed - claimant connection accepted. Authority, profile data and
> bank details are not verified by this claim approval.

Negative grants enforced: not company verification, not authority-to-act,
not bank verification, not API sharing approval, not compliance clearance,
not authority to bind the company.

Audit payload: actor, evidence references, reviewer, timestamp, reason.

## Q4 — Evidence matrix proof

Encoded in `BATCH_19A_EVIDENCE_MATRIX` for:

- sole_proprietor
- private_company
- close_corporation
- corporate_shareholder_or_control
- third_party_representative

Fallback: incomplete official evidence routes to
`more_information_required` / `authority_review_required`. Evidence older
than 12 months must be refreshed unless reviewer records an exception
(`registry_claim_evidence_age_exception_recorded`).

## Q5 — Representative permissions proof

Pre-authority allowed: start claim, upload mandate, request authority review.
Pre-authority forbidden: edit profile fields, submit bank details, manage
users, consent to API sharing, represent company as verified.

## Q6 — Competing claim proof

Later claims accepted and marked `claim_conflict_detected`. While unresolved:
no profile changes, no bank submission, no user management, no API-sharing
consent. Resolution outcomes: `primary_claim_approved`,
`additional_authority_approved`, `claim_rejected`, `duplicate_claim_closed`,
`dispute_opened`.

## Q7 — Search visibility proof

- Public: company name, reg #, local #, VAT (where allowed), legal form,
  country, registered address, activity description.
- Logged-in (with privacy controls): officer/member/director names only when
  sourced from official/licensed records and public-display approved.
- Admin-only: emails, phones, personal addresses, source contact-person
  details, full filing/event text, linked companies, birth year, internal
  notes.
- Never publicly searchable: raw personal addresses, personal emails/phones,
  bank details, source-provider internal fields, claim evidence, compliance
  notes.
- Safe match reasons only.

## Q8 — Public profile proof

- Public visible: company name, country, reg/local #, legal form, status,
  registered address, VAT (where allowed), source label, last sourced date,
  readiness label.
- Requires `public_display_approved`: officer/director/member names + roles,
  activity/industry, filing summaries, non-sensitive event summary.
- Hidden from public + API: bank details, claim evidence, compliance notes,
  dispute notes, do-not-contact, provider/internal risk labels.
- Required label: `Sourced company record - not independently verified by
  Izenzo unless specifically stated.`

## Q9 — `sample_only` proof (critical)

The five attached records are locked as `sample_only`:

- bullion_bathrooms_nigeria
- dangote_fertiliser_limited
- harith_holdings
- laurium_capital
- starfair_162

API contract:

- production API output: **excluded**
- sandbox `readiness_state`: `sample_only`
- sandbox `verified_by_izenzo`: `false`
- payment-status `usable verified`: `false`

Required label: `Sample record - sourced data for workflow testing. Not
independently verified by Izenzo.`

Upgrade path: permitted-use review → provenance capture → duplicate check →
field-level readiness approval → `platform_admin`/`compliance_owner` sign-off.

## Q10 — Missing-company proof

```
no_result -> new_company_request_submitted -> duplicate_check_required
  -> evidence_required / provisional_record_created_admin_only
  -> claim_review
  -> approved_imported_unverified / rejected / duplicate_found
```

Only `platform_admin`/`compliance_owner` may create a provisional record;
provisional records are admin-only and never public or API-usable until
approved.

## Q11 — Correction rule proof

Direct claimant edits forbidden on: company name, registration number, VAT
number, legal form, officers, members, registered address, bank details.
Low-risk contact updates captured as `proposed_contact_update`, pending
review. Approved corrections create field-level provenance, previous-value
history, reviewer, timestamp, audit event. Rejected corrections leave the
existing public value and surface `correction_rejected`.

## Q12 — Outreach restriction proof

| Channel | Rule |
| --- | --- |
| Email | Business decision + permitted-use review + approved template + human reviewer + audit log |
| Phone | Admin-only manual, logged outcome, no automatic dialling |
| SMS | Disabled in Phase 1 |
| WhatsApp | Disabled in Phase 1 |
| Letter / manual research | Admin-only, lawful basis only, logged |
| Do-not-contact | Immediate suppression, contact details never exposed publicly |

## Guard list

- `scripts/check-batch-19a-ssot-parity.mjs`
- `scripts/check-batch-19a-forbidden-wording.mjs`
- `scripts/check-batch-19a-sample-only-locked.mjs`
- `scripts/check-batch-19a-no-auto-outreach.mjs`

## Test summary

- `src/tests/batch-19a-client-claim-search-profile-decisions.test.ts`
  covers claim starter categories, unregistered flow ordering,
  `claim_approved_limited` semantics, evidence freshness, competing claim
  blocks, representative pre-authority forbidden actions, search/profile
  visibility tiers, the five sample_only records, sample_only API contract,
  protected-field edit lock and Phase 1 SMS/WhatsApp disablement.

## Acceptance status

`BATCH_19A_CLIENT_CLAIM_SEARCH_PROFILE_DECISIONS_COMPLETE`
