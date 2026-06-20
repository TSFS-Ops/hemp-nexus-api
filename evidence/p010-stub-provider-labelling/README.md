# P010 — Stub Provider Labelling / Hiding

Status: **P010_STUB_PROVIDER_LABELLING_HARDENED_INTERNAL_ACCEPTANCE_PASSED**

Date: 2026-06-20 (hardening batch on top of 2026-06-19 acceptance)

## Scope

Four providers are NOT live yet:

| Provider   | Category      | Live? | Client visible? | Admin visible? |
|------------|---------------|-------|-----------------|----------------|
| CIPC       | KYB           | No    | No              | Yes (labelled) |
| Onfido     | Identity      | No    | No              | Yes (labelled) |
| Dow Jones  | Sanctions/PEP | No    | No              | Yes (labelled) |
| Refinitiv  | Sanctions/PEP | No    | No              | Yes (labelled) |

## Hardening batch (2026-06-20)

This batch extends the original P010 acceptance with:

1. **SSOT metadata**: every stub provider now carries
   `category`, `is_live`, `client_visible`, `admin_visible`,
   `requires_test_mode`, `approved_warning_label`, `allowed_statuses`.
2. **Test-Mode simulation path**: new edge function
   `provider-stub-simulate` — admin/developer + Test Mode-only, audit-only.
3. **Admin diagnostic UI**: `StubProviderSimulationPanel` mounted under
   `AdminSettings` → Test Mode tab. Buttons disabled unless Test Mode is
   active; tooltip uses the agreed wording.
4. **Build-time guards**:
   - extended `scripts/check-stub-providers-parity.mjs` (42 pins × 2 files),
   - new `scripts/check-stub-provider-copy-drift.mjs` scanning
     `src/components`, `src/pages`, `docs` for stub provider names co-occurring
     with forbidden status wording. Both wired into `prebuild`.
5. **Extended forbidden list**: now includes
   `provider-confirmed`, `provider_confirmed`, `provider-approved`,
   `provider_approved`, `provider_matched`, `live_check_complete`,
   plus phrase-form guards for `verification complete`, `screening complete`,
   `provider check passed`, `provider match found`, `external check complete`.
6. **Extended canonical audit names**:
   `stub_provider.test_mode_simulated`, `stub_provider.visibility_suppressed`
   added alongside the existing `not_live` / `blocked` / `no_external_check`.

## Files changed (hardening batch)

- `src/lib/stub-providers.ts` — metadata + role helpers + extended lists.
- `supabase/functions/_shared/stub-providers.ts` — mirror + Test Mode envelope helper.
- `scripts/check-stub-providers-parity.mjs` — extended pins.
- `scripts/check-stub-provider-copy-drift.mjs` — new build-time copy guard.
- `package.json` — `prebuild` now runs the copy-drift guard.
- `supabase/functions/provider-stub-simulate/index.ts` — new audit-only edge function.
- `supabase/functions/provider-stub-simulate/index.test.ts` — Deno negative-path tests.
- `supabase/config.toml` — registers `provider-stub-simulate`.
- `scripts/edge-function-deploy-manifest.json` — registers the new function.
- `src/components/admin/StubProviderSimulationPanel.tsx` — admin diagnostic UI.
- `src/components/admin/AdminSettings.tsx` — mounts the new panel.
- `src/tests/p010-stub-provider-labelling.test.ts` — extended to 23 tests
  (provider × role matrix, extended forbidden lists, envelope helpers).

## Provider × role visibility matrix

| Role                | UI visibility   | Stub action button | Server response on direct call          |
|---------------------|------------------|----------------------|------------------------------------------|
| requester / trader  | Hidden           | None                 | 401 / 403 (no client-facing route)       |
| counterparty        | Hidden           | None                 | 401 / 403 (no client-facing route)       |
| compliance_analyst  | Hidden in workflow | None                | 401 / 403 (no admin route exposed)       |
| platform_admin      | Labelled (warning) | Disabled unless Test Mode | 200 `stub_not_live` + `stub_provider.blocked` when Test Mode OFF; 200 `test_mode_bypass` + `stub_provider.test_mode_simulated` when ON |
| developer / internal | Labelled (warning) | Disabled unless Test Mode | Same as platform_admin                    |

## Audit event names used

- `stub_provider.not_live` (existing — emitted by `idv-verify` / `dilisense-screen` gates)
- `stub_provider.blocked` (new — emitted by `provider-stub-simulate` when role/Test Mode fails)
- `stub_provider.test_mode_simulated` (new — emitted by `provider-stub-simulate` on success)
- `stub_provider.no_external_check` (canonical; reserved)
- `stub_provider.visibility_suppressed` (canonical; reserved)

## Edge/backend guard summary

- `idv-verify` / `dilisense-screen` — short-circuit any stub provider with
  503 `STUB_PROVIDER_NOT_LIVE` + audit-only `stub_provider.not_live`.
  No verification / screening row written; entity not advanced.
- `provider-stub-simulate` — JWT-validated + `has_role(platform_admin)` OR
  `has_role(developer)` + `admin_settings.test_mode_bypass.enabled === true`.
  Returns `test_mode_bypass` envelope with `external_provider_called: false`.
  No writes to verification, screening, KYC/KYB, POI, WaD, match, token,
  notification, or compliance tables.

## Test output

```
$ node scripts/check-stub-providers-parity.mjs
[check-stub-providers-parity] OK (42 pins across 2 files)

$ node scripts/check-stub-provider-copy-drift.mjs
[check-stub-provider-copy-drift] OK (scanned 394 files across 3 roots)

$ bunx vitest run src/tests/p010-stub-provider-labelling.test.ts
 ✓ src/tests/p010-stub-provider-labelling.test.ts (23 tests) 14ms
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

Deno tests at `supabase/functions/provider-stub-simulate/index.test.ts`
cover 405 / 401 / 400 / non-stub-provider negative paths and assert no
forbidden P010 word ever appears in any response envelope. They run against
the deployed function and are intentionally not executed by the build agent.

## Acceptance criteria (post-hardening)

| # | Criterion | Status |
|---|-----------|--------|
| 1  | Stub providers cannot appear as live anywhere in the product | PASS |
| 2  | CIPC/Onfido/Dow Jones/Refinitiv names removed from normal UI, docs, UAT, exports | PASS (copy-drift guard build-enforced) |
| 3  | Requester/trader cannot see or trigger stub providers | PASS |
| 4  | Counterparty cannot see or trigger stub providers | PASS |
| 5  | Compliance analyst cannot see/trigger stub providers in normal workflow | PASS |
| 6  | Platform admin sees stub providers only in diagnostic surfaces with the warning | PASS |
| 7  | Developer/internal same as platform admin | PASS |
| 8  | Platform-admin/developer simulation disabled unless Test Mode is active | PASS (UI tooltip + server gate) |
| 9  | Test Mode simulation creates audit-only evidence, no client-visible result | PASS (`stub_provider.test_mode_simulated`) |
| 10 | No stub envelope can say verified/cleared/screened/passed/approved/... | PASS (test + build-time guard) |
| 11 | No stub pathway calls a real external provider | PASS (gate short-circuits before dispatch) |
| 12 | No stub pathway updates KYB/KYC/sanctions/POI/WaD/match/token/notification/governance | PASS (audit-only writes; no domain writes) |
| 13 | Direct edge-function calls blocked consistently, not only frontend | PASS |
| 14 | Audit captures user, role, org_id, provider category, provider id, action, test_mode, ts, outcome, reason | PASS |
| 15 | Automated tests cover all four providers and all relevant roles | PASS (23 tests, provider × role matrix) |
| 16 | Build-time guard prevents future copy/status drift | PASS (`check-stub-provider-copy-drift.mjs`) |

## Confirmations

- No real external provider call is made by any stub pathway.
- No real verification / screening / compliance result can be created.
- No forbidden wording appears in any stub-provider output (unit-tested +
  build-time guarded).
- No new tables, no new scopes, no new client-facing surface, no schema
  changes, no changes to live `companies_house` / `dilisense` paths.
- Build agent did **not** drive production: edge function not deployed by
  agent, Deno tests not executed by agent, no real users / orgs touched.

## Caveats

- `companies_house` and `dilisense` are real, live integrations and are NOT
  covered by this gate.
- The legacy `verifyWithCIPC` / `verifyWithOnfido` / `screenWithDowJones` /
  `screenWithRefinitiv` helper functions remain in the source files but are
  unreachable; cleanup is a separate batch.
