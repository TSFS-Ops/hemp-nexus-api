# Batch 16 — Company Portal Guided Journey

Status: **BATCH_16_COMPANY_PORTAL_GUIDED_JOURNEY_COMPLETE**

## Scope delivered

- Coherent **My Companies dashboard** at `/registry/my-companies` listing every
  company the user has a claim, authority or bank-detail relationship with,
  using only safe portal labels from
  `src/lib/registry-company-portal-ssot.ts`.
- **Company detail command centre** at `/registry/my-companies/:companyId`
  showing claim, authority, bank-detail, verification, evidence and
  correction/dispute cards plus a safe timeline.
- Company-scoped guided sub-routes:
  - `/registry/my-companies/:companyId/claim`
  - `/registry/my-companies/:companyId/authority`
  - `/registry/my-companies/:companyId/bank-details`
  - `/registry/my-companies/:companyId/verification`
  - `/registry/my-companies/:companyId/evidence`
  - `/registry/my-companies/:companyId/corrections`
  - `/registry/my-companies/:companyId/disputes`
  - `/registry/my-companies/:companyId/revocations`
- **Deterministic next-step engine** (`computeNextStep`) with 9 unit tests
  covering start-claim → wait-review → submit-bank → verification ladder.
- **Safe verification wording**: `safeVerificationLabel` downgrades
  disputed / revoked / expired / non-final states; `verified` wording is
  reserved for final unexpired Batch 14 verified only.
- **Timeline whitelist** with `filterSafeTimeline` so admin-only or raw
  events cannot reach the user surface.
- **Correction**, **dispute** and **revocation** forms with mandatory
  acknowledgement copy guarded by `check-batch-16-portal-acknowledgements.mjs`.
- **Edge function** `registry-my-companies` aggregating safe per-user
  portal state — no raw bank fields, no provider payloads, no admin notes.

## Guards added (prebuild)

- `scripts/check-batch-16-portal-no-raw-bank.mjs`
- `scripts/check-batch-16-portal-no-verified-wording.mjs`
- `scripts/check-batch-16-portal-acknowledgements.mjs`
- `scripts/check-batch-16-portal-next-step-parity.mjs`

## Tests

- `src/tests/batch-16-company-portal-guided-journey.test.ts` — 19 tests
  covering the engine, verification wording, timeline whitelist,
  forbidden-field detector and acknowledgement SSOT.

## Proof summary

- **My Companies dashboard proof:** `src/pages/registry/MyCompanies.tsx`
  renders rows from `registry-my-companies` only, using SSOT labels.
- **Command centre proof:** `src/pages/registry/MyCompanyDetail.tsx` renders
  six safe cards + timeline; never selects raw bank columns.
- **Next-step engine proof:** `computeNextStep` deterministic, 9 tests pass.
- **Safe status labels proof:** Verification label mapping refuses
  "Verified" for disputed/revoked/expired/manual_verified.
- **Timeline proof:** `filterSafeTimeline` strips non-whitelisted events.
- **Evidence centre proof:** `MyCompanyEvidence` only queries own
  submissions under existing RLS.
- **Correction / Dispute / Revocation proof:** forms gated on
  acknowledgement checkbox with SSOT copy.
- **Bank-detail safe status proof:** dashboard + detail surfaces use
  `PORTAL_BANK_DETAIL_LABEL` — captured_unverified renders as
  "Bank details captured but not verified".
- **Access-control proof:** edge function filters by `auth.uid()`; pages
  rely on existing RLS for sub-queries.
- **No raw bank exposure proof:** `check-batch-16-portal-no-raw-bank.mjs`
  blocks raw column selects across portal source files.

## Out of scope (unchanged)

- No live provider verification.
- No external notifications or outreach.
- No auto-approval of claim, authority, bank detail, verification,
  correction, dispute or revocation.
- All Batch 1–15B guardrails remain green.
