# Closeout Report — Compliance Matching Platform

> **Status:** Repo-contract closeout complete. **Live production readiness still requires running the release gate and HealthBoard checks against the live environment.** Source-pinned tests prove repo contracts; they do not prove a healthy production database, deployed edge functions, or applied migrations.

## Executive summary (non-technical)

Twenty-two work batches (A through V) have been hardened, pinned with automated tests, and locked behind static guards. The platform now has:

- A canonical role/state/lifecycle model with database-level invariants.
- Audited, idempotent commercial transitions (POI mint, token burn, engagement accept).
- A reconciliation spine that detects ledger drift, orphaned POIs/WaDs, and missing notification/webhook side-effects, surfaces them as admin risk items, and auto-closes them when drift clears.
- Production safety locks: test-mode bypass is refused in production, demo orgs are excluded from revenue, seeders refuse to run in production, Break-Glass requires AAL2.
- A HealthBoard "Closeout Drift" tile backed by `public.closeout_drift_summary()` that fails-rose on RPC error (no false green).
- Fifteen prebuild static guards that block the build if drift is introduced.

What this report **does not** claim: that the live production database is healthy right now, that all migrations are applied to the live tier, or that policy decisions deferred to the client have been made. Those are tracked in the deferred policy register and the launch runbook.

## How to read this report

- **Status** is one of: COMPLETE (shipped + pinned), PARTIAL (shipped with documented gaps), POLICY-PENDING (awaits client decision).
- **Tests** link the pinning suite. Run them with `npm run test:regression`.
- **Deferred** lists items split off to `docs/deferred-policy-register.md`.

## Batch completion table (A–V)

| Batch | Title | Status | Test pin | Deferred |
|---|---|---|---|---|
| A | Operational truthfulness (Stage 1 UI) | COMPLETE | `src/tests/batch-a-stage1-operational-truthfulness.test.tsx`, `src/tests/batch-a-ui.test.ts` | — |
| B | Frozen roles, schema, RPCs, engagement guard, reconfirmation | COMPLETE | `src/tests/batch-b-*.test.ts(x)` (10 files) | — |
| C | Payment idempotency + schema/RLS | COMPLETE | `src/tests/batch-c-payment-idempotency.test.ts`, `batch-c-phase1-schema-rls.test.ts` | — |
| D | Webhook reliability + reconfirm idempotency | COMPLETE | `src/tests/batch-d-webhook-reliability.test.ts`, `batch-d-test-6-reconfirm-idempotency.test.ts` | — |
| E | Outreach blocked emit, UI reasons, by-match hardening, upload session | COMPLETE | `src/tests/batch-e-*.test.ts(x)` (4 files) | — |
| F | Event coverage, external resilience, UI surfacing | COMPLETE | `src/tests/batch-f-*.test.ts` (3 files) | — |
| G | Financial controls, observability and retirement | COMPLETE | `src/tests/batch-g-*.test.ts` (2 files) | — |
| H | Refund / FX legacy preservation | COMPLETE | `src/tests/batch-h-refund-fx-legacy.test.ts` | — |
| I | Compliance gate consistency + outreach drillthrough | COMPLETE | `src/tests/batch-i-*.test.ts` (2 files) | — |
| J | Anonymous route access, dispute late-cancel, match challenges AAL2, org-name resolution | COMPLETE | `src/tests/batch-j-*.test.ts(x)` (4 files) | — |
| K | Lifecycle consistency + outreach CSV export | COMPLETE | `src/tests/batch-k-*.test.ts` (2 files) | — |
| L | Document evidence validation + export clarity | COMPLETE | `src/tests/batch-l-*.test.ts` (2 files) | — |
| M | Notification prefs, count fallback/cache, outreach precise count | COMPLETE | `src/tests/batch-m-*.test.ts(x)` (4 files) | template/routing matrix → deferred |
| N | API/webhook security, outreach auto-refresh + ops polish | COMPLETE | `src/tests/batch-n-*.test.ts` (3 files) | — |
| O | Data retention/privacy, MT008 fixtures, source guards, detection/archive/repair RPCs | COMPLETE | `src/tests/batch-o-*.test.ts` (7 files) | email-log anonymise retention window → deferred |
| P | Role membership authority | COMPLETE | `src/tests/batch-p-role-membership-authority.test.ts` | — |
| Q | Discovery / matching quality | COMPLETE | `src/tests/batch-q-discovery-matching-quality.test.ts` | canonical counterparty rules → deferred |
| R | Programme workflow consistency | COMPLETE | `src/tests/batch-r-programme-workflow-consistency.test.ts` | jurisdiction mismatch block vs warn → deferred |
| S | Support / manual intervention | COMPLETE | `src/tests/batch-s-support-manual-intervention.test.ts` | Break-Glass extra policy → deferred |
| T | UI truthfulness, dashboards, reporting accuracy | COMPLETE | `src/tests/batch-t-ui-report-truthfulness.test.ts` | demo hide-default vs operator toggle, AAL2 block-vs-warn per export → deferred |
| U | Production safety, test-mode, secrets, deployment gates | COMPLETE | `src/tests/batch-u-prod-safety.test.ts` | required-vs-optional secret classification → deferred |
| V | Final reconciliation, orphaned state, closeout readiness | COMPLETE | `src/tests/batch-v-final-reconciliation.test.ts` | auto-close of risk items as system actor → deferred |
| W | Closeout proof pack, regression lock | COMPLETE | `src/tests/batch-w-closeout-artefacts.test.ts` | final public launch wording → deferred |

## Key shipped controls (cross-batch)

- **Role & state SSOT**: `getMatchRole`, `match-state.ts`, `wad-state.ts`, `completion-engine.ts`; DB trigger `matches_role_invariant_trg` blocks same-org-both-sides and orphan-creator.
- **Atomic commercial primitives**: `atomic_generate_poi_v2`, `atomic_token_burn`, `atomic_accept_bind`, `atomic_engagement_transition`, `atomic_validate_governance_doc` — all service-role-only EXECUTE.
- **Reconciliation jobs**: `burn-poi-reconciliation`, `balance-drift-reconciliation`, `side-effect-reconciliation`, `transaction-reconciliation`, all registered in `cron_heartbeats`, surface to `admin_risk_items`, auto-close via `reconciliation_auto_close`.
- **Closeout signal**: `public.closeout_drift_summary()` + HealthBoard Closeout Drift tile (fails rose on RPC error).
- **Production safety**: `isProductionTier()`, seed/unseed refusal (`SEED_PRODUCTION_REFUSED` + audit row), `require-secrets` helper (presence-only, never logs values).
- **Audit hardening**: Break-Glass requires AAL2 via `assertAal2` and captures `actor_ip` + `user_agent`; transaction-reconciliation supports `dry_run` + per-record before/after snapshots.
- **Export audit**: `auditedDownloadCSV` enforced via `scripts/check-csv-export-audit.mjs`; CSV preamble carries `generated_at`, `demo_excluded`, `aal_required` where relevant.
- **Webhook integrity**: `triggerWebhooks` requires `eventIdempotencyKey` (static guard); `webhook_replay_guard` ledger + daily prune.
- **Prebuild static guards (15)**: routes, edge-paths, subject-truncate, docs-zar, docs-staleness, visual-tokens, lifecycle-mirror, legacy-admin-rls, webhook-callsite-idempotency, fx-no-importers, bypass-callsites, public-page-imports, edge-function-rpc-coverage, csv-export-audit, plus (Batch W) batch-suite-presence and release-gate-sync.

## Disclaimer — what tests prove vs do not prove

**Prove** (when `npm run test:regression` passes):
- Repo-pinned contracts: function signatures, status enums, RPC presence in migrations, prebuild guards, file-presence of audit helpers, CSV preamble format, role/state allow-lists.

**Do not prove** without running against the live environment:
- That migrations are applied to the live database.
- That edge functions are deployed at the current commit.
- That cron schedules are active and heartbeats are green.
- That secrets are configured in the live tier.
- That `closeout_drift_summary()` currently returns zero critical drift.

For live evidence, run `node scripts/closeout-snapshot.mjs` against the live DB env and follow `docs/launch-runbook.md`.

## Remaining count framing

Remaining issues at handover: **10**, all classified as **policy-pending** (client decision) rather than engineering blockers. See `docs/deferred-policy-register.md`.

## Regression command

```bash
npm run test:regression   # vitest run src/tests/batch-*.test.ts
```

## P-4 Governance Record closeout

- [P-4 Governance Record Closeout Proof Pack](./p4-governance-record-closeout-proof-pack.md) — evidence index for the 18/18 admin HQ atomicity claim, UI surface, canonical writer, corrections, waivers, AAL2 coverage, deferred items.
- [P-4 Safe Claim Language](./p4-governance-record-safe-claim-language.md) — approved client-facing wording plus explicit do-not-claim list.
- [Governance Rollback Proof](./governance-rollback-proof.md) — how to run the live DB rollback proof against a staging tier.

