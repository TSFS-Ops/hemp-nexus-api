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
- `check-admin-aal2-coverage.mjs` (Batch E governance drift guard: sensitive admin edge functions must carry both `assertAal2` and a governance/audit writer surface; prebuild-only textual check)
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
- `check-mt012-audit-names.mjs` (MT-012 trade-request archive audit-name SSOT drift guard: four canonical audit actions `trade_request.archive_blocked_active_child_matches`, `trade_request.archived_admin_override_active_children`, `trade_request.archived_normal`, `trade_request.admin_exception_hold_released` pinned across `src/lib/trade-request/mt-012-audit.ts` and `supabase/functions/_shared/mt-012-audit.ts`; MT-012 migration body emits all four; no payment/credit surface referenced in the migration.)
- `check-mt012-progression-coverage.mjs` (MT-012 progression-guard coverage pin: protected surfaces `poi-engagements`, `poi-transition`, `wad`, `p3-wad`, `collapse` still import `assertMatchProgressable`; `parent_archived_admin_exception_hold` marker still recognised by `match-progression-guard.ts`; the three MT-012 edge functions reference no payment/credit surfaces in non-comment code.)




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

## COMP-002 / COMP-012 Phase 2A
Compliance freshness gates active synchronously at WaD / p3-WaD / collapse. Sanctions stale > 30d or verification stale > 365d → 409 with canonical code, opens `compliance_holds` row + Verification Queue item, emits canonical audit. Admin release/close require platform_admin + AAL2 + ≥20-char reason. Cron auto-open and baseline notifications deferred to Phase 2B.

## OPS-010 Demo workspace operations
- Create/reset/archive demo workspaces via HQ → Demo Workspaces (`AdminDemoWorkspacesPanel`). Each action requires platform_admin, AAL2, and a reason ≥ 20 characters.
- The deterministic seeder (`seed-ops010-demo-workspace`) populates buyer/seller orgs, trade requests, matches and ledger entries using the `ops010-` dataset prefix. Never seeds real client / CP fixture names.
- Live external calls are short-circuited at the edge-function boundary by `_shared/demo-mode-entry.ts`. Audited as `ops.demo_*` actions.
- Demo artefacts (WaD, p3-WaD, collapse, deal certificate, evidence pack, exports) carry the `DEMO — NOT A PRODUCTION ARTEFACT` watermark and a `DEMO_` seal prefix.
- Email policy: zero outbound for demo orgs (Phase 2A). Verified by `check-ops-010-guard-coverage.mjs`.
- Prebuild guards: `check-ops-010-audit-names.mjs`, `check-ops-010-guard-coverage.mjs`, `check-ops-010-demo-boundary.mjs`.

## DATA-009 Phase 2 — residency review workflow

- Org submits requirement via `residency-review-request` edge function.
- Platform admin reviews in HQ → Residency Reviews tab.
- Approve / decline via `admin-residency-review-approve` /
  `admin-residency-review-decline` edge functions (AAL2 + reason ≥ 20).
- Open hold blocks: `export-prepare`, `export-download`, `wad`, `p3-wad`,
  `collapse`, `deal-certificate`, `evidence-pack`.
- Approval is a POLICY EXCEPTION ONLY. No hosting/region/backup/export/
  deletion side effect is performed.

Prebuild guards:
- `scripts/check-data-009-phase2-audit-emission.mjs`
- `scripts/check-data-009-phase2-no-technical-side-effects.mjs`
- `scripts/check-data-009-phase2-guard-coverage.mjs`

### DEC-007 / PAY-009 — Refund & payment-dispute governance (Phase 2)

- Org self-serve refund: `POST /functions/v1/refund-request` (authenticated
  org member). Calls `request_refund` SECDEF RPC — auto-blocks when
  credits are fully burned (`blocked_credits_used`) or purchase is older
  than 180 days (`blocked_expired`). Approval/decline by platform admin in
  HQ → Billing Review tab via `admin-refund-approve` /
  `admin-refund-decline` (AAL2 + reason ≥ 20).
- Refund approval emits an append-only `administrative_adjustment` row on
  `token_ledger`. Existing burned credits are NEVER deleted or rewritten.
- Paystack webhook (`token-purchase/webhook`) routes `charge.dispute.create`
  through `record_payment_dispute` (idempotent on
  `provider_dispute_reference`), and `charge.dispute.resolve` (won) through
  `resolve_payment_dispute_won`. Lost dispute resolution from webhook only
  records a `billing.payment_dispute_resolved_lost` audit-detection row and
  defers the formal RPC resolution to admin AAL2 review in HQ → Billing
  Review (prevents double ledger debit alongside the legacy chargeback path).
- Billing hold (`organizations.billing_hold = true`) blocks new
  `token-purchase` checkouts (`BILLING_HOLD_ACTIVE`) AND blocks every
  `atomic_token_burn` call across the platform (POI mint, WaD, collapse).
  Apply/release via `admin-billing-hold-apply` / `admin-billing-hold-release`
  (AAL2 + reason ≥ 20). Auto-released when last open dispute resolves won.

Prebuild guards:
- `scripts/check-dec-007-pay-009-audit-names.mjs`
- `scripts/check-dec-007-pay-009-guard-coverage.mjs`
- `scripts/check-dec-007-pay-009-no-ledger-delete.mjs`

## Batch 4 — Enterprise Identity (SSO/SAML shell + SCIM lifecycle)

Status: BATCH_4_CODE_READY — staging operator verification required. Live SSO claim is only permitted when `ssoClaimAllowed()` returns true (status=live AND last_test_result=pass AND supabase_sso_provider_id set AND last_tested_at set). Promotion to `status=live` is gated by `org-sso-test-connection` and independently enforced by the `tg_org_sso_configs_guard_live_status` DB trigger. No custom SAML; no external SCIM HTTP endpoint.

Prebuild guards:
- `scripts/check-identity-audit-names.mjs`
- `scripts/check-tenant-boundary-audit-names.mjs`
- `scripts/check-data-org-retention-audit-names.mjs`

## DATA-004 — Per-Org Retention (Phase 1 shell + Phase 2 evidence + Phase 3 partial enforcement + Phase 3.1 evidence hardening)

Status: **DATA-004 Phase 3.1 LIVE — PARTIAL ENFORCEMENT ONLY. Only `email_send_log` is wired to `org_retention_policies`. All other retention jobs remain deferred. pg_cron is NOT scheduled.**

Surfaces:
- HQ → Retention & Holds → **Per-Org Retention** (Phase 1 editor — `platform_admin` + AAL2; values recorded + audited; DB enforces ≥ platform floor).
- HQ → Retention & Holds → **Retention Health** (Phase 2 + Phase 3 + Phase 3.1 evidence — `platform_admin`, no AAL2; reports `enforcement_status: "partial_enforcement_email_send_log_only"`, surfaces the latest `retention_run_evidence` row for the wired sweeper, including missing-policy / disabled-policy / invalid-policy / legal-hold / error skip counts, and any audit/evidence write-failure warning from the latest run).

Canonical names:
- Phase 1 (policy mutation — persist to `audit_logs`, pinned by `check-data-org-retention-audit-names.mjs`):
  - `data.org_retention_policy.set`
  - `data.org_retention_policy.cleared`
- Phase 3 / 3.1 (wired sweeper, pinned by `check-data-004-phase3-audit-names.mjs`):
  - `data.retention_job.email_send_log.skipped` — **persists to `audit_logs`** with real per-org `org_id` (one row per skipped org per run).
  - `data.retention_job.email_send_log.started` / `.completed` / `.partial` / `.failed` — **run-level lifecycle events, EVIDENCE-ONLY.** Recorded on `retention_run_evidence` rows via `details.lifecycle_event_name`. They do NOT persist to `audit_logs` because `audit_logs.org_id` is NOT NULL and there is no platform-system org. The canonical lifecycle source of truth is `retention_run_evidence`.

Phase 3.1 evidence-hardening contract (must hold):
- The sweeper enumerates orgs from **candidate `email_send_log` rows** via the read-only helper `discover_email_send_log_candidate_orgs(p_limit)` (service_role EXECUTE only). Orgs without an explicit retention policy are visible in `retention_run_evidence` as `skipped_due_to_missing_policy` instead of being silently protected by absence-from-iteration.
- Per-org `skipped` audit writes are tracked; on failure the run records an inline `audit_write_failed` evidence row AND surfaces an `audit_write_failures[]` array on both the run-final `retention_run_evidence.details` and the function response. Audit failures are never silently swallowed.
- Evidence-write failures are also tracked in `evidence_write_failures[]` and surfaced in the response.
- Lifecycle events remain evidence-only — the sweeper does NOT call any audit writer with `org_id: null`.

Phase 3 enforcement contract (still holds):
- ONLY `purge-email-send-log-daily` is wired to per-org retention. Enforced by `scripts/check-data-004-phase3-enforcement-scope.mjs`.
- All other retention jobs remain DEFERRED and forbidden from consuming `org_retention_policies` / `get_effective_retention_days`:
  - `storage-retention-cleanup`
  - `account-deletion-sweeper`
  - `cold-storage-archive`
  - retention enforcement sentinel paths
  - `email-log-anonymise` (remains global-floor, untouched)
  - Enforced by `scripts/check-data-004-phase2-no-enforcement.mjs` (still active for the deferred list above).
- `purge-email-send-log-daily` is **manually / service-role invocable only**. **pg_cron is NOT scheduled.**
- `dry_run=true` is the default. A live purge requires deliberate operator invocation with `dry_run=false`.
- Fail-closed: missing, disabled, or invalid policy aborts the org with `skipped` evidence — never silent deletion-approval.
- Active org-scoped legal hold (`legal_holds.status='active'`, `scope_type='org'`) blocks purge and writes `skipped` evidence.
- Every run writes append-only rows to `retention_run_evidence` (rows seen / purged / skipped / status / dry_run / job_name).

### Operator checklist — manual verification of `purge-email-send-log-daily`

1. Create or confirm an explicit valid `email_send_log` retention policy for a test org via HQ → Per-Org Retention (AAL2 required; `retention_days ≥ 90`).
2. Confirm a separate org with **no explicit policy** AND candidate email_send_log rows produces an explicit `skipped_due_to_missing_policy` row in `retention_run_evidence` on the next run (Phase 3.1 hardening).
3. Confirm an active org-scoped legal hold on a third test org skips the purge for that org (`status='skipped'`, `decision='skipped_due_to_legal_hold'`).
4. Invoke `purge-email-send-log-daily` via service-role / curl with `{ "dry_run": true }` (the default). Confirm the function returns 200 and writes a `status='started'` evidence row with `details.lifecycle_event_name='data.retention_job.email_send_log.started'`.
5. Inspect `retention_run_evidence` for the new run: per-org rows must include `rows_seen`, `rows_purged=0` (dry-run), populated skip counters per decision, and `dry_run=true`.
6. Confirm HQ → Retention & Holds → Retention Health shows the latest run, including missing-policy / disabled-policy / invalid-policy / legal-hold / error skip counters.
7. Only after dry-run evidence is clean, optionally re-invoke in a controlled fixture with `{ "dry_run": false }`. Treat this as a deliberate operator action.
8. Confirm post-live-run evidence shows `rows_purged > 0` ONLY for eligible orgs (explicit valid policy, no active legal hold). Skipped/failed orgs must remain at `rows_purged=0`.
9. Confirm no other record class or sweeper was touched: `storage-retention-cleanup`, `account-deletion-sweeper`, `cold-storage-archive`, `email-log-anonymise`, and retention sentinel paths must show no new activity tied to per-org retention.
10. Confirm response/evidence `audit_write_failures` and `evidence_write_failures` arrays are empty. If non-empty, treat as a hard alert before scheduling.

Phase 4+ (deferred — do NOT start without explicit sign-off):
- Scheduling `purge-email-send-log-daily` under pg_cron.
- Wiring any additional sweeper (storage / account deletion / cold storage / sentinel / `email-log-anonymise`) to `org_retention_policies`. Each must be its own batch, with per-job negative-path tests, evidence, and an explicit guard relaxation.

Prebuild guards:
- `scripts/check-data-org-retention-audit-names.mjs`
- `scripts/check-data-004-phase2-no-enforcement.mjs` (deferred sweepers stay forbidden)
- `scripts/check-data-004-phase3-enforcement-scope.mjs` (only `purge-email-send-log-daily` may consume per-org retention)
- `scripts/check-data-004-phase3-audit-names.mjs` (5 canonical names + persistence map: `skipped`=audit_logs_per_org, lifecycle=evidence_only)

Vitest:
- `src/tests/data-004-phase2-evidence-guard.test.ts`
- `src/tests/data-004-phase3-enforcement-guard.test.ts` (covers Phase 3.1 hardening: candidate discovery, lifecycle persistence map, no run-level audit writes, audit/evidence write-failure surfacing)



## DATA-004 Phase 3.2 — scheduling readiness (historical, superseded by Phase 4)

Status: **Phase 3.2 SUPERSEDED — see DATA-004 Phase 4 below for the current scheduled-dry-run state. Phase 3.2 was scheduling readiness only with no pg_cron schedule; that gate has now been ticked and Phase 4 added a dry-run-only schedule. The Phase 3.2 readiness checklist remains the historical sign-off record. Live purge is NOT scheduled.**

Phase 3.2 prepares the platform for a future scheduling decision without
making any destructive behaviour automatic.

### What Phase 3.2 changes

- HQ Retention Health response now carries an explicit
  `scheduling_status: "phase_3_1_verified_pg_cron_pending_approval"` and a
  `scheduling_notes` object stating `pg_cron_scheduled: false`,
  `invocation_mode: "manual_service_role_only"`,
  `dry_run_default: true`. HQ Retention Health panel surfaces this
  readiness state in the top banner so no operator can misread "wired"
  as "scheduled".
- `scripts/check-data-004-phase3-2-no-schedule.mjs` is wired into
  `npm run build` and fails the build if any migration installs an
  active `cron.schedule(...purge-email-send-log-daily...)` /
  `net.http_post(...purge-email-send-log-daily...)`; if the sweeper's
  `dry_run` default flips away from `true`; if the lifecycle persistence
  classification stops being `evidence_only`; or if the
  readiness-gate language drifts in `RELEASE_GATE.md` /
  `docs/launch-runbook.md`.

### What Phase 3.2 does NOT change

- No pg_cron schedule.
- No new sweeper wired.
- No change to `email-log-anonymise`.
- No change to retention floors.
- No change to the `dry_run=true` default.
- No org-admin mutation of retention policies.
- No automation of any destructive behaviour.

### Scheduling readiness gate

See `RELEASE_GATE.md` → "DATA-004 Phase 3.2 — scheduling readiness" for
the operator checklist that must ALL be ticked before any future
pg_cron migration is authored. Every box is operator-verifiable today.

### Future scheduling sequence (documented, NOT implemented)

This sequence is documented so the future scheduling batch is unambiguous.
Phase 3.2 does NOT execute any of it.

**Step A — scheduled dry-run only** (separate batch, separate approval):

- Schedule `purge-email-send-log-daily` under pg_cron with
  `{ "dry_run": true }`. No rows can be purged.
- Define a minimum observation window (e.g. 7 consecutive successful runs
  with zero `audit_write_failures[]` / `evidence_write_failures[]`)
  before live scheduling is even considered.
- Each scheduled run must create a `retention_run_evidence` row.
- HQ → Retention & Holds → Retention Health must show the latest run.
- Missing-policy, legal-hold, and error skip counters must be reviewed
  before each progression decision.

**Step B — scheduled live purge** (separate batch, separate approval, only after Step A stability):

- Only after Step A stability has been independently reviewed.
- Requires a second, separate human approval recorded in the release gate.
- Fail-closed behaviour, legal-hold checks, and audit/evidence failure
  visibility must be unchanged.
- Rollback instructions must be tested in a non-production fixture before
  the live schedule is committed.

### pg_cron migration template (DOCS-ONLY, DISABLED)

The SQL below is intentionally inside a Markdown code fence so it is
**not** an executable migration. The build guard
(`check-data-004-phase3-2-no-schedule.mjs`) strips SQL comments before
scanning `supabase/migrations/**.sql`; an actual migration file containing
this body would still trip the guard because the file path
(`supabase/migrations/...`) is what the guard scans, not docs files.
Copy this template into a real migration **only after every box in the
Phase 3.2 readiness gate is ticked** and the explicit human approval is
recorded.

#### Step A — scheduled dry-run schedule (future, not committed)

```sql
-- DATA-004 Phase 4 (FUTURE — DO NOT APPLY UNTIL PHASE 3.2 GATE IS TICKED).
-- Schedules purge-email-send-log-daily under pg_cron with dry_run=true.
-- A LIVE purge schedule is a SEPARATE, LATER migration with its OWN approval.
--
-- Required extensions (must already be enabled):
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- Secrets / headers:
--   - INTERNAL_CRON_KEY  (preferred — least-privilege)
--   - or SUPABASE_SERVICE_ROLE_KEY (only if INTERNAL_CRON_KEY is not yet rotated)
--   - Content-Type: application/json
--
-- Cadence: daily 03:17 UTC (off-peak; avoids cleanly-rounded clashes).
--
-- DO NOT REMOVE THE dry_run=true BODY UNTIL STEP B IS APPROVED.
SELECT cron.schedule(
  'purge-email-send-log-daily-dry-run',
  '17 3 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/purge-email-send-log-daily',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-internal-cron-key', '<INTERNAL_CRON_KEY>'
    ),
    body    := jsonb_build_object('dry_run', true)
  ) AS request_id;
  $$
);
```

#### Step B — scheduled live purge (future, SEPARATE migration, SEPARATE approval)

```sql
-- DATA-004 Phase 4b (FUTURE — REQUIRES SEPARATE APPROVAL after Step A stability).
-- Replaces the dry-run schedule with the live purge.
-- Live purge requires the SECOND explicit approval recorded in RELEASE_GATE.md.
SELECT cron.unschedule('purge-email-send-log-daily-dry-run');

SELECT cron.schedule(
  'purge-email-send-log-daily',
  '17 3 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/purge-email-send-log-daily',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-internal-cron-key', '<INTERNAL_CRON_KEY>'
    ),
    body    := jsonb_build_object('dry_run', false)
  ) AS request_id;
  $$
);
```

#### Rollback / unschedule

```sql
-- Cancel either the dry-run or the live schedule (whichever is installed).
SELECT cron.unschedule('purge-email-send-log-daily-dry-run');
SELECT cron.unschedule('purge-email-send-log-daily');

-- Verify nothing is scheduled for the sweeper:
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN ('purge-email-send-log-daily-dry-run', 'purge-email-send-log-daily');
```

#### Evidence query — verify the latest run after each scheduled tick

```sql
SELECT id, started_at, finished_at, status, dry_run,
       rows_seen, rows_eligible, rows_purged,
       rows_skipped_missing_policy, rows_skipped_disabled_policy,
       rows_skipped_invalid_policy, rows_skipped_legal_hold,
       rows_skipped_error,
       details -> 'lifecycle_event_name'      AS lifecycle_event_name,
       details -> 'audit_write_failures'      AS audit_write_failures,
       details -> 'evidence_write_failures'   AS evidence_write_failures
FROM public.retention_run_evidence
WHERE job_name = 'purge-email-send-log-daily'
ORDER BY started_at DESC
LIMIT 5;
```

### Prebuild guards (Phase 3.2 additions)

- `scripts/check-data-004-phase3-2-no-schedule.mjs` (new) — blocks active
  schedule migrations, pins `dry_run=true` default, pins lifecycle
  `evidence_only` persistence, and pins the readiness-gate language in
  this runbook and `RELEASE_GATE.md`.

Vitest:

- `src/tests/data-004-phase3-enforcement-guard.test.ts` is extended with
  Phase 3.2 assertions: the guard exists, the sweeper's `dry_run` default
  remains `true`, the lifecycle persistence map remains `evidence_only`,
  HQ Retention Health renders the scheduling-readiness banner, and the
  readiness-gate language is present in both docs.
