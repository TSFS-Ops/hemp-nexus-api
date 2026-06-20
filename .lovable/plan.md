## P010 — Status before this batch

P010 was already shipped as `P010_STUB_PROVIDER_LABELLING_READY_FOR_OPERATOR_VERIFY` on 2026-06-19. The following is **already in place** and will be reused, not rebuilt:

- Central SSOT: `src/lib/stub-providers.ts` + `supabase/functions/_shared/stub-providers.ts` (parity-enforced by `scripts/check-stub-providers-parity.mjs`, wired into `prebuild`).
- Edge gates: `idv-verify` and `dilisense-screen` short-circuit any stub provider with HTTP 503 `STUB_PROVIDER_NOT_LIVE`, audit-only `stub_provider.not_live`, and never advance entity / screening state.
- UI copy: `TestModeBypassPanel` IDV + Sanctions rows already say *"(Onfido / CIPC are not live yet…)"* and *"(Dow Jones / Refinitiv are not live yet…)"*; `FacilitationCaseManualChecksPanel` and `docs/Counterparties` no longer name the four providers.
- Unit pins: `src/tests/p010-stub-provider-labelling.test.ts` covers the four keys, forbidden words, statuses, audit names, verbatim labels and error code.

## What the new prompt adds on top

The new prompt tightens four things that are not yet captured. This batch only fills those gaps; no rework of the existing gate.

### 1. Enrich the SSOT with policy metadata

Add metadata to each entry (no behaviour change to existing call sites):

```text
provider_id, provider_category (KYB | Identity | Sanctions/PEP),
is_live: false, client_visible: false, admin_visible: true,
requires_test_mode: true, approved_warning_label, allowed_statuses
```

Add forbidden-word coverage for the longer list from the new prompt
(`provider-confirmed`, `provider_confirmed`, `provider-approved`,
`provider_approved`, `provider_matched`, `live_check_complete`,
plus phrase scans for `verification complete`, `screening complete`,
`provider check passed`, `provider match found`, `external check complete`).
Mirror to the edge SSOT and extend the parity checker pins.

### 2. Add an explicit Test-Mode simulation path (audit-only)

New edge function `provider-stub-simulate` (admin/developer only, requires Test Mode active):

- Validates JWT + `has_role(platform_admin | developer)`.
- Requires `admin_settings.test_mode_active = true`; otherwise returns the standard stub-not-live envelope and writes `stub_provider.blocked`.
- When allowed: writes `stub_provider.test_mode_simulated` (audit-only) and returns:
`{ ok: true, status: "test_mode_bypass", external_provider_called: false, message: <verbatim label> }`.
- Never writes to `screening_results`, `kyc_status`, `entities`, `dd_*`, `pois`, `wads`, `matches`, `token_*`, `notifications`.

No new tables. No new scopes (re-uses existing `platform_admin` / `developer` roles and the existing `admin_settings.test_mode_active` flag if present, otherwise the existing Test Mode mechanism used by `TestModeBypassPanel`).

### 3. Admin-only "Simulate in Test Mode" UI control

Inside the existing admin diagnostic panel (`TestModeBypassPanel` area), add a small "Stub provider simulation" card listing the 4 providers with:

- generic category label + verbatim warning,
- per-provider **Simulate in Test Mode** button (disabled when Test Mode off, with the agreed tooltip),
- on click → invokes `provider-stub-simulate`, surfaces audit-only result, never displays "verified/passed/cleared/etc".

Gated by `useUserRole()` so only `platform_admin` / `developer` see it.

### 4. Build-time guards + expanded tests

- Extend `scripts/check-stub-providers-parity.mjs` for the new metadata + extended forbidden list.
- New script `scripts/check-stub-provider-copy-drift.mjs` (wired into `prebuild`): greps the repo for the forbidden phrases co-occurring with any of the 4 provider names in user-facing files (`src/components/**`, `src/pages/**`, `docs/**`, exports), excluding the SSOT and tests. Fails the build on a match.
- Extend `src/tests/p010-stub-provider-labelling.test.ts` with:
  - role × provider matrix (requester, counterparty, compliance_analyst, platform_admin, developer) — using the policy helper, asserting `client_visible=false` blocks all four for non-admin roles and `admin_visible=true` + Test Mode gate for the two admin roles.
  - extended forbidden-words list pinned.
  - envelope helpers produce no forbidden word and `external_provider_called=false`.
- New Deno test `supabase/functions/provider-stub-simulate/index.test.ts` covering: unauth → 401, non-admin → 403, admin + Test Mode off → blocked envelope + `stub_provider.blocked` audit, admin + Test Mode on → `test_mode_bypass` envelope + `stub_provider.test_mode_simulated` audit, never writes to screening/kyc tables.

## Out of scope (explicit)

- No real provider integration for CIPC / Onfido / Dow Jones / Refinitiv.
- No new tables, no new scopes, no schema changes.
- No client-facing surface gains a stub provider control.
- No changes to `companies_house` / `dilisense` (those are live).

## Deliverable

After implementation:

- Run `bunx vitest run src/tests/p010-stub-provider-labelling.test.ts` and the new Deno test.
- Update `evidence/p010-stub-provider-labelling/README.md` with: files changed, provider × role visibility matrix, audit event names, test output, and the new acceptance status:
`P010_STUB_PROVIDER_LABELLING_HARDENED_INTERNAL_ACCEPTANCE_PASSED`.

Confirm to proceed and I will implement exactly the above — nothing else.  
  
Proceed.

Implement **exactly** the batch described above and nothing outside scope.

Use this acceptance line after evidence is complete:

```text
P010_STUB_PROVIDER_LABELLING_HARDENED_INTERNAL_ACCEPTANCE_PASSED
```

Key constraints to preserve:

- Reuse the existing P010 SSOT and gates.
- Do not rebuild what already shipped.
- No real provider integration.
- No new tables.
- No new scopes.
- No client-facing stub controls.
- No changes to live `companies_house` or `dilisense`.
- Simulation is **platform_admin/developer only**, **Test Mode only**, and **audit-only**.
- Stub simulation must never write verification, screening, POI, WaD, match, token, notification, or compliance state.
- Forbidden wording guard must be build-time enforced.
- Evidence README must include files changed, role/provider matrix, audit names, test output, and final status.

After implementation, run:

```bash
bunx vitest run src/tests/p010-stub-provider-labelling.test.ts
```

and the new Deno test:

```bash
deno test supabase/functions/provider-stub-simulate/index.test.ts
```

Then update:

```text
evidence/p010-stub-provider-labelling/README.md
```

with the final evidence and status.