# Batch 4 — Authority-to-Act, Consent-Based Bank Detail Capture, Verified Bank Detail Status Model

Modules in scope: **M005**, **M006**, **M007**.

## Summary

Batch 4 establishes the trust and payment-detail status layer that sits between a
Claim Your Company record (Batch 3) and any downstream institutional or
operational use of company profile or bank-detail data. It is strictly a
governance + state-machine layer — **no external IDV or bank-verification
provider is integrated, and no institutional API facade is exposed**.

### M005 — Authority-to-Act
- States: `not_started`, `pending_evidence`, `submitted`, `under_review`,
  `conditionally_approved`, `approved`, `rejected`, `expired`, `revoked`,
  `disputed`, `cancelled`.
- Auto-approval is impossible — the only path into approved /
  conditionally_approved / rejected / revoked / disputed runs through
  `registry-authority-review`, which requires `platform_admin` or
  `compliance_owner` AND both non-verification acknowledgements
  (`acknowledged_not_company_verification` and
  `acknowledged_not_bank_verification`).
- Mandatory copy on admin review:
  > "Approving authority confirms only that this person may act for the
  > company within the recorded scope. It does not verify the company profile
  > or any bank details."

### M006 — Consent-Based Bank Detail Capture
- Capture is **blocked** unless the linked authority request is in
  `approved` or `conditionally_approved`.
- Sensitive bank fields are stored only in the `enc_*` columns
  (Batch-4-grade obfuscation). The `enc_*` columns are revoked from
  the `authenticated` role so PostgREST queries never return them.
- Browser & admin surfaces only see `masked_*` columns.
- Six consent scopes are recorded per submission as audit-retained receipts.

### M007 — Verified Bank Detail Status Model
- States: `not_provided`, `captured_unverified`, `verification_pending`,
  `verified`, `failed`, `expired`, `revoked`, `disputed`,
  `provider_unavailable`, `cancelled`.
- Only `verified` is "verified". The state-transition function refuses to
  set `verified` without `verification_method` and `expiry_at`, and writes
  `verified_at`, `verified_by`, `verification_method`, `expiry_at` plus a
  `registry_bank_detail_status_changed` audit event.

### Edge functions added
- `registry-authority-request` — start / submit / add_evidence / cancel.
- `registry-authority-review` — admin/compliance review with both
  non-verification acks.
- `registry-bank-detail-submit` — gates on authority approval, lands in
  `captured_unverified`, records consent receipts.
- `registry-bank-detail-status-transition` — admin/compliance status
  machine; `verified` requires method + expiry.
- `registry-bank-detail-access` — masked-view audit + unmasked-access
  request + admin-only unmasked read (reason ≥ 20 chars, fully audited).

### Routes
- `/registry/company/:id/authority`
- `/registry/company/:id/bank-details`
- `/admin/registry/authority`
- `/admin/registry/bank-details`

### Prebuild guards
- `scripts/check-registry-authority-state-parity.mjs`
- `scripts/check-registry-bank-detail-state-parity.mjs`
- `scripts/check-registry-batch4-audit-names.mjs`
- `scripts/check-registry-batch4-wording.mjs`
- `scripts/check-registry-batch4-no-provider-integration.mjs`

### Tests
- `src/tests/batch-4-authority-bank-detail-status.test.ts`

### Database
Migration `Batch 4 — Authority + Bank Detail` creates:
- `registry_authority_requests`, `registry_authority_evidence`,
  `registry_authority_reviews`, `registry_authority_events`
- `registry_bank_detail_submissions`, `registry_bank_detail_consent_receipts`,
  `registry_bank_detail_evidence`, `registry_bank_detail_access_log`,
  `registry_bank_detail_events`
- Status-mutation block triggers on both top-level tables (status only
  changes through service-role edge functions).
- `SELECT` on `enc_*` columns is REVOKED from `authenticated`.

### Out of scope (explicitly NOT done in Batch 4)
- Real registry data ingestion / publishing.
- Institutional API facades (M008/M009).
- AI outreach / human outreach approval queue.
- CIPC, Onfido, GlobalDatabase, B2BHint, Dow Jones, Refinitiv, PayFast,
  bank-verification providers.
- Auto-verification of bank details.

Completion: `BATCH_4_AUTHORITY_BANK_DETAIL_STATUS_COMPLETE`.
