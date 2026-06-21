# Batch 12 — Authority-to-Act Request, Evidence and Approval

## Purpose
Build the controlled authority-to-act workflow on top of approved company claims (Batch 11). Approved claimants can request **scoped** authority, upload authority evidence, track per-scope decisions, and receive admin/compliance outcomes. Admin/compliance reviewers can decide per-scope, with mandatory acknowledgement that authority **does not** verify the company profile, confirm bank details, or make the company institutionally usable.

## Non-negotiables (re-stated)
- Authority approval grants ONLY the named scope(s).
- Authority approval is NOT company verification.
- Authority approval is NOT bank-detail verification.
- Authority approval does NOT make the company institutionally usable.
- In-app notifications are LOG-ONLY (`sent_externally = false`).
- Raw sensitive evidence never public.
- Existing Batch 1–11 guardrails untouched.

## Authority user journey
1. `/registry/company/:id/authority` — start request from an approved claim.
2. Confirm company → confirm approved claim → select requested scopes → enter authority details → upload/attach evidence metadata → accept declaration → submit.
3. `/registry/authority` — list of own authority requests.
4. `/registry/authority/:authorityRequestId` — status, scope-level decisions, missing evidence, public-safe approval/rejection wording.

## Authority scope matrix
| Scope | Sensitive | Compliance review | Two-person | Default expiry |
| --- | --- | --- | --- | --- |
| profile_correction_request | no | no | no | 180d |
| profile_correction_approval_request | no | no | no | 180d |
| bank_detail_submission | YES | YES | no | 90d |
| bank_detail_update | YES | YES | no | 90d |
| bank_detail_revocation_request | YES | YES | no | 90d |
| company_user_management_request | YES | YES | no | 90d |
| api_sharing_consent_request | YES | YES | no | 90d |
| dispute_response | no | no | no | 180d |
| document_upload | no | no | no | 180d |
| authority_delegation_request | YES | YES | YES | 30d |

## Evidence requirement matrix (engine output)
- Low-risk scopes → `claimant_approved_claim_reference` + `declaration`.
- Sensitive scopes → + `identity_proof` + scope-specific proof (`bank_detail_authority_proof` / `api_sharing_consent_proof` / `user_management_authority_proof`) + `company_mandate` (legal-form: company) or `director_member_proprietor_authorisation`.
- Delegation → + `delegated_authority_letter` + `company_mandate` + expiry.
- Professional representatives → + `professional_representative_mandate` + `identity_proof`.

## Scope-level approval proof
`registry-authority-scope-decision` writes a `registry_authority_scope_decisions` row per scope, updates `registry_authority_request_scopes.status`, then reduces overall request status via `reduceAuthorityStatusFromScopeDecisions`:
- all approved → `approved`
- all rejected → `rejected`
- approved + rejected/more-evidence mix → `partially_approved`
- any `more_evidence_requested` → `more_evidence_requested`
- otherwise → `under_review`

## Partial approval proof
See test `reduces to partially_approved when mixed approve/reject` in `src/tests/batch-12-authority-to-act-request-review.test.ts`.

## Active-authority check proof
`checkActiveAuthority()` returns one of `allowed | not_allowed | scope_missing | authority_expired | authority_suspended | authority_revoked | authority_disputed | claim_conflict_locked | company_disabled | company_archived`. Edge function `registry-authority-active-check` is the canonical gate for any future sensitive flow (bank submit, user management). Every call writes `registry_authority_active_check_performed` to `registry_authority_events`.

## Sensitive scope compliance proof
`registry-authority-scope-decision` returns `403 compliance_review_required` when an approved sensitive scope decision is attempted by a reviewer lacking `compliance_owner`. Verified in the deny-path of the edge function.

## Two-person delegation proof
`registry-authority-scope-decision` requires `second_reviewer_id` when approving `authority_delegation_request`; missing → `403 two_person_approval_required`.

## Approval separation proof
- `registry_authority_scope_decisions.acknowledged_not_company_verification` and `acknowledged_not_bank_verification` set true on every approved scope.
- Admin `registry-authority-review` action `approve_full_request` rejects unless body contains the verbatim `REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT`.
- Admin UI `src/pages/admin/registry/AuthorityReview.tsx` renders the acknowledgement copy verbatim and blocks the approve button until checked.
- No mutation is performed on `registry_company_records` (verification status) or `registry_bank_detail_submissions` (verification status) anywhere in the Batch 12 surface.

## RLS proof
Migration `20260621163545_*` (Batch 12 schema) plus prior B12 hardening:
- `registry_authority_request_scopes`, `registry_authority_scope_decisions`, `registry_authority_disputes` → requester sees own rows; admin/compliance read+write all.
- `registry_authority_notes`, `registry_authority_assignments` → admin/compliance only.
- `registry_authority_status_notifications` → recipient owner sees own; admin/compliance read+write all.
- `registry_active_authorities` → owner read-only; admin/compliance read; only `service_role` writes.
- `registry_authority_evidence` policies `rae_owner_read_b12` / `rae_owner_insert_b12` restrict requester ownership and block insert on finalised requests.

## Notification log-only proof
`registry-authority-notification-log` persists `sent_externally: false`. Guard `scripts/check-registry-batch12-no-external-send.mjs` fails the build on any reference to `resend|sendgrid|twilio|whatsapp|mailgun` in that file.

## Public wording proof
- `REGISTRY_AUTHORITY_B12_PUBLIC_APPROVAL_NOTICE` rendered on user status page when status is `approved`.
- `REGISTRY_AUTHORITY_B12_PUBLIC_REJECTION_NOTICE` rendered on rejection.
- `REGISTRY_AUTHORITY_B12_PUBLIC_NEXT_STEP_BANK` shown as guidance (never as "verified" claim).
- Guard `scripts/check-registry-batch12-authority-wording.mjs` blocks forbidden affirmative wording.

## Audit event proof
`REGISTRY_AUTHORITY_B12_AUDIT_EVENT_NAMES` is the canonical Batch-12 list. Every edge function emits exactly one of these names. Guard `scripts/check-registry-batch12-authority-audit-names.mjs` enforces this (legacy Batch-4 names remain accepted).

## Guard list
- `scripts/check-registry-authority-workflow-parity.mjs` — TS↔Deno parity for all Batch 12 enums + copy.
- `scripts/check-registry-batch12-authority-audit-names.mjs` — canonical audit-event names.
- `scripts/check-registry-batch12-authority-wording.mjs` — required acknowledgement + public notice + forbidden wording.
- `scripts/check-registry-batch12-no-external-send.mjs` — notifier is log-only.
- Pre-existing: `check-registry-authority-state-parity.mjs`, `check-registry-batch4-audit-names.mjs`, `check-registry-batch4-wording.mjs`, plus B12 security guards from this batch.

## Test summary
`src/tests/batch-12-authority-to-act-request-review.test.ts` covers:
- SSOT state/scope/category/event constants
- Requirements engine: low-risk vs sensitive vs delegation vs prof-rep
- Claim conflict blocks sensitive submission
- Active-authority check across all 10 outcomes
- Status reducer for approved / partially_approved / rejected / more_evidence_requested

## Edge functions added (deploy-listed)
- `registry-authority-start`
- `registry-authority-submit`
- `registry-authority-evidence-upload`
- `registry-authority-status`
- `registry-authority-scope-decision`
- `registry-authority-active-check`
- `registry-authority-dispute-manage`
- `registry-authority-notification-log`

(Existing `registry-authority-request` and `registry-authority-review` remain deploy-listed.)

## Database changes
- Extended `registry_authority_requests` (`requested_scopes`, `is_sensitive`, `two_person_required`, `withdrawn_at`, `cancelled_at`, `escalated_at`, `last_activity_at`).
- Extended `registry_authority_evidence` (`evidence_category`, `state`, `scope_code`, `reviewed_by`, `reviewed_at`, `review_notes`, `expiry_at`).
- New tables: `registry_authority_request_scopes`, `registry_authority_scope_decisions`, `registry_authority_notes`, `registry_authority_assignments`, `registry_authority_status_notifications`, `registry_active_authorities`, `registry_authority_disputes`.

## Out of scope (re-stated)
No company-profile verification, no bank-detail verification, no external sends, no outreach, no external provider integration, no raw evidence exposure.
