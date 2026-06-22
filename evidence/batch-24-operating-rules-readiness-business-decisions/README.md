# Batch 24 — Operating Rules SSOT, Readiness, Business Decisions and Wording Gates

## Client decision source

- `docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`
  (received 21 June 2026, attached by Daniel)
- Cover email: `docs/registry/Professional_Email_Re_Business_Registry_Operating_Rules_Questionnaire_Printout.pdf`

The questionnaire is the controlling source for every export below.
Where the document is silent, the accepted conservative defaults from
Batches 1–23 are preserved unchanged.

## Files

- `src/lib/registry-operating-rules.ts` — browser SSOT (states, gates, wording, helpers)
- `supabase/functions/_shared/registry-operating-rules.ts` — Deno mirror
- `scripts/check-registry-operating-rules-parity.mjs` — prebuild parity guard
- `src/tests/batch-24-operating-rules.test.ts` — full client-rule test battery

## Evidence checklist

- [x] **Readiness state proof** — `REGISTRY_READINESS_STATES` lists all
  15 client states including `public_search_ready`, `demo_ready`,
  `api_output_ready`, `imported_sourced`, `seed_only`, `sample_only`,
  `demo_only`, `licence_pending`, `provider_pending`, `quarantined`,
  `duplicate_unresolved`, `disputed`, `privacy_hold`, `field_not_public`,
  `production_live`.
- [x] **Field-level readiness proof** — `REGISTRY_FIELD_GROUPS` exposes
  17 field groups; `isApiOutputAllowed` refuses to let field readiness
  inherit from record readiness.
- [x] **Public-search gate proof** — `isPublicSearchAllowed` requires
  `public_search_ready` AND country/provenance/licence/min-fields/
  decision/no-hold, all enforced in tests.
- [x] **Demo gate proof** — `isDemoAllowed` enforces source +
  licence-evidence + current decision; sensitive demos require
  `compliance_owner` approval.
- [x] **API output gate proof** — `isApiOutputAllowed` blocks
  `sample_only`/`seed_only`/`demo_only`/`provider_pending`/`disputed`/
  `duplicate_unresolved`, admin-only fields and not_api_ready fields.
- [x] **Business-decision gate proof** —
  `REGISTRY_BUSINESS_DECISION_TYPES` covers all 15 gated actions;
  `isBusinessDecisionCurrent` respects expiry, retirement and
  immediate-review triggers.
- [x] **Expiry proof** — `REGISTRY_BUSINESS_DECISION_REVIEW_DAYS`
  matches client defaults (365 / 180 / 90); test exercises a 400-day-
  old decision and asserts block.
- [x] **Protected wording proof** — `isWordingAllowed` enforces the six
  client-protected words AND the seven always-blocked words; fallback
  vocabulary is recorded.
- [x] **Build-vs-data readiness proof** —
  `REGISTRY_READINESS_DASHBOARD_SECTIONS` lists all 13 sections;
  `REGISTRY_READINESS_LABELS.built_data_pending` and
  `data_loaded_workflow_inactive` keep the two states separately
  labelled.
- [x] **Guard summary** —
  `scripts/check-registry-operating-rules-parity.mjs` pinned in
  `npm run prebuild` and exposed as `npm run check:batch-24`.
- [x] **Test summary** — `src/tests/batch-24-operating-rules.test.ts`
  covers every gate, expiry, role/approval count, protected/always-
  blocked word, label string and dashboard section listed above.

## Acceptance

`BATCH_24_OPERATING_RULES_READINESS_BUSINESS_DECISIONS_COMPLETE`
