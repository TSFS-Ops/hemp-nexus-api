# Batch 2 — Registry Provenance, Country Coverage, Import Batches

**Scope:** M010, M011, M012. Strictly governance/foundation. **No real registry data was ingested.**

## What this batch delivers

### M010 — Registry Data Provenance Framework
- `registry_data_sources` — every source recorded with type (registry / licensed_dataset / seed_layer / company_claim / admin_enrichment / provider_api / manual_review), country coverage, licence status, and per-use flags (commercial, public display, API output, outreach, institutional demo), resale restrictions, source URL, stale date, owner role, evidence URL, internal notes.
- `registry_source_licences` — licence reference + permitted-use rules with effective windows.
- `registry_field_provenance` — per-field origin metadata: source link, raw value, confidence band (unverified / low / medium / high / authoritative), verification level (none / dataset_present / admin_reviewed / claimant_attested / authority_verified / provider_verified).
- `registry_provenance_events` — audit trail of provenance writes.
- **Hard rule (SSOT):** presence in a dataset MUST NOT equal verification. Encoded in `src/lib/registry-provenance.ts::presenceImpliesVerification()` returning `false`.

### M011 — Country Coverage Framework
- `registry_country_coverage` — every country tracked with per-surface state: `coverage_state`, `registry_data_state`, `claim_company_state`, `authority_verification_state`, `bank_detail_verification_state`, `api_output_state`, `outreach_state`, `demo_readiness_state`, `public_wording_allowed`, internal notes, next action, evidence URL, last reviewed at, review due.
- Seeded with all 54 African countries at `no_coverage` except South Africa (ZA) and Nigeria (NG), which are explicitly recorded as `seed_only` (framework placeholder, NOT operational).
- `registry_country_coverage_events` — append-only audit per state change.
- **Hard rule:** `seed_only` / `sample_only` → `production_ready` is blocked unless caller supplies an APPROVED `business_decisions` row of category `country` AND an evidence URL. Enforced server-side in `registry-country-coverage-update`.

### M012 — Registry Import-Batch Framework
- `registry_import_batches` — header (batch reference, source, country, licence reference, permitted uses, schema version, evidence URL, uploader/reviewer/approver, timestamps).
- `registry_import_batch_rows` — staged rows with validation state (`pending` / `passed` / `failed` / `quarantined` / `duplicate_candidate`).
- `registry_import_batch_events` — append-only audit of every state change.
- 12-state lifecycle enforced both client- and server-side. Publication requires `approved` → `published` AND an approved `business_decisions` link AND an evidence URL. **No import batch may become public automatically.**

## Edge functions
- `registry-provenance-record` — discriminated union (`record_source` / `record_licence` / `record_field`). platform_admin or compliance_owner only.
- `registry-country-coverage-update` — surface-scoped state writer. Seed→production promotion blocked without approved business decision.
- `registry-import-batch-manage` — create + transition. Enforces `IMPORT_BATCH_ALLOWED_TRANSITIONS`; publish gate requires approved decision + evidence.

## Admin UI
`/admin/registry` now exposes tabs:
- Readiness (Batch 1)
- Decisions (Batch 1)
- Provenance (Batch 2 — `/admin/registry/provenance`)
- Country Coverage (Batch 2 — `/admin/registry/coverage`)
- Import Batches (Batch 2 — `/admin/registry/imports`)

Every page renders `<ReadinessBanner state="shell_ready" />`. No surface uses the words "verified", "live", "guaranteed", or "production-ready" — enforced by `scripts/check-registry-country-coverage-forbidden-words.mjs`.

## Build guards (added to `prebuild`)
- `scripts/check-registry-provenance-parity.mjs` — TS↔Deno parity (source types, licence statuses, confidence bands, verification levels, audit names) + writer-function audit-name pin.
- `scripts/check-registry-country-coverage-parity.mjs` — TS↔Deno parity for coverage states + audit names + writer pin.
- `scripts/check-registry-import-batch-parity.mjs` — TS↔Deno parity for batch states + audit names + writer pin.
- `scripts/check-registry-country-coverage-forbidden-words.mjs` — no `verified`/`live`/`guaranteed`/`production-ready` wording in Batch 2 admin UI; blocks seed_only being shown adjacent to production_ready without explicit negation.
- `scripts/check-registry-batch2-audit-names.mjs` — every audit name in the SSOT is referenced by its writer edge function.

## Tests
`src/tests/batch-2-registry-provenance-coverage-imports.test.ts` covers:
- SSOT integrity for all three modules
- TS↔Deno parity (cross-mirror inspection)
- Import batch state machine (allowed transitions, terminal states, publish gate)
- Edge-function wiring (role check, audit-name presence, publish/promotion gates)
- Admin UI forbidden-word hygiene
- Migration grants, RLS, and 54-country seed presence (ZA + NG at `seed_only`)

## RLS
All 9 tables: authenticated SELECT (audit-friendly admin UI); INSERT/UPDATE/DELETE restricted to `platform_admin` or `compliance_owner` via `public.has_role()`. service_role retains full access for edge functions.

## Out of scope (deferred)
Real registry data, public search results, company profile data, claim workflow, authority workflow, bank-detail capture, verified bank status, institutional API facades, outreach, human approval queue, CIPC / Onfido / GlobalDatabase / B2BHint / bank-verification / Dow Jones / Refinitiv integrations.

## Acceptance
- All prebuild guards pass.
- Migration applied with grants + RLS on every new table.
- Edge functions deployed and listed in `scripts/edge-function-deploy-manifest.json`.
- No public-facing surface implies production readiness.
- Vitest `batch-2-*` suite green.
