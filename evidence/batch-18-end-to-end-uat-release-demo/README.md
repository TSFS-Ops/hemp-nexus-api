# Batch 18 — End-to-End UAT, Release Gate and Demo Pack

**Status:** BATCH_18_END_TO_END_UAT_RELEASE_DEMO_COMPLETE

This batch adds the final UAT, release-gate and demo-readiness layer on
top of Batches 1–17. It is intentionally read-only and adds **no** new
product workflows, no live provider integration, no production
enablement buttons, and no external notifications.

## Single source of truth

- `src/lib/registry-release-gate-ssot.ts` — release statuses, release-
  gate matrix, allowed/forbidden readiness wording, UAT scenario pack,
  demo data set, client-safe limitations.

## Read-only admin surfaces

- `/admin/registry/release-gate` → `src/pages/admin/registry/ReleaseGate.tsx`
- `/admin/registry/demo-pack` → `src/pages/admin/registry/DemoPack.tsx`
- `/admin/registry/uat-scenarios` → `src/pages/admin/registry/UatScenarios.tsx`

All three are gated by `platform_admin` and always render the demo/UAT
warning banner.

## UAT scenario proof

`UAT_SCENARIOS` covers all 25 required workflows from public search
through to expired / revoked / disputed verification. Pinned by tests in
`src/tests/batch-18-end-to-end-uat-release-demo.test.ts`.

## Demo data proof

`DEMO_RECORDS` enumerates the 22 required demo entries (companies, API
clients, API events, requests, blockers, audit trail). Every record is
flagged `isDemo: true` and labelled with the `(UAT)` suffix. Demo bank
values are described in notes only — there are no raw bank fields stored
in the SSOT.

## Release gate matrix proof

`RELEASE_GATE_MATRIX` covers all required modules (25 rows). The
computed final release status is asserted **never** to default to
`production_ready` — verified by `computeFinalReleaseStatus()` and a
pinned unit test.

## Readiness wording proof

`ALLOWED_READINESS_WORDING` enumerates the only nine permitted phrases.
`FORBIDDEN_READINESS_WORDING` enumerates the ten banned phrases. The
prebuild guard `scripts/check-batch-18-forbidden-readiness-wording.mjs`
scans the SSOT-driven surfaces (`src/pages/admin/registry/ReleaseGate.tsx`,
`DemoPack.tsx`, `UatScenarios.tsx`, the SSOT itself and the registry
docs) and fails the build if any forbidden phrase appears without the
required qualifying context.

## Security regression proof

This batch does not introduce new tables, new edge functions or new
client-side data access. It re-asserts existing guarantees:
- no raw bank exposure (Batches 13/13B/14/14B/15/15B/16/17 guards),
- no full API key exposure (Batch 15B guards),
- no raw provider payloads (Batch 14B guards),
- no personal contact leakage (Batch 12 guards),
- RLS and role-gated admin surfaces (existing platform guards).

## Demo walkthrough proof

`docs/registry/demo-walkthrough.md` documents 13 walkthroughs (public
search → readiness dashboard) including the explicit "do not claim"
clause for each. The in-app demo pack at `/admin/registry/demo-pack`
backs the walkthrough with the SSOT demo records.

## Client-safe limitations proof

`docs/registry/client-safe-limitations.md` mirrors `CLIENT_SAFE_LIMITATIONS`
from the SSOT (11 statements). Tests pin presence of the three
"capture/approval does not verify" statements plus "live provider not
enabled" and "production API disabled by default".

## Evidence index proof

`evidence/registry-evidence-index/README.md` indexes all registry-related
batches (1–18) with status, evidence path, known limitations and
production blockers.

## Deploy manifest coverage proof

Batch 18 adds no new edge functions. The existing manifest coverage
guard (`scripts/check-edge-function-deploy-coverage.mjs`) continues to
enforce that every deploy-critical function from Batches 1–17 is named
in `scripts/edge-function-deploy-manifest.json` and mentioned in
`RELEASE_GATE.md`.

## Guards added

- `scripts/check-batch-18-forbidden-readiness-wording.mjs`
- `scripts/check-batch-18-no-production-ready-default.mjs`
- `scripts/check-batch-18-demo-labelled.mjs`
- `scripts/check-batch-18-evidence-index-present.mjs`
- `scripts/check-batch-18-docs-present.mjs`

All run from `prebuild` and fail the build on drift.

## Tests

`src/tests/batch-18-end-to-end-uat-release-demo.test.ts` — 20+ assertions
across release-gate defaults, UAT scenarios, demo records, allowed/
forbidden wording, client-safe limitations and required documentation
presence.

## Acceptance checklist

- [x] End-to-end UAT scenario pack present (25 scenarios).
- [x] Demo / UAT data set labelled and controlled (22 records).
- [x] Release gate matrix present (25 modules).
- [x] Default final release status is **not** `production_ready`.
- [x] Readiness wording is safe; forbidden wording guarded.
- [x] Security regression posture preserved from Batches 1–17.
- [x] Demo walkthrough pack present.
- [x] Client-safe limitations list present.
- [x] Central evidence index present.
- [x] Deploy manifest coverage clean (no new functions added).
- [x] No raw bank, full key or provider payload exposure introduced.
- [x] No automatic approval; no production-ready claim made.
- [x] Tests and guards added to `prebuild`.
