# P-5 Screening & IDV Provider-Ready Flow — Build Plan

Per the instructions ("Phase 1 — Plan first / Before changing files, produce…"), this is the plan. No code is written until you accept it. Build follows the same accept-per-phase rhythm as P-5 Batch 8.

## Scope guardrails (non-negotiable)

- No new live external provider calls. No real provider credentials. Provider-ready / provider-stub only.
- No weakening of POI, WaD, finality, audit, RLS, API, billing, Memory, Batch 6, Batch 7 or Batch 8 protections.
- No P-4 POI/WaD/Trading-Engine regressions.
- Reuse Batch 8 SSOT vocabulary (categories, ready definition, dependency states, decision states, audit/webhook vocab, allowed/banned wording, API-safe fields, ownership roles) rather than inventing parallel taxonomies. New SSOT is added only for screening- and IDV-specific concepts.
- No UI, RPC, projection, edge function, cron, or live call introduced in Phase 1.

## Inspection findings this plan must fix

1. `compliance-freshness-guard` reads `screening_runs`; `dilisense-screen` writes `screening_results`. Freshness can fail-open. Fix in Phase 2 (canonical spine), no schema destruction.
2. PEP hits captured, no gate / hold / review queue. Fix in Phase 4 + Phase 5.
3. Adverse media has no real infrastructure. Build provider-ready, admin-triggered internal structures only — no live claim.
4. Onfido / CIPC / Dow Jones / Refinitiv not implemented. Keep provider-ready labels; never claim live.

## Phased build order

```text
Phase 1  Plan + SSOT registry (this plan; SSOT file in the next turn after accept)
Phase 2  Canonical screening spine (DB) — fix screening_runs vs screening_results drift
Phase 3  Required-check engine (RPC) — service-role only
Phase 4  Transaction gate logic (RPC + read projections) — POI / WaD / finality / funder-ready / API
Phase 5  Manual review queues (DB + RPC) — sanctions, PEP, adverse media, IDV fail, expired, provider-pending, override
Phase 6  UI surfaces (admin + party + funder-safe summary)
Phase 7  API readiness response (safe fields only)
Phase 8  Memory + audit rules (link-only to Batch 4/5; no raw payloads in Memory)
Phase 9  QA + guards + tests
```

Each phase: single additive migration where DB is touched, dedicated guard script, dedicated vitest file, evidence README update, status marker `P5_SCREENING_PHASE_<n>_DEPLOYED`. Stop after each phase and wait for acceptance.

## Phase 1 deliverables (what I will create on accept)

- `src/lib/p5-screening/registry.ts` — SSOT mirror (browser-safe), pinned by guard:
  - check categories: `company_aml_sanctions`, `pep`, `watchlist_name`, `idv_person`, `adverse_media_admin_triggered`
  - party roles requiring checks (buyer/seller co, buyer/seller auth rep, funder rep, admin, agent/introducer, required counterparty, directors-if-relied, UBOs-if-acting)
  - check states: `not_required`, `not_started`, `screening_pending`, `idv_pending`, `provider_pending`, `manual_review_required`, `screening_expired`, `cleared`, `cleared_with_conditions`, `failed`, `rejected`
  - reuse rule constants: `SCREENING_REUSE_MAX_AGE_DAYS = 90`, plus invalidation triggers (core detail change, new required party, unresolved review, provider invalidation, admin re-check flag)
  - gate matrix: which states block POI create / POI accept (none by default) / WaD create / WaD seal / trade approval / finality / funder-ready / API ready=true
  - allowed external wording (verbatim list from your brief)
  - banned external wording (verbatim list from your brief)
  - banned-from-Memory payload kinds (raw provider, ID image, selfie, biometric, unresolved match, provider-pending state, raw adverse media)
  - audit event vocabulary (`p5_screening.*` namespace) and webhook event vocabulary
  - API-safe field allowlist (`ready`, `readiness_status`, `blockers[]`, `affected_party`, `affected_check`, `last_checked_at`, `expires_at`, `admin_review_required`, `provider_pending`, `retry_pending`)
- `scripts/check-p5-screening-phase-1-registry.mjs` — pins all literals above; fails build on drift.
- `src/tests/p5-screening-phase-1-registry.test.ts` — vitest coverage of constants + reuse arithmetic.
- `evidence/p5-screening-idv-provider-ready-flow/README.md` — Phase 1 entry.
- Status marker on completion: `P5_SCREENING_PHASE_1_DEPLOYED`.

## Files likely to change in later phases (forecast, not yet touched)

- DB: new `public.p5_scr_*` tables (party_check_requirements, check_results_canonical view/bridge over `screening_runs` + `screening_results`, gate_decisions, review_queue, idv_person_checks, adverse_media_admin_triggers, audit_events, memory_links). All additive. No destructive schema. No `app_role` widening.
- RPC: `p5_scr_rpc_*` — service-role only, `SECURITY DEFINER`, `SET search_path = public`, `REVOKE … FROM PUBLIC`.
- Read projections: `p5_scr_read_*` for admin / party / funder-safe / API.
- Edge functions: none in Phases 1–5. Optional safe API projection edge function in Phase 7, behind feature flag, no live provider calls.
- UI: `src/pages/admin/p5-screening/Workbench.tsx`, `src/components/p5-screening/*`, `src/lib/p5-screening/api.ts` (single UI gateway — UI never touches tables/RPCs directly).
- Tests: per-phase vitest files + cross-phase QA guard mirroring Batch 8 model.

## Explicit non-scope (will not touch)

- No edits to `src/integrations/supabase/client.ts` or `types.ts` outside the auto-regen after migrations.
- No changes to Batch 6 (exceptions), Batch 7 (dashboards), Batch 8 (provider-ready labelling) surfaces.
- No POI/WaD/finality state-machine edits beyond reading their state to compute gate decisions.
- No `screening_runs` / `screening_results` destructive change — Phase 2 bridges them, doesn't replace them.
- No new `app_role` values; reuse `platform_admin`, `compliance_analyst`, etc.
- No live provider credentials, no `dilisense-screen` / `onfido` / `cipc` / `dow-jones` / `refinitiv` activation.
- No Memory mutation; Batch 4/5 finality and Memory tables are reference-only.

## Risks protected

- Fail-open freshness (Phase 2 bridge).
- Banned wording leaking externally (Phase 1 SSOT + per-phase guard).
- Raw provider payloads reaching funders/users/API/Memory (admin-only columns + projection allowlist + Memory link-only).
- Over-blocking POI (gate matrix explicitly allows POI create/accept on pending).
- Role escalation (no `app_role` widening; service-role-only writes).

## Acceptance gate

Reply "Accepted — proceed to Phase 1 implementation" and I will create the Phase 1 SSOT registry, guard, test, and evidence README only. I will then stop and wait for Phase 2 acceptance.
