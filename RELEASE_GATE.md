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
  - `check-ai-review-audit-names.mjs` — AI Counterparty Intelligence & Match Review audit-name SSOT drift guard: pins the canonical `ai_review.*` action codes across the Deno SSOT (`supabase/functions/_shared/ai-review-audit.ts`) and the browser mirror (`src/lib/ai-review/audit-names.ts`), and forbids any non-canonical `ai_review.<something>` literal under `supabase/functions/ai-*`, `src/lib/ai-review`, or `src/components/admin`. Any change to the AI review audit vocabulary must be paired here.
 - `check-facilitation-case-audit-names.mjs` — Unknown-Counterparty Facilitation Queue (Phase 1) audit-name SSOT drift guard: pins the 7 canonical `facilitation_case.*` action codes (`created`, `assigned`, `status_changed`, `note_added`, `evidence_uploaded`, `closed`, `cancelled_by_requester`) across the Deno SSOT (`supabase/functions/_shared/facilitation-case-state.ts`) and the browser mirror (`src/lib/facilitation-case-state.ts`) and forbids any non-canonical `facilitation_case.<x>` literal anywhere under `supabase/functions/` or `src/`.
 - `check-facilitation-no-send-path.mjs` — Phase 1 hard guarantee for the facilitation queue: scans the 5 facilitation edge function directories and every `*facilitation*` client surface for forbidden patterns (`send-transactional-email`, `notification-dispatch`, Resend/SendGrid/Twilio/SMTP, `atomic_generate_poi*`, `atomic_token_*`, `atomic_accept_bind`, `atomic_engagement_transition`, and direct `.insert(` against `wads` / `matches` / `pois` / `token_ledger` / `token_purchases`). Phase 1 must not introduce outreach, notification, or POI/WaD/match/token/credit/payment mutation paths.
  - `check-facilitation-status-drift.mjs` — Phase 1 facilitation state-machine drift guard: asserts the `INTERNAL_STATUSES`, `OUTCOMES`, and `FACILITATION_AUDIT_NAMES` lists in `src/lib/facilitation-case-state.ts` are byte-identical in order and content to the Deno SSOT in `supabase/functions/_shared/facilitation-case-state.ts`.
  - `check-facilitation-outreach-drift.mjs` — Phase 2 facilitation outreach SSOT drift guard: asserts that the `OUTREACH_GATE_RESULTS`, `OUTREACH_TEMPLATE_STATUSES`, `OUTREACH_CANDIDATE_STATUSES`, `OUTREACH_SEND_STATUSES`, `OUTREACH_ESCALATION_STATUSES`, `DNC_RULE_TYPES`, and the canonical `facilitation_outreach.*` / `facilitation.dnc.*` audit-name lists in `src/lib/facilitation-outreach-constants.ts` are byte-identical in order and content to the Deno SSOT in `supabase/functions/_shared/facilitation-outreach-constants.ts`, and that no facilitation outreach surface lives outside the permitted client/edge directories.
  - `check-facilitation-outreach-audit-names.mjs` — Phase 2 facilitation outreach edge-function audit-name + mutation guard: pins the 10 canonical `facilitation_outreach.*` action codes (`template_status_changed`, `candidate_added`, `candidate_gate_evaluated`, `send_attempted`, `send_succeeded`, `send_blocked`, `send_idempotent_replay`, `escalation_opened`, `escalation_resolved`, `escalation_reopened`) across the Phase 2 edge functions (`facilitation-outreach-template-status`, `facilitation-outreach-candidate-add`, `facilitation-outreach-send`, `facilitation-outreach-escalate`, `facilitation-outreach-escalation-resolve`) and forbids any banned mutation path (POI / WaD / matches / token / credit / payment / poi_engagements / compliance_cases) inside those functions, and asserts the Resend send path exists only in `facilitation-outreach-send`.
  - `check-facilitation-dnc-audit-names.mjs` — Phase 2 Step 5 DNC audit-name guard: pins the canonical `facilitation.dnc.rule_added` and `facilitation.dnc.rule_revoked` action codes to the two DNC edge functions (`facilitation-outreach-dnc-add`, `facilitation-outreach-dnc-revoke`), asserts the resolver constants stay aligned, and forbids any banned mutation path inside the DNC functions.
  - `check-facilitation-sla-drift.mjs` — Batch 7 facilitation SLA SSOT drift guard: asserts that `src/lib/facilitation-sla.ts` and `supabase/functions/_shared/facilitation-sla.ts` keep the same SLA window constants, warning codes, and reminder cadence so the SLA evaluator, drawer panel, and queue badges cannot drift.
  - `check-evidence-pack-seal-contract.mjs` — Facilitation Batch 10 evidence-pack SHA-256 sealing contract guard: asserts the canonical-JSON seal helper exists, is invoked by `facilitation-export-evidence-pack`, and the export response returns `{ pack, seal }` with the digest computed over the pack object. Forbids regressions to unsealed exports.
  - `check-invite-unopened-detector-contract.mjs` — Facilitation Batch 11 Invite-Unopened detector contract guard: asserts `facilitation-invite-unopened-detector` is `INTERNAL_CRON_KEY`-gated, dry-run by default, uses the pinned `invite_unopened_3bd` next-step kind + `facilitation_case.invite_unopened_flagged` audit name, and contains no send / dispatch / POI / WaD / match / token / payment mutation paths and no `facilitation_cases` status mutation.
  - `check-facilitation-template-editor-contract.mjs` — Facilitation Batch 12 Admin Notification Template Editor contract guard: asserts the editor (`facilitation-template-editor`) exposes only the three actions `create_draft` / `update_draft` / `submit_for_approval`, never sends/dispatches anything, never approves a template, never edits approved or archived templates (race-guard `status='draft'`), the existing approval function blocks drafter-self-approval (`DRAFTER_CANNOT_APPROVE_SELF`), the two `facilitation_template.draft_created` / `facilitation_template.draft_updated` audit names are pinned in both server + browser SSOTs, and the editor never imports the requester-safe notification trigger catalogue (`REQUESTER_SAFE_NOTIFICATION_TRIGGERS`).
  - `check-email-anonymisation-readiness-contract.mjs` — DATA-004 Batch 20 Email Anonymisation Readiness Assessment contract guard: asserts the `email-anonymisation-readiness-probe` edge function is assessment-only — gated to `platform_admin` + AAL2/MFA, short-circuits on the `email_send_log_anonymise` record-group legal hold, never calls `.from('email_send_log')`, never invokes the `anonymise_old_email_send_log` RPC, contains no SELECT/UPDATE/DELETE/INSERT/UPSERT/TRUNCATE/ALTER against `email_send_log`, returns a static schema-level disposition inventory + a pinned `READINESS_VERDICT` only (no PII fields keyed from a row), pins the canonical audit name `data.email_anonymisation_readiness_probed` and writes it to `audit_logs`. No anonymisation pathway is created or activated; no scheduler entry is committed.
  - `check-governance-record-coverage-contract.mjs` — Governance Record Batch 1 Critical-Event Coverage Audit contract guard: asserts the `governance-record-coverage-probe` edge function is assessment-only — gated to `platform_admin` + AAL2/MFA (registered in `aal-preflight` as `governance.event_store.coverage_probe`), never calls `.from('event_store')`, contains no SELECT/UPDATE/DELETE/INSERT/UPSERT/TRUNCATE/ALTER against `event_store`, never imports any critical-event writer (`writeCriticalGovernanceEvent` / `writeGovernanceEventBestEffort` / `writeCriticalEventWithPosture`), never introspects `information_schema` / `pg_catalog` at runtime, returns a static `COVERAGE_MATRIX` with the controlled status vocabulary (`wired` / `partial` / `audit_logs_only` / `unwired` / `not_applicable` / `unknown_needs_manual_review`) and per-row evidence citations, pins the canonical audit name `governance.event_store.coverage_probed` (one and only one new name) and writes it to `audit_logs`. No UI surface; no client-side import of the probe; no `pg_cron` schedule; no fail-closed runtime enforcement.
  - `check-wad-seal-canonical-emission-contract.mjs` — Governance Record Batch 2 WaD Seal Event-Store Wiring contract guard: asserts `supabase/functions/wad/index.ts` emits canonical `wad.passed` to `event_store` exactly once on the UI seal path via `writeGovernanceEventBestEffort` (best-effort / fail-open — NOT fail-closed), uses `aggregate_type:"wad"` and the stable idempotency key `` `${wadId}|wad.passed|seal` ``, stamps `WAD_POLICY_VERSION` in both `posture_snapshot` and `metadata`, never references `canonical_payload_json` in the payload, never emits `wad.failed` from the UI seal path, preserves the legacy `writeAuditLog("wad.sealed", …)` + `writeBasicMemoryRecord` + `emitRevenueNotification` hooks, orders the canonical write AFTER the `wads` UPDATE to `status='sealed'` and AFTER `writeAuditLog("wad.sealed", …)` and BEFORE the basic-memory + revenue-notify hooks, never introduces `atomic_wad_seal` / `writeCriticalGovernanceEvent` / `writeCriticalEventWithPosture` in `wad/index.ts`, and forbids any TS-level duplicate `wad.passed` / `wad.failed` writer in `p3-wad/index.ts` (atomic RPC remains the sole emitter there). Classification: `WAD_SEAL_EVENT_STORE_VISIBILITY_ADDED_BEST_EFFORT_NOT_ATOMIC_FAIL_CLOSED`. Full fail-closed seal enforcement deferred to a future atomic seal batch (`WAD_SEAL_FULL_ATOMIC_FAIL_CLOSED_ENFORCEMENT_REQUIRES_FUTURE_ATOMIC_WAD_SEAL_SCOPE`).
  - `check-evidence-secret-leaks.mjs` — Smoke-evidence secret-leak scanner: scans `evidence/`, `playwright-report/`, and `test-results/` for Supabase `service_role` JWTs (decoded payload match), `SUPABASE_SERVICE_ROLE_KEY` / `SERVICE_ROLE_KEY` / `INTERNAL_CRON_KEY` env-style assignments, `otpauth://` provisioning URIs, labelled TOTP/MFA codes, and `sk_live_…` / `sk_test_…` secret keys. Anonymous/authenticated JWTs are allow-listed. Runs in `prebuild` and again inside `scripts/pack-evidence.mjs` so a tainted run cannot be zipped or shipped.
  - `check-public-api-audit-names.mjs` — Public API V1 Sand/Prod canonical audit-name SSOT parity guard: asserts every canonical Public API V1 audit name from the Sandbox/Production Separation workstream (sandbox/production key lifecycle: `api.sandbox_key.*`, `api.production_key.*`; production access approval: `api.production_access.*`; webhook taxonomy: `api.webhook.endpoint.*`, `api.webhook.test.sent`, `api.webhook.delivery.*`, `api.webhook.production.*`) is present somewhere in `supabase/functions/**`, so drift between the documented scope brief and the deployed edge functions fails the build. Legacy `api_key.*` / `api_key.v1.*` events remain accepted for back-compat with earlier batches and are NOT enforced here.
  - `check-ui-surface-coverage.mjs` — UI surface coverage guard: asserts every exported `*Panel` / `*Dashboard` / `*Viewer` component under `src/components/admin` and `src/components/developer` is mounted as a JSX tag somewhere else in `src/` (HQ.tsx, DeveloperCenter.tsx, parent panels, etc.). Catches backend-facing panels that land in the repo but are never wired to a real UI surface. Intentionally internal components must be listed in `scripts/ui-surface-coverage-allowlist.json` with a short reason; stale allowlist entries also fail the build.
  - `check-ui-route-coverage.mjs` — Route-level UI surface coverage guard: builds the static import graph of `src/**`, seeds it from every file that declares a `<Route ... />` JSX element, and asserts every exported `*Panel` / `*Dashboard` / `*Viewer` under `src/components/admin` and `src/components/developer` lies inside that transitive route-reachable closure. Catches panels that are mounted as JSX but only inside other unreachable surfaces — i.e. backend endpoints that should render a UI view but cannot actually be opened from any URL. Intentionally non-route-reachable components must be listed in `scripts/ui-route-coverage-allowlist.json` with a short reason; stale entries also fail the build.
  - `check-api-request-logs-no-payloads.mjs` — API Usage Dashboard V1 · Batch 1 hardening guard: asserts no code under `supabase/functions/**` or `src/**` writes `request_body` or `response_body` into `api_request_logs` via `.insert()` / `.update()` / `.upsert()`. Defence-in-depth alongside the DB trigger `api_request_logs_strip_payloads`, which hard-nulls those columns on insert and update. Maintains the "no raw payloads stored" invariant for the Public API V1 request log.
- `check-tenant-boundary-audit-names.mjs` — Batch 5 · Stage 1 Tenant-Boundary Evidence Pack audit-name drift guard: pins the canonical action `governance.tenant_boundary.probe_completed` to `supabase/functions/tenant-boundary-probe/index.ts` and forbids drifted spellings. Any change to the probe's emitted audit name must be paired here.
- `check-data-org-retention-audit-names.mjs` — DATA-004 Phase 1 (Per-Org Retention shell) audit-name drift guard: pins canonical actions `data.org_retention_policy.set` and `data.org_retention_policy.cleared` to `supabase/functions/admin-org-retention/index.ts` and asserts both are emitted via the `ORG_RETENTION_AUDIT_NAMES` constant (no inline strings). Any change to the per-org retention audit vocabulary must be paired here.
- `check-data-004-phase2-no-enforcement.mjs` — DATA-004 Phase 2 non-enforcement guard (still active for all deferred sweepers): scans `storage-retention-cleanup`, `account-deletion-sweeper`, `cold-storage-archive`, and `email-log-anonymise` for references to `org_retention_policies` or `get_effective_retention_days`. Phase 3 relaxed this guard for `purge-email-send-log-daily` ONLY — every other sweeper remains forbidden from consuming per-org retention until its own sign-off.
- `check-data-004-phase3-enforcement-scope.mjs` — DATA-004 Phase 3 enforcement-scope guard: asserts ONLY `purge-email-send-log-daily` imports `_shared/retention-decision.ts` or references `org_retention_policies` / `get_effective_retention_days`. Any additional sweeper consuming per-org retention without a paired guard relaxation fails the build.
- `check-data-004-phase3-audit-names.mjs` — DATA-004 Phase 3 / 3.1 audit-name SSOT: pins the 5 canonical names `data.retention_job.email_send_log.{started,completed,partial,failed,skipped}` to `purge-email-send-log-daily/index.ts` AND pins the per-name persistence map (`skipped`=`audit_logs_per_org`, `started`/`completed`/`partial`/`failed`=`evidence_only`). Phase 3.1 hardening: the lifecycle events are recorded on `retention_run_evidence.details.lifecycle_event_name` (canonical lifecycle source of truth); only per-org `skipped` rows persist to `public.audit_logs`. Any vocabulary OR persistence change must be paired here AND with a test that proves the new persistence.
- `check-data-004-phase3-2-no-schedule.mjs` — DATA-004 Phase 3.2 scheduling-readiness guard: scans every `supabase/migrations/**.sql` (comment-stripped) and fails the build if any migration installs an ACTIVE `cron.schedule(...)` or `net.http_post(...)` referencing `purge-email-send-log-daily`; pins the sweeper's `dry_run=true` default + `RETENTION_JOB_AUDIT_PERSISTENCE` lifecycle=`evidence_only` / skipped=`audit_logs_per_org` map; requires `RELEASE_GATE.md` and `docs/launch-runbook.md` to carry a `DATA-004 Phase 3.2` section, the verbatim phrase "pg_cron is NOT scheduled", the words "scheduling readiness", "scheduled dry-run", "rollback", and "separate approval"; blocks drift phrasing that would imply pg_cron is active for the sweeper. Comments inside SQL (`-- …` lines and `/​* … *​/` blocks) are stripped before scanning so the disabled docs-only template in the runbook does not trip the guard.
- `check-stub-providers-parity.mjs` — P010 Stub Provider Labelling parity guard: asserts the browser SSOT (`src/lib/stub-providers.ts`) and edge SSOT (`supabase/functions/_shared/stub-providers.ts`) stay byte-aligned on the set of non-live providers (CIPC, Onfido, Dow Jones, Refinitiv), their "not live yet" labels, and the forbidden status vocabulary (`verified` / `cleared` / `passed` / `screened`) that stub paths must never emit. Pairs with the server-side gate in `idv-verify` and `dilisense-screen` that returns HTTP 503 `STUB_PROVIDER_NOT_LIVE` for any stub-provider invocation.
- `check-stub-provider-copy-drift.mjs` — P010 hardening build-time copy-drift guard: scans `src/components`, `src/pages`, and `docs` for any file that names a stub provider (CIPC / Onfido / Dow Jones / Refinitiv) alongside forbidden P010 wording (`verified`, `cleared`, `passed`, `approved`, `screened`, `provider-confirmed`, `provider_confirmed`, `provider-approved`, `provider_approved`, `provider_matched`, `live_check_complete`, plus phrase-form `verification complete` / `screening complete` / `provider check passed` / `provider match found` / `external check complete`). Exempts the SSOT, P010 tests, the admin diagnostic panels, and the internal infrastructure spec.
- `check-poi-verification-gate-wiring.mjs` — POI Verification Guardrails / Draft-Only Mode wiring guard: asserts every formal POI / counterparty-facing entrypoint (`pois`, `poi-transition`, `poi-engagements`, `match`, `wad`, `p3-wad`) imports both `checkOrgLegitimacy` and `checkUserPoiAuthority`, and that the service-role admin paths (`facilitation-poi-conversion`, `export-prepare`, `export-download`) at minimum import `checkOrgLegitimacy`. Every gated function must also reference the canonical reason code `POI_ORG_VERIFICATION_REQUIRED`. Pairs with `src/tests/poi-verification-gate-coverage.test.ts` to pin the no-admin-override contract and the forbidden-action allowlist.
- `check-evidence-rating-parity.mjs` — P011 Counterparty Rating SSOT parity guard: pins the 5 evidence-confidence bands, the 9 forbidden user-facing words, the 8 approved override reason codes, the freshness windows (30 / 7 / 365 / 90 days), the 12 canonical `counterparty_rating.*` audit names, the non-live provider list (CIPC / Onfido / Dow Jones / Refinitiv), and the `COUNTERPARTY_RATING_METHODOLOGY_VERSION = "1.0"` constant across the browser SSOT (`src/lib/evidence-rating.ts`) and the edge mirror (`supabase/functions/_shared/evidence-rating.ts`).
- `check-counterparty-rating-audit-names.mjs` — P011 Counterparty Rating audit-name drift guard: pins the 12 canonical `counterparty_rating.*` actions to the SSOT and forbids any drifted `counterparty_rating.<other>` literal inside the `compute-evidence-rating` and `evidence-rating-override` edge functions.
- `check-evidence-rating-forbidden-words.mjs` — P011 user-facing rating wording guard: scans `src/components/ratings` and `src/pages/docs` for the 9 forbidden words (`safe`, `trusted`, `approved`, `compliant`, `low risk`, `high risk`, `guaranteed`, `cleared`, `bank verified`) appearing in any file that also mentions `rating` / `counterparty`. Exempts the SSOT, the P011 test suite, the P011 evidence README, and the guard scripts themselves.
- `check-unknown-cp-audit-names.mjs` — P012 Unknown-Counterparty Timeline SSOT parity guard: asserts `UNKNOWN_CP_STATUS_ORDER` and `UNKNOWN_CP_AUDIT_EVENT_NAMES` stay byte-aligned between `src/lib/unknown-cp-timeline.ts` and `supabase/functions/_shared/unknown-cp-timeline.ts`.
- `check-unknown-cp-status-parity.mjs` — P012 status enum drift guard: pins the 17-value `user_facing_status` enum in the TS SSOT to the `CHECK (user_facing_status IN (...))` constraint on `public.unknown_cp_case_overlays`.
 - `check-unknown-cp-copy-drift.mjs` — P012 requester-surface copy-drift guard: scans `src/components/unknown-cp` for any leak of the internal-only `outreach_prepared` status and for the 7 forbidden user-facing words (`guaranteed`, `verified`, `approved`, `cleared`, `accepted`, `contacted`, `onboarded`) outside the SSOT, and enforces that `UnknownCpTimelinePanel.tsx` imports from `@/lib/unknown-cp-timeline`.
 - `check-registry-readiness-parity.mjs` — Batch 1 (M019) Module Readiness SSOT parity guard: asserts `REGISTRY_READINESS_STATES` and `REGISTRY_READINESS_AUDIT_EVENT_NAMES` stay byte-aligned between `src/lib/registry-readiness.ts` and `supabase/functions/_shared/registry-readiness.ts`.
 - `check-registry-readiness-forbidden-words.mjs` — Batch 1 Business Registry shell wording guard: blocks `verified`, `live`, `guaranteed`, `production-ready` across `src/components/registry`, `src/pages/registry`, `src/pages/admin/registry` (SSOT and test files exempt) so no shell surface can be mistaken for an operational record of truth.
 - `check-business-decision-audit-names.mjs` — Batch 1 (M018) Business Decision Register audit-name SSOT parity guard: pins `BUSINESS_DECISION_CATEGORIES`, `BUSINESS_DECISION_STATUSES`, `BUSINESS_DECISION_AUDIT_EVENT_NAMES` between TS / Deno and asserts the `business-decision-record` edge function references all three canonical audit names (`business_decision_recorded`, `business_decision_status_changed`, `business_decision_superseded`).
 - `check-registry-provenance-parity.mjs` — Batch 2 (M010) Registry Provenance SSOT parity guard: pins `REGISTRY_SOURCE_TYPES`, `REGISTRY_LICENCE_STATUSES`, `REGISTRY_CONFIDENCE_BANDS`, `REGISTRY_VERIFICATION_LEVELS`, `REGISTRY_PROVENANCE_AUDIT_EVENT_NAMES` between TS and Deno and asserts the `registry-provenance-record` edge function emits all four canonical audit names (`registry_source_recorded`, `registry_source_updated`, `registry_source_licence_recorded`, `registry_field_provenance_recorded`).
 - `check-registry-country-coverage-parity.mjs` — Batch 2 (M011) Country Coverage SSOT parity guard: pins the 11-state `COUNTRY_COVERAGE_STATES` and `COUNTRY_COVERAGE_AUDIT_EVENT_NAMES` between TS and Deno and asserts the `registry-country-coverage-update` edge function emits `registry_country_coverage_state_changed` and `registry_country_coverage_wording_changed`.
 - `check-registry-import-batch-parity.mjs` — Batch 2 (M012) Import Batch SSOT parity guard: pins the 12-state `IMPORT_BATCH_STATES` and the 5-name `IMPORT_BATCH_AUDIT_EVENT_NAMES` between TS and Deno and asserts the `registry-import-batch-manage` edge function emits all five canonical audit names (`registry_import_batch_created`, `registry_import_batch_state_changed`, `registry_import_batch_validation_recorded`, `registry_import_batch_published`, `registry_import_batch_rolled_back`).
 - `check-registry-country-coverage-forbidden-words.mjs` — Batch 2 admin-UI hygiene: blocks `verified`, `live`, `guaranteed`, `production-ready` across the Provenance / Coverage / Imports admin pages and components, and blocks rendering `seed_only` adjacent to `production_ready` without an explicit negation.
 - `check-registry-batch2-audit-names.mjs` — Batch 2 audit-name coverage: asserts every SSOT-declared audit name across M010 / M011 / M012 is referenced by exactly one writer edge function source file.
 - `check-registry-claim-state-parity.mjs` — Batch 3 (M002 / M003 / M004) SSOT parity guard: pins `REGISTRY_CLAIM_STATES`, `REGISTRY_CLAIM_AUDIT_EVENT_NAMES`, `REGISTRY_SEARCH_RESULT_LABELS` between `src/lib/registry-claims.ts` and `supabase/functions/_shared/registry-claims.ts`.
 - `check-registry-claim-audit-names.mjs` — Batch 3 audit-name coverage: every name in `REGISTRY_CLAIM_AUDIT_EVENT_NAMES` must be referenced by at least one `registry-company-*` edge function.
 - `check-registry-claim-approval-wording.mjs` — Batch 3 approval-copy SSOT guard: pins the verbatim non-verification approval copy across SSOT, Deno mirror, claim edge function, and admin Claims page; blocks `verified`/`live`/`guaranteed`/`production-ready` on registry shell surfaces (with allow-listed `not_verified`/`not_provided` exceptions).
 - `check-registry-public-bank-leakage.mjs` — Batch 3 public-surface hygiene: blocks raw bank-detail tokens (`account_number`, `sort_code`, `iban`, `swift_bic`, `routing_number`, `bank_account`) on the public search, profile, claim pages and the `registry-company-search` / `registry-company-profile` edge functions.




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
- `provider-stub-simulate` — P010 admin/developer Test-Mode-only audit-only stub-provider simulation (no external provider call; emits `stub_provider.blocked` / `stub_provider.test_mode_simulated`)
- `compute-evidence-rating` — P011 event-driven counterparty evidence-confidence rating recalculation (role-gated to `platform_admin` / `compliance_owner`; writes `counterparty_evidence_ratings` snapshot + `counterparty_rating.*` audit events; preserves last rating on failure)
- `evidence-rating-override` — P011 admin override apply / change / remove for counterparty evidence-confidence ratings (role-gated to `platform_admin` / `compliance_owner`; reason text ≥30 chars; expiry ≤90 days except `admin_block`; never permits `verification_complete`)
- `unknown-cp-case-bootstrap` — P012 idempotent overlay + initial `poi_created` / `facilitation_case_opened` timeline events for unknown-counterparty facilitation cases
- `unknown-cp-status-transition` — P012 admin/platform_admin structured status transitions (13 typed actions; `reopen_case` requires `platform_admin`; writes user-safe timeline events + canonical `unknown_cp_*` audit names)
- `unknown-cp-user-action` — P012 requester-driven Add more information / Contact support / Cancel request router (min 20-char message; routes cancellations into `cancelled_by_requester`)
- `registry-readiness-transition` — Batch 1 (M019) admin-only readiness state transition (role-gated to `platform_admin` / `compliance_owner`; reason ≥20 chars; writes `registry_readiness_states` history + `registry_readiness_state_changed` audit)
- `business-decision-record` — Batch 1 (M018) Business Decision Register create / update_status / supersede writer (role-gated to `platform_admin` / `compliance_owner`; rationale ≥30 chars; writes `business_decision_events` history + `business_decision_recorded` / `business_decision_status_changed` / `business_decision_superseded` audit events)
- `registry-provenance-record` — Batch 2 (M010) provenance writer (sources / licences / field provenance audit events)
- `registry-country-coverage-update` — Batch 2 (M011) country coverage state transitions (seed → production_ready requires approved business_decision + evidence URL)
- `registry-import-batch-manage` — Batch 2 (M012) 12-state import batch lifecycle writer (publish blocked without approved business decision)
- `registry-company-search` — Batch 3 (M002) public registry search shell (returns no production rows; gates on country coverage; emits `registry_company_search_performed`)
- `registry-company-profile` — Batch 3 (M003) public registry profile shell (safe envelope only; bank-detail STATUS LABEL only; emits `registry_company_profile_viewed`)
- `registry-company-claim` — Batch 3 (M004) Claim Your Company writer (start / submit / add_evidence / review; admin review requires `acknowledged_not_verification: true`; emits 7 claim audit names)



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

## DATA-004 Phase 3.2 — scheduling readiness (historical context)

Phase 3.2 was **scheduling readiness only** — no pg_cron schedule, manual
invocation only. Phase 3.2 sign-off was the precondition for Phase 4.

## DATA-004 Phase 4 — scheduled dry-run ACTIVE · live purge is NOT scheduled

Phase 4 (Batch 4) adds a single pg_cron schedule for
`purge-email-send-log-daily` running in **dry-run mode only**. The
schedule counts and evidences candidate rows but **cannot delete** —
the function defaults `dry_run=true` and the schedule body pins it to
`true`. **Live purge is NOT scheduled.** Moving to a live scheduled
purge requires a separate, second approval after dry-run evidence
review.

Phase 4 does NOT:

- wire any new sweeper (`storage-retention-cleanup`,
  `account-deletion-sweeper`, `cold-storage-archive`, retention
  sentinel paths, `email-log-anonymise` all remain deferred);
- change `email-log-anonymise`;
- broaden enforcement beyond `email_send_log`;
- flip the default `dry_run=true`;
- schedule any live (deleting) job.

### Scheduled dry-run job

- Job name: `purge-email-send-log-daily-dryrun`
- Schedule: `20 3 * * *` (daily 03:20 UTC)
- Body: `{"dry_run": true, "max_orgs": 50, "max_rows_per_org": 5000, "source": "cron:purge-email-send-log-daily-dryrun"}`
- Auth: `x-internal-key` header pulled from vault (`INTERNAL_CRON_KEY`).

### Monitoring expectations after each scheduled tick

Each tick MUST:

- Write a `retention_run_evidence` row with `job_name='purge-email-send-log-daily'`, `org_id IS NULL`, and `status IN ('success','partial','failed')`.
- Have `rows_purged = 0` on every per-org row AND on the run summary.
- Surface every missing-policy org as `decision='skipped_due_to_missing_policy'`.
- Surface every legal-hold org as `decision='skipped_due_to_legal_hold'`.
- Carry `details.audit_write_failures[]` and `details.evidence_write_failures[]` — empty arrays are the expected state.

HQ → Retention & Holds → Retention Health now shows
`scheduling_status=phase_4_scheduled_dry_run_active_live_purge_pending_approval`
plus the `cron.job` row that proves the schedule is dry-run-only. Any
appearance of `phase_4_unexpected_live_schedule_present` or
`pg_cron_mode=LIVE_UNEXPECTED` MUST be treated as a Sev-1 incident and
rolled back immediately.

### Rollback (operator-verified)

```sql
SELECT cron.unschedule('purge-email-send-log-daily-dryrun');
```

After running rollback, `get_purge_email_send_log_cron_jobs()` returns
zero rows and HQ Health surfaces
`scheduling_status=phase_4_dry_run_schedule_missing_check_cron`.

### Live-purge scheduling gate (must ALL be true before opening Phase 5)

- [ ] Phase 4 operator has observed at least one scheduled tick that wrote a `retention_run_evidence` row with `rows_purged=0`.
- [ ] `details.audit_write_failures[]` and `details.evidence_write_failures[]` are empty (or explicitly waived in writing).
- [ ] `rows_skipped_missing_policy` and `rows_skipped_legal_hold` counts are understood and accepted.
- [ ] HQ Health shows `pg_cron_mode=dry_run_only` and lists exactly one `dry_run_schedules` row.
- [ ] No `phase_4_unexpected_live_schedule_present` has ever appeared.
- [ ] `npm run build` passes with `check-data-004-phase3-2-no-schedule.mjs` green.
- [ ] **Explicit human approval** is recorded — separate from any earlier Phase 3.x or Phase 4 approval — before a live (non-dry-run) schedule may be authored.

Until every box above is ticked, **no live purge schedule may be added** —
not as an "edit the existing dry-run body to dry_run=false" change,
not as a second cron job, and not via a manual SQL console run.

## DATA-004 Batch 7 — `cold-storage-archive` dry-run-only evidence path

Status: **DATA-004 Batch 7 LIVE — `cold-storage-archive` is wired as a dry-run-only, evidence-first retention job. The function is NOT scheduled in pg_cron and the live archive path is gated behind a separate, second approval. No source records are deleted or mutated by Batch 7; the live archive contract (storage upload + `retention_flags` bookkeeping) is unchanged from prior versions but is now gated behind an explicit `dry_run=false` opt-in.**

Batch 7 changes (cold-storage-archive is dry-run-only and NOT scheduled):

- `dry_run` default is now TRUE — manual or service-role invocations are non-destructive unless an operator explicitly opts in.
- Candidate discovery routes through `discover_cold_storage_archive_candidates` (SECURITY DEFINER, service-role only). Already-exported rows are pre-classified as duplicates so they appear explicitly in evidence instead of being silently filtered.
- `retention_run_evidence` parity with `purge-email-send-log-daily` — one run-level `started`/`completed`/`partial`/`failed` row plus one per-candidate row. Lifecycle events are evidence-only (no `audit_logs` rows with null `org_id`).
- Explicit skip categories surfaced in evidence + response: `skipped_due_to_legal_hold`, `skipped_due_to_duplicate`, `skipped_due_to_missing_source`, `skipped_due_to_bucket_write`, `skipped_due_to_lookup_error`.
- `audit_write_failures[]` and `evidence_write_failures[]` are tracked and returned — never silently swallowed.
- Idempotency preserved (RPC `already_exported=true`; storage upload uses `upsert: false`).
- HQ → Retention & Holds → Retention Health renders a dedicated Cold Storage section sourced from `last_run_cold_storage_archive`, including the verbatim mode label `manual_dry_run_only`.

What Batch 7 does NOT change:

- No pg_cron schedule for `cold-storage-archive` is added — cold-storage-archive is NOT scheduled.
- No live archive scheduling.
- No source deletion. No source mutation beyond the existing safe archive contract.
- No changes to `email-log-anonymise`.
- No changes to `account-deletion-sweeper`.
- No changes to `storage-retention-cleanup`.
- No changes to `data-retention` sentinel paths.
- No conversion of `purge-email-send-log-daily` to live (Phase 4 dry-run schedule is unchanged).
- The Phase 3 single-consumer rule is preserved — `cold-storage-archive` does NOT consume `org_retention_policies` or `get_effective_retention_days`.

Guards (prebuild):

- `scripts/check-data-004-batch7-cold-storage.mjs` — pins `dry_run=true` default; pins the 5 canonical `cold_storage_archive.*` audit names and `RETENTION_JOB_AUDIT_PERSISTENCE` evidence-only lifecycle map; requires `discover_cold_storage_archive_candidates` and `retention_run_evidence` writes; forbids `.delete()` in the function source; forbids `org_retention_policies` / `get_effective_retention_days` consumption; forbids any migration that schedules `cold-storage-archive` via `cron.schedule`/`net.http_post`; reasserts that `storage-retention-cleanup`, `account-deletion-sweeper`, and `email-log-anonymise` remain unscheduled; requires `RELEASE_GATE.md` and `docs/launch-runbook.md` to carry a `DATA-004 Batch 7` section stating cold-storage-archive is dry-run-only and NOT scheduled.

Batch 8+ (deferred — do NOT open without a separate, second approval):

- Scheduling `cold-storage-archive` (would still be dry-run-only first, then live).
- Wiring `email-log-anonymise` (still violates the dry-run-default posture; requires per-org policy lookup and `retention_run_evidence` parity first).
- Wiring `account-deletion-sweeper` (irreversible account lifecycle — governance batch, not retention).
- Wiring `storage-retention-cleanup` (needs per-item legal-hold upgrade before scheduling).

## DATA-004 Batch 8A — cron contract breach cleanup / quarantine

Status: **DATA-004 Batch 8A COMPLETE — three unauthorized live/destructive cron jobs unscheduled, no new live schedule added, all DATA-004 dry-run jobs preserved, cold-storage-archive remains unscheduled.**

Quarantined cron jobs (unscheduled 2026-05-29):

| jobid | jobname | schedule | call | breach |
|-------|---------|----------|------|--------|
| 14 | `purge-email-send-log-daily` | `0 3 * * *` | `SELECT public.purge_old_email_send_log();` — hard DELETE from `email_send_log` >90d | Bypasses DATA-004 entirely: no `org_retention_policies` lookup, no `assertNoLegalHold` check, no `retention_run_evidence` write, writes only legacy `admin_audit_logs`. Contradicts the documented contract that **live email purge is NOT scheduled**. |
| 24 | `account-deletion-sweeper-daily` | `0 2 * * *` | `account-deletion-sweeper` body `{dry_run:true, max_rows:50}`, header `x-internal-key: current_setting('app.internal_cron_key', true)` | Body is dry-run, but the GUC `app.internal_cron_key` is not set, so the call silently 401s every day. Redundant with jobid 25 (correctly authenticated dry-run at 03:15). Removed under fail-closed posture. |
| 35 | `email-log-anonymise-daily` | `30 3 * * *` | `email-log-anonymise` body `{p_days:90, p_dry_run:false}` | Live irreversible PII masking. Contradicts the documented contract that `email-log-anonymise` is **deferred and unscheduled**. |

Preserved (verified post-quarantine):

- jobid 25 `account-deletion-sweeper-daily-dryrun` (`15 3 * * *`, body pins `dry_run:true`, `INTERNAL_CRON_KEY` via vault).
- jobid 39 `purge-email-send-log-daily-dryrun` (`20 3 * * *`, body pins `dry_run:true`, `INTERNAL_CRON_KEY` via vault).
- jobid 7 `storage-retention-cleanup-job` — inactive, untouched.
- `cold-storage-archive` — no schedule, Batch 7 contract preserved.

Guard (prebuild):

- `scripts/check-data-004-batch-8a-cron-quarantine.mjs` — fails the build if any SQL migration:
  - re-schedules any of the quarantined jobnames (`purge-email-send-log-daily`, `account-deletion-sweeper-daily`, `email-log-anonymise-daily`, `cold-storage-archive-weekly`),
  - schedules the legacy `purge_old_email_send_log()` DB function via `cron.schedule`,
  - schedules `email-log-anonymise` without `p_dry_run:true` pinned (or with `p_dry_run:false`),
  - schedules `account-deletion-sweeper` without `dry_run:true` pinned (or with `dry_run:false`),
  - or schedules `cold-storage-archive` at all (Batch 7 contract).

NOTE: cron state lives in the live DB, not in source. The guard is a regression net for migrations only. Operators must continue to audit `cron.job` directly before any live-schedule batch.

What Batch 8A does NOT change:

- No new live schedule added.
- No DATA-004 dry-run job altered.
- No retention enforcement broadened.
- No retention policy/floor changes.
- No edge function code or migration deleted.
- Cold-storage-archive remains unscheduled.

Replacements for any quarantined job require a separate batch with `retention_run_evidence` parity, per-org policy awareness, legal-hold enforcement, and a second explicit approval. See `docs/deferred-policy-register.md` entries for "DATA-004 legacy live email purge", "DATA-004 live account deletion cron", and "DATA-004 live email anonymise cron".

## DATA-004 Batch 8B — live cron-state evidence gate

Status: **DATA-004 Batch 8B COMPLETE — live `cron.job` audited; state matches the DATA-004 contract; no schedule changes made.**

Why this batch exists: Batch 8A demonstrated that SQL-migration guards and documentation can drift from live `cron.job` state (jobids 14/24/35/8 had been scheduled outside the documented contract). SQL-only regression nets are necessary but not sufficient — live cron state must itself become release evidence before any future Batch 9+ live-schedule decision.

### Live cron snapshot (2026-05-29)

Source query:
```sql
SELECT jobid, jobname, schedule, active FROM cron.job
WHERE jobname IN (
  'purge-email-send-log-daily',
  'email-log-anonymise-daily',
  'account-deletion-sweeper-daily',
  'cold-storage-archive-weekly',
  'purge-email-send-log-daily-dryrun',
  'account-deletion-sweeper-daily-dryrun',
  'storage-retention-cleanup-job'
)
ORDER BY jobid;
```

Result:

| jobid | jobname                                  | schedule     | active | expected           |
|-------|------------------------------------------|--------------|--------|--------------------|
| 7     | storage-retention-cleanup-job            | `0 2 * * *`  | false  | inactive ✅        |
| 25    | account-deletion-sweeper-daily-dryrun    | `15 3 * * *` | true   | dry-run live ✅    |
| 39    | purge-email-send-log-daily-dryrun        | `20 3 * * *` | true   | dry-run live ✅    |

All four quarantined jobnames (`purge-email-send-log-daily`, `email-log-anonymise-daily`, `account-deletion-sweeper-daily`, `cold-storage-archive-weekly`) returned **0 rows** — i.e. absent from live cron. ✅

`cold-storage-archive` is absent from live cron (separate `ILIKE '%cold-storage%'` probe — 0 rows). ✅

Evidence artifact: `evidence/data-004-batch-8b-cron-snapshot.md`.

### Pre-Batch-9 live-cron audit checklist (operator, REQUIRED)

Before approving any future live-schedule batch (Batch 9A cold-storage scheduled dry-run, Batch 9B live email-purge replacement, or any other) the operator MUST:

1. Run the snapshot query above against the live DB.
2. Confirm `0 rows` for every quarantined jobname.
3. Confirm `25` and `39` are still present, active, on `15 3 * * *` and `20 3 * * *` respectively, with bodies pinning `dry_run:true` / `p_dry_run:true` and `INTERNAL_CRON_KEY` via vault.
4. Confirm `7` is still `active=false`.
5. Confirm no `cold-storage-archive*` jobname exists.
6. Re-write `evidence/data-004-batch-8b-cron-snapshot.md` (or a dated sibling file) with the fresh output.
7. Only then proceed with the schedule change.

A passing prebuild guard run is **not** a substitute for this checklist — `scripts/check-data-004-batch-8a-cron-quarantine.mjs` only scans SQL migrations, and any external SQL run against the DB will bypass it.

### What Batch 8B does NOT change

- No new cron schedule added.
- No dry-run job converted to live.
- No new sweeper wired.
- No retention policy/floor change.
- No edge function code change.
- No destructive job touched.




## DATA-004 Batch 9A — schedule `cold-storage-archive` dry-run only

Status: **DATA-004 Batch 9A LIVE — `cold-storage-archive` is now scheduled as a weekly DRY-RUN ONLY job (`cold-storage-archive-dryrun`, Sundays 03:40 UTC). Live cold-storage-archive scheduling remains gated behind a separate, second approval. No source deletion. No source mutation. Existing dry-run jobs (jobid 25, 39) and inactive jobid 7 are unchanged.**

Live cron posture after Batch 9A (verified via `SELECT jobid, jobname, schedule, active FROM cron.job` against live DB on 2026-05-29):

| jobid | jobname                                   | schedule       | active | mode     |
|-------|-------------------------------------------|----------------|--------|----------|
| 25    | `account-deletion-sweeper-daily-dryrun`   | `15 3 * * *`   | true   | dry-run  |
| 39    | `purge-email-send-log-daily-dryrun`       | `20 3 * * *`   | true   | dry-run  |
| 40    | `cold-storage-archive-dryrun`             | `40 3 * * 0`   | true   | dry-run  |
| 7     | `storage-retention-cleanup-job`           | `0 2 * * *`    | false  | inactive |

Quarantined jobnames (`purge-email-send-log-daily`, `email-log-anonymise-daily`, `account-deletion-sweeper-daily`, `cold-storage-archive-weekly`) remain absent (0 rows in `cron.job`). No live `cold-storage-archive` job exists.

Batch 9A schedule body pins:

```
body := jsonb_build_object(
  'dry_run', true,
  'limit', 50,
  'source', 'cron:cold-storage-archive-dryrun'
)
```

Auth: `x-internal-key` sourced from `vault.decrypted_secrets WHERE name = 'INTERNAL_CRON_KEY'`. Never anon Bearer. Target: `/functions/v1/cold-storage-archive` (the Batch 7 edge function).

Rollback: `SELECT cron.unschedule('cold-storage-archive-dryrun');`

What Batch 9A changes:

- Exactly one scheduled dry-run for `cold-storage-archive` is added (jobid 40).
- HQ → Retention Health → "Cold storage archive" tile now surfaces the scheduled dry-run, the `dry_run_schedules` / `live_schedules` arrays, and the rollback SQL.
- `admin-org-retention` `health` action now reads `get_cold_storage_archive_cron_jobs()` and reports `scheduling_status` for cold-storage-archive parallel to the existing email-send-log path.
- `scripts/check-data-004-batch9a-cold-storage-schedule.mjs` enforces: exactly one `cold-storage-archive-dryrun` schedule, dry_run:true pinned, `x-internal-key` + `INTERNAL_CRON_KEY` auth, never anon Bearer, target `/functions/v1/cold-storage-archive`, and that `cold-storage-archive-weekly` stays quarantined.

What Batch 9A does NOT change:

- No live cold-storage-archive schedule is added. Live archive scheduling is a separate, second approval gate (Batch 9B+).
- No source records are deleted or mutated. The Batch 7 contract (`dry_run` defaults to TRUE, no `.delete(` in source, `org_retention_policies` not consumed) is preserved.
- `purge-email-send-log-daily-dryrun` (jobid 39), `account-deletion-sweeper-daily-dryrun` (jobid 25), and `storage-retention-cleanup-job` (jobid 7, inactive) are unchanged.
- No live email purge, live anonymise, or live account-deletion schedule is added.
- Per-org retention policies, floors, source deletion behaviour, and sweeper wiring are unchanged.

Operator evidence requirement: Batch 9B is the operator evidence tick capturing the first scheduled `cold-storage-archive-dryrun` run from `retention_run_evidence`. Live cold-storage scheduling stays gated until that evidence is reviewed.

## DATA-004 Batch 9B — `cold-storage-archive-dryrun` scheduled-cron pathway evidence

Status: **DATA-004 Batch 9B PASS (2026-05-29). The scheduled-cron pathway for `cold-storage-archive-dryrun` was exercised end-to-end without changing the schedule, using the exact body and `x-internal-key` auth the cron job uses. Five `retention_run_evidence` rows were written (`would_export`, `skipped_due_to_duplicate`, `skipped_due_to_missing_source`, plus `started` and `partial`), all with `dry_run=true` and `lifecycle_persistence=evidence_only`. `audit_write_failures=[]`, `evidence_write_failures=[]`. No source rows were deleted or destructively mutated; the eligible flag was NOT promoted to `archive_storage_path`. Cron state is identical before and after. No live cold-storage schedule appeared.**

Evidence artifact: `evidence/data-004-batch-9b-scheduled-tick-evidence.md` (run_id `51554340-a074-4803-9465-ddf52bdb271f`).

Skip-category coverage map:
- `would_export` / dry-run — proved live in this run.
- `skipped_due_to_duplicate` — proved live in this run.
- `skipped_due_to_missing_source` — proved live in this run.
- `skipped_due_to_legal_hold` (`legal_hold_batch`) — already proved by Batch 7 evidence row `run_id 6cea2c51-0f45-4e96-8d5d-4eaabea786ba`. Not re-exercised in Batch 9B to avoid mutating live `legal_holds`.
- `legal_hold_row` — unreachable for `screening_results` by design (`COLD_TABLE_TO_SCOPE['screening_results'] = null`). Not a bug.

Fixture cleanup: migration `20260529…_data_004_batch9b_fixture_cleanup.sql` removed the three fixture `retention_flags` and two fixture `screening_results` rows on demo org `aaaa0004-0004-0004-0004-aaaaaaaaaaaa`. Append-only `retention_run_evidence` rows preserved.

What Batch 9B does NOT change:
- No schedule edit (jobid 40 untouched).
- No live cold-storage cron added.
- No conversion to live archive.
- No source deletion, no destructive source mutation.
- `purge-email-send-log-daily-dryrun` (jobid 39), `account-deletion-sweeper-daily-dryrun` (jobid 25), `storage-retention-cleanup-job` (jobid 7), `email-log-anonymise`, and account-deletion live paths are all unchanged.
- Quarantined live jobnames remain absent.

Live cold-storage scheduling still requires a **separate, explicit Batch 10** approval AND a fresh live-cron snapshot. Batch 9B does NOT approve it.

## DATA-004 Batch 10 — live `cold-storage-archive` scheduling

Status: **DATA-004 Batch 10 LIVE (2026-05-30).** `cold-storage-archive` is now scheduled as a LIVE weekly job (`cold-storage-archive-live`, jobid 41, Sundays 04:10 UTC, 30 minutes after the dry-run baseline). Body pins `dry_run:false`. Auth uses `x-internal-key` from `vault.INTERNAL_CRON_KEY` (never anon Bearer). Target is `/functions/v1/cold-storage-archive`. The existing `cold-storage-archive-dryrun` schedule (jobid 40, Sundays 03:40 UTC) is intentionally left in place so dry-run vs live comparison evidence keeps accumulating.

First live tick (run_id `fc63bc96-5aff-4553-b0bc-a3313cdbcc0c`): HTTP 200, `status=success`, `dry_run=false`, `candidates=0`, `processed=0`, `failed=0`, `audit_write_failures=[]`, `evidence_write_failures=[]`, `lifecycle_persistence=evidence_only`. Two `retention_run_evidence` rows written (`started`, `success`). No storage exports written (no eligible records existed at dispatch). No source deletion. No destructive source mutation. Skip-category coverage (duplicate / missing-source / legal-hold-batch) remains evidenced by prior Batch 9B run `51554340-…` and Batch 7 manual run `6cea2c51-…` against the same edge function build. Evidence: `evidence/data-004-batch-10-live-cold-storage-evidence.md`.

Rollback SQL:

```sql
SELECT cron.unschedule('cold-storage-archive-live');
```

Out of scope for Batch 10 (still gated, no live schedule introduced):
- live `email_send_log` purge / `purge-email-send-log-daily` jobname
- live `email-log-anonymise`
- live `account-deletion-sweeper`
- `storage-retention-cleanup-job` (jobid 7 still inactive)
- per-org retention floors / policy rules
- any broadening of `cold-storage-archive` source-record handling beyond non-destructive JSON export

## DATA-004 Closeout Pack

Status: **DATA-004 Closeout Pack COMPLETE (2026-05-30).** Documentation, evidence, guard, and cross-consistency consolidation. **No schedule changed, no cron added/removed, no edge function behaviour changed, no policy changed, no destructive path introduced.** Live `cron.job` re-audited 2026-05-30 and matches the documented contract (jobids 25, 39, 40, 41 active; jobid 7 inactive; quarantined jobnames 14/24/35 and `cold-storage-archive-weekly` absent). The closeout pack is the single authoritative cross-reference for DATA-004 state, evidence map, guard inventory, deferred/gated register, and rollback SQL. See `evidence/data-004-closeout-pack.md`.

Next recommended (do NOT start without explicit approval): DATA-004 Next Controls Review (paper-only) or DATA-004 Live Email Purge Replacement Assessment (paper-only). Live email purge, live anonymisation, live account deletion, storage-retention-cleanup, and sentinel paths remain gated.



## DATA-004 Batch 12 — Live Cron Drift Monitor

Status: **DATA-004 Batch 12 LIVE (2026-05-30) — read-only.** A live cron drift monitor (`public.data_004_cron_drift_check()`, `SECURITY DEFINER`, `STABLE`, `service_role` EXECUTE only) is now wired into the `admin-org-retention` edge function `health` action and surfaced in HQ → Per-Org Retention. The monitor compares live `cron.job` state against the approved contract (active: `account-deletion-sweeper-daily-dryrun`, `purge-email-send-log-daily-dryrun`, `cold-storage-archive-dryrun`, `cold-storage-archive-live`; forbidden: `purge-email-send-log-daily`, `email-log-anonymise`, `account-deletion-sweeper`, `account-deletion-sweeper-live`, `storage-retention-cleanup`, `cold-storage-archive-weekly`; inactive expected: `storage-retention-cleanup-job`).

The monitor is **read-only** and **does not modify cron state** — it issues no `cron.schedule`, no `cron.unschedule`, no `INSERT`/`UPDATE`/`DELETE` against `cron.*`, and no `net.http_post`. It only `SELECT`s from `cron.job`.

First live drift result (2026-05-30, verified via `SELECT jobid, jobname, schedule, active FROM cron.job`): **PASS** — jobids 25, 39, 40, 41 active with approved schedules; jobid 7 (`storage-retention-cleanup-job`) inactive as expected; no forbidden jobnames present.

Guard: `scripts/check-data-004-batch-12-cron-drift-readonly.mjs` (wired into `prebuild`) asserts the RPC is `SECURITY DEFINER`/`STABLE`/`service_role`-only, the migration body contains zero cron mutation verbs, the edge function exposes the surface via the existing `health` action without scheduling cron, and that this section plus the runbook section contain the verbatim phrases `read-only` and `does not modify cron state`.

What Batch 12 does NOT change: no cron schedule is added, removed, or modified; no edge function enforcement broadens; no retention policy or floor changes; no new sweeper is wired; live email purge, live email anonymisation, live account deletion, and storage-retention-cleanup remain gated.

Rollback (drift RPC only — leaves all schedules untouched):

```sql
DROP FUNCTION IF EXISTS public.data_004_cron_drift_check();
```

Evidence: `evidence/data-004-batch-12-cron-drift-monitor.md`.

## DATA-004 Batch 13 — Cold-Storage Positive-Candidate Live Evidence

Status: **DATA-004 Batch 13 PASS (2026-05-31).** Proof-only batch. The scheduled `cold-storage-archive-live` tick (jobid 41, Sundays 04:10 UTC) was exercised end-to-end against three staged fixtures without changing the schedule, body, auth, or edge function code. Run id `99a12b33-4bcf-43f4-a201-ef93a306062d`, `dry_run=false`, `lifecycle_persistence=evidence_only`, `audit_write_failures=[]`, `evidence_write_failures=[]`, final lifecycle row `status='partial'` (candidates=3, processed=2, failed=0, skip_counts.duplicate=1, skip_counts.missing_source=1).

Fixture outcomes: **Fixture A** (positive eligible) `decision='exported'`, storage object written to `archived-records/compliance_cases/2018/8fc9ee52-…/b13a1111-…json`, source `compliance_cases` row remained intact and was not destructively mutated, `retention_flags.archive_storage_path` populated with matching `archive_hash`. **Fixture B** (duplicate) `decision='skipped_due_to_duplicate'`, reason `archive_storage_path_already_set`, no duplicate storage object created, flag unchanged. **Fixture D** (missing source) `decision='exported_with_null_source'`, `source_record_present=false`, evidence row carries reason `source_record_null_at_flag_time`, failure surfaced explicitly via `skip_counts.missing_source=1` — not swallowed. **Fixture C** (row-level legal hold) intentionally deferred to a separate "DATA-004 Batch 14 — Cold-Storage Row-Level Legal Hold Live Evidence" because `compliance_cases` maps to `scopeType=null` in `COLD_TABLE_TO_SCOPE` and synthesising a hold-mapped fixture exceeds the Batch 13 "do not change code/schedule" envelope.

Cron drift remained PASS (jobids 25/39/40/41 active with documented schedules; jobid 7 inactive; forbidden jobnames `purge-email-send-log-daily`, `email-log-anonymise`, `account-deletion-sweeper`, `account-deletion-sweeper-live`, `storage-retention-cleanup`, `cold-storage-archive-weekly` all absent). HQ → Per-Org Retention "Live cron drift monitor" panel reflects the latest live cold-storage run via the Batch 12 read-only `data_004_cron_drift_check()` + Batch 9A `get_cold_storage_archive_cron_jobs()` pathways; panel copy does not imply email purge, anonymisation, account deletion, storage cleanup, or sentinel approval.

Cleanup (2026-05-31): the three fixture `retention_flags` rows (`b13a2222-…`, `b13b3333-…`, `b13d4444-…`) and the single fixture `compliance_cases` row (`b13a1111-…`) were removed via a cleanup migration. **All five `retention_run_evidence` rows for run_id `99a12b33-…` were preserved.** No audit rows were deleted. No legal hold was created during Batch 13, so no release was required. The two live storage exports (`b13a1111-…json`, `b13d8888-…json`) were retained as preserved evidence of a real non-destructive cold-storage export; removal can be performed later under a separate storage runbook with audit reason `data-004-batch13-cleanup`.

What Batch 13 does NOT change: no cron schedule added, removed, or modified; no edge function code changed; no retention policy or floor changed; no live email purge, live email anonymisation, live account deletion, storage-retention-cleanup, or sentinel scheduling enabled. The only database mutations were the Phase 1 fixture INSERTs (already recorded) and the Phase 2 fixture cleanup DELETEs above.

Evidence: `evidence/data-004-batch-13-cold-storage-positive-live-evidence.md`.

Next recommended (do NOT start without explicit approval): DATA-004 Batch 14 — Cold-Storage Row-Level Legal Hold Live Evidence (covering the deferred Fixture C). Live email purge, live anonymisation, live account deletion, storage-retention-cleanup, and sentinel paths remain gated.

## DATA-004 Batch 14 — Cold-Storage Row-Level Legal Hold Live Evidence

Status: **DATA-004 Batch 14 PASS (2026-06-04).** Proof-only batch. One-shot manual live invocation of `cold-storage-archive` (`dry_run:false`, `limit:50`, `x-internal-key` from vault, `source:manual:data-004-batch14-row-hold-proof`) executed under explicit user approval. No cron schedule was created, modified, or removed; no edge function code changed; no retention policy or floor changed. Run id `903b44cc-50c4-4487-8838-a54c8884fb51`, `dry_run=false`, `lifecycle_persistence=evidence_only`, `audit_write_failures=[]`, `evidence_write_failures=[]`, final lifecycle row `status='partial'` (candidates=3, processed=1, failed=0, `skip_counts.legal_hold_row=1`, `skip_counts.duplicate=1`, `skip_counts.missing_source=0`).

Chosen table: `matches` (scope `"match"` per `COLD_TABLE_TO_SCOPE` at `supabase/functions/cold-storage-archive/index.ts:91-99`). Fixture outcomes: **Fixture A** (synthetic `matches` row with active row-level `legal_holds` row scoped `match`/`b14a0001`) `decision='skipped_due_to_legal_hold'`, reason `row_hold_id=b14a9999-…`, `details.skip_category=legal_hold_row`, per-org audit `data.retention_job.cold_storage_archive.skipped` emitted, no storage object written, `retention_flags.archive_storage_path` remained NULL, source `matches` row intact. **Fixture B** (unheld positive control) `decision='exported'`, storage object written to `archived-records/matches/2018/8fc9ee52-…/b14b0002-…json` (size 2064, hash `20a245f9…408036fd`), source `matches` row intact (non-destructive), `retention_flags.archive_storage_path`/`archive_hash`/`archive_size_bytes` populated. **Fixture C** (duplicate control) `decision='skipped_due_to_duplicate'`, reason `archive_storage_path_already_set`, no duplicate storage object created.

Cron drift remained PASS pre/post run (jobids 25/39/40/41 active with documented schedules; jobid 7 inactive; forbidden destructive jobnames absent). HQ → Per-Org Retention "Live cron drift monitor" panel now reflects `903b44cc-…` as the latest cold-storage run. Cleanup (2026-06-04): fixture legal hold released with audited reason; three fixture `retention_flags` and three fixture `matches` rows deleted; **all five `retention_run_evidence` rows for run_id `903b44cc-…` preserved**; the single live storage export (`b14b0002-…json`) retained as preserved evidence (Batch 13 precedent), residual path documented.

What Batch 14 does NOT change: no cron schedule added/removed/modified; no edge function code changed; no retention policy or floor changed; no live email purge, live email anonymisation, live account deletion, storage-retention-cleanup, or sentinel scheduling enabled; no new sweeper wired; enforcement scope unchanged.

Evidence: `evidence/data-004-batch-14-cold-storage-row-hold-live-evidence.md`.

## DATA-004 Batch 19 — Live Email Purge Scheduling + First Live Tick Evidence

Status: **DATA-004 Batch 19 PASS (2026-06-11).** Live `email_send_log` purge is now scheduled **only** through the DATA-004 edge function `purge-email-send-log-daily`. pg_cron jobid 42 `purge-email-send-log-daily-live` runs daily at `50 3 * * *` UTC, body pins `dry_run:false`, auth uses `x-internal-key` from `vault.INTERNAL_CRON_KEY` (never anon Bearer), target is `/functions/v1/purge-email-send-log-daily`. The legacy DB-side `public.purge_old_email_send_log()` cron path remains **absent / quarantined** (Batch 8A) and is NOT used. The dry-run schedule `purge-email-send-log-daily-dryrun` (jobid 39, `20 3 * * *`, `dry_run:true`) is preserved unchanged and continues to write daily `retention_run_evidence`.

First live tick: run_id `65de39b3-e554-4fb2-9bf9-736b552d5995`, `dry_run=false`, `status=success`, `rows_seen=0`, `rows_eligible=0`, `rows_purged=0`, all skip counts `0`, `audit_write_failures=[]`, `evidence_write_failures=[]`, 2 `retention_run_evidence` rows written. Fail-closed no-op because production currently has 0 valid `email_send_log` `org_retention_policies` rows. Batch 18 positive-control dry-run (run_id `e8f067ee-1a9a-4d4b-9602-8c69c07a100a`) already proved positive eligibility, within-retention, missing-policy, legal-hold, and disabled-policy decision branches.

Protected by design (no behaviour change in Batch 19):
- Missing-policy orgs — skipped (`skipped_due_to_missing_policy`); cannot be purged.
- Legal-hold orgs — skipped (`skipped_due_to_legal_hold`); cannot be purged.
- Disabled / invalid policy orgs — skipped (`skipped_due_to_disabled_policy`); cannot be purged.
- Within-retention rows — retained (`retained_not_expired`).

Cron drift contract updated to `data-004-batch-19`: jobid 42 added to `expected_active`; jobid 39 retained; legacy bare-name `purge-email-send-log-daily` jobname remains in the forbidden set; `storage-retention-cleanup-job` (jobid 7) remains inactive. HQ → Per-Org Retention "Live cron drift monitor" PASS before and after schedule + first live tick.

Rollback SQL (live schedule only — dry-run jobid 39 unaffected):

```sql
SELECT cron.unschedule('purge-email-send-log-daily-live');
```

What Batch 19 does NOT change: no edge function code changed; no migration changed the `purge-email-send-log-daily` function behaviour; no retention policy or floor changed; enforcement scope unchanged (still only `email_send_log` is wired); no anonymisation, account deletion, storage cleanup, or sentinel scheduling enabled; the legacy DB purge function remains quarantined and absent from cron.

Remaining gated paths after Batch 19 (each still requires its own explicit approval + fresh live-cron snapshot): live email anonymisation (`email-log-anonymise`), live account-deletion sweeper (`account-deletion-sweeper`), `storage-retention-cleanup-job`, sentinel paths, per-org enforcement beyond `email_send_log`, org-admin mutation of retention policies.

Evidence: `evidence/data-004-batch-19-live-email-purge-schedule.md`. First live tick run_id: `65de39b3-e554-4fb2-9bf9-736b552d5995`.

## DATA-004 Final Enterprise Status Pack

Status: **CLOSEOUT (2026-06-11) — documentation/evidence only.** Final enterprise-grade status pack for DATA-004 after Batch 19. No code, cron, schedules, edge functions, retention policies, floors, sweepers, anonymisation, account deletion, storage cleanup, sentinel paths, or destructive behaviour changed by this pack.

Final cron posture (contract `data-004-batch-19`): jobid 25 `account-deletion-sweeper-daily-dryrun` (dry-run), jobid 39 `purge-email-send-log-daily-dryrun` (dry-run), jobid 40 `cold-storage-archive-dryrun` (dry-run), jobid 41 `cold-storage-archive-live` (LIVE, non-destructive), jobid 42 `purge-email-send-log-daily-live` (LIVE, destructive scoped by policy + legal-hold), jobid 7 `storage-retention-cleanup-job` inactive. Forbidden jobnames absent: legacy DB email purge, `email-log-anonymise-daily`, legacy `account-deletion-sweeper-daily`, `cold-storage-archive-weekly`.

Approved enterprise-grade DATA-004 paths: `email_send_log` retention (dry-run + live, fail-closed by policy + legal-hold), `cold-storage-archive` (dry-run + live, non-destructive, row-level legal-hold proven on `matches`), cron-drift visibility (read-only monitor), per-org retention policy shell (AAL2-gated `admin-org-retention`) + Retention Health.

Remaining gated paths (each requires its own explicit approval + fresh live-cron snapshot): live email anonymisation (`email-log-anonymise`), live account-deletion sweeper, `storage-retention-cleanup-job`, sentinel paths, per-org enforcement beyond `email_send_log`, org-admin mutation of retention windows.

Consolidated rollback SQL (apply selectively, then verify via live `cron.job`, HQ Retention Health, and `retention_run_evidence`; do NOT delete evidence rows during rollback):

```sql
SELECT cron.unschedule('purge-email-send-log-daily-live');
SELECT cron.unschedule('purge-email-send-log-daily-dryrun');
SELECT cron.unschedule('cold-storage-archive-live');
SELECT cron.unschedule('cold-storage-archive-dryrun');
SELECT cron.unschedule('account-deletion-sweeper-daily-dryrun');
```

Recommendation: stop DATA-004 implementation here unless an enterprise requirement opens one of the remaining gated paths. If reopened, next assessment options are email anonymisation readiness (parallel to Batch 15→17) or `storage-retention-cleanup-job` legal-hold upgrade assessment — assessment only, not live activation.

Evidence: `evidence/data-004-final-enterprise-status-pack.md`.








## Admin Export Controls — Batch 2 (HQ Governance Record Export Request Shell)

Guard: `scripts/check-admin-export-controls-batch-2.mjs` (wired into `prebuild`) asserts that the `admin-governance-export-request` edge function enforces `assertAal2` + `is_admin`, emits both canonical DATA-010 audits, and that neither the edge function nor `AdminGovernanceExportRequestPanel.tsx` generates files, signed URLs, CSV, Blob output, or download anchors. Request shell only — no approve/prepare/download. Evidence: `evidence/admin-export-controls-batch-2.md`.

## Admin Export Controls — Batch 3 (Redaction + Access Contract Tests)

Guard: `scripts/check-admin-export-controls-batch-3.mjs` (wired into `prebuild`) plus contract tests `src/tests/admin-export-controls-batch-3.test.ts` (41 cases) pin: (a) platform_admin + AAL2 gates on `admin-governance-export-request`, (b) strict Zod body schema with 4-value redaction allow-list and `redacted_client_safe` default, (c) all DATA-010 canonical audit emissions on success + every denial path, (d) `request_admin_governance_export` remains `SECURITY DEFINER`, `service_role`-only EXECUTE, writes `awaiting_approval`, and (e) the HQ panel still renders no approve/prepare/download/destroy/signed-URL/Blob-CSV surfaces. Proof-only batch — no file generation, no download, no approval path added. Evidence: `evidence/admin-export-controls-batch-3-tests.md`.

## Admin Export Controls — Batch 4 (Governance Record Export Approval Shell)

Guard: `scripts/check-admin-export-controls-batch-4.mjs` (wired into `prebuild`) plus contract tests `src/tests/admin-export-controls-batch-4.test.ts` (40 cases) pin: (a) `admin-governance-export-approve` enforces `is_admin` before `assertAal2` with stable `NOT_PLATFORM_ADMIN` / `MFA_REQUIRED` codes, (b) `approve_admin_governance_export` is `SECURITY DEFINER`, `service_role`-only EXECUTE, takes `FOR UPDATE` row lock, raises clean `REQUEST_NOT_FOUND` / `REQUEST_NOT_PENDING` / `NOT_GOVERNANCE_RECORD_REQUEST` / `SELF_APPROVAL_BLOCKED` codes, (c) the only forward transition is `awaiting_approval → approved` (no `ready_for_download` / `downloaded` / `destroyed` / `export_preparation_required` writes anywhere), (d) DATA-010 canonical audits emit `data.admin_export_approved` on success and `data.admin_export_blocked_or_declined` on every denial with full actor / approver / request / governance / redaction / legal-hold / previous-status / new-status payload, (e) the HQ approval panel renders no download / signed-URL / prepare / destroy / generated-file / "ready to download" / Blob-CSV surfaces and self-approval is disabled in UI in addition to being blocked at the DB. Approval-only batch — no file generation, no download, no preparation. Evidence: `evidence/admin-export-controls-batch-4-approval-shell.md`.

## Admin Export Controls — Batch 5 (HQ Governance Export Request List View)

Guard: `scripts/check-admin-export-controls-batch-5.mjs` (wired into `prebuild`) plus contract tests `src/tests/admin-export-controls-batch-5.test.ts` pin: (a) `admin-governance-export-list` enforces `is_admin` before `assertAal2` with stable `NOT_PLATFORM_ADMIN` / `MFA_REQUIRED` codes, (b) the query is hard-scoped to `kind = 'admin_export'` AND `governance_record_id IS NOT NULL` with visible statuses limited to `awaiting_approval` / `approved` / `denied` / `failed` (no `prepared` / `generated` / `ready_for_download` / `downloaded` / `destroyed` ever queried or rendered), (c) the response is governance-safe — request id, governance record id, status, requester / approver ids and timestamps, redaction mode, purpose, summarised reason / approval note, legal-hold context presence + scope only — and explicitly excludes file paths, storage keys, signed URLs, download tokens, raw sanctions/PEP/adverse-media payloads, and full legal-hold reasons, (d) the edge function never `.insert`s / `.update`s / `.delete`s `export_requests`, never writes any `status =` value, never calls `approve_admin_governance_export` or `request_admin_governance_export`, and never invents an out-of-vocabulary `data.admin_export_*` audit name — only denial paths emit the canonical `data.admin_export_blocked_or_declined`, (e) the HQ list panel (mounted in the new `export-requests` sub-tab under Governance Records) renders no prepare / generate / download / destroy / signed-URL / CSV / JSON / PDF / "ready to download" surfaces, invokes only `admin-governance-export-list`, validates the optional governance_record_id filter as a UUID client-side, and is gated behind the existing platform_admin `RequireAuth` wrapping `/hq` plus the AAL2 banner. Read-only visibility only — DATA-004 untouched, approval semantics from Batch 4 unchanged. Evidence: `evidence/admin-export-controls-batch-5-list-view.md`.

## Admin Export Controls — Batch 6 (Legal-Hold Context Auto-Detection)

Guard: `scripts/check-admin-export-controls-batch-6.mjs` (wired into `prebuild`) plus contract tests `src/tests/admin-export-controls-batch-6.test.ts` pin: (a) new shared helper `supabase/functions/_shared/legal-hold-detection.ts` (`detectGovernanceRecordLegalHold`, `sanitiseOperatorLegalHoldContext`, `diffDetectedLegalHoldContext`) selects ONLY `id, scope_type, scope_id` from `legal_holds` filtered to `status='active'` — never reads `reason`, `metadata`, `released_reason`, `released_by`, `applied_by`, and never `insert`s / `update`s / `delete`s `legal_holds`; (b) confirmed detection paths are `match`, `buyer_org`, `seller_org`, `target_org`, `dispute`, `engagement` (walked via `matches`, `disputes`, `poi_engagements`); deferred paths (`match_document_evidence`, `match_evidence_row`, `poi_record`, `user_scope`) are explicitly listed and not silently inferred; (c) `admin-governance-export-request` calls detection after auth/AAL2/Zod gates, sanitises operator-supplied `legal_hold_context` to `{ hold_id, scope }` only (operator never overrides detected), stores the safe summary under `verification.legal_hold_context.detected` / `.operator`, and `data.admin_export_requested` now carries `legal_hold_context_detected` + `legal_hold_context_operator`; (d) `admin-governance-export-approve` re-runs detection read-only post-RPC and emits `data.admin_export_approved` with `legal_hold_context_detected_at_request`, `legal_hold_context_detected_at_approval`, `legal_hold_context_operator`, `legal_hold_context_changed_since_request`, `legal_hold_context_diff` — approval transition (`awaiting_approval → approved`) and self-approval/AAL2/platform_admin gates from Batch 4 unchanged; (e) `admin-governance-export-list` adds safe fields `legal_hold_auto_detected`, `legal_hold_hold_count`, `legal_hold_hold_sources`, `legal_hold_primary_scope`, `legal_hold_detected_at`, `legal_hold_detection_source` and continues to expose no raw `reason` / `notes` / `metadata` — `legal_holds` is never read with those columns and never mutated; (f) the HQ request panel surfaces a safe `Legal-hold auto-detection` block after successful submit and the HQ list panel renders an `auto-detected · <scope>` badge with hold count + source list, both still banning prepare/generate/download/destroy/signed-URL/CSV/Blob/"ready to download" surfaces; (g) detection is fail-OPEN by design (errors surface in `detection_errors[]`), informational only — it never blocks request or approval. Detection-only batch — no file generation, no signed URL, no prepare, no download, no destroy, no mutation of `legal_holds`. DATA-004 untouched (no cron, cold-storage, retention, sweeper, or archive changes). Evidence: `evidence/admin-export-controls-batch-6-legal-hold-auto-detection.md`.

## Admin Export Controls — Batch 7 (Live E2E Smoke: request → approval → list visibility)

Proof-only batch. Adds no runtime behaviour, no new edge function, no new migration, no new prebuild guard, no new audit name, and no new prepare/generate/download/signed-URL/destroy surface. Adds a single live-smoke harness `scripts/admin-export-controls-batch-7-smoke.mjs` (npm script: `smoke:admin-export-controls`) that proves the non-generating Governance Record export chain end-to-end against a deployed Lovable Cloud environment using only the three existing Batch 2 / 4 / 5 edge functions (`admin-governance-export-request`, `admin-governance-export-approve`, `admin-governance-export-list`) and the Supabase Auth REST endpoints (`/auth/v1/token`, `/auth/v1/factors`) with an inline RFC 6238 TOTP implementation — no new dependencies. The harness exercises five smoke paths: A — platform_admin AAL2 request success (asserts `status=200`, `request_id`, `status='awaiting_approval'`, `redaction_mode` preserved, no signed URL / download / prepare / destroy / Blob / `Content-Disposition` markers); B — request denials (AAL1 platform_admin → `403/MFA_REQUIRED`, non-admin → `403/NOT_PLATFORM_ADMIN`); C — second platform_admin AAL2 approval success (asserts `new_status='approved'`, `previous_status` absent or `'awaiting_approval'`); D — self-approval blocked (`409/SELF_APPROVAL_BLOCKED`); E — list visibility (AAL2 admin sees the approved row with `governance_record_id` / `status` / `redaction_mode` and no raw `notes` / `raw_reason` / `legal_hold_reason`; AAL1 admin → `403`; non-admin → `403`). Every response is run through `assertNoGenerationLeak()` which fails on any `signed_url|signedUrl|createSignedUrl|download_link|downloadUrl|download_url|\bprepare(d)?\b|\bdestroy(ed)?\b|text/csv|Content-Disposition|new Blob|generated_file|file_path|storage_object` token. The script writes `evidence/admin-export-controls-batch-7-live-e2e-smoke.json` with per-path checks and an explicit `no_generation_proof` block, and exits `2` with a precise missing-env list when invoked without staging `SMOKE_*` credentials. Audit emission (`data.admin_export_requested`, `data.admin_export_approved`, `data.admin_export_blocked_or_declined`) is contract-pinned by the existing Batches 2–6 source-pin tests and prebuild guards (all green on this commit). DATA-004 untouched: no migrations, no `cron.job` mutation, no changes to `cold-storage-archive*`, `purge-email-send-log-daily`, `email-log-anonymise`, `storage-retention-cleanup`, `account-deletion-sweeper`, `admin-org-retention`, `org_retention_policies`, `get_effective_retention_days`, the live cron drift monitor, or the scheduled Sunday 2026-05-31 04:10 UTC `cold-storage-archive-live` tick. Live run is operator-gated and not executed in the loop that wrote this batch. Evidence: `evidence/admin-export-controls-batch-7-live-e2e-smoke.md` and `evidence/admin-export-controls-batch-7-live-e2e-smoke.json` (populated by the operator on first staging run).

## Admin Export Controls — Batch 7C (Staging-only internal smoke runner)

Guard: `scripts/check-admin-export-controls-batch-7c.mjs` (wired into `prebuild`) pins the staging-only internal smoke runner edge function `supabase/functions/admin-export-batch-7c-smoke/index.ts`. The runner refuses to execute when `is_production_environment()` returns true, requires `service_role` or `INTERNAL_CRON_KEY` plus the exact confirm phrase `RUN_ADMIN_EXPORT_BATCH_7C_SMOKE`, and exercises only the existing Batch 2 / 4 / 5 edge functions (`admin-governance-export-request`, `admin-governance-export-approve`, `admin-governance-export-list`) against `@test.izenzo.co.za` fixtures. The guard asserts zero generation-leak surface in the runner: no prepare, no download, no destroy, no signed URL, no Blob, no CSV, no `Content-Disposition`, no storage upload. DATA-004 untouched: no cron, no cold-storage, no retention, no `org_retention_policies` mutation. No fixture passwords or TOTP secrets surface in the evidence shell `evidence/admin-export-controls-batch-7c-internal-smoke-runner.md`. Live invocation is operator-gated against a staging Lovable Cloud instance; this loop did not execute the runner in production.

## Admin Export Controls — Batch 8 (Redaction Contract Implementation)

Status: **complete (non-generating)**. Proceeding under **Option 3** (publish/build-and-debug-later) because no separate staging backend is connected; Batch 7C live execution remains blocked on production-refusal and is NOT bypassed. Batch 8 is restricted to a pure redaction-contract helper plus tests and a prebuild guard — NO file generation, NO download, NO signed URL, NO storage write, NO prepare / destroy, NO new edge function, NO change to the `admin-governance-export-request` / `-approve` / `-list` surfaces, NO change to the Batch 7C runner, NO DATA-004 touch, NO `legal_holds` mutation.

Guard: `scripts/check-admin-export-controls-batch-8.mjs` (wired into `prebuild` after `check-admin-export-controls-batch-7c.mjs` and before `check-evidence-secret-leaks.mjs`) plus contract tests `src/tests/admin-export-controls-batch-8.test.ts` pin: (a) shared helper `supabase/functions/_shared/admin-export-redaction.ts` exports `redactGovernanceRecord`, `REDACTION_MODES`, `DEFAULT_REDACTION_MODE`, `ALLOWED_FIELDS_BY_MODE`, `LEGAL_HOLD_SAFE_FIELDS`, `MASK_TOKEN`, `UnsupportedRedactionModeError`; (b) the four canonical modes `redacted_client_safe` / `evidence_only` / `metadata_only` / `full_internal` are literal-pinned with `redacted_client_safe` as the safe default and unsupported / omitted modes resolved safely; (c) the `ALWAYS_FORBIDDEN_FIELD_SUBSTRINGS` floor covers secrets / auth tokens (`password`, `api_key`, `auth_token`, `refresh_token`, `webhook_secret`, `signing_secret`, `bearer`, `totp`, `mfa_secret`), payment instruments (`card_number`, `pan`), file / download / storage surface (`signed_url`, `download_url`, `download_token`, `storage_path`, `storage_object`, `file_path`, `file_url`, `object_key`, `bucket`), raw compliance payloads (`sanctions_raw`, `pep_raw`, `adverse_media_raw`, `raw_api_response`, `third_party_confidential`, `auto_sources_raw`), internal notes (`internal_notes`, `admin_notes`, `privileged_legal_notes`, `internal_investigation_notes`), and raw legal-hold context (`legal_hold_reason`, `legal_hold_notes`, `released_reason`, `released_by`, `applied_by_user`); (d) PII (`email`, `phone`, `physical_address`, `national_id`, `passport`, `tax_id`, `date_of_birth`, …) is masked with the deterministic `MASK_TOKEN = "[REDACTED]"` in every mode except `full_internal`, which retains PII at top level for platform_admin internal review but still blocks every forbidden surface and still records the touch in `manifest.masked_fields`; (e) `legal_hold` is reduced to the Batch 6-aligned safe summary (`has_legal_hold`, `scope`, `hold_count`, `hold_sources`, `primary_scope`, `detected_at`, `detection_source`, `detection_version`) and raw `reason` / `notes` / `metadata` / `released_*` / `applied_by_user` are dropped; (f) demo / test labels (`is_demo`, `is_test`, `demo`, `test_mode`) pass through verbatim; (g) the helper is pure — guard fails the build if the helper introduces `fetch(`, `createSignedUrl`, `.storage`, `Deno.writeFile/writeTextFile`, `new Blob(`, `text/csv`, `application/pdf`, `Content-Disposition`, `supabase.functions.invoke`, `from('export_requests'|'legal_holds'|'governance_records')`, `.insert()`, `.update()`, `.delete()`, `.rpc()`, `org_retention_policies`, `cron.schedule`, `net.http_post`, `cold-storage-archive`, `is_production_environment`, the Batch 7C confirm phrase, or any reference to `admin-governance-export-prepare/download/destroy`; (h) the input object is never mutated and the redactor is deterministic; (i) the manifest accurately records `mode`, `allowed_fields`, `removed_fields`, `masked_fields`, `forbidden_fields_blocked`, `legal_hold_reduced`, `notes`. Redaction-contract batch only — no file generation, no downloadable artifact, no behaviour change in request / approval / list paths, no Batch 7C runner change, no weakening of the production guard. Evidence: `evidence/admin-export-controls-batch-8-redaction-contract.md`.

## Admin Export Controls — Batch 9 (Redaction UI Preview Shell)

Status: **complete (read-only, non-generating)**. Continues under Option 3 (publish/build-and-debug-later) because no separate staging backend is connected; Batch 7C live execution remains blocked on production-refusal and is NOT bypassed. Batch 9 adds a platform_admin + AAL2-gated redaction preview surface and NOTHING else — NO file generation, NO download, NO signed URL, NO storage write, NO Blob, NO Content-Disposition, NO prepare/destroy, NO mutation of `export_requests` / `legal_holds` / `matches` / `governance_records`, NO new audit name, NO DATA-004 touch, NO change to the Batch 7C runner or the Batch 2/4/5/6/8 surfaces.

Guard: `scripts/check-admin-export-controls-batch-9.mjs` (wired into `prebuild` after `check-admin-export-controls-batch-8.mjs` and before `check-evidence-secret-leaks.mjs`) plus contract tests `src/tests/admin-export-controls-batch-9.test.ts` pin: (a) new edge function `supabase/functions/admin-governance-export-preview/index.ts` enforces `is_admin` (`NOT_PLATFORM_ADMIN`) then `assertAal2` (`MFA_REQUIRED`) with denial audits via `DATA_010_AUDIT_ACTIONS.blocked_or_declined`, accepts a strict Zod body (`governance_record_id: uuid`, `redaction_mode` enum of the four canonical Batch 8 modes defaulting to `redacted_client_safe`), assembles a Governance Record-shaped payload from already-safe sources (`matches` columns `id/status/created_at/updated_at/buyer_org_id/seller_org_id`, latest `export_requests` summary columns `id/status/redaction_mode/requested_at/updated_at/created_at`, and the Batch 6 `detectGovernanceRecordLegalHold` safe summary), and returns `{ ok, governance_record_id, redaction_mode, redacted, manifest, contract }` after passing the payload through `redactGovernanceRecord` from `_shared/admin-export-redaction`; (b) the edge function performs NO `.insert`/`.update`/`.delete`/`.upsert`, NO `createSignedUrl`/`.storage`/`Deno.writeFile`/`writeTextFile`/`new Blob(`/`text/csv`/`application/pdf`/`Content-Disposition`, NO `supabase.functions.invoke`, NO reference to `admin-governance-export-prepare/download/destroy`, NO reference to `is_production_environment`/`RUN_ADMIN_EXPORT_BATCH_7C_SMOKE`, and NO touch of `org_retention_policies`/`cron.schedule`/`net.http_post`/`cold-storage-archive`; (c) new HQ panel `src/components/admin/governance/AdminGovernanceExportPreviewPanel.tsx` (mounted under `/hq` → Governance Records → `export-preview` sub-tab) renders the Preview-only / No-download / No-signed-URL / AAL2 badges, renders the redacted preview + manifest containers, invokes ONLY `admin-governance-export-preview` (never list/request/approve/prepare/download/destroy), validates `governance_record_id` as a UUID client-side, gates on `useAuth().isPlatformAdmin`, and renders NO download anchor / `new Blob(` / `URL.createObjectURL` / `saveAs(` / `text/csv` / `application/pdf` / `Content-Disposition` / `Download` / `Prepare` / `Destroy` / `Ready to download` / `signed url` surface; (d) the preview never mutates source rows — preview is computed in-memory only and returns redacted + manifest only. Read-only preview batch — no file generation, no downloadable artifact, no behaviour change in request / approval / list paths, no Batch 7C runner change, no weakening of the production guard. Evidence: `evidence/admin-export-controls-batch-9-redaction-preview-shell.md`.

---

### Admin Export Controls Batch 10 — Production-Safe Manual QA Pack

Status: **complete (documentation-only)**. Batch 10 is a non-technical manual QA pack for testers (Daniel / David) to click through the existing Admin Export Controls surfaces in the published / live system **without** triggering any actual export generation, download, signed/temporary link, prepare, or destroy behaviour. No runtime source change. No file generation, no Blob, no Content-Disposition, no `URL.createObjectURL`, no signed/temporary link, no storage upload, no DATA-004 touch (cron / cold-storage / archive / retention untouched), no weakening of the Batch 7C production-refusal guard, and no behaviour change to request / approval / list / preview paths. Batch 7C live smoke remains blocked on the absence of a separate staging backend; the internal smoke runner must remain refused on the connected production-tier backend throughout this QA.

Guard: `scripts/check-admin-export-controls-batch-10.mjs` (wired into `prebuild` after `check-admin-export-controls-batch-9.mjs` and before `check-evidence-secret-leaks.mjs`) pins: (a) the QA pack exists at `evidence/admin-export-controls-batch-10-manual-qa-pack.md` and continues to require `platform_admin` + `AAL2` gating, reference `MFA_REQUIRED` / `NOT_PLATFORM_ADMIN` messaging, name the Batch 7C production-guard posture, pin the default redaction mode `redacted_client_safe`, and keep the safe-summary legal-hold indicator check and the "no file / no download link / no temporary link / no-generation boundary" wording; (b) the QA pack must not contain positive tester instructions of the form "click download", "download the CSV/PDF/JSON/file", "generate (the) export", "prepare (the) export", or "destroy (the) export" (those phrases are allowed only inside negative-safety listings where the surrounding line negates them — e.g. "Generate export button" under "must be absent"); (c) the existing runtime targets `supabase/functions/admin-governance-export-list/index.ts`, `supabase/functions/admin-governance-export-preview/index.ts`, `src/components/admin/governance/AdminGovernanceExportRequestsListPanel.tsx`, and `src/components/admin/governance/AdminGovernanceExportPreviewPanel.tsx` still contain none of `createSignedUrl(`, `signed_url`, `storage.upload(`, `storage.download(`, `new Blob(`, `URL.createObjectURL(`, `Content-Disposition`, `text/csv`, `application/pdf`, anchor `download` attribute, or any invocation of `export-prepare` / `export-download` / `export-destroy` / `admin-export-prepare` / `admin-governance-export-prepare` / `admin-governance-export-download` / `admin-governance-export-destroy`; (d) `supabase/functions/admin-export-batch-7c-smoke/index.ts` still exists and still references the production-environment guard so the Batch 7C refusal is intact; (e) no sibling Batch 10 artefacts have been created under `evidence/` outside the canonical QA pack file. The QA pack covers: platform_admin visibility of the four Governance Records sub-tabs, non-admin denial at `/hq`, MFA/AAL2 gating on list and preview, request flow (status enters awaiting approval, default redaction mode `redacted_client_safe`, no file), approval flow (self-approval blocked, second admin approves, status `approved`, no file), list view (safe-summary legal-hold indicator only, no raw reasons), redaction preview (manifest renders, no raw sensitive payloads), and a negative safety scan covering Download / Generate / Prepare / Destroy / CSV / PDF / JSON / temporary-link / file-path / storage-object / raw legal-hold / raw sanctions / raw PEP / raw adverse-media / raw API response. Evidence: `evidence/admin-export-controls-batch-10-manual-qa-pack.md`.

---

### Admin Export Controls Batch 11 — QA Pack Dry-Run + Evidence Backfill

Status: **evidence shell complete; live QA execution pending human testers**. Batch 11 turns the Batch 10 manual QA pack into a structured evidence folder at `evidence/admin-export-controls-batch-11-qa-dry-run/` (containing `README.md`, `qa-results.md`, `qa-results.json`, and `screenshot-index.md`). Scenarios A, B, C1, C2, D, E1, E2, F, G, H are scaffolded as `not run` with placeholder screenshot filenames under `screenshots/` — no screenshots are claimed as captured, and no scenario is marked `pass` without a real PNG on disk. No runtime source code changed in this batch. No file generation, download link, signed/temporary link, storage upload, Blob, Content-Disposition, CSV/PDF/JSON output, or prepare/destroy surface was introduced. DATA-004 (cron / cold-storage / archive / retention) was not touched. The Batch 7C production-refusal guard remains intact.

Guard: `scripts/check-admin-export-controls-batch-11.mjs` (wired into `prebuild` after `check-admin-export-controls-batch-10.mjs` and before `check-evidence-secret-leaks.mjs`) pins: (a) the Batch 11 evidence folder and the four required files (`README.md`, `qa-results.md`, `screenshot-index.md`, `qa-results.json`) exist; (b) no Batch 11 markdown file contains positive tester instructions to "click download", "download the CSV/PDF/JSON/file", "generate (the) export", "prepare (the) export", or "destroy (the) export" — those phrases are allowed only in negative-context lines (no/not/never/absent/forbidden/blocker/STOP/etc.); (c) any screenshot referenced as `yes`/`captured`/`✅` in `screenshot-index.md`, or any scenario marked `passed` in `qa-results.json`, must have its PNG actually present in `screenshots/` (no fake screenshot claims; `qa-results.json.screenshots_captured=true` requires real PNGs on disk); (d) the existing runtime targets `supabase/functions/admin-governance-export-list/index.ts`, `supabase/functions/admin-governance-export-preview/index.ts`, `src/components/admin/governance/AdminGovernanceExportRequestsListPanel.tsx`, and `src/components/admin/governance/AdminGovernanceExportPreviewPanel.tsx` still contain none of `createSignedUrl(`, `signed_url`, `storage.upload(`, `new Blob(`, `URL.createObjectURL(`, `Content-Disposition`, `text/csv`, `application/pdf`, anchor `download` attribute, or any invocation of `admin-governance-export-prepare/download/destroy`; (e) `supabase/functions/admin-export-batch-7c-smoke/index.ts` still exists and still references the production refusal path (`is_production_environment` / `production_refused`); (f) no sibling Batch 11 artefacts have been created under `evidence/` outside the canonical folder. Evidence: `evidence/admin-export-controls-batch-11-qa-dry-run/`.

---

## Facilitation Phase 1 — CLOSED (2026-06-14)

**Verdict: `PHASE_1_CLIENT_UAT_READY`**

Unknown-Counterparty Facilitation Queue, Phase 1 (intake + admin triage; no outreach / no send path / no POI/WaD/match/token effects).

- Headless pack: **PASS** 17/17 — `supabase/functions/uat-facilitation-phase-1/index.ts`, Run 4 2026-06-13T18:45:01Z, raw output `evidence/facilitation-phase-1-operator-verification/run-4-headless-after-restrictive-fix.json`
- Storage / RLS corrective fixes: **PASS** (3 migrations)
  - `20260613180059_facilitation_case_visible_helper` — SECURITY DEFINER helper terminates `fevd_select` / `fevd_insert` EXISTS chain
  - `20260613183111_match_document_visible_helper` — SECURITY DEFINER helpers break `match_documents` ↔ `document_access` recursive policy chain (pre-existing platform RLS recursion, outside facilitation surface)
  - `20260613184415_storage_permissive_to_restrictive` — converts two broad PERMISSIVE `storage.objects` policies on `evidence-waiver-packets` and `archived-records` to RESTRICTIVE so they constrain rather than permit on every other bucket
- `platform_admin` manual leg: **PASS** — operator-attested by Josh Kruger 2026-06-14 against `FAC-2026-000006`; see `evidence/facilitation-phase-1-operator-verification/platform-admin/attestation.md`
- Negative controls: **PASS** — zero writes to `pois`/`wads`/`matches`/`token_ledger`/`token_purchases`/`notification_dispatches`/`email_send_log`/`poi_engagements`/non-facilitation `audit_logs` in the negative-control window
- No outreach / no send path: **PASS** — enforced by `scripts/check-facilitation-no-send-path.mjs` (already wired into prebuild)

Known Phase 1 UX gap (non-blocking): **Assign owner** field is freehand UUID input. Backend Zod `uuid()` gate is correct; replace with a `platform_admin` / `compliance_analyst` member picker before customer-facing GA.

Phase 2 (approved-email outreach + duplicate checks + do-not-contact checks + compliance escalation; still no SLA / reporting dashboard) is **NOT STARTED** and is gated on this closeout.

Evidence: `evidence/facilitation-phase-1-operator-verification/` (README.md, summary.json, platform-admin-manual-checklist.md, platform-admin/attestation.md, run-4-headless-after-restrictive-fix.json).
