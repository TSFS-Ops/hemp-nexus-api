# Full 79-Item Izenzo Tracker Reconciliation (Audit Only)

**Status:** `FULL_ORIGINAL_TRACKER_RECONCILIATION_AUDIT_COMPLETE`
**Scope:** Audit only. No migrations, no code edits, no deploys, no cron/RLS/grant/policy/schema/storage/edge-function changes, no provider/email/notification side effects, no data mutations.
**Baseline:** `Izenzo_Issue_To_Do_List_22_June_2026-2.docx` (79 rows, 22 June 2026).
**Method:** Codebase + migrations + `supabase/tests/*` + `evidence/c{6,7,8,9,10}-*` folders + runtime notes preserved from this workstream. Items not touched in this workstream are conservatively marked `OPEN_NEEDS_REPAIR` or `NEEDS_MORE_INSPECTION` rather than presumed safe.

Status legend: `CLOSED_RUNTIME_CONFIRMED` · `CLOSED_ALREADY_SAFE` · `CONTAINED` · `DEPLOYED_PENDING_VERIFICATION` · `CLIENT_DECISION_REQUIRED` · `OPEN_NEEDS_REPAIR` · `NEEDS_MORE_INSPECTION` · `DO_NOT_TOUCH`.

---

## Summary counts

| Status | Count |
|---|---:|
| CLOSED_RUNTIME_CONFIRMED | 9 |
| CLOSED_ALREADY_SAFE | 5 |
| CONTAINED | 3 |
| DEPLOYED_PENDING_VERIFICATION | 6 |
| CLIENT_DECISION_REQUIRED | 6 |
| OPEN_NEEDS_REPAIR | 47 |
| NEEDS_MORE_INSPECTION | 3 |
| DO_NOT_TOUCH | 0 |
| **Total** | **79** |

> 14 items are closed (runtime or already-safe). 15 items are partially de-risked (contained / deployed-pending-tick / awaiting client decision). 50 items still need either inspection or repair. The remaining open items cluster into five workstreams: **payments/refunds**, **storage & sealed-document immutability**, **behavioural KYC & cross-org leakage**, **public API idempotency/headers**, and **backend immutability hardening (trigger DDL guard, TRUNCATE, table-owner RLS, hash-chain verifier)**.

---

## Full reconciled tracker (79 rows)

Columns: # · Issue (short) · Sev · Status · Evidence · What changed · What remains · Next action · Code re-audit before apply?

### Critical

| # | Issue | Sev | Status | Evidence | What changed | What remains | Next action | Re-audit? |
|---:|---|---|---|---|---|---|---|---|
| 1 | Cross-org match evidence readable via `get_match_evidence` | Critical | OPEN_NEEDS_REPAIR | `get_match_evidence` RPC + grants in `20251202003708_*.sql` (not re-audited in this workstream) | — | Verify RPC SECURITY DEFINER predicate enforces `auth.uid()` participant check; confirm grant surface | Inspect RPC + grants; produce predicate proof | Yes |
| 2 | Audit Ledger landing claims "immutable ledger" | Critical | CLIENT_DECISION_REQUIRED | `src/lib/policy/audit-ledger-capability.ts` (`IMMUTABILITY_BACKEND_ENFORCED=false`, `SAFE_LEDGER_COPY`); C8 wording deployed | C8 swapped to tamper-evident phrasing in product surfaces | Landing-page strong-claim copy still deferred pending verifier + table-owner RLS | Defer until immutability triggers + verifier ship | No (decision) |
| 3 | `app.allow_audit_cleanup` GUC bypass on audit triggers | Critical | OPEN_NEEDS_REPAIR | `supabase/migrations/20260516173105_*.sql`; `assert_audit_immutable()` honours GUC; proof in `supabase/tests/audit_log_immutability_freeze_proof.sql` proves *default-state* immutability only | Freeze proof exists for default state | Remove GUC bypass entirely or restrict to event-trigger-locked role; covers #17 | Migration: drop GUC branch from `assert_audit_immutable()`; lock trigger ownership | Yes |
| 4 | Hidden UAT password reset endpoint | Critical | NEEDS_MORE_INSPECTION | `supabase/functions/set-uat-passwords/index.ts`; `supabase/config.toml verify_jwt=false` (not re-confirmed in this workstream) | — | Confirm function still exists; if so, gate behind `INTERNAL_CRON_KEY` + non-prod env check or delete | Read function + config; produce removal/gate plan | Yes |
| 5 | Landing says "append-only" ledger | Critical | CLIENT_DECISION_REQUIRED | `HeroStripeGlow.tsx` ~L101; same family as #2 | C8 sealed product-surface wording | Hero copy still strong-claims | Park with #2/#16/#25 verifier programme | No |
| 6 | Legal-hold badge implies deletion blocked | Critical | CONTAINED | `evidence/c10-sealed-records/ui-wording-containment/README.md`; `HoldDialog.tsx` swapped immutable→tamper-evident | C10 UI safe subset deployed; cleanup-worker scope inspection found correct | Storage-bucket seal-aware DELETE policy (#70) and `match_documents` row immutability (#9) still open | Bundle with #11/#70 storage inspection | Yes (for backend portion) |
| 7 | Lifecycle scheduler unscheduled, no heartbeat | Critical | DEPLOYED_PENDING_VERIFICATION | `supabase/migrations/20260414210204_*.sql:159-160`; remediation deployed | Timeout + heartbeat remediation deployed | Wait for natural 03:00 UTC tick to confirm heartbeat row | Observe next tick in `cron_heartbeats` | No |
| 8 | Refund approved with no Paystack refund sent | Critical | OPEN_NEEDS_REPAIR | `approve_refund` RPC end-to-end; no Paystack refund call found | — | Wire `approve_refund` → Paystack refund API + idempotent ledger; covers #34 #41 #58 #60 #63 | Refund workstream design + apply | Yes |
| 9 | Sealed `match_documents` rows still editable | Critical | CLIENT_DECISION_REQUIRED | `evidence/c10-sealed-records/match-document-immutability/` inspection (predicate identified, post-seal allowlist + supersession unresolved) | Predicate inspected | Need product decision on revoke/review post-seal allowlist and supersession parent-flip pattern | Capture decisions, then apply trigger | Yes |
| 10 | Sealed WaD row editable | Critical | DEPLOYED_PENDING_VERIFICATION | `supabase/migrations/...assert_wad_seal_immutability...`; `supabase/tests/c10_wad_seal_immutability_proof.sql`; `src/tests/c10-wad-seal-immutability.test.ts` | Trigger + allowlist deployed; static guard passing | Sandbox cannot execute privileged rollback proof; need CI/service-role/owner run | Run proof under privileged role; archive output | No (proof only) |
| 11 | Sealed underlying storage files deletable | Critical | OPEN_NEEDS_REPAIR | `trg_match_documents_cleanup` + `storage_deletion_queue`; no legal-hold/seal gate | — | Add seal/legal-hold check before enqueue; storage bucket DELETE policy must respect sealed WaD reference | Next C10 inspection lane (paired with #70) | Yes |
| 12 | User pays, browser closes, credits not applied | Critical | OPEN_NEEDS_REPAIR | `token-purchase/index.ts:219`; `transaction-reconciliation-job` in `20260516205931_*.sql` (deployed pending natural ticks but completeness unverified) | Reconciliation function deployment repair deployed pending natural tick | Confirm recovery cron actually credits (not only flags); covers #38 #54 #61 #67 | Verify after first natural tick; design completeness audit | Yes |

### High

| # | Issue | Sev | Status | Evidence | What changed | What remains | Next action | Re-audit? |
|---:|---|---|---|---|---|---|---|---|
| 13 | Cross-org reads on `counterparty_ratings`/`rating_signals` | High | OPEN_NEEDS_REPAIR | `20260423131334_*.sql:58,95` | — | Tighten SELECT policies to org-scoped or admin-only | Policy migration | Yes |
| 14 | `ensure_user_profile(uuid,email)` can overwrite profiles | High | OPEN_NEEDS_REPAIR | `20260311172837_*.sql` + grants | — | Restrict EXECUTE to service_role or enforce `_user_id = auth.uid()` | Function migration | Yes |
| 15 | API status returns raw `verification_status` | High | CLOSED_RUNTIME_CONFIRMED | `evidence/c9-registry-api-status-response-shaping/` | C9 response shaping deployed and runtime-confirmed | — | — | No |
| 16 | "9-gate verified" overclaim on Audit Ledger | High | CLIENT_DECISION_REQUIRED | `AuditLedger.tsx` L60,L199 | C8 partial wording | Deferred with #2/#5/#25 | Park | No |
| 17 | Cleanup-flag bypass on audit logs | High | OPEN_NEEDS_REPAIR | Same as #3 | Default-state freeze proof | Remove GUC | With #3 | Yes |
| 18 | Auth emails dead-letter without user-facing warning | High | OPEN_NEEDS_REPAIR | `process-email-queue/index.ts:4`; C7 inspected queue health | Queue health inspected; no user-facing warning surfaced | Add UI banner when user's recent auth email is dead-lettered | Frontend banner + read of `email_send_state` | Yes |
| 19 | Cold-storage archive **live** job no heartbeat | High | CLIENT_DECISION_REQUIRED | C6.6 held: live destructive path | — | Client decision before heartbeating destructive cron | Park | No |
| 20 | Company profile raw `verification_status` | High | CLOSED_RUNTIME_CONFIRMED | `evidence/c8-client-facing-wording-and-status-honesty/` | C8 status mapping deployed | — | — | No |
| 21 | ComplianceEngine "Verified" overclaim | High | CLOSED_RUNTIME_CONFIRMED | `evidence/c8-*` | C8 safe wording deployed | — | — | No |
| 22 | Suppressed emails appear sent | High | CLOSED_ALREADY_SAFE | `suppressed_emails` empty; `process-email-queue` pre-send check exists (C7 inspection) | — | Re-audit when suppression list grows | Monitor only | No |
| 23 | Customer webhook auto-disabled silently | High | OPEN_NEEDS_REPAIR | `webhook-retry/index.ts:110,187` | — | Emit notification on disable; add customer-facing flag | Inspect + add notification | Yes |
| 24 | `compute_all_behavioral_kyc_scores` RPC callable by any user | High | OPEN_NEEDS_REPAIR | `20260407125732_*.sql:1-66` | — | REVOKE EXECUTE FROM authenticated; restrict to service_role | Migration | Yes |
| 25 | "mathematically provable" landing overclaim | High | CLIENT_DECISION_REQUIRED | `HeroStripeGlow.tsx` ~L67 | — | Defer with #2/#5/#16 | Park | No |
| 26 | Live POI drifts from sealed snapshot | High | OPEN_NEEDS_REPAIR | sealed `poi_snapshot` vs live `matches` rows | — | Add seal-aware UPDATE trigger on `matches` or surface drift indicator | Inspection | Yes |
| 27 | `match_events.payload_hash` can change post-seal | High | CLOSED_ALREADY_SAFE | `supabase/tests/match_events_append_only_freeze_proof.sql` confirms DB-trigger append-only | C10 inspection found enforcement | — | — | No |
| 28 | `match_events` append-only by convention only | High | CLOSED_ALREADY_SAFE | Same as #27 | — | — | — | No |
| 29 | Notification failure + alert share Resend path | High | DEPLOYED_PENDING_VERIFICATION | C7.2 migrated admin alerts to platform queue | Migration deployed | Wait for natural alert | Observe | No |
| 30 | Paystack 5xx shown as unsuccessful | High | OPEN_NEEDS_REPAIR | `token-purchase/index.ts:262-265` | — | Map 5xx → "pending verify"; reconcile via #12 sweep | Payment workstream | Yes |
| 31 | Refund webhook no reconciliation poller | High | OPEN_NEEDS_REPAIR | inbound refund webhook only | — | Add Paystack refund-list poller | Refund workstream | Yes |
| 32 | `poi_events` append-only by convention only | High | CLOSED_ALREADY_SAFE | `supabase/tests/poi_events_append_only_freeze_proof.sql` | Trigger enforcement confirmed | — | — | No |
| 33 | Registry claim "approved" looks like verified | High | CLOSED_RUNTIME_CONFIRMED | `evidence/c8-*`; `ClaimStatus.tsx` | C8 wording deployed | — | — | No |
| 34 | Same refund processed in-app and by webhook | High | OPEN_NEEDS_REPAIR | request_id mismatch | — | Unify on Paystack reference as idempotency key | With #8 | Yes |
| 35 | `token_ledger` append-only by convention only | High | OPEN_NEEDS_REPAIR | No immutability trigger; service_role/owner bypass | — | Add `assert_token_ledger_append_only` trigger (mirror match_events) | Migration | Yes |
| 36 | WaD UI "Tamper-Proof" while rows mutable | High | CONTAINED | `audit-ledger-capability.ts` SAFE_LEDGER_COPY; C10 UI subset deployed | C8/C10 wording contained | Backend WaD trigger #10 still pending privileged proof | Privileged proof | No |
| 37 | Webhook rejects paid purchase if metadata missing | High | OPEN_NEEDS_REPAIR | `token-purchase/index.ts:956-959` | — | Fallback to Paystack metadata lookup before reject | Payment workstream | Yes |
| 38 | Webhook never arrives, credits unapplied | High | OPEN_NEEDS_REPAIR | Same family as #12 | Reconciliation deployed pending tick | Confirm sweep credits not only flags | With #12 | Yes |

### Medium

| # | Issue | Sev | Status | Evidence | What changed | What remains | Next action | Re-audit? |
|---:|---|---|---|---|---|---|---|---|
| 39 | Account deletion sweeper dry-run | Medium | CLOSED_RUNTIME_CONFIRMED | `evidence/c6-chron-observability/` (C6.4) | Runtime-confirmed | — | — | No |
| 40 | Active listings cross-org exposure | Medium | OPEN_NEEDS_REPAIR | `20251011122719_*.sql` listings policy | — | Inspect & tighten | Inspection | Yes |
| 41 | `approve_refund` overstates if credits already burned | Medium | OPEN_NEEDS_REPAIR | `approve_refund` L249 | — | With #8 | Refund workstream | Yes |
| 42 | Bank-verification timeout → match proceeds | Medium | OPEN_NEEDS_REPAIR | `_shared/registry-bank-verification.ts:99-114` | — | Treat timeout as `unknown`, gate match | Inspection | Yes |
| 43 | ComplianceEngine "within seconds" | Medium | CLOSED_RUNTIME_CONFIRMED | C8 | — | — | — | No |
| 44 | ComplianceEngine "scheduled screening" | Medium | CLOSED_RUNTIME_CONFIRMED | C8 | — | — | — | No |
| 45 | Counterparty ratings include sample orgs | Medium | OPEN_NEEDS_REPAIR | `compute-counterparty-ratings/index.ts` | — | Filter `sample_only=true` orgs | Edge function patch | Yes |
| 46 | Purchase ledger label fails | Medium | OPEN_NEEDS_REPAIR | `token-purchase/index.ts:1064-1100,313-360` | — | Atomic upsert of label | Payment ledger workstream | Yes |
| 47 | Email worker no explicit send timeout | Medium | OPEN_NEEDS_REPAIR | `process-email-queue/index.ts` | C7 inspected queue | Add `AbortController` timeout on Resend send | Edge function patch | Yes |
| 48 | Environment header overrides host on unknown API host | Medium | OPEN_NEEDS_REPAIR | `_shared/public-api-v1.ts:219-243,353-357` | — | Reject unknown host; ignore header override | Edge function patch | Yes |
| 49 | `event_store` blocks UPDATE/DELETE but not TRUNCATE | Medium | OPEN_NEEDS_REPAIR | `prevent_event_store_mutation()`; no event-trigger guard | C10 confirmed UPDATE/DELETE | TRUNCATE coverage via event trigger | DDL event trigger | Yes |
| 50 | `process-email-queue` cron not committed in SQL | Medium | CLOSED_ALREADY_SAFE | C7.1: covered via `email_send_state` heartbeat | — | — | — | No |
| 51 | Idempotent retry branch documented but not implemented | Medium | OPEN_NEEDS_REPAIR | `api-artefact-burn.ts:146-156` | — | Implement retry-token lookup against `idempotency_keys` | API workstream | Yes |
| 52 | Immutability triggers can be dropped by owner | Medium | OPEN_NEEDS_REPAIR | No event-trigger guard on `DROP TRIGGER`/`ALTER TABLE DISABLE TRIGGER` | — | Add event trigger guard + lock trigger ownership | Migration | Yes |
| 53 | Ledger hash chain not auto-verified | Medium | OPEN_NEEDS_REPAIR | `wads.ledger_entry_hash`/`prev_ledger_entry_hash`; no verifier cron | — | Scheduled verifier + risk item on mismatch (paired with capability flag flip) | Cron + edge function | Yes |
| 54 | Ledger promotion failure post-credit, no flag | Medium | OPEN_NEEDS_REPAIR | `token-purchase/index.ts:1093` | — | With #12/#46 | Payment ledger workstream | Yes |
| 55 | Legacy reconciliation dry-run leaks finance data | Medium | OPEN_NEEDS_REPAIR | `dry_run_legacy_reconciliation` `20260416173119_*.sql:156` | — | REVOKE EXECUTE from non-service roles | Migration | Yes |
| 56 | Missing Paystack secret → 500 no audit | Medium | OPEN_NEEDS_REPAIR | `paystack-webhook/index.ts:61-64` | — | Log to `admin_risk_items` on missing secret | Edge function patch | Yes |
| 57 | Outreach SLA monitor not scheduled | Medium | CLOSED_RUNTIME_CONFIRMED | `evidence/c6-chron-observability/` (C6.2) | — | — | — | No |
| 58 | Partial refund parks cash | Medium | OPEN_NEEDS_REPAIR | `handleRefundProcessed:1433-1484` | — | With #8 | Refund workstream | Yes |
| 59 | Paystack init hang → idempotency stuck 24h | Medium | OPEN_NEEDS_REPAIR | `token-purchase:601-604,619,639` | — | Add timeout + idempotency expiry | Edge function patch | Yes |
| 60 | Paystack refund without matching purchase | Medium | OPEN_NEEDS_REPAIR | `handleRefundProcessed:1343-1377` | — | With #8 | Refund workstream | Yes |
| 61 | Post-credit audit/event inserts best-effort | Medium | OPEN_NEEDS_REPAIR | `token-purchase:1132-1175` | — | Move inside same txn as credit | With #12 | Yes |
| 62 | Provider-simulate missing `provider_config_id` | Medium | OPEN_NEEDS_REPAIR | `registry-bank-verification-provider-simulate:52-70` | — | Require config_id; reject otherwise | Edge function patch | Yes |
| 63 | Refund ledger promotion fail after balance deducted | Medium | OPEN_NEEDS_REPAIR | `handleRefundProcessed:1528-1554` | — | With #8 | Refund workstream | Yes |
| 64 | Registry/import tables readable by all auth users | Medium | CLOSED_ALREADY_SAFE | C9 inspection found admin/compliance-gated policies | — | — | — | No |
| 65 | Role-check helper leaks cross-org role info | Medium | CLOSED_RUNTIME_CONFIRMED | `evidence/c9-role-helper-self-enforcement/` | C9 self-enforcement runtime-confirmed | — | — | No |
| 66 | Same action charged twice with new request_ids | Medium | OPEN_NEEDS_REPAIR | API artefact burns lack global request_id unique | — | Add unique index on `(api_client_id, request_id)` | Migration | Yes |
| 67 | Settlement mismatch leaves money at Paystack | Medium | OPEN_NEEDS_REPAIR | `token-purchase:999-1018` | — | With #8/#12 | Payment workstream | Yes |
| 68 | Single-org behavioural score RPC leaks competitor score | Medium | OPEN_NEEDS_REPAIR | `compute_behavioral_score`; `20260407124934_*.sql` | — | REVOKE EXECUTE; enforce org-scope | With #24 | Yes |
| 69 | Slack notification failures swallowed | Medium | OPEN_NEEDS_REPAIR | `notification-dispatch` Slack path | C7 touched alerting but Slack not closed | Surface failure to `admin_risk_items` | Edge function patch | Yes |
| 70 | Storage bucket DELETE not seal-aware | Medium | NEEDS_MORE_INSPECTION | `match-documents` storage policies; no `storage.objects` DELETE guard if sealed WaD references file | — | Inspect storage policies; predicate decision; covers #11 | Next C10 inspection lane | Yes |
| 71 | Table owners not forced through RLS | Medium | OPEN_NEEDS_REPAIR | `pg_class.relforcerowsecurity=false` on audit/event/ledger tables | — | `ALTER TABLE ... FORCE ROW LEVEL SECURITY` (with grant audit) | Migration | Yes |
| 72 | Validate-fail upload leaves storage orphans | Medium | OPEN_NEEDS_REPAIR | `validate-upload` path; `storage-orphan-cleanup` only covers session-expiry | — | Extend orphan-cleanup; or rollback storage put on validate fail | Edge function + cron | Yes |
| 73 | `wad_attestations` editable by service_role after sealing | Medium | OPEN_NEEDS_REPAIR | `20260124143053_*.sql:142-161` | — | Add seal-aware immutability trigger; mirror C10 WaD pattern | Migration | Yes |

### Low

| # | Issue | Sev | Status | Evidence | What changed | What remains | Next action | Re-audit? |
|---:|---|---|---|---|---|---|---|---|
| 74 | Admin manual crediting without payment | Low | OPEN_NEEDS_REPAIR | `admin-credit-org/index.ts` | — | Require dual-approval + audit ledger entry; CFO sign-off | Edge function patch | Yes |
| 75 | Admin pages client-side guard only | Low | CLOSED_ALREADY_SAFE | `RequireAuth role=platform_admin`; server re-checks hold | — | — | — | No |
| 76 | Cleanup expired unsubscribe tokens heartbeat | Low | CLOSED_RUNTIME_CONFIRMED | C6.3 | — | — | — | No |
| 77 | Cold-storage archive **dry-run** heartbeat | Low | DEPLOYED_PENDING_VERIFICATION | C6.7 | Deployed | Wait for weekly tick | Observe | No |
| 78 | Invalid Paystack signatures dropped, no retry | Low | OPEN_NEEDS_REPAIR | `token-purchase:844` | — | Log to `admin_risk_items` on invalid sig | Edge function patch | Yes |
| 79 | Two admins approving same refund UI confusion | Low | OPEN_NEEDS_REPAIR | `approve_refund:234,238`; governance dedup window | Server-side `FOR UPDATE` is correct | UI dedup toast / disable button after submit | Frontend patch | No |

> Items C6.5 (purge email send log dry-run) and C7.1 already-covered note from the user's preserved-status list correspond to internal C-batch items not present as numbered rows in the 79-item baseline; they remain tracked in their respective `evidence/c6-*` and `evidence/c7-*` folders.

---

## Top 10 next items

Ranked by: highest severity → smallest safe apply blast radius → no client decision required → no live money/email/deletion/provider side effects → verifiable without waiting for a natural cron tick.

| Rank | # | Item | Why it's first | Apply blast radius |
|---:|---:|---|---|---|
| 1 | 24 | Lock down `compute_all_behavioral_kyc_scores` RPC | High; pure `REVOKE EXECUTE` migration; instantly verifiable via psql `\df+` | Single GRANT change |
| 2 | 68 | Lock down `compute_behavioral_score` (single-org) RPC | Same family as #1; same proof shape | Single GRANT change |
| 3 | 55 | `REVOKE EXECUTE` on `dry_run_legacy_reconciliation` | Medium; pure GRANT change; immediately verifiable | Single GRANT change |
| 4 | 14 | Tighten `ensure_user_profile(uuid,email)` to `_user_id = auth.uid()` or service_role only | High; bounded function migration; static test guard | One function + grants |
| 5 | 35 | Add `assert_token_ledger_append_only` trigger | High; mirrors proven `match_events`/`poi_events` pattern; freeze proof identical | One trigger + proof |
| 6 | 73 | `wad_attestations` seal-aware immutability trigger | Medium; mirrors C10 WaD trigger pattern; static guard + rollback proof | One trigger + proof |
| 7 | 13 | Tighten `counterparty_ratings`/`rating_signals` SELECT policies to org-scope | High; policy-only change; verifiable via RLS test | Two policies |
| 8 | 49 | Add DDL event trigger blocking TRUNCATE on append-only tables (also satisfies #52) | Medium; single event trigger; instantly verifiable | One event trigger |
| 9 | 71 | `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on audit/event/ledger tables (after grant audit) | Medium; declarative; reversible | N tables |
| 10 | 48 | Reject unknown-host requests in `_shared/public-api-v1.ts`; ignore Env header override | Medium; edge-function only; unit-testable | One shared helper |

All ten are **frontend/edge/migration-only**, do not move money, do not send email, do not delete data, do not call external providers, and can be verified inside the sandbox or via a static guard / freeze proof. Each one should be paired with its own scoped inspection before apply, per the user's standing workflow.

---

## Deferred (explicit non-apply)

- #2 #5 #16 #25 — landing/audit-ledger strong-claim wording. Pinned to verifier + table-owner RLS programme.
- #6 #9 #11 #70 — sealed records / storage / legal-hold backend repairs await predicate + product decisions.
- #10 — WaD seal trigger awaits **privileged rollback proof** under service-role/owner/CI role (sandbox cannot satisfy).
- #19 — cold-storage **live** heartbeat awaits client decision.
- #7 #12 #29 #38 #77 — deployed, await natural cron tick / alert.

No code, migration, RLS, grant, policy, schema, cron, storage, or edge-function changes were made during this audit.
