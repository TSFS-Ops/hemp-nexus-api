# Payment PR sequencing recommendation — 2026-07-23

## Should PR #29 be reviewed/merged before PR #28?

Either order is fine; they are independent (see below). If forced to pick, review PR #28
(Paystack admin-only hardening) first, simply because it was opened first and is the smaller,
more contained diff (one guard clause plus a webhook cross-check). PR #29 contains a genuine
security fix (ITN signature-bypass) and is arguably the more time-sensitive of the two, so it is
also reasonable to prioritise its review. Neither PR depends on the other being merged first.

## Are PR #28 and PR #29 independent?

Yes. PR #28 (`hardening/paystack-admin-only`) touches only Paystack admin-gating and the
`charge.success` webhook cross-check in `token-purchase/index.ts`, plus its own tests and
report. PR #29 (`investigate/payfast-codespace-failures`) touches only `payfast.ts` (the ITN
raw-body signature fallback), two PayFast test files, and its own report. Neither PR's diff
overlaps the other's files. Both branch from `main` independently and neither has been rebased
on the other.

## Are either blocked by introduced failures?

No. Both PRs show the same 4 failing CI checks (Lint -> Typecheck -> Test -> Build, Schema drift
check, E2E - POI mint soft-route, Dependency audit HIGH/CRITICAL gate), and all 4 were verified
to fail identically on the latest `main` commit (`1f187e4`, CI #2141). Neither PR introduces a
new failure; this was confirmed by comparing exact error counts/messages (e.g. the Lint job's
"688 problems (4 errors, 684 warnings)" is identical across `main`, PR #28, and PR #29).

## Are repo-wide CI failures pre-existing?

Yes, all 4. See `docs/repo-ci-debt-triage-2026-07-23.md` for full detail on each. Two of the four
lint errors were fixed on a separate `triage/repo-ci-debt-2026-07-23` branch/PR this session
(test-only, zero risk); the other three failure categories (schema drift, missing E2E secrets,
dependency audit) remain and are documented with recommendations but were not fixed
unilaterally, since each requires either a product decision (footer copy, BackButton API), an
ops decision (CI secrets), or careful one-at-a-time dependency work that a blind automated fix
demonstrably breaks (see `docs/dependency-audit-plan-2026-07-23.md`).

## What should be reviewed by someone with payment/security context?

- PR #28: the new `platform_admin` guard on Paystack checkout initiation in
  `token-purchase/index.ts`, and the new stored-purchase cross-check added to the
  `charge.success` webhook handler (validates provider/status/amount/currency/org/user against
  the `token_purchases` row before crediting).
- PR #29: the new defensive check added to `verifyPayfastSignatureFromRawBody` in `payfast.ts`
  (rejects any content appended after `&signature=` in the raw ITN body) - this is the fix for a
  real signature-bypass defect and deserves a careful second look given it is payment/security
  code, even though it is a small, additive change.

## What should not be merged yet?

Neither PR #28 nor PR #29 should be merged until a human reviewer with payment/security context
has read the respective diffs, per the do-not-merge recommendation already posted on both PRs.
The `triage/repo-ci-debt-2026-07-23` branch's lint fix is low risk but has also not been merged
by this session (no PR was merged automatically, per standing instructions). The dependency
audit vulnerabilities remain unpatched and should not be fixed via a blind `npm audit fix` (see
plan doc) - any real fix there should go through its own reviewed PR.

## What is the safest next step this evening?

Nothing further needs to happen tonight from a safety standpoint: all payment/security-relevant
work (PR #28, PR #29) is complete, tested, documented, and clearly labelled do-not-merge pending
review. The safest next step is for a human with payment/security context to review PR #28 and
PR #29 in either order tomorrow, and separately decide whether to pick up the schema-drift,
dependency-audit, and E2E-secrets follow-up work documented in the triage branch's PR.

## Final status

PAYMENT_PR_SEQUENCE_READY
