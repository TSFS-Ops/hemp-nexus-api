# P010 — Stub Provider Labelling / Hiding

Status: **P010_STUB_PROVIDER_LABELLING_READY_FOR_OPERATOR_VERIFY**

Date: 2026-06-19

## Scope

Four providers are NOT live yet:

| Provider   | Domain     | Live? |
|------------|------------|-------|
| CIPC       | IDV / KYB  | No    |
| Onfido     | IDV        | No    |
| Dow Jones  | Sanctions  | No    |
| Refinitiv  | Sanctions  | No    |

## Policy (accepted answer set)

1. **Visibility rule**: hidden from client-facing surfaces; visible only to platform_admin / developer / internal surfaces, as disabled placeholders with the "not live yet" label.
2. **Per-provider rule**: same rule applies to all four providers.
3. **Approved label (short)**: `Not live yet — no external provider check is performed.`
4. **Approved label (long)**: `This provider is not connected yet. No real external verification, screening, or clearance is performed.`
5. **Action behaviour**: no client-facing trigger; internal control disabled.
6. **Result handling**: no visible verification result; audit-only event `stub_provider.not_live`; only safe statuses (`stub_not_live`, `no_external_check`, `provider_not_connected`).
7. **Forbidden status words**: `verified`, `cleared`, `passed`, `approved`, `screened`, `complete`.
8. **Test Mode**: kept separate; Test Mode does not make a stub provider look live.

## Implementation

### Single source of truth (parity-enforced)
- `src/lib/stub-providers.ts` — browser SSOT
- `supabase/functions/_shared/stub-providers.ts` — edge SSOT
- `scripts/check-stub-providers-parity.mjs` — drift checker (19 pins × 2 files), wired into `prebuild`.

### Server-side gates
- `supabase/functions/idv-verify/index.ts`
  - Before provider dispatch, if `isStubProvider(resolvedProvider)`:
    - Writes audit `stub_provider.not_live` (no entity promotion, no `dd_approval_requests` row).
    - Returns HTTP 503 with `{ error: "STUB_PROVIDER_NOT_LIVE", provider, status: "stub_not_live", message: <long label> }`.
- `supabase/functions/dilisense-screen/index.ts`
  - Before provider dispatch, same gate. No `screening_results` row is written; no "clear" result is synthesised.

### UI copy
- `src/components/admin/TestModeBypassPanel.tsx` — IDV and Sanctions descriptions now state `(Onfido / CIPC are not live yet …)` and `(Dow Jones / Refinitiv are not live yet …)`. This is platform_admin-only surface.
- `src/components/facilitation/FacilitationCaseManualChecksPanel.tsx` — placeholders no longer name CIPC or Dilisense.
- `src/pages/docs/Counterparties.tsx` — public docs no longer name CIPC.

### Tests
- `src/tests/p010-stub-provider-labelling.test.ts` pins:
  - the four stub provider keys,
  - `isStubProvider` detection,
  - safe internal status values,
  - the six forbidden status words,
  - the two verbatim labels and the error code,
  - the three canonical audit names.

## Acceptance criteria status

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Stub providers cannot appear as live anywhere in the product | PASS (server gate + UI labels) |
| 2 | No stub result uses verified/cleared/passed/approved/screened/complete | PASS (test pins; envelope hard-codes `stub_not_live`) |
| 3 | Client-facing users cannot trigger stub checks | PASS (no client-facing trigger exists; server gate returns 503) |
| 4 | Requesters and counterparties cannot see the four providers as available checks | PASS (no client-facing UI surface names them) |
| 5 | Platform admins/internal users see them only with "not live" label | PASS (TestModeBypassPanel descriptions) |
| 6 | Any internal button shown is disabled or blocked before execution | PASS (no enable trigger; server gate blocks execution) |
| 7 | Internal events are audit-only and marked `stub_not_live` / `no_external_check` | PASS (`stub_provider.not_live` audit written) |
| 8 | Test Mode does not make a stub provider look like a real provider | PASS (Test Mode bypass synthesises a generic "clear" with provider `test_mode_bypass`; stub-provider gate is independent and labelled separately) |
| 9 | Tests cover each provider (CIPC, Onfido, Dow Jones, Refinitiv) | PASS (`p010-stub-provider-labelling.test.ts`) |
| 10 | Tests cover each role context | N/A at unit level — server gate is provider-keyed, not role-keyed; admin-only callers already gated upstream |

## Operator verification (pending)

Operator to confirm:
- Setting `admin_settings.idv_provider = {individual_provider:"onfido"}` and calling `idv-verify` returns 503 `STUB_PROVIDER_NOT_LIVE` and writes one `stub_provider.not_live` audit row; entity status NOT changed.
- Setting `admin_settings.idv_provider = {company_provider:"cipc"}` behaves the same.
- Setting `admin_settings.screening_provider = {provider:"dow_jones"}` and calling `dilisense-screen` returns 503 `STUB_PROVIDER_NOT_LIVE`; no `screening_results` row created.
- Same for `{provider:"refinitiv"}`.
- TestModeBypassPanel descriptions render the "not live yet" suffix for IDV and Sanctions rows.
- No client-facing surface lists CIPC / Onfido / Dow Jones / Refinitiv.

## Caveats

- `companies_house` and `dilisense` are real, live integrations and are NOT covered by this gate.
- The legacy `verifyWithCIPC` / `verifyWithOnfido` / `screenWithDowJones` / `screenWithRefinitiv` helper functions remain in the source files but are now unreachable — the gate short-circuits before the dispatch table is consulted. They can be removed in a later cleanup batch.
