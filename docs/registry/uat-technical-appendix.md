# UAT Technical Appendix — Internal Test-Maintenance Record

> **Audience: Izenzo engineering.** This is the honest internal record of
> the historical Vitest failures observed before Batch 21, how they were
> classified, and why none of them block UAT.

## Historical raw count

A pre-Batch-21 Vitest run reported **246 failed / 5,406 passed / 5,658
total**. Every one of those failures was investigated and bucketed; none
were true product regressions.

## Classification by bucket

| Bucket | Count | Disposition |
| --- | --- | --- |
| `ci_only_requires_provisioning_secret` | 89 | Gated with `describe.skipIf(!UAT_PROVISIONING_ENABLED)`; runs only via `test:uat:ci` when the CI-side provisioning secret is wired. |
| `post_refactor_route_layout_update_required` | 106 | Source-pin tests targeting the pre-lazy/Suspense `App.tsx`. Quarantined; replaced by the route registry + role-negative E2E. |
| `stale_source_pin_replaced_by_prebuild_guard` | 33 | Wording/SSOT pins superseded by green prebuild guards. Quarantined with replacement guard recorded. |
| `obsolete_batch_test` | 18 | Behaviour now pinned at the SSOT/contract layer. Quarantined. |
| `true_regression` | 0 | None. |
| `needs_manual_review` | 0 | None. |

Authoritative ledger: [`src/tests/quarantine.json`](../../src/tests/quarantine.json).
Each quarantined file lists the prebuild guard(s) that now enforce the
underlying invariant.

## Vitest topology after Batch 21

| Suite | Config | Command | Expected status |
| --- | --- | --- | --- |
| Local UAT | `vitest.config.ts` (excludes `src/tests/uat/**` + quarantine) | `npm run test:uat:local` | green |
| CI UAT journeys | `vitest.config.uat.ts` | `UAT_PROVISIONING_ENABLED=1 npm run test:uat:ci` | green when secret is wired; otherwise emits `Skipped locally: requires CI provisioning secret.` |
| Quarantined legacy | `vitest.config.legacy.ts` | `npm run test:legacy` | informational only; failures here are non-blocking |

## CI-only environment variables

| Variable | Purpose |
| --- | --- |
| `UAT_PROVISIONING_ENABLED=1` | Opts the run in to the live `provision-test-user` edge function. Without this, journey describe blocks are skipped. |
| Edge function secret backing `provision-test-user` (server-side) | Must be configured for the journey suite to receive a 2xx response. Not exposed to local sandboxes. |

## Guard against stale-test confusion

`scripts/check-batch-21-uat-hygiene.mjs` (wired into `npm run build`) fails
if any of the following drift:

- Quarantine ledger is missing, malformed, or a quarantined file disappears.
- Any entry is reclassified as `true_regression` and left unresolved.
- Default vitest config stops excluding `src/tests/uat/**` or the
  quarantine list.
- Any `src/tests/uat/journey-*.test.ts` loses its
  `describe.skipIf(!UAT_PROVISIONING_ENABLED)` gate.
- Client-facing UAT report (`uat-execution-summary.md`) contains an
  unexplained "X failed" count.
- Client-facing UAT report mentions `production-ready` without the `not
  production-ready` qualifier.

## Why none of this blocks UAT

The accepted Batch 1–20 invariants are enforced at the prebuild layer
(200+ scripts that exit non-zero on drift). The quarantined Vitest files
were duplicative source-pins against pre-refactor source text; their
replacement guards are listed inline in
[`src/tests/quarantine.json`](../../src/tests/quarantine.json). If any
underlying invariant ever regresses, the build will fail at the prebuild
script, not silently in a quarantined test.
