# Registry — Demo Walkthrough Pack (Batch 18)

> Internal use only. Always open the demo warning banner first. Use the
> demo records listed at `/admin/registry/demo-pack` — never real data.

Each walkthrough notes: route · role · demo record · expected safe
result · what NOT to claim to the client.

## 1. Public search

- Route: `/registry/search`
- Role: public user
- Demo record: `demo-co-imported-01`
- Expected safe result: list rendered without contact or bank fields.
- Do not claim: that results are verified or guaranteed accurate.

## 2. Public company profile

- Route: `/registry/company/:id`
- Role: public user
- Demo record: `demo-co-za-01`
- Expected: safe profile; personal contact and bank fields hidden.
- Do not claim: that the profile equals a verified entity.

## 3. Claim walkthrough

- Route: `/registry/company/:id/claim`
- Role: authenticated user
- Demo record: `demo-co-claimable-01`
- Expected: claim recorded, status `submitted`.
- Do not claim: that approval equals verification.

## 4. Authority walkthrough

- Route: `/registry/authority`
- Role: authenticated user
- Demo record: `demo-co-claim-approved-01`
- Expected: authority request recorded with scope.
- Do not claim: that authority approval equals identity verification.

## 5. Bank-detail submission

- Route: `/registry/bank-details`
- Role: authenticated user
- Demo record: `demo-co-authority-approved-01`
- Expected: submission accepted with consent receipt. Bank values used in
  the walkthrough are fake.
- Do not claim: that captured equals verified.

## 6. Bank-detail review

- Route: `/admin/registry/bank-details/submissions/:id`
- Role: compliance analyst
- Demo record: `demo-co-bank-captured-01`
- Expected: review decision recorded; raw fields never shown in full.
- Do not claim: that the review verifies the bank.

## 7. Bank verification

- Route: `/admin/registry/bank-verification/:id`
- Role: compliance analyst
- Demo record: `demo-co-verification-requested-01`
- Expected: simulated verification only; status remains not verified
  unless the Batch 14 final gate is satisfied.
- Do not claim: that any live provider was called.

## 8. Company portal

- Route: `/registry/my-companies/:id`
- Role: authenticated user
- Demo record: `demo-co-claim-approved-01`
- Expected: deterministic next-step rendered safely.

## 9. Institutional API client

- Route: `/admin/registry/api-clients/:clientId`
- Role: platform admin
- Demo record: `demo-api-sandbox-01`
- Expected: only last-four key reference rendered; production controls
  disabled.

## 10. API test console

- Route: `/admin/registry/api-test-console`
- Role: platform admin
- Demo record: `demo-api-sandbox-01`
- Expected: safe envelope returned; non-final bank states render as
  Not verified.

## 11. Admin operations cockpit

- Route: `/admin/registry/operations`
- Role: platform admin
- Demo record: `demo-readiness-blocker-01`
- Expected: cockpit shows work items, SLAs and risk safely.

## 12. Correction / dispute / revocation

- Routes: `/registry/my-companies/:id/{corrections,disputes,revocations}`
- Role: authenticated user
- Demo records: `demo-correction-01`, `demo-dispute-01`, `demo-revocation-01`
- Expected: request submitted; remains review-gated and consequence-gated.

## 13. Readiness dashboard

- Route: `/admin/registry/release-gate`
- Role: platform admin
- Demo record: full matrix
- Expected: matrix rendered with the demo/UAT warning; default final
  release status is not `production_ready`.
