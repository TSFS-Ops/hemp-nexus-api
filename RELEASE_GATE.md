# Release Gate - 15-Minute Pre-Ship Checklist

> Run this before every production publish. A single ❌ in **Blockers** halts the release.

---

## 1. Automated Checks (~2 min)

```bash
# Must all exit 0
npm run test:regression    # vitest run on src/tests/batch-*.test.ts (batch proof suite)
npm run build              # TypeScript + Vite compilation (runs all prebuild guards below)
npm run check:drift        # Layout/footer/back-button drift guard
npx vitest run             # Full unit + integration sweep
node scripts/closeout-snapshot.mjs   # Writes dated artefact under docs/closeout/ when DB env present
```

After the snapshot script runs against the live DB tier, confirm the
HealthBoard **Closeout Drift** tile is green (`closeout_drift_summary()`
returns zero critical drift) and review
`docs/deferred-policy-register.md` for any items still requiring client
sign-off.

Prebuild guards enforced automatically by `npm run build`:

- `check-routes.mjs` — route registry vs source drift
- `check-edge-function-paths.mjs` — edge invoke paths exist
- `check-no-inline-subject-truncate.mjs` — email subject clamping
- `check-docs-no-zar-billing.mjs` / `check-docs-staleness.mjs` — docs hygiene
- `check-operational-visual-tokens.mjs` — design token usage
- `check-match-lifecycle-mirror.mjs` — lifecycle helper drift
- `check-legacy-admin-rls.mjs` — legacy `admin` role RLS guard
- `check-webhook-callsite-idempotency.mjs` — webhook idempotency
- `check-fx-no-importers.mjs` — FX layer not re-introduced
- `check-bypass-callsites.mjs` — test-mode bypass audit coverage
- `check-public-page-imports.mjs` — public pages don't import auth code
- `check-edge-function-rpc-coverage.mjs` — edge RPCs are migration-backed (Batch U)
- `check-csv-export-audit.mjs` — sensitive CSV exports are audited (Batch U)
- `check-batch-suite-presence.mjs` — every closeout-report batch row has a matching test (Batch W)
- `check-release-gate-sync.mjs` — prebuild scripts + critical cron jobs are documented (Batch W)
- `check-edge-function-deploy-coverage.mjs` — deploy-critical edge functions are backed by source AND named on this page (post-MT-009 Test 1 incident)
- `check-legal-claims.mjs` — DEC-005/006/010 forbidden wording guard on public pages
- `check-aal-registry-drift.mjs` — SEC-001 AAL2 call-site ↔ preflight registry drift guard
- `check-admin-aal2-coverage.mjs` — Batch E governance drift guard: every sensitive admin edge function listed in the script's SENSITIVE registry must import `assertAal2` AND emit a governance/audit writer surface (canonical writer, direct `audit_logs`/`event_store` insert, or shared lifecycle helper); fails the build if any sensitive endpoint is missing either guard. Prebuild-only textual check, not a runtime integration test.
- `check-export-audit-payload.mjs` — DATA-010 Phase 1: admin CSV/JSON exports must carry `purpose`, `reason`, `data_categories`, `target_type`; admin exports require AAL2 server-side; Phase 2 signed-URL/TTL/file-destruction lifecycle is deferred
- `check-user-export-categories.mjs` — DATA-005 Phase 1: user self-export category SSOT (Deno ↔ client mirror) drift guard, forbidden category names blocked, canonical Phase 1 audit names required, Phase 2 audit names forbidden until lifecycle ships
- `check-legal-hold-audit-names.mjs` — DATA-003 Phase 1: legal-hold enforcement audit-name SSOT drift guard across helper + 8 wired enforcement paths
- `check-cp003-audit-names.mjs` — CP-003 audit-name parity guard: signed canonical `pending_engagement.outreach_blocked_missing_counterparty_name` must be emitted alongside legacy `pending_engagement.outreach_blocked_missing_name` across all 3 code surfaces and the controlled-prod seed
- `check-data-002-audit-names.mjs` — DATA-002 Phase 1 account self-deletion audit-name parity: legacy `account.*` and canonical `data.deletion_window_elapsed` / `data.profile_deleted_or_anonymised` / `data.deletion_deferred_retention_required` dual-write contract enforced across `delete-account` and `account-deletion-sweeper` edge functions
- `check-public-availability-claims.mjs` — UI-010 public status & availability-claims guard: enforces the verbatim signed holding message on `src/pages/Status.tsx`, blocks forbidden public availability claims (`SYSTEM: OPERATIONAL`, `uptime`, `live/real-time platform health`, `99.9%`, `99.95%`, `degraded service`, `incident resolved`, `All systems operational`) on the public surfaces (Status, HeroStripeGlow, PublicHeader, Developers), and pins the two canonical audit action constants (`status.public_status_publish_blocked`, `status.admin_health_check_recorded`) in `src/lib/status-audit.ts`
- `check-data-009-residency-claims.mjs` — DATA-009 Phase 1 data-residency truthfulness guard: asserts the policy SSOT `src/lib/policy/data-residency-policy.ts` exists and declares the four canonical audit action names (`data.residency_requirement_detected`, `data.unapproved_residency_claim_blocked`, `data.residency_exception_approved`, `data.residency_exception_declined`); blocks unapproved residency phrases on public/admin/docs surfaces unless qualified with `separate` + `approval` wording or carries the `DATA_009_ALLOW` SSOT marker. Phase 2 (residency_review_required state, onboarding_hold_residency_review stage, runtime emission of the four audit names, approval/decline workflow) is intentionally deferred.
- `check-dec010-generated-doc-claims.mjs` — DEC-010 Phase 1 generated-document claim guard: pins the four claim classifications (`approved_now`, `approved_after_hardening`, `prohibited`, `manual_review_required`) and the three canonical audit action constants (`claims.claim_evaluated`, `claims.unapproved_claim_blocked`, `claims.claim_approved_by_admin`) in `src/lib/legal/claims-register.ts`; extends the public-page forbidden-phrase scan to generated documents (`supabase/functions/deal-certificate/index.ts`, `src/components/developer/IntegrationGuidePdf.ts`); enforces the expanded prohibited prose list (Izenzo replaces legal/financial/regulatory/human review, production-grade audit, regulator-ready audit, demo/test data presented as live traction). Phase 2 admin approval workflow + runtime emission of `claims.claim_approved_by_admin` are intentionally deferred and tested by absence.
- `check-dec-001-004-outreach-governance.mjs` — DEC-001 / DEC-004 Phase 1 outreach-governance guard: pins SSOTs at `src/lib/outreach/dec-001-audit.ts` (canonical actions `pending_engagement.off_platform_outreach_evaluated|sent|blocked` plus the eleven canonical `blocked_reason` discriminators) and `src/lib/outreach/dec-004-states.ts` (sole manual-outreach owner `izenzo_platform_admin`; explicit non-owners Vericro / Imperial Tech / payment providers; the ten canonical signed-form outreach states mapped onto `engagement_status` / `operational_state` / SLA / dispute / late-acceptance / suppressed flags; four canonical audit actions `outreach.manual_follow_up_assigned|action_recorded|owner_reassigned|sla_scan_flagged_manual_follow_up`). Dual-write emissions are wired in `supabase/functions/poi-engagements/index.ts` (evaluated / sent / blocked / manual_follow_up_assigned / manual_follow_up_action_recorded) and `supabase/functions/outreach-sla-monitor/index.ts` (sla_scan_flagged_manual_follow_up) alongside the existing per-reason audits — no legacy audit name is removed. `outreach.manual_owner_reassigned` is declared for SSOT completeness only and is guaranteed (by guard + test) NOT to be emitted at runtime because no reassignment surface exists; Phase 2 (reassignment surface, new DB enum values, new operational states) is intentionally deferred.
- `check-engagement-wording.mjs` — DEC-005 engagement-wording guard: bans the `auto-decline` phrasing in user-facing source and blocks finality / mutual / sealed wording that appears on the same line as pre-acceptance / late-acceptance / renewed engagement-state identifiers. Runs across `src/components`, `src/pages`, `src/lib`, and the Supabase email templates.
 - `check-dec-005-006-audit-names.mjs` — DEC-005 / DEC-006 Phase 1 legal-wording audit-name SSOT guard: pins the six canonical audit action constants in `src/lib/legal/dec-005-006-audit.ts` (`legal.pre_acceptance_wording_applied`, `legal.unsafe_pre_acceptance_wording_blocked`, `counterparty.acceptance_recorded_wording_state_updated`, `legal.poi_binding_wording_applied`, `legal.unsafe_poi_binding_claim_blocked`, `legal.poi_wording_updated_after_counterparty_acceptance`) and asserts the signed wording in `src/lib/legal/pre-acceptance-wording.ts` + `src/lib/legal/poi-wording.ts` (Pending Engagement label, initiator copy, outreach invitation copy, Draft POI label, Accepted POI label, post-acceptance qualifier) remains verbatim. Phase 1 is SSOT-only — wording helpers (`assertPreAcceptanceSafe`, `assertPoiWordingSafe`, `getPoiLabel`) are pure / side-effect free with no runtime callers, so no fake audit IO is emitted; Phase 2 (real dual-write at wording-application / acceptance-recording surfaces) is intentionally deferred.
- `check-data-005-010-export-lifecycle.mjs` — DATA-005 / DATA-010 Phase 2A shared export lifecycle guard: pins the canonical audit-action SSOT at `src/lib/data/export-lifecycle-audit.ts` and its Deno mirror at `supabase/functions/_shared/export-lifecycle-audit.ts` (13 actions: `data.export_request_received`, `data.export_requester_verified`, `data.export_blocked_verification_failed`, `data.export_limited_retention_or_confidentiality_required`, `data.admin_export_requested`, `data.admin_export_approval_required`, `data.admin_export_approved`, `data.admin_export_rejected`, `data.export_prepared`, `data.export_delivered`, `data.user_export_downloaded`, `data.admin_export_downloaded`, `data.export_file_destroyed`); pins the user/admin state machines at `src/lib/data/export-state-machine.ts` (+ Deno mirror) and the redaction SSOT at `src/lib/data/export-redaction.ts` (+ Deno mirror) with its 26-column forbidden deny-list and explicit allow-lists per category; asserts the `export-destroy` edge function remains `destructiveEnabled = false` (dry-run only) and that `admin-export-request` / `admin-export-approve` server-side require platform admin + AAL2. Phase 2B (destructive cron enablement, MFA step-up on user exports, one-time-use download tokens, legacy `user_export_requests` retirement, org-admin scoped exports) is intentionally deferred.
- `check-mt012-audit-names.mjs` — MT-012 trade-request archive audit-name SSOT drift guard: pins the four canonical audit actions (`trade_request.archive_blocked_active_child_matches`, `trade_request.archived_admin_override_active_children`, `trade_request.archived_normal`, `trade_request.admin_exception_hold_released`) in `src/lib/trade-request/mt-012-audit.ts` and its Deno mirror `supabase/functions/_shared/mt-012-audit.ts`; asserts the MT-012 migration body emits all four canonical names; asserts the migration body does not reference any payment / credit-ledger surface (`atomic_token_burn`, `token_ledger`, `credits.purchased`, `credits.granted`, `payment_intents`, `paystack`).
- `check-mt012-progression-coverage.mjs` — MT-012 progression-guard coverage pin: asserts the five protected progression surfaces (`poi-engagements`, `poi-transition`, `wad`, `p3-wad`, `collapse`) still import `assertMatchProgressable`; asserts `supabase/functions/_shared/match-progression-guard.ts` still recognises the `parent_archived_admin_exception_hold` marker; asserts the three MT-012 edge functions (`trade-request-archive`, `admin-trade-request-archive-override`, `admin-trade-request-exception-hold-release`) reference no payment / credit surfaces in non-comment code.
- `check-dec-007-pay-009-audit-names.mjs` — DEC-007 / PAY-009 Phase 2 billing-governance audit-name SSOT drift guard: pins the 13 canonical audit action constants (`billing.refund_requested|approved|declined|blocked_credits_used|blocked_expired`, `billing.credit_adjustment_recorded`, `billing.payment_dispute_detected|resolved_won|resolved_lost`, `billing.credits_frozen_due_to_dispute`, `billing.used_credits_marked_billing_review`, `billing.org_billing_hold_applied|released`) in `src/lib/policy/dec-007-pay-009-audit.ts` AND its Deno mirror at `supabase/functions/_shared/dec-007-pay-009-audit.ts`.
- `check-dec-007-pay-009-guard-coverage.mjs` — DEC-007 / PAY-009 Phase 2 billing-hold guard coverage: asserts `_shared/billing-hold-guard.ts` exists; asserts `token-purchase/index.ts` wires `assertNoBillingHold` + the `BILLING_HOLD_ACTIVE` short-circuit at checkout init; asserts at least one migration installs the `BILLING_HOLD_ACTIVE` short-circuit inside `atomic_token_burn`; asserts all seven admin/governance edge functions (`admin-refund-approve|decline`, `admin-payment-dispute-record|resolve-won|resolve-lost`, `admin-billing-hold-apply|release`) import `assertAal2` and return `NOT_PLATFORM_ADMIN` + `REASON_REQUIRED`; asserts `AdminBillingReviewPanel.tsx` imports the canonical `DEC_007_PAY_009_ADMIN_DISCLAIMER` copy.
- `check-dec-007-pay-009-no-ledger-delete.mjs` — DEC-007 / PAY-009 Phase 2 ledger-integrity guard: forbids `DELETE FROM token_ledger|audit_logs|matches|poi|wads` and `.from('token_ledger'|'audit_logs'|'matches'|'poi'|'wads').delete()` patterns across all nine DEC-007 / PAY-009 surfaces (`refund-request`, `admin-refund-approve|decline`, `admin-payment-dispute-record|resolve-won|resolve-lost`, `admin-billing-hold-apply|release`, `_shared/billing-hold-guard.ts`). Burned credits are append-only flagged via `payment_dispute_affected_burns`; ledger / POI / WaD / audit history is never deleted or rewritten.
- `check-basic-memory-vocab-drift.mjs` — Basic Memory Record v1 closed-vocab drift guard: pins the v1 trigger types (`finality.collapsed`, `wad.sealed`, `dispute.resolved`), outcomes (`completed`, `wad_sealed`, `dispute_resolved`), reason codes (`collapse_recorded`, `attestations_complete`, `dispute_resolved`) and environment classification (`live`, `demo`, `test`) in `src/lib/basic-memory/outcomes.ts`. Mirrors the CHECK constraints on `public.basic_memory_records`; any change here must be paired with a migration changing the CHECK constraints.
- `check-identity-audit-names.mjs` — Batch 4 Enterprise Identity audit-name SSOT drift guard: pins the 10 canonical `identity.*` audit names (`sso_config_created`, `sso_metadata_updated`, `sso_domains_updated`, `sso_connection_tested`, `sso_enabled`, `sso_disabled`, `sso_failed`, `scim_user_provisioned`, `scim_user_suspended`, `scim_user_deprovisioned`) and asserts that the edge SSOT (`supabase/functions/_shared/identity-audit.ts`) and the browser mirror (`src/lib/identity/identity-audit.ts`) stay in lockstep. Any change to the identity audit vocabulary must be paired here.
- `check-evidence-secret-leaks.mjs` — Smoke-evidence secret-leak scanner: scans `evidence/`, `playwright-report/`, and `test-results/` for Supabase `service_role` JWTs (decoded payload match), `SUPABASE_SERVICE_ROLE_KEY` / `SERVICE_ROLE_KEY` / `INTERNAL_CRON_KEY` env-style assignments, `otpauth://` provisioning URIs, labelled TOTP/MFA codes, and `sk_live_…` / `sk_test_…` secret keys. Anonymous/authenticated JWTs are allow-listed. Runs in `prebuild` and again inside `scripts/pack-evidence.mjs` so a tainted run cannot be zipped or shipped.
- `check-tenant-boundary-audit-names.mjs` — Batch 5 · Stage 1 Tenant-Boundary Evidence Pack audit-name drift guard: pins the canonical action `governance.tenant_boundary.probe_completed` to `supabase/functions/tenant-boundary-probe/index.ts` and forbids drifted spellings. Any change to the probe's emitted audit name must be paired here.
- `check-data-org-retention-audit-names.mjs` — DATA-004 Phase 1 (Per-Org Retention shell) audit-name drift guard: pins canonical actions `data.org_retention_policy.set` and `data.org_retention_policy.cleared` to `supabase/functions/admin-org-retention/index.ts` and asserts both are emitted via the `ORG_RETENTION_AUDIT_NAMES` constant (no inline strings). Any change to the per-org retention audit vocabulary must be paired here.
- `check-data-004-phase2-no-enforcement.mjs` — DATA-004 Phase 2 non-enforcement guard (still active for all deferred sweepers): scans `storage-retention-cleanup`, `account-deletion-sweeper`, `cold-storage-archive`, and `email-log-anonymise` for references to `org_retention_policies` or `get_effective_retention_days`. Phase 3 relaxed this guard for `purge-email-send-log-daily` ONLY — every other sweeper remains forbidden from consuming per-org retention until its own sign-off.
- `check-data-004-phase3-enforcement-scope.mjs` — DATA-004 Phase 3 enforcement-scope guard: asserts ONLY `purge-email-send-log-daily` imports `_shared/retention-decision.ts` or references `org_retention_policies` / `get_effective_retention_days`. Any additional sweeper consuming per-org retention without a paired guard relaxation fails the build.
- `check-data-004-phase3-audit-names.mjs` — DATA-004 Phase 3 / 3.1 audit-name SSOT: pins the 5 canonical names `data.retention_job.email_send_log.{started,completed,partial,failed,skipped}` to `purge-email-send-log-daily/index.ts` AND pins the per-name persistence map (`skipped`=`audit_logs_per_org`, `started`/`completed`/`partial`/`failed`=`evidence_only`). Phase 3.1 hardening: the lifecycle events are recorded on `retention_run_evidence.details.lifecycle_event_name` (canonical lifecycle source of truth); only per-org `skipped` rows persist to `public.audit_logs`. Any vocabulary OR persistence change must be paired here AND with a test that proves the new persistence.
- `check-data-004-phase3-2-no-schedule.mjs` — DATA-004 Phase 3.2 scheduling-readiness guard: scans every `supabase/migrations/**.sql` (comment-stripped) and fails the build if any migration installs an ACTIVE `cron.schedule(...)` or `net.http_post(...)` referencing `purge-email-send-log-daily`; pins the sweeper's `dry_run=true` default + `RETENTION_JOB_AUDIT_PERSISTENCE` lifecycle=`evidence_only` / skipped=`audit_logs_per_org` map; requires `RELEASE_GATE.md` and `docs/launch-runbook.md` to carry a `DATA-004 Phase 3.2` section, the verbatim phrase "pg_cron is NOT scheduled", the words "scheduling readiness", "scheduled dry-run", "rollback", and "separate approval"; blocks drift phrasing that would imply pg_cron is active for the sweeper. Comments inside SQL (`-- …` lines and `/​* … *​/` blocks) are stripped before scanning so the disabled docs-only template in the runbook does not trip the guard.




### Edge functions requiring deploy

Every name below is enforced by `scripts/check-edge-function-deploy-coverage.mjs`
against `scripts/edge-function-deploy-manifest.json`. Confirm each one is
live in the production runtime before publishing.

- `match-named-contacts-assign` — MT-009 Phase 2 controlled named-contact assign (frontend-invoked from `AssignNamedContactDialog`)
- `seed-mt009-controlled-prod` — MT-009 controlled-production demo seeder (admin/curl only)
- `unseed-mt009-controlled-prod` — MT-009 controlled-production demo cleanup (admin/curl only)
- `seed-cp002-controlled-prod` — CP-002 controlled-production demo seeder (admin/curl only)
- `unseed-cp002-controlled-prod` — CP-002 controlled-production demo cleanup (admin/curl only)
- `seed-cp009-controlled-prod` — CP-009 / DEC-003 controlled-production late-acceptance fixture seeder (admin/curl only)
- `unseed-cp009-controlled-prod` — CP-009 / DEC-003 controlled-production fixture cleanup (admin/curl only)
- `admin-legal-hold` — SEC-001 / DATA-003 Platform Admin legal-hold apply/release (AAL2 + reason required)
- `user-export-request` — DATA-005 Desk → My Data user-initiated export request
- `export-prepare` — DATA-005 / DATA-010 export preparation worker (cron + admin curl)
- `export-download` — DATA-005 / DATA-010 signed export download endpoint
- `residency-review-request` — DATA-009 Desk-user residency review submission
- `admin-residency-review-approve` — DATA-009 Platform Admin residency review approval (AAL2 + reason required)
- `admin-residency-review-decline` — DATA-009 Platform Admin residency review decline (AAL2 + reason required)
- `admin-billing-hold-apply` — DEC-007 / PAY-009 Platform Admin billing hold apply (AAL2 + reason required)
- `admin-billing-hold-release` — DEC-007 / PAY-009 Platform Admin billing hold release (AAL2 + reason required)
- `admin-refund-approve` — DEC-007 Platform Admin refund approval (AAL2 + reason required)
- `admin-refund-decline` — DEC-007 Platform Admin refund decline (AAL2 + reason required)
- `admin-payment-dispute-record` — PAY-009 Platform Admin manual payment-dispute record (AAL2 + reason required)
- `admin-payment-dispute-resolve-won` — PAY-009 Platform Admin payment-dispute resolve-won (AAL2 + reason required)
- `admin-payment-dispute-resolve-lost` — PAY-009 Platform Admin payment-dispute resolve-lost (AAL2 + reason required)
- `basic-memory-record-write` — Basic Memory Record v1 internal writer (server-to-server only: called by `collapse`, `wad`, `poi-engagements` via `_shared/basic-memory.ts`; rejects browser callers with 401; must be live for Batch 3 hooks to record `finality.collapsed` / `wad.sealed` / `dispute.resolved` Memory rows)
- `list-org-purchases` — DEC-007 read-only listing of caller's org token_purchases + open refund_requests; powers the "Request refund" affordance on `/desk/billing` (no provider mutation)



Closeout & handover artefacts (must be reviewed before client sign-off):

- `docs/closeout-report.md` — batch A–V completion table with test pins
- `docs/deferred-policy-register.md` — client-owned policy decisions
- `docs/launch-runbook.md` — go-live procedure, cron heartbeats, Sentry, demo exclusion, seeders refused in prod, rollback, sign-off matrix
- `docs/handover.md` — non-technical client summary

**Blocker:** Any command exits non-zero.

---

## 2. Auth & Permissions (~3 min)

| Check | Route | Expected |
|-------|-------|----------|
| Unauthenticated landing | `/` | Landing page renders, no console errors |
| Sign-in flow | `/auth` | Email/password login succeeds, redirects to `/dashboard` |
| Dashboard guard | `/dashboard` (logged out) | Shows "Please sign in" prompt, not a flash of dashboard |
| Admin guard | `/admin` (non-admin user) | Redirects to `/dashboard`, no admin UI flicker |
| Sign-out | Sidebar → Sign Out | Clears session, returns to landing |
| Session expiry | Close tab, wait 5 min, reopen `/dashboard` | Either restores session or shows sign-in cleanly |

**Blocker:** Admin content visible to non-admin. Dashboard visible without auth.

---

## 3. Critical Flows (~4 min)

### Trading Partner Search
1. `/dashboard/search` → enter a known entity name → results appear
2. Click a result → detail loads without error

### Match Lifecycle
1. `/dashboard/matches` → list loads (or shows empty state if none)
2. Click a match → `/dashboard/matches/:id` → tabs render (Documents, Notes, Deal Terms)
3. Upload a document → verify file appears in list (test with `.pdf` and reject a `.exe` renamed to `.pdf`)

### Settings & Account
1. `/dashboard/settings` → all tabs render
2. `/dashboard/account` → profile form loads, org details visible

### Admin (requires admin account)
1. `/admin` → Overview tab loads with stats
2. Switch to Entities, Matches, Audit tabs → data loads or shows empty state
3. Checkpoint verification -> "DD Only" mode completes without errors

**Blocker:** Search returns unhandled error. Match detail crashes. File upload bypasses validation.

---

## 4. Loading / Error / Empty States (~2 min)

| Scenario | How to test | Expected |
|----------|-------------|----------|
| Slow load | Throttle to "Slow 3G" in DevTools → `/dashboard` | `FullPageLoader` spinner, no layout shift |
| API failure | Block `*supabase*` in DevTools Network → reload `/dashboard/matches` | `ErrorState` card with retry button |
| Empty data | New account with no matches → `/dashboard/matches` | "No matches yet" empty state, not a blank page |
| Edge function down | `/dashboard/search` with backend offline | Inline error with retry, not silent failure |

**Blocker:** Blank page on any failure. Silent data loss.

---

## 5. Visual & Responsive (~2 min)

### Desktop (1280px+)
- [ ] Landing hero layout intact, no overflow
- [ ] Dashboard sidebar collapses/expands correctly
- [ ] Admin tables don't horizontally overflow

### Mobile (390px)
- [ ] Landing page scrollable, CTA visible without horizontal scroll
- [ ] Dashboard sidebar becomes sheet/drawer
- [ ] Match detail tabs stack or scroll horizontally
- [ ] All modals/dialogs fit viewport

### Dark Mode
- [ ] Toggle theme → no white flashes, text remains readable
- [ ] Cards and badges maintain contrast

**Blocker:** Content unreachable on mobile. Unreadable text in either theme.

---

## 6. Console & Network Hygiene (~1 min)

- [ ] No `console.error` on initial load of `/`, `/dashboard`, `/admin`
- [ ] No failed network requests (red in DevTools) on happy path
- [ ] No `401` responses when authenticated
- [ ] No secrets/tokens visible in client-side source or network payloads

**Blocker:** Leaked secrets. Auth errors on valid session.

---

## 7. Drift & Consistency (~1 min)

- [ ] `npm run check:drift` passes (no raw footers, no inline back-buttons)
- [ ] All page titles use `<PageContainer>` (spot-check 3 pages)
- [ ] All authenticated pages use `RequireAuth` or `useAuth` guard

**Blocker:** Drift violations detected.

---

## Release Blocker Summary

A release is **blocked** if any of these are true:

1. `npm run build` fails
2. `npm run check:drift` fails
3. Any test suite fails
4. Admin UI visible to non-admin users
5. Dashboard accessible without authentication
6. Blank page on any error/loading/empty state
7. Content unreachable on mobile viewport
8. Secrets exposed in client bundle or network
9. File upload accepts spoofed MIME types
10. Silent data loss (form submission fails without user feedback)

---

## Post-Publish Verification

After clicking **Publish → Update**:

1. Visit published URL → landing loads
2. Sign in → dashboard loads
3. Open browser console → no errors
4. Test on actual mobile device if possible

> **Estimated time:** 12–15 minutes for full pass.

## COMP-002 / COMP-012 Phase 2A (compliance freshness gates)
- Sanctions freshness threshold = 30 days; verification freshness = 365 days.
- `compliance_holds` table + `operator_verification_requests.compliance_hold_id` link.
- Shared guard `supabase/functions/_shared/compliance-freshness-guard.ts` wired into `wad`, `p3-wad`, `collapse` after MT/engagement guards.
- Admin release/close edge fns: `admin-compliance-hold-release`, `admin-compliance-hold-close` (platform_admin + AAL2 + reason ≥ 20 chars; no payment/credit side effects).
- HQ → Compliance Holds tab (`AdminComplianceHoldPanel`).
- Prebuild guards: `check-comp-002-012-audit-names.mjs`, `check-comp-002-012-thresholds.mjs`, `check-comp-002-012-guard-coverage.mjs`.
- Phase 2B deferred: cron auto-open, baseline backfill notifications, broad `notification-dispatch` suppression.

## OPS-010 Phase 2A (Controlled Demo Workspace)
- Schema: `is_demo` + `demo_dataset_id` on 18 tables; `demo_workspaces` registry; `enforce_demo_inheritance_trg` rejects mixed live/demo with `DEMO_BOUNDARY_VIOLATION`.
- SECDEF RPCs (service_role only, platform_admin + AAL2 + reason ≥ 20): `create_demo_workspace`, `reset_demo_workspace`, `archive_demo_workspace`.
- Demo guard (`supabase/functions/_shared/demo-mode-guard.ts`) + entry helper (`_shared/demo-mode-entry.ts`) wired into:
  - Primary chokepoints: `send-transactional-email` (zero outbound), `token-purchase` (no live Paystack), `dilisense-screen` (deterministic CLEAR).
  - Secondary chokepoints: `paystack-webhook`, `admin-credit-org`, `idv-verify`, `ubo-verify`, `wad`, `p3-wad`, `collapse`, `deal-certificate`, `evidence-pack`, `webhooks`, `webhook-retry`, `webhook-events`, `export-prepare`, `export-download`.
- Artefact surfaces (WaD / p3-WaD / collapse / certificate / evidence pack / export) stamp `markDemoArtifact` with `DEMO — NOT A PRODUCTION ARTEFACT` watermark + `non_production: true` + `DEMO_` seal prefix → never substitutable for live production artefacts.
- Email policy: zero outbound for demo orgs. Demo email attempts are audit-only via `ops.demo_outreach_blocked`.
- Global `<DemoModeBanner />` mounted in `src/App.tsx` beneath `TestModeBanner`.
- HQ → "Demo Workspaces" tab (`AdminDemoWorkspacesPanel`).
- Prebuild guards: `check-ops-010-audit-names.mjs`, `check-ops-010-guard-coverage.mjs`, `check-ops-010-demo-boundary.mjs`.
- Phase 2B deferred: cron-driven dataset cleanup, demo-aware live-dashboard filters, allowlisted internal inbox for demo email preview, screenshot watermark renderer on UI artefact previews.

## DATA-009 Phase 2 — residency review workflow

Prebuild guards enforced:
- `scripts/check-data-009-phase2-audit-emission.mjs`
- `scripts/check-data-009-phase2-no-technical-side-effects.mjs`
- `scripts/check-data-009-phase2-guard-coverage.mjs`

Approval records the policy exception only. No automatic data migration,
region split, backup change, export restriction, deletion, or re-hosting
occurs as a result of a residency request. Any technical change requires
a separate engineering decision.

## DATA-004 Phase 3.2 — scheduling readiness (pg_cron NOT scheduled)

Phase 3.2 is **scheduling readiness only**. It does NOT schedule
`purge-email-send-log-daily` under pg_cron, does NOT wire any new sweeper,
does NOT change `email-log-anonymise`, does NOT broaden enforcement beyond
`email_send_log`, and does NOT flip the default `dry_run=true`.

Enforcement scope is unchanged from Phase 3.1:

- `purge-email-send-log-daily` is the **only** sweeper consuming
  `org_retention_policies`.
- Invocation is manual / service-role only.
- `dry_run=true` is the default.
- All other sweepers (`storage-retention-cleanup`,
  `account-deletion-sweeper`, `cold-storage-archive`, retention sentinel
  paths, `email-log-anonymise`) remain deferred and forbidden from
  consuming per-org retention.

### Scheduling readiness gate (must ALL be true before any pg_cron migration is even drafted)

A future scheduling batch may only be opened once **every** item below is
ticked and recorded. Each item is operator-verifiable today.

- [ ] Phase 3.1 operator evidence run has passed (dry-run + controlled live
      fixture) and is recorded.
- [ ] Latest **dry-run** `retention_run_evidence` row reviewed.
- [ ] Latest **controlled live fixture** `retention_run_evidence` row
      reviewed.
- [ ] HQ → Retention & Holds → Retention Health shows the latest
      `status='success'` or `status='partial'` run, with `dry_run=true`.
- [ ] `rows_skipped_missing_policy` count for the latest run is
      understood and explicitly accepted by the operator. Missing-policy
      orgs MUST remain `rows_purged=0`.
- [ ] `rows_skipped_legal_hold` count for the latest run is understood
      and explicitly accepted by the operator.
- [ ] `audit_write_failures[]` on the latest run is empty, OR the
      non-empty contents are explicitly waived in writing by the
      operator with a recorded reason.
- [ ] `evidence_write_failures[]` on the latest run is empty, OR the
      non-empty contents are explicitly waived in writing by the
      operator with a recorded reason.
- [ ] `npm run build` passes with `check-data-004-phase3-enforcement-scope.mjs`
      green — confirming only `purge-email-send-log-daily` consumes
      `org_retention_policies`.
- [ ] `npm run build` passes with `check-data-004-phase2-no-enforcement.mjs`
      green — confirming every other sweeper remains unwired.
- [ ] `npm run build` passes with `check-data-004-phase3-2-no-schedule.mjs`
      green — confirming no migration carries an active schedule and the
      readiness gate is documented.
- [ ] **Explicit human approval** is recorded before any pg_cron
      migration is even authored. Recording the approval is a precondition,
      not a post-hoc justification.
- [ ] A **separate, second** explicit human approval is recorded before
      moving from "scheduled dry-run" to "scheduled live purge".

Until every box above is ticked, **no pg_cron schedule may be added** —
not active, not "temporarily disabled but live in the migration file",
not via a guard-bypassing one-off RPC, and not via a manual SQL
console run.
