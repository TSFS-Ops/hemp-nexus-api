# Batch 14B — Bank Verification Admin UI and Claimant-Safe Status Wiring

Status: **COMPLETE** — admin verification queue, admin verification detail
page, decision-gate display, claimant-safe status component, expired/disputed/
revoked not-verified notices, and Batch 13B non-breaking link wired without
modifying the accepted Batch 13B review logic or Batch 14 backend contracts.

## Surfaces

- **Admin queue** — `/admin/registry/bank-verification`
  Lists open verification requests with masked-only summary, mode, country,
  expiry, age, status filter. Renders an "Open verification review" CTA per
  row. Reads `registry_bank_detail_verification_requests` (RLS restricted to
  platform_admin / compliance_owner).

- **Admin detail** — `/admin/registry/bank-verification/:bankDetailSubmissionId`
  Renders masked summary, current verification status, decision-gate table,
  expiry / reverification panel, provider-simulation panel (test-only label),
  manual-verification panel (disabled by default), expired / disputed /
  revoked alerts. Links out to the Batch 13B unmask flow for elevated raw
  access — never renders raw bank fields itself.

- **Claimant-safe component** — `src/components/registry/BankVerificationPublicStatus.tsx`
  Drop-in component for user-facing surfaces. Resolves the public label from
  the accepted Batch 14 SSOT and emits the conservative "Not verified" badge
  for every non-final status (including `manual_verified`, `provider_matched`,
  `expired`, `disputed`, `revoked`).

## Decision-gate display

The admin detail page renders every gate from
`REGISTRY_BANK_VERIFICATION_DECISION_GATES`, marked one of
`passed | failed | warning | not_applicable`. Failed gates remain visible
and disable the manual-decision affordance. Manual verification is hidden
or disabled unless mode is `manual_verification_allowed`, no gate has
failed, the verification is not expired and not cancelled.

## Forbidden surfaces (proof of exclusion)

- No raw bank-detail columns are referenced on any B14B file
  (`scripts/check-batch-14b-ui-no-raw-leak.mjs`).
- No "verified" wording is rendered for non-final statuses
  (`scripts/check-batch-14b-ui-no-verified.mjs`).
- Provider simulation is always labelled
  "Provider simulation only. This does not verify bank details."
- Manual verification copy requires the canonical acknowledgement text.
- Live provider integration is not wired (per accepted Batch 14).

## Batch 13B link non-breaking proof

The admin detail page links to
`/admin/registry/bank-details/submissions/:id` for raw access via the
existing Batch 13B unmask flow. No Batch 13B route, page, callsite, RLS
policy, audit name or guard is modified.

## Guards

- `scripts/check-batch-14b-ui-no-verified.mjs` — forbidden verification
  wording on B14B surfaces; ensures conservative badge, provider simulation
  label, and manual acknowledgement are referenced.
- `scripts/check-batch-14b-ui-no-raw-leak.mjs` — forbids encrypted column
  selects and raw provider payload rendering on B14B surfaces.
- Existing Batch 14 guards remain wired
  (`check-registry-bank-verification-parity.mjs`,
  `check-registry-bank-verification-invariants.mjs`,
  `check-registry-bank-verification-no-live-provider.mjs`).
- Batch 13B guards remain wired and unchanged.

## Tests

`src/tests/batch-14b-bank-verification-ui.test.tsx`

- captured_unverified / manual_verified / provider_matched / failed /
  provider_mismatch / provider_error / provider_unavailable / verification_
  requested / manual_review_required / cancelled → render "Not verified".
- expired / disputed / revoked → render "Not verified".
- final `verified` (unexpired, undisputed, unrevoked) → renders "Verified".
- final `verified` with past expiry → flips to "Not verified".
- public-label resolver maps `expired` correctly and downgrades expired
  `verified` to "Verification expired".
- gate label table covers every accepted backend gate.
- manual acknowledgement and provider simulation labels match the backend
  SSOT exactly.
- claimant-safe component renders only safe wording.
- App imports cleanly (Batch 13B route stability proxy).

## Out of scope (unchanged)

- No live provider integration.
- No provider production verification.
- No changes to Batch 14 backend gates or audit events.
- No changes to Batch 13B backend calls / review logic.
- No raw bank-detail exposure (public, claimant or API).
- No external notification send / outreach.
