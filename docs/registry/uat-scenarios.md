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
