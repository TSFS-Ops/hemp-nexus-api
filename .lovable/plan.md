## Batch 1 — Business Registry Foundation (M001, M018, M019)

Scope strictly limited to Batch 1 as instructed. No real registry data ingested. No bank capture, no API facade, no outreach, no claim/authority logic — those are explicitly reserved for Batches 2–6.

### Deliverables

**M001 — Business Registry Shell**

- New module under `/registry` with role-safe routes:
  - `/registry` — module landing (explains scope, links to search/claim/admin where applicable)
  - `/registry/search` — public company search shell (empty-state only, no data)
  - `/registry/company/:id` — company profile shell (empty-state, "no record loaded")
  - `/registry/claim` — claim placeholder ("Coming in Batch 3")
  - `/admin/registry` — admin registry area (tabs: Readiness, Decisions; other tabs marked "Coming in later batch")
  - `/admin/registry/readiness` — Product Truth dashboard (M019)
  - `/admin/registry/decisions` — Business Decision Register (M018)
  - `/registry/readiness` — client-safe readiness summary placeholder (full M017 in Batch 6)
- All routes guarded; no misleading "live" wording. Every shell page carries a `<ReadinessBanner state="shell_ready" />` so nothing can be mistaken for production.

**M019 — Module Readiness / Product Truth Layer**

- DB tables (RLS-scoped, `service_role` + `platform_admin` write, `authenticated` read on non-sensitive views):
  - `registry_modules` — module code (M001…M019), name, category, current readiness state
  - `registry_readiness_states` — append-only history of state transitions per (module, country, provider, surface) with reason, actor, evidence link, effective_at
- Readiness enum (exact): `not_started`, `shell_ready`, `test_data_ready`, `provider_pending`, `data_pending`, `licence_pending`, `admin_only`, `client_demo_ready`, `production_ready`, `disabled`.
- SSOT in `src/lib/registry-readiness.ts` + Deno mirror in `supabase/functions/_shared/registry-readiness.ts`. Parity guard `scripts/check-registry-readiness-parity.mjs`.
- `<ReadinessBanner />` + `<ReadinessBadge />` components read state and render copy from SSOT. Hard rule: surfaces that aren't `production_ready` cannot render verified/live wording (enforced by `scripts/check-registry-readiness-forbidden-words.mjs`).
- Admin dashboard `/admin/registry/readiness`: matrix of modules × surfaces with current state, last change, link to history. `platform_admin` and `compliance_owner` can transition states via edge function `registry-readiness-transition` (writes audit event `registry_readiness_state_changed`).
- Seed every M001–M019 module at `not_started` except M001/M018/M019 set to `shell_ready` after this batch.

**M018 — Business Decision Register**

- DB table `business_decisions` (RLS: read = authenticated within org for non-confidential; full read + write = `platform_admin`/`compliance_owner`). Columns: title, category (country | data_source | provider | public_display | api_output | outreach_use | commercial_use | institutional_demo | wording), status (`proposed`, `approved`, `rejected`, `expired`, `superseded`, `under_review`), rationale, effective_at, review_at, expiry_at, owner_role, approved_by, superseded_by, evidence_url.
- `business_decision_events` append-only audit table; every status change emits audit name `business_decision_recorded` / `business_decision_status_changed`.
- Edge function `business-decision-record` (POST create / update / supersede; enforces role + 30-char rationale).
- Admin UI `/admin/registry/decisions`: list with filter by category/status, detail drawer with full history, "Record decision" form (admin-only).
- Public-safe getter helper `getActiveDecision(category, key)` for later batches to consult before showing any country/provider as live.

### Guards & Tests

- Prebuild scripts:
  - `check-registry-readiness-parity.mjs` (TS ↔ Deno mirror)
  - `check-registry-readiness-forbidden-words.mjs` (blocks "verified", "live", "production", "guaranteed" in non-production-ready shell copy)
  - `check-business-decision-audit-names.mjs`
- Vitest suite `src/tests/batch-1-registry-foundation.test.ts` (~25 cases): route guards, readiness state transitions, decision lifecycle, forbidden-word enforcement, RLS isolation across two orgs, audit emission for each transition.
- RELEASE_GATE.md + edge-function-deploy-manifest.json updated for the two new edge functions and three new prebuild scripts.
- Evidence pack: `evidence/batch-1-registry-foundation/README.md` with seeded readiness matrix snapshot, decision register screenshot list, audit-event coverage.

### Out of scope (deferred to later batches, will be rejected if attempted here)

- Real or seed company records, search results, profile data
- Claim / authority / bank capture / API facade / outreach / human approval queue
- Country coverage table (M011), provenance model (M010), import batches (M012) — Batch 2
- Provider integrations (CIPC, Onfido, bank verification, etc.)

### Files to create

- `supabase/migrations/<ts>_batch_1_registry_foundation.sql`
- `src/lib/registry-readiness.ts`, `src/lib/business-decisions.ts`
- `supabase/functions/_shared/registry-readiness.ts`
- `supabase/functions/registry-readiness-transition/index.ts`
- `supabase/functions/business-decision-record/index.ts`
- `src/pages/registry/{Landing,Search,CompanyProfile,Claim,Readiness}.tsx`
- `src/pages/admin/registry/{Index,Readiness,Decisions}.tsx`
- `src/components/registry/{ReadinessBanner,ReadinessBadge,ReadinessMatrix,DecisionForm,DecisionList}.tsx`
- `scripts/check-registry-readiness-parity.mjs`
- `scripts/check-registry-readiness-forbidden-words.mjs`
- `scripts/check-business-decision-audit-names.mjs`
- `src/tests/batch-1-registry-foundation.test.ts`
- `evidence/batch-1-registry-foundation/README.md`

### Acceptance for Batch 1

- All routes render shell-only with readiness banner
- Readiness matrix shows all 19 modules with correct seeded states
- Decision register CRUD works for `platform_admin`; non-admins read-only or blocked
- All audit events emit; RLS blocks cross-org reads
- Prebuild guards + tests pass
- No "verified"/"live"/"production" wording anywhere in shell copy

Approve to proceed, or tell me to adjust scope (e.g., split M018 into its own batch, or skip the readiness banner component).  
  
Approved — proceed with **Batch 1 exactly as scoped**.

One small adjustment before build: keep **M018 inside Batch 1**. Do **not** split it out. The Business Decision Register is needed from day one because the readiness layer must have a formal place to record what can and cannot be said about countries, providers, public display, API output and institutional demos.

Send this instruction:

Proceed with Batch 1 — Business Registry Foundation exactly as specified.

Scope is approved and remains strictly limited to M001, M018 and M019.

Do not ingest any real or seed registry data. Do not build company records, real search results, claim logic, authority logic, bank-detail capture, API facades, outreach, provider integrations, provenance, country coverage or import batches. Those are deferred to later batches.

Key approval points:

1. M001 Business Registry Shell is approved.
2. M019 Product Truth / Module Readiness Layer is approved.
3. M018 Business Decision Register is approved and should remain in Batch 1.
4. Readiness banners must appear on every registry shell route.
5. No shell page may use “verified”, “live”, “production” or “guaranteed” wording unless the relevant surface is `production_ready`.
6. All readiness transitions and business decision changes must emit audit events.
7. RLS must block cross-org access.
8. Platform admins and compliance owners may transition readiness and record decisions.
9. Other users must only have safe read access where allowed.
10. The evidence pack, RELEASE_GATE update, deploy manifest update, guards and tests are mandatory acceptance items.

Acceptance remains:

- all shell routes render correctly;
- readiness matrix shows all M001–M019 modules;
- M001, M018 and M019 are seeded as `shell_ready`;
- all other modules are seeded as `not_started`;
- decision register works for authorised admins;
- non-admins are read-only or blocked as designed;
- audit events emit correctly;
- RLS isolation is proven;
- all prebuild guards pass;
- all tests pass;
- no misleading wording appears anywhere in the shell copy.

Proceed with Batch 1 only.

&nbsp;