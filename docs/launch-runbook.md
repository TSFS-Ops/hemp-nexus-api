# Launch Runbook

> Operational source of truth for production go-live. Combine with `RELEASE_GATE.md` (15-min pre-ship checklist) and `docs/closeout-report.md` (what shipped). This runbook is for the **launch event** and **first 24 hours**.

## 0. Roles & sign-off

| Sign-off | Owner | Evidence required |
|---|---|---|
| Engineering | Lead engineer | `npm run test:regression` green, `npm run build` green, this runbook §1–§6 ticked |
| Compliance / Operations | Ops lead | `docs/deferred-policy-register.md` reviewed, HealthBoard Closeout Drift tile green |
| Client / Izenzo | Client signatory | `docs/handover.md` acknowledged, deferred-policy register signed |

No tier ships without all three sign-offs and attached evidence (terminal output / screenshots).

---

## 1. Pre-launch command list (engineering)

Run **in order**:

```bash
# 1. Repo-contract proof
npm run test:regression        # vitest run src/tests/batch-*.test.ts
npm run build                  # runs all 17 prebuild static guards + vite build
npm run check:drift            # layout/footer/back-button drift

# 2. Optional: full test sweep
bunx vitest run                # everything, including non-batch tests
```

All three must exit 0. Attach the terminal output to the release ticket.

### Prebuild static guards enforced by `npm run build`

- `check-routes.mjs`
- `check-edge-function-paths.mjs`
- `check-no-inline-subject-truncate.mjs`
- `check-docs-no-zar-billing.mjs`
- `check-docs-staleness.mjs`
- `check-operational-visual-tokens.mjs`
- `check-match-lifecycle-mirror.mjs`
- `check-legacy-admin-rls.mjs`
- `check-webhook-callsite-idempotency.mjs`
- `check-fx-no-importers.mjs`
- `check-bypass-callsites.mjs`
- `check-public-page-imports.mjs`
- `check-edge-function-rpc-coverage.mjs`
- `check-csv-export-audit.mjs`
- `check-batch-suite-presence.mjs` (Batch W)
- `check-release-gate-sync.mjs` (Batch W)
- `check-legal-claims.mjs` (DEC-005/006/010)
- `check-aal-registry-drift.mjs` (SEC-001)
- `check-export-audit-payload.mjs` (DATA-010 Phase 1: admin exports require AAL2 + `purpose`/`reason`/`data_categories`/`target_type`; Phase 2 signed-URL/TTL/file-destruction lifecycle deferred)
- `check-user-export-categories.mjs` (DATA-005 Phase 1: user self-export category SSOT drift, forbidden categories blocked, Phase 1 canonical audit names required, Phase 2 names forbidden until lifecycle ships under `DATA-005-FU-EXPORT-LIFECYCLE-001`)
- `check-legal-hold-audit-names.mjs` (DATA-003 Phase 1: legal-hold helper + 8 wired enforcement paths audit-name SSOT drift guard)
- `check-cp003-audit-names.mjs` (CP-003 audit-name parity: signed canonical `outreach_blocked_missing_counterparty_name` paired with legacy `outreach_blocked_missing_name` across 3 emit surfaces + controlled-prod seed)
- `check-data-002-audit-names.mjs` (DATA-002 Phase 1 account self-deletion: dual-write of legacy `account.*` and canonical `data.deletion_window_elapsed` / `data.profile_deleted_or_anonymised` / `data.deletion_deferred_retention_required` audits across `delete-account` and `account-deletion-sweeper`)
- `check-public-availability-claims.mjs` (UI-010 public status & availability-claims guard: verbatim signed holding message on `src/pages/Status.tsx`; forbidden phrases blocked on Status/HeroStripeGlow/PublicHeader/Developers; canonical audit constants `status.public_status_publish_blocked` and `status.admin_health_check_recorded` pinned in `src/lib/status-audit.ts`)
- `check-data-009-residency-claims.mjs` (DATA-009 Phase 1 data-residency truthfulness guard: policy SSOT at `src/lib/policy/data-residency-policy.ts` with the four canonical audit action constants `data.residency_requirement_detected`, `data.unapproved_residency_claim_blocked`, `data.residency_exception_approved`, `data.residency_exception_declined`; forbidden unapproved-residency phrases blocked on public/admin/docs surfaces unless qualified with `separate` + `approval` wording; Phase 2 exception workflow and runtime audit emissions are deferred)
- `check-dec010-generated-doc-claims.mjs` (DEC-010 Phase 1 generated-document claim guard: four claim classifications and three canonical audit action constants pinned in `src/lib/legal/claims-register.ts`; static lint coverage extended to `supabase/functions/deal-certificate/index.ts` and `src/components/developer/IntegrationGuidePdf.ts`; expanded prohibited prose list enforced; admin claim approval workflow + runtime `claims.claim_approved_by_admin` emission deferred to Phase 2 and tested by absence)
- `check-dec-001-004-outreach-governance.mjs` (DEC-001 / DEC-004 Phase 1 outreach-governance guard: SSOTs `src/lib/outreach/dec-001-audit.ts` and `src/lib/outreach/dec-004-states.ts`; canonical DEC-001 actions `pending_engagement.off_platform_outreach_evaluated|sent|blocked` and DEC-004 actions `outreach.manual_follow_up_assigned|action_recorded|owner_reassigned|sla_scan_flagged_manual_follow_up`; ten canonical signed-form outreach states mapped onto live `engagement_status` / `operational_state` / SLA / dispute / late-acceptance / suppressed flags; sole manual-outreach owner `izenzo_platform_admin` with explicit non-owners Vericro / Imperial Tech / payment providers. Dual-write emissions wired in `supabase/functions/poi-engagements/index.ts` and `supabase/functions/outreach-sla-monitor/index.ts` alongside the existing per-reason audits — no legacy audit name removed. `outreach.manual_owner_reassigned` is exported for SSOT completeness but is guaranteed not emitted at runtime; reassignment surface, new DB enum values, and new operational states are Phase 2.)
- `check-engagement-wording.mjs` (DEC-005 engagement-wording guard: bans `auto-decline` phrasing and finality / mutual / sealed wording on the same line as pre-acceptance / late-acceptance / renewed state identifiers across `src/components`, `src/pages`, `src/lib`, and the Supabase email templates.)
- `check-dec-005-006-audit-names.mjs` (DEC-005 / DEC-006 Phase 1 legal-wording audit-name SSOT guard: pins the six canonical audit actions `legal.pre_acceptance_wording_applied`, `legal.unsafe_pre_acceptance_wording_blocked`, `counterparty.acceptance_recorded_wording_state_updated`, `legal.poi_binding_wording_applied`, `legal.unsafe_poi_binding_claim_blocked`, `legal.poi_wording_updated_after_counterparty_acceptance` in `src/lib/legal/dec-005-006-audit.ts`; asserts the verbatim signed wording in `src/lib/legal/pre-acceptance-wording.ts` + `src/lib/legal/poi-wording.ts`. Wording helpers remain pure / side-effect free; Phase 2 dual-write at real wording-application / acceptance-recording surfaces is intentionally deferred.)
- `check-data-005-010-export-lifecycle.mjs` (DATA-005 / DATA-010 Phase 2A shared export lifecycle guard: canonical audit-action SSOT at `src/lib/data/export-lifecycle-audit.ts` and Deno mirror at `supabase/functions/_shared/export-lifecycle-audit.ts` with 13 actions covering request/verify/block/limit/admin-request/admin-approval-required/approved/rejected/prepared/delivered/user-downloaded/admin-downloaded/file-destroyed; user + admin state machines pinned at `src/lib/data/export-state-machine.ts` (+ Deno mirror); redaction SSOT at `src/lib/data/export-redaction.ts` (+ Deno mirror) enforces a 26-column forbidden deny-list and per-category allow-lists; `admin-export-request` and `admin-export-approve` require platform admin + AAL2 server-side and the DB trigger blocks self-approval; `export-destroy` is locked to `destructiveEnabled = false` (daily dry-run cron); Phase 2B — destructive enablement, MFA step-up on user exports, one-time-use signed-URL tokens, legacy `user_export_requests` retirement, org-admin scoped exports — is intentionally deferred.)




### DATA-005 Phase 1 — User self-export of data (subject-access request)

Users can request an export of their personal/account data from
**Desk → Settings → My Data**. Phase 1 captures the request, resolves
which categories are eligible, applies rate-limits and legal/security
hold guards, and writes canonical audit rows:

- `data.user_export_requested`
- `data.user_export_scope_resolved`
- `data.user_export_blocked_or_declined`

Phase 1 does **not** generate a downloadable file. The full lifecycle
(async generation, signed-URL TTL, download audit, file expiry/destruction)
is deferred to `DATA-005-FU-EXPORT-LIFECYCLE-001`, which is intended to
share the signed-URL/storage-TTL module with `DATA-010-FU-EXPORT-LIFECYCLE-001`.

A formal legal/security hold model is deferred to
`DATA-005-FU-LEGAL-HOLD-001`. The Phase 1 helper is future-safe: if the
`legal_holds` table does not exist, it returns "no active hold"; once
the table appears, the existing call-site begins enforcing it without
further code changes.

---

## 2. Backend confirmations (ops)

| Check | How | Pass criterion |
|---|---|---|
| Migrations applied | Compare highest `supabase/migrations/*.sql` timestamp to live DB `schema_migrations` | Live ≥ repo |
| Edge functions deployed | Lovable Cloud → Functions list against `supabase/functions/*` | All present at current commit |
| Secrets configured | `require-secrets` helper response on a probe edge function | `status: "ok"` (or documented `degraded`) |
| Cron heartbeats | `select kind, last_run_at from cron_heartbeats` | All listed jobs ran within their window (see §3) |

### Critical scheduled jobs (must have recent heartbeat)

- `burn-poi-reconciliation`
- `balance-drift-reconciliation`
- `side-effect-reconciliation`
- `transaction-reconciliation`
- `cron-heartbeat-reconcile`
- `sentry-heartbeat`
- `email-log-anonymise`
- `lifecycle-scheduler`

If any heartbeat is stale, do not proceed.

---

## 3. Closeout drift snapshot

```bash
node scripts/closeout-snapshot.mjs
```

- Writes a dated artefact to `docs/closeout/YYYY-MM-DD-closeout-snapshot.md`.
- Calls `public.closeout_drift_summary()` against the live DB env.
- Only treat output as **live evidence** when run against the live DB; the script labels it so.

**Pass criterion:** open critical drift count = 0. Open lower-severity items must be acknowledged in writing in the release ticket.

Cross-check: HealthBoard → Closeout Drift tile is green (not rose, not amber).

---

## 4. Production safety sanity (ops)

| Check | How | Pass criterion |
|---|---|---|
| Test-mode bypass off in prod | `select * from admin_settings where key='test_mode_bypass'` | All flags `false` in production tier |
| Seeders refused | `curl` `seed-daniel-fixtures` on production → expect 403 `SEED_PRODUCTION_REFUSED` | 403 + audit row in `admin_audit_logs` |
| Demo orgs excluded | HQ → Revenue panel header | Shows "demo excluded" flag |
| Billing availability | Desk → Billing panel | Tier shows live USD pricing, no fallback banner |
| Sentry heartbeat | Sentry project → cron monitor | Last beat within 5 min |

---

## 5. Smoke tests (mixed)

Manual smoke per `RELEASE_GATE.md` sections 2–6 plus:

- Sign in → Desk → New Trade Request → save draft → reopen. **Pass:** draft persists.
- Admin → Engagements → open pending row → countdown visible.
- HealthBoard → all tiles render, Closeout Drift = green, no rose tiles.

---

## 6. Rollback

Trigger rollback if **any** of:
- Closeout Drift tile turns rose for >15 min.
- Critical reconciliation risk item opens and does not auto-close in 2 cycles.
- Edge function error rate >2% over 10 min.
- Sentry heartbeat goes stale.

Rollback steps:
1. Lovable: Publish → Update → roll to previous successful publish.
2. Backend migrations: if a migration is at fault, revert by applying a forward-compatible "undo" migration; never `DROP` in production without dual sign-off.
3. Edge functions: redeploy the previous commit's `supabase/functions/*` set.
4. Open a `release_rollback` audit row with the trigger reason.
5. Re-run §3 (closeout snapshot) and confirm drift cleared before re-enabling traffic.

---

## 7. First-24-hour watch

- Poll HealthBoard every 30 min for the first 4 hours, then hourly.
- Check `cron_heartbeats` at T+6h, T+12h, T+24h.
- Re-run `node scripts/closeout-snapshot.mjs` at T+24h and attach to the release ticket.

---

## 8. Evidence to attach before client sign-off

- Output of `npm run test:regression`.
- Output of `npm run build` (showing all prebuild guards green).
- The dated artefact from `scripts/closeout-snapshot.mjs`.
- Screenshot of HealthBoard with Closeout Drift = green.
- `docs/deferred-policy-register.md` with each item annotated **Accepted / Deferred-to-Tplus / Rejected** by the client.
- Sign-off block from §0 completed.
