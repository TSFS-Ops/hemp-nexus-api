# Batch 28 — Bank Detail Capture, Multi-Account & Verification Operating Rules

## Client decision source

`docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`

## SSOT and guards

- `src/lib/registry-bank-operating-rules.ts` (browser SSOT)
- `supabase/functions/_shared/registry-bank-operating-rules.ts` (Deno mirror, byte-identical)
- `scripts/check-registry-bank-operating-rules-parity.mjs` (parity + required exports + invariants, pinned in `npm run prebuild`)
- `src/tests/batch-28-bank-detail-operating-rules.test.ts`
- `docs/registry/bank-detail-operating-rules.md`

## Evidence checklist

- [x] **Bank submitter gate proof** — `evaluateBankSubmitGate` requires authority_active with `submit_bank_details` / `bank_submit`; claim-only users, blocked user kinds, and suspended companies are rejected; conditional authority is constrained to `draft_only` mode; platform_admin requires both `admin_assisted_evidence_present` and a non-null reason. `BANK_SUBMIT_CLAIM_APPROVAL_ALONE_UNLOCKS = false`.
- [x] **Country field proof** — `BANK_REQUIRED_FIELDS_ZA`, `BANK_REQUIRED_FIELDS_NG`, `BANK_REQUIRED_FIELDS_OTHER` pin the required fields; `validateBankFields` returns `missing` and `forbidden` arrays; NG BVN blocked unless `bvn_separately_approved=true`.
- [x] **Multi-account proof** — `BANK_V1_MAX_ACTIVE_ACCOUNTS = 3`; `evaluateNewBankAccount` enforces dual-approval beyond 3, purpose-label requirement for additional accounts, and primary uniqueness per currency/payment route. Purpose labels closed list: `operating / escrow / export / project / subscription / settlement`.
- [x] **Third-party escalation proof** — Default state `third_party_account_pending_review`; `evaluateThirdPartyAccount` requires the five-item evidence set and compliance_owner approval; `BANK_THIRD_PARTY_API_RAW_BLOCKED_BY_DEFAULT = true`; `BANK_THIRD_PARTY_API_REQUIRES_TWO_PERSON = true`.
- [x] **Evidence proof** — `BANK_BASE_REQUIRED_EVIDENCE` pins the seven base items; `isBankStatusGatedByEvidenceReview` blocks `manually_checked`, `verified`, `provider_verified`, `bank_confirmed`, `institution_confirmed`, `manual_bank_check_complete` until evidence review is complete; metadata fields pinned.
- [x] **Masked/unmasked access proof** — Role lists for masked and unmasked views pinned; `BANK_UNMASKED_REQUIRES_AAL2`, `BANK_UNMASKED_REQUIRES_REASON`, `BANK_UNMASKED_REQUIRES_AUDIT_EVENT` all `true`; `evaluateUnmaskRequest` returns `role_not_permitted` / `aal2_required` / `reason_required` and forces `must_audit: true` on success.
- [x] **Verification-type proof** — `BANK_APPROVED_VERIFICATION_TYPES` is the four-item allow-list; `isBankStatusVerified` returns true only for `provider_verified`, `bank_confirmed`, `institution_confirmed`, `manual_bank_check_complete`; `BANK_COMPANY_CONFIRMED_IS_VERIFIED = false`; `BANK_MANUAL_CHECKED_IS_PROVIDER_VERIFIED = false`.
- [x] **Manual verification proof** — `evaluateManualVerification` requires the five-item manual evidence set, compliance_owner approval, and platform_admin decision; API label `manual_bank_check_complete`; demo copy: "Manual evidence reviewed - no live provider check performed."
- [x] **Expiry / re-verification proof** — `BANK_MANUAL_VERIFICATION_VALIDITY_DAYS = 90`, `BANK_PROVIDER_OR_BANK_OR_INSTITUTION_VALIDITY_DAYS = 180`; `BANK_IMMEDIATE_EXPIRY_TRIGGERS` pins the six triggers; `BANK_RE_VERIFICATION_TRIGGERS` includes `expiry_reached` plus all immediate triggers.
- [x] **Payment-status usability proof** — `evaluatePaymentStatusGate` returns `usable=true` only for approved verification states with valid evidence, compliance approval (where manual), active authority/consent, and a permitting business decision; otherwise returns one of nine explicit blocking reasons.
- [x] **API raw-bank block proof** — `BANK_API_RAW_BLOCKED_BY_DEFAULT = true`; `PAYMENT_STATUS_API_RAW_BANK_BLOCKED_BY_DEFAULT = true`; `PAYMENT_STATUS_API_SAFE_FIELDS` excludes raw account number / IBAN.
- [x] **UI proof** — `BANK_NON_USABLE_UI_WORDING` pins the canonical UI strings; `BANK_OPERATING_WORDING` pins authority-required / claim-only-not-enough / third-party-escalation / unmask-requires-AAL2 messaging used across company + admin bank surfaces.
- [x] **Trading Desk shell proof** — This batch is a SSOT/guards/tests addition; no shell or sidebar component is altered. Batches 22/23 shell and typeahead behaviour, Batch 27 authority gates, and Batches 13/13B/14/14B/15/16/17 bank guarantees remain intact.
- [x] **Guard summary** — Parity guard pins SHA-256 byte-parity between browser + Deno SSOT, validates 60+ required exports, and enforces invariants: `BANK_COMPANY_CONFIRMED_IS_VERIFIED=false`, `BANK_MANUAL_CHECKED_IS_PROVIDER_VERIFIED=false`, `BANK_API_RAW_BLOCKED_BY_DEFAULT=true`, `PAYMENT_STATUS_API_RAW_BANK_BLOCKED_BY_DEFAULT=true`, `BANK_V1_MAX_ACTIVE_ACCOUNTS=3`, manual validity 90 days, provider validity 180 days, claim-approval-alone does not unlock.
- [x] **Test summary** — `src/tests/batch-28-bank-detail-operating-rules.test.ts` adds ~40+ assertions covering submitter gate (verified email, claim-only, expired/disputed/revoked, conditional, admin-assisted, missing scope), country field requirements (ZA/NG/other + BVN), multi-account (limits, dual-approval, purpose, primary uniqueness), third-party escalation, evidence-gated statuses, company_confirmed-not-verified, manual-not-provider, manual verification gates, validity windows, immediate expiry triggers, non-usable state wording, payment-status gate for all blocking reasons, masked-only safe fields, and audit-name pinning.

## Release status

Registry remains UAT/demo-ready. Batch 28 is a SSOT + guards + tests batch and introduces no new edge functions or schema changes. All Batch 24–27 evidence remains current; this batch extends the operating-rules SSOT family to bank-detail capture, multi-account governance and verification.

## Edge functions requiring deploy (Batch 28)

- (none — Batch 28 is a SSOT/guards/tests batch; no edge surface changed.)
