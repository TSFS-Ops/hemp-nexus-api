# Batch 11 — Real Claim Submission, Evidence Upload and Review UX

Scope: build the full user-facing and admin-facing claim workflow on top of
Batches 1–10. Claim approval **never** grants authority-to-act, verifies a
company profile, verifies bank details, or enables API/institutional use.
In-app notifications are LOG-ONLY.

## SSOT

- Browser: `src/lib/registry-claim-workflow.ts`
- Deno mirror: `supabase/functions/_shared/registry-claim-workflow.ts`

Pinned arrays:

| SSOT | Size |
| --- | --- |
| `REGISTRY_CLAIMANT_TYPES` | 12 |
| `REGISTRY_EVIDENCE_CATEGORIES` | 11 |
| `REGISTRY_EVIDENCE_STATES` | 8 |
| `REGISTRY_CLAIM_WORKFLOW_STATUSES` | 19 |
| `REGISTRY_CLAIM_REVIEW_ACTIONS` | 11 |
| `REGISTRY_CLAIM_CONFLICT_OUTCOMES` | 5 |
| `REGISTRY_CLAIM_WORKFLOW_AUDIT_EVENT_NAMES` | 20 |

Pinned wording (verbatim in both TS and Deno SSOTs):

- `REGISTRY_CLAIM_APPROVAL_PUBLIC_WORDING`
- `REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE`
- `REGISTRY_CLAIM_REJECTION_PUBLIC_WORDING`
- `REGISTRY_CLAIM_ADMIN_APPROVAL_ACK`

## Evidence requirements matrix (engine output)

| Legal form | Required (always) | Required if claimant unlisted |
| --- | --- | --- |
| sole_proprietor | proprietor_proof, company_registration_evidence, declaration | + mandate_letter |
| private_company | company_registration_evidence, declaration | director_member_officer_proof OR (mandate_letter + board_company_authorisation) |
| close_corporation | company_registration_evidence, declaration | director_member_officer_proof OR mandate_letter |
| corporate_shareholder | corporate_shareholder_control_evidence, mandate_letter, company_registration_evidence, declaration | — |
| third_party_representative | mandate_letter, identity_proof, declaration | blocks if `mandate_evidence_missing` |

Professional representatives **always** add `identity_proof` + `mandate_letter`
and trigger `requires_compliance_review`.

## Claim status matrix

19 workflow statuses managed in `registry_company_claims.workflow_status`,
mirrored from the SSOT array. Terminal: `approved`, `rejected`, `expired`,
`cancelled`, `withdrawn`.

Default expiry:

- draft → 30 days
- evidence-requested → 14 days
- submitted under review → 30 days unless extended

## Database (migration `batch-11-real-claim-submission-review`)

Extended:

- `registry_company_claims`: `claimant_type`, `company_legal_form`,
  `is_professional_representative`, `sla_due_at`, `assigned_reviewer_user_id`,
  `evidence_completeness`, `conflict_id`, `workflow_status`, `expires_at`,
  `rejection_reason`, `resubmission_allowed`.
- `registry_company_claim_evidence`: `category`, `evidence_state`,
  `sensitive` (defaults `true`), `document_name`, `issuing_authority`,
  `issue_date`, `expiry_date`, `reviewer_user_id`, `review_notes`,
  `rejection_reason`, `provenance_link`, `claimant_statement`, `file_path`.

Created:

- `registry_company_claim_review_events` — admin/compliance review audit trail.
- `registry_company_claim_notes` — internal admin notes (admin/compliance read).
- `registry_company_claim_assignments` — reviewer assignment ledger.
- `registry_company_claim_status_notifications` — in-app LOG-ONLY notifications.

RLS:

- Claim review events / notes: admin + compliance read only.
- Assignments: admin + compliance + the assigned user.
- Notifications: recipient or admin/compliance only.
- All tables grant `service_role` for edge functions; no anon grants.

## Edge functions

- `registry-claim-start` — claimant-initiated. Requires verified email +
  claim-enabled company. Defaults `workflow_status='claim_started'` and
  30-day draft expiry.
- `registry-claim-evidence-upload` — claimant-owned only. Auto-flags
  `sensitive=true` unless category=`declaration`. Auto-flips
  `more_evidence_requested → evidence_resubmitted`.
- `registry-claim-submit` — runs the requirements engine; conflict
  detection sets `claim_conflict_detected` instead of `claim_submitted`.
  SLA set to 30 days.
- `registry-claim-status` — claimant or admin/compliance only.
- `registry-claim-review` — admin/compliance only. 11 actions; reason
  required for state-changing ones; `approve_claim` blocked unless
  `acknowledged_not_verification: true`. **Never** touches authority,
  profile_verified or bank-detail fields.
- `registry-claim-conflict-resolve` — records one of 5 conflict outcomes.
  No automatic winner selection.
- `registry-claim-notification-log` — admin/compliance only, log-only.

All deploy-listed in `scripts/edge-function-deploy-manifest.json`.

## Audit events

All 20 names emit through `registry_company_claim_events` and `audit_logs`.
Covered by `scripts/check-registry-batch11-audit-names.mjs`.

## Public UI

- `/registry/claim` and `/registry/company/:id/claim` — start/upload flow
  (Batch 3 form retained, extended through this batch).
- `/registry/claims` — claimant claim list (Batch 11).
- `/registry/claims/:claimId` — status detail, evidence checklist,
  cancellation, approval/rejection wording (Batch 11).

## Admin UI

- `/admin/registry/claims` — Batch 3 queue (retained, untouched).
- `/admin/registry/claims-review` — Batch 11 review queue with filters,
  action selector, reason field, and **mandatory approval acknowledgement**
  checkbox (`REGISTRY_CLAIM_ADMIN_APPROVAL_ACK`).

## Guards (prebuild)

- `check-registry-claim-workflow-parity.mjs` — TS ↔ Deno SSOT parity +
  verbatim wording.
- `check-registry-batch11-audit-names.mjs` — every SSOT audit name appears
  in at least one batch-11 edge function (or the Batch 3 function).
- `check-registry-batch11-no-verified-claim-wording.mjs` — forbidden
  wording absent on review/status surfaces; public approval wording
  present in `ClaimStatus.tsx`; admin ack present in `ClaimsReview.tsx`.
- `check-registry-batch11-no-auto-send.mjs` — no provider strings
  (Resend/SendGrid/Twilio/WhatsApp/SMS) and no claim-approval mutations
  of authority/profile/bank/api fields in batch-11 edge functions.

All prior Batch 1–10 guards remain wired and passing.

## Approval separation proof

The `registry-claim-review` function on `approve_claim`:

1. Sets `workflow_status='approved'` and `status='approved'`.
2. Records `registry_claim_approved` in `registry_company_claim_events`
   and `audit_logs`.
3. Returns `public_wording = REGISTRY_CLAIM_APPROVAL_PUBLIC_WORDING`.
4. Logs an in-app notification (no external send).

It does **not** update `authority_status`, `profile_verified`,
`bank_detail_status`, or `api_output_allowed`. The guard
`check-registry-batch11-no-auto-send.mjs` enforces this at build time.

## Conflict proof

`registry-claim-submit` detects another active claim with the same
`company_reference` and routes the new claim to `claim_conflict_detected`
+ emits `registry_claim_conflict_detected`. Resolution requires
`registry-claim-conflict-resolve` with admin/compliance role and an
explicit outcome from `REGISTRY_CLAIM_CONFLICT_OUTCOMES`.

## Notification log-only proof

All notifications insert into `registry_company_claim_status_notifications`
with `delivery_state='logged_only'` and emit
`registry_claim_notification_logged`. No edge function in this batch
imports a mail/SMS/WhatsApp provider; enforced by
`check-registry-batch11-no-auto-send.mjs`.

## Tests

`src/tests/batch-11-real-claim-submission-review.test.ts`:

- SSOT sizes and contents (claimant types, evidence categories/states,
  workflow statuses, review actions, conflict outcomes, audit names).
- Verbatim wording invariants.
- Evidence requirements engine across the 5 legal forms and the
  professional-rep, listed/unlisted, mandate-missing, terminal-status,
  and corporate-shareholder branches.
- Terminal-state helper.

## Files

- `src/lib/registry-claim-workflow.ts`
- `supabase/functions/_shared/registry-claim-workflow.ts`
- `supabase/functions/registry-claim-{start,submit,evidence-upload,status,review,conflict-resolve,notification-log}/index.ts`
- `src/pages/registry/ClaimsList.tsx`
- `src/pages/registry/ClaimStatus.tsx`
- `src/pages/admin/registry/ClaimsReview.tsx`
- `scripts/check-registry-claim-workflow-parity.mjs`
- `scripts/check-registry-batch11-audit-names.mjs`
- `scripts/check-registry-batch11-no-verified-claim-wording.mjs`
- `scripts/check-registry-batch11-no-auto-send.mjs`
- `src/tests/batch-11-real-claim-submission-review.test.ts`
- Migration: extends claims/evidence + creates review_events / notes /
  assignments / status_notifications.

## Final status

`BATCH_11_REAL_CLAIM_SUBMISSION_REVIEW_COMPLETE`
