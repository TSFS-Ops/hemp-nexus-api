## Deprecated compliance provider cleanup

Remove all customer/code/docs references to **CIPC, Onfido, Dow Jones, Refinitiv** (and variants). Preserve VerifyNow / `idv-person-verify`, PayFast, Paystack (legacy), Resend, Sentry, Companies House.

### Approach

Replace vendor identifiers with provider-neutral category keys everywhere runtime code and tests depend on them:


| Old key     | New key               |
| ----------- | --------------------- |
| `cipc`      | `company_registry`    |
| `onfido`    | `identity_document`   |
| `dow_jones` | `sanctions_screening` |
| `refinitiv` | `pep_screening`       |


Display / prose:

- "CIPC" → "company registry provider"
- "Onfido" → "identity-document provider"
- "Dow Jones" → "sanctions screening provider"
- "Refinitiv" → "PEP screening provider"
- Lists like "CIPC, Onfido, Dow Jones, Refinitiv are stubbed" → "External compliance providers are not currently connected."

### Files to change

**SSOT (rewritten, neutral entries):**

- `src/lib/stub-providers.ts`
- `supabase/functions/_shared/stub-providers.ts`

**Runtime code:**

- `src/lib/evidence-rating.ts`, `supabase/functions/_shared/evidence-rating.ts` (allowed-provider list)
- `src/lib/idv/provider-registry.ts` (decommissioned list + comment)
- `src/lib/p5-batch8/registry.ts` (preferred_providers → neutral text)
- `src/lib/registry-client-decisions-19a.ts` (`cipc_or_registry_evidence` → `company_registry_evidence`)
- `src/components/admin/TestModeBypassPanel.tsx` (help text neutralised)
- `src/components/registry/DecisionForm.tsx` (placeholder)
- `src/pages/docs/CounterpartyRatingMethodology.tsx` (public docs prose)
- `supabase/functions/_shared/demo-mode-guard.ts` (comment)
- `supabase/functions/idv-verify/index.ts` (rename `verifyWithCIPC`/`verifyWithOnfido` → neutral; allow-lists use new keys; env-var references removed)
- `supabase/functions/provider-stub-simulate/index.test.ts` (payload provider)

**VerifyNow protection:**

- `supabase/functions/idv-person-verify/**` — untouched except that its smoke test's pins for the sibling `idv-verify` allow-lists are updated to match the new neutral keys.

**Guards / scripts:**

- `scripts/check-stub-providers-parity.mjs` — pin the neutral keys instead of vendor names.
- `scripts/check-stub-provider-copy-drift.mjs` — repurpose to enforce the deprecation (fail on any vendor name anywhere in `src/**` and `docs/**`).
- `scripts/check-evidence-rating-parity.mjs` — pin neutral keys.
- Registry batch4/5/6 & bank-verification guards — keep their existing "banned name" lists (they enforce the same policy). Add these guards to the new deprecation-guard exemption list.
- **New:** `scripts/check-no-deprecated-compliance-provider-names.mjs` — repo-wide deny of `CIPC / Onfido / Dow Jones / Refinitiv` (and variants) across `src/**`, `supabase/functions/**`, `docs/**`, `evidence/**`, `public/**`, `README*`. Allowlist: itself, `supabase/migrations/**` (historical, untouched), the other guard scripts that also carry banned-name lists.
- Wire the new guard into the existing `prebuild` script chain.

**Tests updated to new keys:**

- `src/tests/p010-stub-provider-labelling.test.ts`
- `src/tests/p011-counterparty-rating-methodology.test.ts`
- `src/tests/batch-v-wording.test.ts`, `batch-v-wire-per-path-consumption.test.ts`, `batch-v-wire-controlled-action-gates.test.ts`, `batch-v-ui-fix-4-real-idv-and-queue.test.ts`
- `src/tests/batch-4-authority-bank-detail-status.test.ts`, `batch-5-institutional-api-management.test.ts`, `public-api-v1-sandprod-batch6-usage-limits.test.ts`
- `supabase/functions/idv-verify/o_production_lockout_smoke_test.ts`
- `supabase/functions/idv-person-verify/idv_person_verify_smoke_test.ts`

**Docs / evidence prose (bulk neutralise via targeted rewrites, not sed):**

- `docs/platform-audit-report.md`
- `docs/infrastructure-requirements.md`
- `RELEASE_GATE.md`
- Evidence README files under `evidence/**` that mention the four vendors — replace vendor names with neutral wording and append a one-line quarantine note: *"Earlier placeholder provider names have been removed. The platform uses provider-neutral compliance categories unless and until a specific provider is formally approved."*

### Explicitly out of scope

- No changes to `supabase/migrations/**` (historical).
- No RLS / grant / schema / enum edits.
- No secret rotation; env-var names removed from docs/code only where safe.
- No VerifyNow runtime, adapter, contract-map, or routing changes.
- No frontend publish.

### Validation

- `rg -i -e 'cipc|onfido|dow.?jones|refinitiv'` across `src/`, `docs/`, `evidence/`, `public/`, `README*` returns **only** the new deprecation guard file.
- Prebuild guard chain passes (`check-stub-providers-parity`, `check-stub-provider-copy-drift` repurposed, new deprecation guard, existing registry batch guards).
- Vitest suites listed above pass with the neutral keys.
- VerifyNow (`idv-person-verify`) files remain byte-identical apart from smoke-test pins.
- Build (`bun run build`) green.

### Deliverables reported at end

Inventory, files changed, wording replacements, tests run + results, VerifyNow confirmation, verdict `DEPRECATED_COMPLIANCE_PROVIDER_REFERENCES_REMOVED_VERIFYNOW_INTACT` (or `_PARTIAL_[reason]`).  
  
Deprecated compliance provider cleanup

Remove all customer/code/docs references to CIPC, Onfido, Dow Jones, Refinitiv and variants. Preserve VerifyNow / idv-person-verify, PayFast, Paystack where still genuinely legacy/internal, Resend, Sentry, Lovable Send and Companies House.

Do not remove Companies House references. Companies House is not part of this deprecated-provider cleanup.

Objective:

Replace deprecated vendor identifiers with provider-neutral category keys everywhere runtime code and tests depend on them, without breaking current VerifyNow, IDV, compliance, registry, funder, POI, WaD, billing, admin or API flows.

Preferred key mapping:

| Old key | New key |

|---|---|

| cipc | company_registry |

| onfido | identity_document |

| dow_jones | sanctions_screening |

| refinitiv | pep_screening |

Display / prose replacements:

- “CIPC” → “company registry provider”

- “Onfido” → “identity-document provider”

- “Dow Jones” → “sanctions screening provider”

- “Refinitiv” → “PEP screening provider”

- “CIPC, Onfido, Dow Jones, Refinitiv are stubbed” → “External compliance providers are not currently connected.”

Important persistence rule:

If any deprecated provider key is persisted in database rows, audit payloads, enum values, migration-created constraints, snapshots, or historical records, do not rename it destructively in this batch. Add provider-neutral aliases or compatibility mapping instead, and document the remaining historical key separately.

Explicitly out of scope:

- No edits to historical migrations unless absolutely unavoidable.

- No RLS changes.

- No grant changes.

- No schema drops.

- No enum drops.

- No secret rotation.

- No VerifyNow runtime, adapter, contract-map or routing changes.

- No frontend publish.

- No production provider calls.

- No real identity data.

Files / areas to inspect and update:

- src/**

- supabase/functions/**

- scripts/**

- docs/**

- evidence/**

- public/**

- README*

- tests and fixtures

- provider registry/stub files

- seed/demo data

- comments/docstrings

- CI/prebuild guards

Specific files to check:

- src/lib/stub-providers.ts

- supabase/functions/_shared/stub-providers.ts

- src/lib/evidence-rating.ts

- supabase/functions/_shared/evidence-rating.ts

- src/lib/idv/provider-registry.ts

- src/lib/p5-batch8/registry.ts

- src/lib/registry-client-decisions-19a.ts

- src/components/admin/TestModeBypassPanel.tsx

- src/components/registry/DecisionForm.tsx

- src/pages/docs/CounterpartyRatingMethodology.tsx

- supabase/functions/_shared/demo-mode-guard.ts

- supabase/functions/idv-verify/index.ts

- supabase/functions/provider-stub-simulate/index.test.ts

- scripts/check-stub-providers-parity.mjs

- scripts/check-stub-provider-copy-drift.mjs

- scripts/check-evidence-rating-parity.mjs

- relevant Vitest and Deno smoke tests

VerifyNow protection:

Before and after cleanup, confirm:

- supabase/functions/idv-person-verify/** still exists.

- VerifyNow adapter files still exist.

- provider-contract-map still contains the confirmed VerifyNow routes.

- ZA said_basic / ZA Home Affairs / NG NIN mappings are unchanged.

- IDV diagnostic work remains intact.

- No VerifyNow runtime code was changed except smoke-test pins if absolutely necessary.

Guard requirement:

Add or update a guard script:

scripts/check-no-deprecated-compliance-provider-names.mjs

It should fail on deprecated provider names across:

- src/**

- supabase/functions/**

- docs/**

- evidence/**

- public/**

- README*

Allowlist only:

- the guard’s own banned-name list;

- existing guard scripts that contain banned-name lists;

- supabase/migrations/** as historical untouched files;

- any unavoidable historical evidence reference, with explicit justification.

Prefer zero remaining references outside allowlisted guard/historical areas.

Evidence handling:

Evidence files should be neutralised where they are current status documents. Historical evidence may only retain deprecated provider names if absolutely unavoidable and explicitly allowlisted in the guard with a short justification. Prefer zero references.

Add this neutral note where needed:

“Earlier placeholder provider names have been removed. The platform uses provider-neutral compliance categories unless and until a specific provider is formally approved.”

Validation required:

- repo-wide rg before and after for:

  cipc

  onfido

  dow.?jones

  dow_jones

  dow-jones

  dowjones

  refinitiv

  world-check, only if used as Refinitiv branding

- prebuild guard chain passes

- relevant Vitest suites pass

- VerifyNow Deno tests still pass

- TypeScript check passes

- build passes or closest available validation passes

- no broken imports

- no route breaks

- no deprecated provider names remain outside explicit allowlist

Required final report:

1. Inventory of references found.

2. Classification of references:

   - deleted

   - neutralised

   - compatibility alias retained

   - historical/migration allowlisted

3. Files changed.

4. Commit SHA(s).

5. Exact wording/key replacements.

6. Guards added/updated.

7. Tests run and results.

8. Any remaining references and why.

9. Confirmation VerifyNow / idv-person-verify remains intact.

10. Confirmation no migration/RLS/grant/schema/secret/frontend publish occurred unless explicitly justified.

11. Final verdict.

Expected verdict:

DEPRECATED_COMPLIANCE_PROVIDER_REFERENCES_REMOVED_VERIFYNOW_INTACT

If not complete:

DEPRECATED_COMPLIANCE_PROVIDER_CLEANUP_PARTIAL_[CLEAR_REASON]