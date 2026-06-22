# Batch 26 — Search, Typeahead, Public Profile and Corrections Rules

## Client decision source

`docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`

## SSOT

- `src/lib/registry-search-profile-rules.ts` (browser)
- `supabase/functions/_shared/registry-search-profile-rules.ts` (Deno)
- `scripts/check-registry-search-profile-rules-parity.mjs` (parity guard)
- `scripts/check-registry-search-profile-allowlists.mjs` (invariants guard)
- `src/tests/batch-26-search-profile-corrections.test.ts`
- `docs/registry/search-profile-correction-rules.md`

## Evidence checklist

- [x] **Search field classification proof** —
  `REGISTRY_SEARCH_FIELD_CLASSIFICATION` encodes the client's five
  classes; `classifyField` + `isFieldSearchableByAudience` enforce
  audience gating.
- [x] **Officer search restriction proof** —
  `OFFICER_PUBLIC_SEARCH_ENABLED = false`,
  `isOfficerLoggedInSearchAllowed` requires all four gates,
  `isOfficerApiSearchAllowed` requires compliance_owner approval,
  `OFFICER_MATCH_CAUTION` ships the exact caution wording.
- [x] **Email/phone restriction proof** —
  `EMAIL_PUBLIC_SEARCH_ENABLED = false`,
  `PHONE_PUBLIC_SEARCH_ENABLED = false`, classification keeps
  `personal_email` and `personal_phone` admin-only.
- [x] **Partial / typo / abbreviation proof** —
  `PARTIAL_MATCH_MIN_CHARS = 3`, `TYPO_MIN_CONFIDENCE = 0.85`,
  `PUBLIC_MIN_CONFIDENCE = 0.75`, `PARTIAL_MATCH_ALLOWED_FIELDS`
  whitelist, `PARTIAL_MATCH_FORBIDDEN_FIELDS` blocklist,
  `APPROVED_LEGAL_SUFFIX_ABBREVIATIONS`, `rankMatch` orders exact
  identifiers above fuzzy names.
- [x] **Safe match reason proof** — `PUBLIC_SAFE_MATCH_REASONS` is the
  closed set of seven labels; `ADMIN_ONLY_MATCH_REASONS` never
  overlaps; `isPublicSafeMatchReason` is the public filter and the
  Batch 23 typeahead already uses the equivalent allow-list.
- [x] **Typeahead safety proof** — Batch 23 guard
  `scripts/check-batch-23-registry-typeahead.mjs` remains pinned and
  still enforces the SAFE_MATCH_FIELDS allow-list, the sample-record
  chip, and the no-bank/no-personal/no-provider forbidden list.
- [x] **No-result queue-only proof** — `NO_RESULT_WORDING`,
  `NO_RESULT_QUEUE_EVENT = "company_addition_requested"`,
  `NO_RESULT_FORBIDDEN_SIDE_EFFECTS` block public records, claims,
  POIs and API-ready records; `noResultRequestRequiresLogin()` is
  `true`.
- [x] **Public profile visibility proof** — `PUBLIC_PROFILE_FIELDS`,
  `MASKED_OR_LOGGED_IN_PROFILE_FIELDS`,
  `ADMIN_ONLY_PROFILE_FIELDS`, `API_ONLY_PROFILE_FIELDS` and
  `EXCLUDED_PROFILE_FIELDS` codify the questionnaire's tiers;
  `profileFieldAudience` is the single decision point.
- [x] **Profile UI wording proof** — `PROFILE_WORDING` ships the four
  client-supplied strings verbatim.
- [x] **Correction workflow proof** — `CORRECTION_REQUIRED_FIELDS`,
  `correctionReviewerRoleFor` routes sensitive fields to
  `compliance_owner`, `CORRECTION_NEVER_AUTO_PUBLISHES`,
  `CORRECTION_USES_VERSIONED_HISTORY`,
  `CORRECTION_OLD_VALUES_ADMIN_ONLY_BY_DEFAULT`,
  `correctionBlocksPublicWhileDisputed`.
- [x] **Version history proof** — `CorrectionVersion` interface
  defines the persisted shape (field, old value, proposed value,
  source, evidence, reviewer, decision, timestamps).
- [x] **Admin correction queue proof** — Existing
  `src/pages/admin/registry/CorrectionRequests.tsx` admin surface is
  preserved; the SSOT now drives reviewer role routing and
  publish/auto-publish constraints.
- [x] **Trading Desk shell proof** — No client-side component added
  in this batch bypasses `useRegistryBase` / `rebaseRegistryPath`;
  Batch 22 and Batch 23 guards remain pinned in prebuild.
- [x] **Guard summary** —
  `scripts/check-registry-search-profile-rules-parity.mjs` and
  `scripts/check-registry-search-profile-allowlists.mjs` are added to
  `npm run prebuild`.
- [x] **Test summary** —
  `src/tests/batch-26-search-profile-corrections.test.ts` covers
  classification, audience gating, officer/email/phone restrictions,
  partial/typo/abbreviation thresholds, safe match reasons,
  no-result workflow, profile visibility tiers, profile wording,
  correction reviewer routing, version-history flags and
  disputed-under-review blocking.

## Acceptance

`BATCH_26_SEARCH_PROFILE_CORRECTIONS_RULES_COMPLETE`
