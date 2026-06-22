# Batch 25 — Provenance, Country Coverage, Import Validation and Duplicate Governance

Final status: **BATCH_25_PROVENANCE_COUNTRY_IMPORT_DUPLICATE_GOVERNANCE_COMPLETE**

## Client decision source

- `docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`
  (received 21 June 2026, sections 2–15)
- Cover email: `docs/registry/Professional_Email_Re_Business_Registry_Operating_Rules_Questionnaire_Printout.pdf`

## Files

- `src/lib/registry-provenance-import-rules.ts` — browser SSOT
- `supabase/functions/_shared/registry-provenance-import-rules.ts` — Deno mirror
- `scripts/check-registry-provenance-import-rules-parity.mjs` — parity guard
- `scripts/check-registry-provenance-no-generic-country-covered.mjs` — wording guard
- `src/tests/batch-25-provenance-country-import-duplicate.test.ts` — 36 tests
- `docs/registry/provenance-country-import-duplicate-rules.md` — operating doc

## Evidence checklist

- [x] **Source-type proof** — `REGISTRY_SOURCE_TYPES` lists all 10
  client source types; `missingSourceDescriptorField` quarantines
  unknown/unlabelled sources.
- [x] **Licensed-dataset sourced-only proof** — licensed datasets are
  `sourced_only` until a verification method is recorded
  (`isLicensedDatasetVerified`); the required UI wording
  `"Sourced from licensed dataset - not independently verified by Izenzo."`
  is exported as `REGISTRY_LICENSED_DATASET_WORDING`.
- [x] **Field provenance proof** — 17-item metadata model exported via
  `REGISTRY_FIELD_PROVENANCE_METADATA`; 9 required descriptors enforced
  by `missingFieldProvenance`; 7 opt-in usage flags.
- [x] **Manual review proof** — 14 field groups in
  `REGISTRY_MANUAL_REVIEW_FIELD_GROUPS` default to not-public;
  `isFieldPublicAllowed` only returns true when
  `manual_review_completed === true`; core fields require
  `isPublicCoreFieldAllowed`.
- [x] **Conflict priority proof** — `REGISTRY_SOURCE_PRIORITY_ORDER`
  pins the client's order; `resolveSourceConflict` returns the winning
  value and `conflict_under_review`. Public users see
  `REGISTRY_CONFLICT_PUBLIC_WORDING`; API responses see
  `REGISTRY_CONFLICT_API_STATUS`.
- [x] **Country capability proof** — 6 independent capabilities + 12
  workflow states; `isCountryCapabilityReady` confirms capabilities
  are not co-dependent. Generic "country covered" wording is rejected
  by `check-registry-provenance-no-generic-country-covered.mjs`.
- [x] **Pre-import checklist proof** — 16-item checklist + 3
  production extras; `missingPreImportChecklistItem` blocks production
  import when licence is missing.
- [x] **Import validation / quarantine proof** — 6 required, 6
  quarantine-if-missing, 6 optional, 6 excluded; 9 reason codes;
  `validateImportRow` quarantines bad rows.
- [x] **Batch failure threshold proof** — systemic reasons fail the
  whole batch; otherwise valid rows are staged. Critical-field failure
  ratio threshold is the client's 5%
  (`REGISTRY_BATCH_CRITICAL_FIELD_FAILURE_THRESHOLD_RATIO`).
- [x] **Duplicate threshold proof** — exact / 0.95 / 0.92 / 0.85
  thresholds pinned in `REGISTRY_DUPLICATE_THRESHOLDS`; name/phone/
  email/website/fuzzy never auto-match.
- [x] **Merge approval proof** — `evaluateDuplicateMerge` requires
  `data_governance_owner` for low-risk and BOTH `platform_admin` +
  `compliance_owner` for high-risk; high-risk never auto-merges; audit
  requirements pin source history, old ids, audit trail and rollback.
- [x] **UI proof** — readiness labels exported via
  `REGISTRY_PROVENANCE_READINESS_LABELS` for use by admin/client-safe
  surfaces; raw bank, full personal contact and evidence bodies remain
  excluded by Batches 8 / 12 / 13 / 13B / 14B guards (untouched).
- [x] **Guard summary** — 2 new guards wired into `npm run prebuild`
  (parity + no-generic-country-covered); all existing Batch 1–24
  guards remain green.
- [x] **Test summary** — 36 tests in
  `src/tests/batch-25-provenance-country-import-duplicate.test.ts`,
  all passing.

## Accepted limitations

- Batch 25 is an SSOT + helpers + guards batch. It does not enable
  live provider verification, production API output, outreach, or
  automatic merges. All Batch 1–24 guardrails remain in force.
- The five client sample records remain locked `sample_only` (pinned
  by Batch 19A/19B) and are excluded from search and API output by the
  same gates this SSOT encodes.

## Edge functions requiring deploy (Batch 25)

- (none — Batch 25 is a pure SSOT + guard + test batch)
