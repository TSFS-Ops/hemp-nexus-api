# Registry — UAT Scenarios (Batch 18)

> Canonical pack lives in `UAT_SCENARIOS` inside
> [`src/lib/registry-release-gate-ssot.ts`](../../src/lib/registry-release-gate-ssot.ts).
> In-app viewer: `/admin/registry/uat-scenarios`.

Each scenario records: user role · starting data state · steps · expected
result · safety rules · route or function touched · evidence reference.

## Coverage (25 scenarios)

1. Public user searches for a company.
2. Public user views a safe company profile.
3. User starts a claim.
4. User uploads claim evidence.
5. Admin / compliance reviews the claim.
6. Claim is approved.
7. User requests authority-to-act.
8. User uploads authority evidence.
9. Admin / compliance reviews authority.
10. Authority is approved.
11. User submits bank details.
12. Admin / compliance reviews bank-detail submission.
13. Bank details captured but not verified.
14. Verification is requested.
15. Verification decision gates reviewed.
16. Non-final verification status remains not verified.
17. Final verified status shown only where the Batch 14 gate permits.
18. Institutional API client queries `profile-status` safely.
19. Institutional API client queries `payment-status` safely.
20. Company portal shows correct next step and safe status.
21. Admin operations centre shows the related work items.
22. Correction request submitted and remains review-gated.
23. Dispute submitted and remains review-gated.
24. Revocation request submitted and remains review-gated.
25. Expired / revoked / disputed verification returns not verified.

## Out of scope for UAT runs

- No live provider verification.
- No external notifications.
- No outreach.
- No automatic approvals.

## Client-decision scenarios (Batch 19B)

Canonical list lives in
`BATCH_19B_UAT_CLIENT_DECISION_SCENARIOS` in
[`src/lib/registry-client-decisions-19b.ts`](../../src/lib/registry-client-decisions-19b.ts).

26. The five attached records (`bullion_bathrooms_nigeria`,
    `dangote_fertiliser_limited`, `harith_holdings`, `laurium_capital`,
    `starfair_162`) are labelled `sample_only` in UI and API.
27. Sample_only records are excluded from the production API.
28. Sample_only sandbox response returns `verified_by_izenzo = false` and
    `readiness_state = sample_only`.
29. Claim approval is rendered as `claim_approved_limited` with the
    client-signed wording; it does not unlock authority, bank-detail
    submission or API-sharing UI.
30. Officer/director/member name public search is blocked unless the
    logged-in + public-display-approved + official/licensed source path
    applies.
31. Officer, activity and event summaries require public-display
    approval before they appear on a public profile.
32. Evidence older than 12 months renders refresh required unless a
    reviewer exception with reason, reviewer, timestamp and audit event
    is recorded.
33. Representative cannot submit bank details before authority is
    approved.
34. Competing claims show neutral conflict copy; admin/compliance
    review is required before higher privileges are granted.
35. Missing-company request does not create a public profile or a
    claimable record automatically.
36. `proposed_contact_update` remains pending review.
37. SMS outreach is disabled in Phase 1.
38. WhatsApp outreach is disabled in Phase 1.
39. Do-not-contact records suppress outreach immediately and contact
    details remain source data only.

