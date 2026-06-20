# Batch 3 — Public Company Search, Company Profile Shell, Claim Your Company

Scope: M002 (public search), M003 (profile shell), M004 (claim workflow). No
real registry data ingested. No bank-detail capture. No authority-to-act. No
institutional API facade. No outreach.

## Artefacts

### Database (migration `20260620_batch3_registry_claims`)
- `registry_company_claims` — claim record (claimant, company reference, country, declarations, status). Direct status mutations from non-service_role callers are blocked by trigger `registry_company_claims_block_status_mutation`. RLS: claimant sees own; admin / compliance_owner see all.
- `registry_company_claim_evidence` — metadata-only evidence. RLS: claimant adds + reads own; admin reads all.
- `registry_company_claim_events` — append-only audit. RLS: claimant + admin can read.
- `registry_company_claim_reviews` — reviewer decisions with mandatory `acknowledged_not_verification`. RLS: admin + claimant of the underlying claim.

### SSOT (TS + Deno mirror)
- `src/lib/registry-claims.ts` + `supabase/functions/_shared/registry-claims.ts`
  - `REGISTRY_CLAIM_STATES` (11 states)
  - `REGISTRY_CLAIM_AUDIT_EVENT_NAMES` (7 names)
  - `REGISTRY_SEARCH_RESULT_LABELS` (15 labels)
  - `REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_COPY` (verbatim copy block)

### Edge Functions
- `registry-company-search` — public, returns `[]` + `country_not_production_ready` warning when coverage is below imported_unverified. Audits `registry_company_search_performed`.
- `registry-company-profile` — public, returns safe envelope only. Bank-detail status LABEL only; raw_bank_details_exposed flagged `false`. Audits `registry_company_profile_viewed`.
- `registry-company-claim` — authenticated, supports `start | submit | add_evidence | review`. Blocks `approve` from `claim_started`. Review requires `acknowledged_not_verification: true` and rationale ≥ 20 chars. Admin-only (`platform_admin` / `compliance_owner`) for `review`.

### UI
- `/registry/search` — filters + always-empty results panel + coverage warning surface (M002 shell_ready).
- `/registry/company/:id` — safe profile envelope with claim CTA (M003 shell_ready).
- `/registry/claim` and `/registry/company/:id/claim` — claim form, declarations, consents, submission (M004 shell_ready).
- `/admin/registry/claims` — admin queue + review drawer with mandatory non-verification acknowledgement.

### Prebuild guards (wired into `npm run build`)
- `scripts/check-registry-claim-state-parity.mjs` — TS ↔ Deno parity for states, audit names, search labels.
- `scripts/check-registry-claim-audit-names.mjs` — every audit name in the SSOT is emitted by at least one `registry-company-*` edge function.
- `scripts/check-registry-claim-approval-wording.mjs` — verbatim non-verification copy present in SSOT, Deno mirror, claim edge function, admin Claims surface; forbidden wording blocked on shell UI.
- `scripts/check-registry-public-bank-leakage.mjs` — public registry surfaces never reference raw bank-detail tokens.

### Tests
- `src/tests/batch-3-public-registry-claim-workflow.test.ts` — 15 cases covering SSOT parity, audit name coverage, mandatory acknowledgement, non-verification copy presence, shell wording, raw bank-field absence, declarations, state transitions.

## Out of scope (deferred to later batches)
- Real registry data ingest.
- Authority-to-act (M005) approval workflow.
- Consent-based bank-detail capture (M006) and verified bank-detail status logic (M007).
- Institutional API facades (M008 / M009).
- Provider integrations (CIPC, Onfido, GlobalDatabase, B2BHint, Dow Jones, Refinitiv).
- AI outreach (M013) and human approval queue.

## Acceptance summary
- All four registry shell routes load with `<ReadinessBanner state="shell_ready" />`.
- Claim approval requires explicit acknowledgement that approval ≠ verification.
- RLS enforced: claimant sees own claims only; admin + compliance_owner review.
- All audit events emitted via `event_store` + `registry_company_claim_events`.
- Search returns no production rows; profile returns label-only envelope.
- No raw bank-detail tokens appear in any public registry surface.

Final completion phrase: BATCH_3_PUBLIC_REGISTRY_CLAIM_WORKFLOW_COMPLETE
