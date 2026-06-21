# Batch 7 — Registry Search & Claim Rules Hardening

Implements the approved operating rules from
`izenzo-registry-claim-rules-recommended-answers.docx` (Q1–Q12) as the
canonical product behaviour. Strengthens the existing Business Registry
foundation without ingesting production-scale registry data and without
marking any record as verified, production-ready or institutionally usable.

## Rule implementation summary

| Q  | Rule | Surface |
| -- | ---- | ------- |
| Q1 | Any person may start a claim; only `platform_admin` or `compliance_owner` may approve. Unlisted claimants must route via `evidence_required → under_review`. | `src/lib/registry-claim-rules.ts` (`REGISTRY_CLAIM_APPROVAL_ROLES`, `REGISTRY_CLAIMANT_ROLE_TYPES`), `supabase/functions/registry-company-claim/index.ts` |
| Q2 | Unregistered users may start a claim enquiry only. Account + email verification required before evidence submission. | `registry_claim_interest_events` table + `REGISTRY_CLAIM_INTEREST_STATES`; correction/new-company functions enforce `email_confirmed_at`. |
| Q3 | Claim approval only confirms claim-record review. Never verifies authority, profile or bank details. | `REGISTRY_CLAIM_APPROVAL_SAFETY_COPY`; existing claim edge already requires `acknowledged_not_verification`. |
| Q4 | Evidence requirements differentiated by entity / claimant type. | `REGISTRY_EVIDENCE_CATEGORIES`, `REGISTRY_EVIDENCE_REQUIREMENTS`. |
| Q5 | Professional representatives may only start/evidence/request authority. 90-day default authority period. | `REGISTRY_PROFESSIONAL_REPRESENTATIVE_DEFAULT_AUTHORITY_DAYS = 90`; `isProfessionalRepresentative()`. |
| Q6 | Competing claims create a conflict state; later claims accepted but flagged. | `registry_claim_conflicts` + `REGISTRY_CLAIM_CONFLICT_STATES`. Admin UI: `/admin/registry/claim-conflicts`. |
| Q7 | Tiered searchability (public / public-with-care / admin-only / not-searchable). Public search must not leak sensitive match reasons. | `REGISTRY_SEARCH_FIELD_TIERS`, `registry_public_search_sensitive_match_suppressed` audit event. |
| Q8 | Tiered visibility (public / masked / admin-only / hidden). Bank detail status label only, never raw. | `REGISTRY_PROFILE_FIELD_TIERS`, `REGISTRY_PUBLIC_PROFILE_NON_VERIFICATION_COPY`. |
| Q9 | Imported records default to `imported_unverified`. API must return `not_usable / not_ready / business_decision_required` until further gates. | `REGISTRY_IMPORTED_RECORD_DEFAULT_STATE`, `REGISTRY_IMPORTED_UNVERIFIED_API_STATUS_RESPONSES`. |
| Q10 | New-company request workflow. Provisional records labelled and not public. | `registry-new-company-request` edge + `registry_new_company_requests` table + admin UI `/admin/registry/new-company-requests`. |
| Q11 | Claimants may only REQUEST corrections; public/API fields don't change until admin approves. | `registry-company-correction-request` edge + `registry_company_correction_requests` + admin UI `/admin/registry/correction-requests`. |
| Q12 | Outreach blocked until business decision. Channel permissions encoded. | `REGISTRY_OUTREACH_CHANNEL_PERMISSIONS`, `REGISTRY_OUTREACH_BLOCKED_COPY`. Existing AI outreach drafter + approval gates unchanged. |

## State matrices

* Claim interest: `claim_interest_started → account_required → email_verification_required → email_verified → claim_started → claim_submitted → evidence_required | under_review → approved | rejected | expired | cancelled`.
* Claim conflict: `first_claim_under_review → second_claim_received → claim_conflict_detected → evidence_requested_from_claimants → admin_review → one_claim_approved | multiple_claims_approved_with_scoped_access | rejected | escalated`.
* New-company request: `no_result_found → new_company_request_started → basic_details_submitted → source_evidence_required → duplicate_check_pending → admin_review → provisional_record_created | request_rejected → claim_review_required`.
* Correction request: `correction_requested → evidence_required → under_admin_review → approved | rejected → profile_updated_with_new_provenance`.
* Imported record readiness: `imported_unverified → claim_enabled → authority_enabled → client_demo_ready → production_ready` (each move requires recorded business decision).

## Public vs admin search separation (Q7)

* Public search may match only fields in `public_searchable` and (with display care) `public_searchable_with_careful_display`.
* If a record matches an `admin_only_searchable` or `not_publicly_searchable` field, the result is suppressed from public callers and `registry_public_search_sensitive_match_suppressed` is emitted on the admin side.
* Public callers never see "matched on email/phone/address/bank" reasons.

## Public profile visibility (Q8)

* `public_visible` fields render as plain text on the company profile.
* `masked_public` fields render in masked form only.
* `admin_only` fields render only when the caller has `platform_admin` or `compliance_owner`.
* `hidden_from_public` fields never render — raw bank details and unmasked bank references are blocked end-to-end.

## Claim approval separation proof

* `REGISTRY_CLAIM_APPROVAL_SAFETY_COPY` is the canonical wording.
* `registry-company-claim` requires `acknowledged_not_verification: true` on every review.
* Claim approval writes only to `registry_company_claims.status` and `registry_company_claim_reviews`. It never updates `authority_records`, `registry_bank_detail_submissions` or profile verification fields.

## Competing claim proof

* `registry_claim_conflicts` is admin-readable only.
* Scoped grants live in `scope_grants jsonb` so multiple claimants can hold non-overlapping permissions.
* `registry_claim_conflict_detected` / `registry_claim_conflict_resolved` / `registry_claim_scope_granted` audit events are emitted.

## Imported-unverified proof

* Default state for imported records is `imported_unverified`.
* `REGISTRY_IMPORTED_UNVERIFIED_DISPLAY_COPY` describes the record as "source-backed but … not yet been independently verified".
* `check-registry-claim-rules-forbidden-wording.mjs` rejects "verified", "production-ready" and "institutionally usable" wording on imported_unverified surfaces.

## New-company request proof

* Edge function `registry-new-company-request` enforces email verification, runs a duplicate-candidate pre-flight, and emits `registry_new_company_request_started` + `registry_new_company_duplicate_check_started`.
* Provisional records are stored in `registry_new_company_requests` with `status = 'provisional_record_created'` and the wording `"Provisional unverified record. Not public unless approved."`.

## Correction request proof

* Edge function `registry-company-correction-request` records the proposed value but never mutates the source registry fields directly.
* `sensitive_field` flag auto-detects PII / bank / officer field paths and routes them to `compliance_owner` for review.
* Approval emits `registry_company_correction_applied` and transitions the request to `profile_updated_with_new_provenance` — actual provenance writes are deferred to the existing provenance writer (`registry-provenance-record`).

## Outreach blocked proof

* `REGISTRY_OUTREACH_BLOCKED_COPY` is the canonical wording.
* The existing AI outreach drafter (`registry-ai-outreach-draft`) and human approval queue (`registry-outreach-review`) remain the only writer surfaces. `check-registry-batch7-no-auto-send.mjs` enforces that the two new Batch 7 edge functions do not call any SMS / WhatsApp / email provider.

## Guard list (added in Batch 7)

* `scripts/check-registry-claim-rules-parity.mjs`
* `scripts/check-registry-claim-rules-forbidden-wording.mjs`
* `scripts/check-registry-batch7-no-auto-send.mjs`

All Batch 1–6 guards remain active.

## Test summary

* `src/tests/batch-7-registry-search-claim-rules-hardening.test.ts`
  * SSOT parity for every Batch 7 array.
  * Claim approval safety copy present and `acknowledged_not_verification` still required.
  * Claim edge function does not update authority or bank-detail tables.
  * New-company + correction edge functions enforce email verification.
  * New-company edge function rejects approval from invalid state and emits duplicate-check audit.
  * Correction edge function flags sensitive fields and routes to `compliance_owner`.
  * Migration creates each new table with `service_role` GRANT and RLS enabled.

## Files added / changed

```
src/lib/registry-claim-rules.ts                              (new SSOT)
supabase/functions/_shared/registry-claim-rules.ts           (new SSOT mirror)
supabase/functions/registry-new-company-request/index.ts     (new edge)
supabase/functions/registry-company-correction-request/index.ts (new edge)
supabase/migrations/20260621120000_b7c50001-r7-claim-rules-hardening.sql (new tables + RLS)
src/pages/admin/registry/NewCompanyRequests.tsx              (admin queue)
src/pages/admin/registry/CorrectionRequests.tsx              (admin queue)
src/pages/admin/registry/ClaimConflicts.tsx                  (admin queue)
scripts/check-registry-claim-rules-parity.mjs                (guard)
scripts/check-registry-claim-rules-forbidden-wording.mjs     (guard)
scripts/check-registry-batch7-no-auto-send.mjs               (guard)
src/tests/batch-7-registry-search-claim-rules-hardening.test.ts (tests)
scripts/edge-function-deploy-manifest.json                   (manifest update)
supabase/config.toml                                         (verify_jwt config)
src/App.tsx                                                  (admin routes)
src/pages/admin/registry/Index.tsx                           (tiles)
RELEASE_GATE.md                                              (batch entry)
package.json                                                 (prebuild guards)
```

## Out of scope (reasserted)

* No production-scale registry ingest.
* No record marked verified / production-ready / institutionally usable.
* No raw bank details exposed.
* No raw personal contact details exposed publicly.
* No AI auto-send path.
* No external provider integration.
* No raw bank-detail API scope.

Status: `BATCH_7_REGISTRY_SEARCH_CLAIM_RULES_HARDENING_COMPLETE`.
