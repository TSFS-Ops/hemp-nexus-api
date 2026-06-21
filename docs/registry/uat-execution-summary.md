# UAT Execution Summary — Izenzo Business Registry

> **Audience: client UAT reviewer.** This is the clean, client-facing
> evidence summary for the Business Registry UAT run. The full historical
> test-maintenance record sits beside it in
> [`uat-technical-appendix.md`](./uat-technical-appendix.md).

## Headline result

> **UAT automation evidence is green for the accepted UAT pass criteria.
> Legacy/internal test maintenance items have been separated from the UAT
> evidence path. The registry remains UAT/demo-ready, not
> production-ready.**

## What was executed

| Layer | Status | Evidence |
| --- | --- | --- |
| Prebuild guard suite (200+ scripts) | green | `npm run build` exits 0 |
| Route generation and TypeScript compile | green | `npm run build` |
| Local UAT vitest suite (`test:uat:local`) | green | `npm run test:uat:local` |
| Batch 18 end-to-end UAT pack guards | green | `scripts/check-batch-18-*` |
| Batch 19A client decision alignment | green | `scripts/check-batch-19a-*` |
| Batch 19B UI / API / UAT alignment | green | `scripts/check-batch-19b-*` |
| Batch 20 pre-UAT embarrassment audit | green | `scripts/check-batch-20-*` |
| Batch 21 UAT test hygiene | green | `scripts/check-batch-21-uat-hygiene.mjs` |

## UAT pass-criteria evidence

Each row maps a signed UAT criterion to the green automated guard that
proves it:

| UAT criterion | Guard / evidence |
| --- | --- |
| Sample-only records are clearly labelled on public surfaces | `check-batch-18-demo-labelled.mjs` |
| Sample-only records cannot return `verified_by_izenzo=true` | `check-batch-19a-sample-only-locked.mjs` |
| Sample-only records are excluded from the production API contract | `check-batch-19b-sample-only-api.mjs` |
| Claim approval cannot imply broader verification | `check-registry-claim-approval-wording.mjs`, `check-registry-batch10-no-verified-claim-wording.mjs`, `check-registry-batch11-no-verified-claim-wording.mjs` |
| Authority approval cannot imply broader verification | `check-registry-batch4-wording.mjs`, `check-registry-batch12-authority-wording.mjs` |
| Bank details captured ≠ verified; raw details never exposed | `check-registry-public-bank-leakage.mjs`, `check-registry-bank-detail-b13-no-verified.mjs`, `check-batch-13b-ui-no-verified.mjs`, `check-batch-14b-ui-no-verified.mjs`, `check-batch-15-no-raw-bank.mjs`, `check-batch-15b-ui-no-raw-bank.mjs`, `check-batch-16-portal-no-raw-bank.mjs`, `check-batch-17-operations-no-raw-bank.mjs` |
| Live bank-detail provider verification remains disabled | `check-registry-bank-verification-no-live-provider.mjs` |
| Full API keys never re-rendered after creation | `check-batch-15b-ui-no-full-key.mjs` |
| Production API access disabled by default; admin acknowledgement required | `check-batch-15b-ui-prod-ack.mjs`, `check-registry-api-state-rules.mjs` |
| No automatic external send paths (SMS / WhatsApp / email outreach) | `check-notification-no-live-sms-whatsapp-providers.mjs`, `check-registry-batch6-no-auto-send.mjs`, `check-registry-batch7-no-auto-send.mjs`, `check-registry-batch11-no-auto-send.mjs`, `check-registry-batch12-no-external-send.mjs`, `check-batch-19a-no-auto-outreach.mjs` |
| Officer-name search rules respect client-signed approval list | `check-batch-19b-officer-name-search.mjs` |
| Personal contacts admin-only; no leakage to general authenticated users | `check-registry-people-personal-contact-leak.mjs` |
| Release gate does NOT default to `production_ready` | `check-batch-18-no-production-ready-default.mjs`, `check-batch-20-release-gate-not-production-ready.mjs` |
| No raw API request/response payloads stored | `check-api-request-logs-no-payloads.mjs` |
| No raw provider payloads exposed | `check-registry-batch4-no-provider-integration.mjs`, `check-registry-batch5-no-provider.mjs`, `check-registry-batch6-no-provider.mjs` |
| No debug / TODO / placeholder strings in registry UI | `check-batch-20-no-debug-in-registry-ui.mjs` |
| Sensitive RLS hardening | `check-sensitive-rls-with-check-true.mjs`, `check-sensitive-column-open-select.mjs` |
| Admin AAL2 coverage across sensitive endpoints | `check-admin-aal2-coverage.mjs` |

## Accepted limitations (carried forward, non-blocking for UAT)

- Live bank-detail provider verification is intentionally deferred —
  bank details remain `captured`, never `verified`.
- Production-mode public API is disabled by default and requires
  documented admin acknowledgement to enable.
- SMS and WhatsApp outreach channels remain Phase 1 disabled.
- Five named sample records are locked `sample_only` and excluded from
  the production API contract.

## Where to go next

- Full UAT scenario walkthrough: [`docs/registry/uat-scenarios.md`](./uat-scenarios.md).
- Internal historical test-maintenance record:
  [`uat-technical-appendix.md`](./uat-technical-appendix.md).
- Release gate matrix and per-module statuses:
  [`docs/registry/release-gate-matrix.md`](./release-gate-matrix.md).
- Central evidence index:
  [`evidence/registry-evidence-index/README.md`](../../evidence/registry-evidence-index/README.md).

## Sign-off wording

This UAT pack is delivered as **UAT / demo-ready, not production-ready.**
Production-readiness requires the deferred items above and a separate
release-gate sign-off, recorded in `RELEASE_GATE.md`.
