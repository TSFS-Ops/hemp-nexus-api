# Batch 27 — Claim and Authority Operating Rules

## Client decision source

`docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`

## SSOT and guards

- `src/lib/registry-claim-authority-rules.ts` (browser SSOT)
- `supabase/functions/_shared/registry-claim-authority-rules.ts`
  (Deno mirror, byte-identical)
- `scripts/check-registry-claim-authority-rules-parity.mjs`
  (parity + required-exports guard, pinned in `npm run prebuild`)
- `src/tests/batch-27-claim-authority-rules.test.ts`
- `docs/registry/claim-authority-operating-rules.md`

## Evidence checklist

- [x] **Registration / email-verification gate proof** —
  `CLAIM_AUTHORITY_REQUIRES_VERIFIED_EMAIL` lists the six gated actions;
  `evaluateClaimGate` returns `must_register` or `must_verify_email`
  for unauthenticated / unverified users; search + public-profile
  view remain open.
- [x] **Claimant role proof** — `CLAIMANT_ROLE_DISPOSITION` maps each
  of the seven roles to the client-specified disposition; unrelated
  third parties blocked; platform_admin admin-assisted cannot self-
  approve.
- [x] **Evidence matrix proof** — `CLAIM_EVIDENCE_BY_LEGAL_FORM`
  defines distinct required document sets for sole_proprietor,
  company, close_corporation, partnership and other_legal_form;
  `isEvidenceFresh` enforces the 12-month rule with reviewer
  exception override.
- [x] **Unlisted claimant proof** —
  `UNLISTED_CLAIMANT_REVIEW_STATE = "unlisted_claimant_review"` and
  `UNLISTED_CLAIMANT_BLOCKED_CAPABILITIES` block edit-profile, bank,
  API consent and authority-sensitive workflows.
- [x] **Multi-claim conflict proof** — `CLAIM_CONFLICT_STATES`
  enumerates the four conflict states; `claimReviewerRoleFor` routes
  conflicts and sensitive claims to `compliance_owner`.
- [x] **Claim approval limited proof** — `CLAIM_APPROVAL_UNLOCKS`
  contains only `edit_profile_limited_non_sensitive` and
  `request_authority_to_act`; `CLAIM_APPROVAL_DOES_NOT_UNLOCK`
  blocks bank, API, manage_users, verification changes,
  self-approval and audit deletion. `CLAIM_APPROVED_LIMITED_WORDING`
  matches the accepted Batch 19A wording.
- [x] **Authority scope proof** — `AUTHORITY_SCOPES` is a closed
  seven-item allow-list; `isAuthorityScopeAllowed` rejects anything
  outside.
- [x] **Authority expiry proof** —
  `AUTHORITY_DEFAULT_EXPIRY_MONTHS_GENERAL = 12`,
  `AUTHORITY_DEFAULT_EXPIRY_MONTHS_BANK_OR_API = 6`,
  `defaultExpiryMonthsForScope` returns the correct window per scope.
- [x] **Two-person approval proof** — `AUTHORITY_TWO_PERSON_SCOPES`
  pins bank, API and manage_users; `evaluateAuthorityAction` returns
  `needs_second_approval` when fewer than two distinct approvers
  signed off.
- [x] **Compliance-owner required proof** —
  `AUTHORITY_COMPLIANCE_OWNER_REQUIRED_SCOPES` covers bank, API and
  dispute scopes; missing compliance_owner returns
  `needs_compliance_owner`.
- [x] **Self-approval block proof** — `evaluateAuthorityAction`
  returns `self_approval_blocked` when subject equals actor.
- [x] **Expired / disputed / revoked block proof** —
  `AUTHORITY_BLOCKING_STATES` contains `expired`, `revoked`,
  `suspended_disputed`, `compliance_review`;
  `blocksSensitiveAction` is `true` for each.
- [x] **Forbidden capabilities proof** —
  `AUTHORITY_FORBIDDEN_CAPABILITIES` blocks changing verification
  results, deleting audit history, overriding disputes, changing
  pricing and approving own authority.
- [x] **Full-authority guarantee** —
  `AUTHORITY_FULL_IS_DEFAULT = false`,
  `AUTHORITY_FULL_REQUIRES_COMPLIANCE_OWNER = true`.
- [x] **UI wording proof** — `CLAIM_AUTHORITY_WORDING` ships the
  claim CTA, limited-approval wording, unlisted-claimant notice,
  authority scope disclaimer, expired/revoked/disputed notices,
  two-person notice and self-approval-blocked notice as ready-to-use
  copy for company portal and admin UI.
- [x] **Trading Desk shell proof** — Batch 22 and Batch 23 guards
  (`check-batch-22-registry-shell-claim-entry.mjs`,
  `check-batch-23-registry-typeahead.mjs`) remain pinned in
  `npm run prebuild`; this batch did not introduce client-side
  registry surfaces that bypass `useRegistryBase` /
  `rebaseRegistryPath`.
- [x] **Guard summary** —
  `scripts/check-registry-claim-authority-rules-parity.mjs` enforces
  byte-identical SSOT mirroring and presence of all 33 required
  exports.
- [x] **Test summary** —
  `src/tests/batch-27-claim-authority-rules.test.ts` covers gate
  evaluation, claimant role disposition, legal-form evidence matrix,
  evidence freshness, unlisted claimant blocks, conflict reviewer
  routing, limited claim approval effects, scope allow-list,
  two-person and compliance-owner approval, default expiry windows,
  blocking states, self-approval blocking, forbidden capabilities
  and audit catalogue coverage.

## Cross-cutting guarantees preserved

- No raw bank, personal or evidence exposure introduced.
- No live provider verification, no production API access, no
  outreach and no external notifications enabled.
- Claim approval remains limited (`claim_approved_limited`); claim
  approval never unlocks bank, API or user management.
- Authority remains scoped and temporary; full authority is not a
  default and requires `compliance_owner`.

## Acceptance

`BATCH_27_CLAIM_AUTHORITY_OPERATING_RULES_COMPLETE`
