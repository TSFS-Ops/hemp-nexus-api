# Batch 9 — Registry Source File Import, Field Mapping, Validation

**Status:** `BATCH_9_REGISTRY_SOURCE_IMPORT_VALIDATION_COMPLETE`

## Goal
Turn real company source files into clean, governed registry records
without manual seed scripts. Build the controlled import pipeline so
admins can upload source data, map fields, validate, quarantine bad
records, detect duplicates, gate publish behind an approved business
decision, and index approved records — all while preserving every
Batch 1–8 rule.

## What changed

### Data model
| Table | Purpose |
|---|---|
| `registry_source_files` | Provenance + licence + permitted-use for every source dataset. |
| `registry_source_file_pages` | Page-level text for long source reports. |
| `registry_import_field_mappings` | Per-batch mapping of source field → target field + visibility tier. |
| `registry_import_records_staging` | One row per staged company record with mapped fields, validation outcome, duplicate status, quarantine status, publish status, and `published_record_id`. |
| `registry_import_record_validation_results` | Per-row validation issues (info/warning/error/block). |
| `registry_import_duplicate_candidates` | Candidate matches with confidence band and review status. |
| `registry_import_quarantine` | Quarantine queue with status `open` / `released` / `permanently_excluded`. |
| `registry_import_approval_events` | Approval / rejection audit trail. |
| `registry_import_publish_events` | Per-record publish audit trail. |

Existing tables `registry_import_batches`, `registry_import_batch_rows`,
`registry_company_records`, `registry_company_identifiers`,
`registry_company_addresses`, `registry_company_people`,
`registry_company_activities`, `registry_company_filings`,
`registry_company_events` and `registry_company_search_index` are
preserved unchanged and are the publish targets.

### SSOT
- `src/lib/registry-import-pipeline.ts` (+ Deno mirror in
  `supabase/functions/_shared/registry-import-pipeline.ts`)
- Pinned by:
  - `scripts/check-registry-import-pipeline-parity.mjs`
  - `scripts/check-registry-batch9-no-verified-default.mjs`

### Edge functions (all admin/compliance-gated)
- `registry-source-file-upload` — accepts `records[]` (manual/JSON),
  `csv_text` (CSV) or `raw_text` (text extract); creates source-file,
  batch and staging rows; emits `registry_source_file_uploaded` and
  `registry_source_file_parsed`.
- `registry-import-field-map` — upserts per-batch mappings; rejects
  any forbidden public mapping (personal email/phone).
- `registry-import-validate` — runs the full validation matrix
  (required fields, bank-detail patterns, mapping policy, duplicate
  detection against existing records and intra-batch); writes
  validation results, quarantine entries and duplicate candidates;
  moves batch to `validated` or `validation_failed`; emits
  `registry_import_validation_started/completed` and
  `registry_import_record_quarantined` /
  `registry_import_duplicate_candidate_detected`.
- `registry-import-duplicate-check` — admin records the review
  decision; emits `registry_import_duplicate_reviewed`.
- `registry-import-quarantine-review` — admin releases or
  permanently excludes a quarantine entry with rationale.
- `registry-import-approve-publish` — three actions:
  - `approve` requires source provenance, licence, country not
    disabled, an approved `business_decisions` row, no open
    quarantine; emits `registry_import_publish_approved`.
  - `reject` emits `registry_import_publish_rejected`.
  - `publish` delegates to the SECURITY DEFINER RPC
    `atomic_publish_registry_import_batch`, which atomically inserts
    `registry_company_records` (forced to
    `readiness_state = 'imported_unverified'` and
    `api_output_allowed = false`), all related identifier/address/
    people/activity/filing/event rows, and **public-only**
    `registry_company_search_index` rows. Emits
    `registry_import_record_published`,
    `registry_import_publish_completed` and
    `registry_import_search_index_created`.

### Admin UI
`/admin/registry/imports` rebuilt as a single guided page with:
- batch list,
- upload tab (manual records / JSON / CSV / extracted text),
- selected-batch detail with validation summary tiles, validate button,
  staged records table (validation outcome + duplicate + publish per
  row), duplicate candidates with review actions, quarantine queue with
  release / permanently-exclude actions, and approve / publish
  controls.

### Guards added to prebuild
- `check-registry-import-pipeline-parity.mjs`
- `check-registry-batch9-no-verified-default.mjs`

Existing Batch 8 guards (`check-registry-record-model-parity.mjs`,
`check-registry-batch8-no-verified-wording.mjs`) continue to enforce
visibility tiers and forbidden wording.

## Imported_unverified proof
- `atomic_publish_registry_import_batch` hard-codes
  `readiness_state = 'imported_unverified'` and
  `api_output_allowed = false` on every insert. The DB function is the
  only sanctioned publish path.
- Frontend admin page surfaces a banner stating the same.
- `check-registry-batch9-no-verified-default.mjs` greps the entire
  source tree and fails CI if any new code path defaults an imported
  record to `verified`, `production_ready` or
  `institutionally_usable`.

## Public search proof after publish
Existing Batch 8 `registry-company-search` queries
`registry_company_search_index` at `tier='public'` only. The publish
RPC writes only public-tier index rows, so published records become
searchable through the existing Batch 8 search flow with no further
work. The 30-second per-scope cache and rate limits from the Batch 8
follow-up still apply.

## Quarantine / duplicate enforcement proof
- DB function: rows are skipped when `publish_status = 'pending'` AND
  validation outcome is not `valid` / `valid_with_warnings`, blocked
  when duplicate status is `high` / `exact_identifier_match` /
  `reviewed_duplicate`, and blocked when an `open` quarantine row
  exists. Each block writes a `registry_import_publish_events` row.

## Out of scope (per spec)
- No production-scale automated ingestion.
- No external provider integrations.
- No OCR pipeline (PDF support is admin-paste-text only).
- No record marked verified / production-ready / institutionally
  usable.
- No raw bank-detail exposure.
- No raw personal contact-detail exposure.
- No outreach.

## Acceptance
- ✅ Admins can stage source records via three input paths.
- ✅ Field mapping enforces visibility / searchability tiers.
- ✅ Validation runs before publish.
- ✅ Duplicate detection runs before publish.
- ✅ Bad records are quarantined and skipped on publish.
- ✅ Quarantined records are never indexed.
- ✅ Publish requires approved business decision + provenance +
  admin/compliance role + no open quarantine.
- ✅ Published records default to `imported_unverified`.
- ✅ Published records are indexed at the public tier only.
- ✅ Public profile + search continue to enforce Batch 7/8 visibility
  rules.
- ✅ All new edge functions are deploy-listed
  (`scripts/edge-function-deploy-manifest.json`).
- ✅ All canonical audit events emit.
- ✅ Guards pinned in `package.json` prebuild.
