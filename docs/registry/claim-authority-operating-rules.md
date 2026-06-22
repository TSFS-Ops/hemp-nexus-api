# Batch 27 — Claim and Authority Operating Rules

Client decision source:
`docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`

## SSOT

- `src/lib/registry-claim-authority-rules.ts` (browser)
- `supabase/functions/_shared/registry-claim-authority-rules.ts` (Deno)
- `scripts/check-registry-claim-authority-rules-parity.mjs` (byte-parity guard)
- `src/tests/batch-27-claim-authority-rules.test.ts`

## What is codified

1. **Registration / email-verification gate** — six actions
   (`claim_start`, `claim_evidence_submit`, `authority_request`,
   `bank_detail_submit`, `data_dispute_open`, `api_visibility_request`)
   require registered + email-verified user. Searching and viewing
   public profiles do not.
2. **Claimant role classification** — seven roles with explicit
   dispositions (`allowed_with_evidence`,
   `allowed_with_evidence_and_authority_review`,
   `enquiry_only_until_mandate_approved`,
   `enquiry_only_unless_contract_authorises`, `blocked`,
   `admin_assisted_no_self_approval`).
3. **Evidence matrix by legal form** — sole proprietor, company,
   close corporation, partnership and other-legal-form each carry a
   non-empty required document set; evidence older than 12 months
   requires refresh unless an approved reviewer exception is recorded.
4. **Unlisted claimant handling** — `unlisted_claimant_review` state
   blocks edit-profile, bank submission, API consent and
   authority-sensitive workflows until approved.
5. **Multi-claim / conflicts** — four conflict states
   (`competing_claim`, `authority_conflict`, `revoked_authority`,
   `disputed_claim`); `compliance_owner` reviews conflicts and
   sensitive claims, otherwise `data_governance_owner`.
6. **Claim approval is limited** — unlocks only limited profile edit
   and the right to request authority. Never unlocks bank submission,
   API consent, user management, verification results or self-
   approval. Pinned wording matches Batch 19A.
7. **Authority scopes** — closed set of seven scopes
   (`edit_profile`, `submit_bank_details`, `manage_users`,
   `consent_to_api_sharing`, `dispute_handling`,
   `approve_profile_corrections`, `receive_institutional_notifications`).
8. **Authority states + expiry** — 11 states; default 12-month expiry
   for general scopes, 6-month expiry for `submit_bank_details` and
   `consent_to_api_sharing`.
9. **Two-person approval** — `submit_bank_details`,
   `consent_to_api_sharing`, `manage_users` require two distinct
   approvers; bank/API/dispute scopes additionally require
   `compliance_owner` sign-off.
10. **Self-approval blocked** — `evaluateAuthorityAction`
    short-circuits when subject equals actor.
11. **Sensitive-action blocks** — `expired`, `revoked`,
    `suspended_disputed`, `compliance_review` states block
    bank-submit, API-sharing, manage-users, profile publication,
    dispute closure and settlement-sensitive actions.
12. **Forbidden capabilities** — authority never permits changing
    verification results, deleting audit history, overriding disputes,
    changing pricing or approving its own grant.

## Acceptance

`BATCH_27_CLAIM_AUTHORITY_OPERATING_RULES_COMPLETE`
