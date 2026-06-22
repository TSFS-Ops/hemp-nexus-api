# Registry — Provenance, Country Coverage, Import Validation and Duplicate Governance (Batch 25)

Client decision source:
`docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`
(received 21 June 2026).

The browser SSOT is `src/lib/registry-provenance-import-rules.ts` and the
byte-identical Deno mirror is
`supabase/functions/_shared/registry-provenance-import-rules.ts`. The
parity guard is
`scripts/check-registry-provenance-import-rules-parity.mjs`.

## 1. Source types (§2)

10 source types are allowed: `official_public_registry`,
`licensed_third_party_dataset`, `company_submitted_data`,
`authorised_representative_submitted_data`, `verified_external_provider`,
`bank_institution_confirmed_data`, `admin_reviewed_evidence`,
`user_correction_dispute_submission`, `izenzo_workflow_audit_event`,
`system_generated_derived_status`. Each source MUST carry the 9
descriptors in `REGISTRY_SOURCE_REQUIRED_FIELDS`. Unlabelled or
unknown-source data is quarantined and is excluded from both public
search and API output.

## 2. Licensed dataset treatment (§3)

A licensed dataset confers `sourced_only` standing only. The wording
`"Sourced from licensed dataset - not independently verified by Izenzo."`
is exported as `REGISTRY_LICENSED_DATASET_WORDING` and must appear on
any surface that displays a licensed-dataset value. A field is lifted to
verified standing only via one of the 5 approved verification methods.

## 3. Field-level provenance metadata (§4)

`REGISTRY_FIELD_PROVENANCE_METADATA` exports the full 17-item metadata
model; `REGISTRY_FIELD_PROVENANCE_REQUIRED` pins the 9 fields that MUST
be populated before any surface may use the value. `missingFieldProvenance`
returns the first missing key. `REGISTRY_FIELD_USAGE_FLAGS` lists the 7
opt-in usage flags (none default to true).

## 4. Manual-review-before-public-display fields (§5)

`REGISTRY_MANUAL_REVIEW_FIELD_GROUPS` lists the 14 groups (officers,
UBO, personal emails, phones, addresses, VAT/tax, adverse events,
filings implying compliance/risk, bank-status labels, company
corrections, conflicting values, low-confidence matches, duplicate
linked values, public-use-restricted fields). `isFieldPublicAllowed`
refuses to surface any of these groups publicly unless
`manual_review_completed === true`. Even the four
`REGISTRY_PUBLIC_CORE_FIELDS` require the full `isPublicCoreFieldAllowed`
gate.

## 5. Source conflict priority (§6)

`REGISTRY_SOURCE_PRIORITY_ORDER` encodes the client's order
(official_public_registry → bank_institution_confirmed →
verified_external_provider → admin_reviewed_evidence →
licensed_third_party_dataset → company_submitted_data →
user_correction_dispute_submission). `resolveSourceConflict` returns
the winning value, the winning source, the losers and a
`conflict_under_review` flag. The public wording
(`REGISTRY_CONFLICT_PUBLIC_WORDING = "Some details are under review"`)
and the API status (`REGISTRY_CONFLICT_API_STATUS = "conflict_under_review"`)
are the only conflict signals exposed outside admin.

## 6. Country coverage model (§7) and workflow states (§8)

`REGISTRY_COUNTRY_CAPABILITIES` exports the 6 independent capabilities
(search/claim/authority/bank capture/bank verification/API).
`REGISTRY_COUNTRY_WORKFLOW_STATES` exports the 12 workflow states.
`isCountryCapabilityReady` confirms that a country may be search-ready
while claims, bank capture, bank verification or API output remain
disabled. No surface uses the generic "country covered" wording —
`check-registry-provenance-no-generic-country-covered.mjs` rejects it.

## 7. Searchable-country minimums (§9)

`REGISTRY_SEARCHABLE_COUNTRY_MINIMUM_ITEMS` lists the 11 items required
before a country becomes searchable (legal name, registration/local id,
jurisdiction, source type, source/licence ref, import batch id,
matching key, `public_search_ready` readiness state, approved
public-search business decision, no unresolved import hold, no
unresolved licence hold). Countries with sample or weak data remain
`sample_only` or `seed_only` and are excluded from normal public search.

## 8. Readiness labels (§10)

`REGISTRY_PROVENANCE_READINESS_LABELS` exports the exact client wording
for `seed_only`, `sample_only`, `provider_pending`, `licence_pending`,
`search_ready` and `api_pending`.

## 9. Pre-import checklist (§11)

`REGISTRY_PRE_IMPORT_CHECKLIST` lists the 16 items required before any
dataset may be imported into production tables.
`REGISTRY_PRODUCTION_IMPORT_EXTRA_ITEMS` adds import batch id, source
licence record and approval status. `missingPreImportChecklistItem`
returns the first missing item — production imports are blocked when
licence is missing.

## 10. Import validation rules (§12)

`REGISTRY_IMPORT_REQUIRED_FIELDS` (6 items) hard-validate every row.
`REGISTRY_IMPORT_QUARANTINE_IF_MISSING_FIELDS` (6 items) trigger
quarantine without failing validation. `REGISTRY_IMPORT_OPTIONAL_FIELDS`
(6 items) are permissive. `REGISTRY_IMPORT_EXCLUDED_FIELDS` (6 items)
hard-reject sensitive data unless a special approval exists. Bad rows
carry one of the 9 `REGISTRY_IMPORT_QUARANTINE_REASON_CODES`.

## 11. Batch failure threshold (§13)

One bad row does not fail the whole batch. `evaluateBatchOutcome` fails
the entire batch only on a systemic reason
(`REGISTRY_BATCH_SYSTEMIC_FAILURE_REASONS`: missing licence, wrong
country, schema mismatch, corrupted file, invalid source identity,
critical-field failure rate over threshold). The threshold ratio is
`REGISTRY_BATCH_CRITICAL_FIELD_FAILURE_THRESHOLD_RATIO = 0.05` (5%).

## 12. Duplicate matching (§14)

`REGISTRY_DUPLICATE_THRESHOLDS` pins:

* exact triggers: same country + registration/local id, same official
  registry id, same verified tax/VAT number (where approved);
* high-confidence ratios: name + address ≥ 0.95, name + officer/regdate
  ≥ 0.92;
* possible-duplicate ratio: name ≥ 0.85 + country/industry/address
  signal;
* never-auto-match signals: name, phone, email, website, fuzzy text;
* required candidate metadata: match keys, confidence score, compared
  fields.

`classifyDuplicate` returns `exact | high_confidence | possible | none`.

## 13. Duplicate merge governance (§15)

`classifyMergeRisk` returns `high` whenever any of
`REGISTRY_DUPLICATE_MERGE_RISK_TRIGGERS` is present (claims, authority,
bank, disputes, API exposure, verified fields). `evaluateDuplicateMerge`:

* low-risk: `data_governance_owner` may merge at confidence ≥ 0.95;
* high-risk: NEVER auto-merge — `platform_admin` PLUS `compliance_owner`
  must both approve.

`REGISTRY_DUPLICATE_MERGE_AUDIT_REQUIREMENTS` pins source history, old
ids, audit trail and rollback link as mandatory.

## 14. Audit names (§17)

`REGISTRY_PROVENANCE_IMPORT_AUDIT_NAMES` covers field-status read,
country-capability read, import preflight, validation summary, row
quarantine, batch systemic failure, duplicate candidate flagged, merge
reviewed/approved/blocked-high-risk/rolled-back.

## 15. Guards (§18)

* `scripts/check-registry-provenance-import-rules-parity.mjs` —
  byte-identical browser/Deno parity, plus presence of every required
  export.
* `scripts/check-registry-provenance-no-generic-country-covered.mjs` —
  rejects the generic "country covered" wording in registry UI files.

## 16. Tests (§19)

`src/tests/batch-25-provenance-country-import-duplicate.test.ts` — 36
pure tests covering every gate listed above.
