# Bank-detail capture, multi-account & verification operating rules (Batch 28)

**Client decision source:** `docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`

**SSOT:**
- Browser: `src/lib/registry-bank-operating-rules.ts`
- Deno:    `supabase/functions/_shared/registry-bank-operating-rules.ts` (byte-identical mirror)
- Parity guard: `scripts/check-registry-bank-operating-rules-parity.mjs`

## Summary

This document captures the client's accepted operating rules for bank-detail
capture, multiple accounts, third-party accounts, evidence, masked/unmasked
access, verification types, manual verification, validity periods,
non-usable states and the payment-status API usability gate.

### Submitter gate
- Requires authority_active with `submit_bank_details` (or `bank_submit`) scope.
- Claim approval alone NEVER unlocks bank submission.
- Expired / disputed / revoked / suspended_disputed / compliance_review authority states block submission.
- platform_admin may submit only in admin-assisted mode with evidence + reason.
- Conditional authority limited to draft/pending only.

### Country fields
- ZA: bank name, holder, account number, branch code, account type, currency, proof. SWIFT optional.
- NG: bank name, holder, account number, bank code / NIBSS identifier, currency, proof. BVN forbidden unless separately approved.
- Other: bank name, holder, account number or IBAN, branch/sort/routing, SWIFT/BIC optional, currency, country, proof.

### Multiple accounts
- One primary account per currency / payment route.
- Purpose label required for additional accounts (operating / escrow / export / project / subscription / settlement).
- V1 maximum active accounts per company: 3. Fourth+ requires platform_admin AND compliance_owner approval.

### Third-party accounts
- Default state `third_party_account_pending_review`. Escalated.
- Cannot be usable without mandate, contract, ownership/relationship explanation, board/member resolution, and compliance_owner approval.
- Raw API output blocked by default; two-person approval required to expose.

### Evidence requirements
- Base: recent bank letter/statement, holder proof, mandate/resolution where authority not obvious, submitter authority evidence, account purpose, currency/payment route, consent declaration.
- Evidence must be reviewed before status may advance to `manually_checked`, `provider_verified`, `bank_confirmed`, `institution_confirmed` or `manual_bank_check_complete`.

### Masked / unmasked access
- Masked: company authorised bank users, platform_admin, compliance_owner, finance_operations, approved institutional API client with bank-status scope.
- Unmasked: compliance_owner, authorised finance_operations, authorised platform_admin, company authorised bank_submit user viewing own account.
- Unmasked requires AAL2 + reason + audit event. Public users never see bank details.

### Verification types
- Approved: `provider_confirmed`, `bank_confirmed`, `institution_confirmed`, `compliance_approved_manual_verification`.
- Company-confirmed is NOT verified. Manual_checked is NOT provider-verified.

### Manual verification before provider live
- Allowed only with compliance_owner approval and platform_admin decision.
- API label `manual_bank_check_complete`. Demo wording: "Manual evidence reviewed - no live provider check performed."

### Validity / expiry
- Manual verification: 90 days.
- Provider / bank / institution: 180 days.
- Immediate expiry triggers: dispute, account change, authority revocation, adverse bank notification, failed payment, material correction request.

### Non-usable states
- pending → "Bank details submitted - review pending" / `not_usable_pending`
- disputed → "Bank details under dispute" / `not_usable_disputed`
- revoked → "Bank details revoked" / `not_usable_revoked`
- expired → "Verification expired - re-verification required" / `re_verification_required`
- failed → "Verification failed" / `failed_not_usable`

### Payment-status API
- Usable only when bank status is one of the approved verification types, not expired/disputed/revoked/pending, required evidence present, manual gates compliance-approved where applicable, authority active with bank/API consent, and the current business decision allows it.
- Safe response fields: payment_status, verification_type, last_verified_date, expiry_date, dispute_state, usable, masked_account_identifier, bank_country, currency.
- Raw bank details are NEVER returned by default.
