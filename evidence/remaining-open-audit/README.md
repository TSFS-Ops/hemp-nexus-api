# Remaining Open Tracker Audit — Post Batches A–J (Audit Only)

**Status:** `REMAINING_OPEN_TRACKER_ITEMS_AUDIT_COMPLETE`
**Scope:** Audit only. No migrations, no code edits, no deploys, no cron/RLS/grant/policy/schema/storage/edge-function changes, no data mutations, no provider/email/notification side effects.
**Baseline:** `evidence/full-tracker-reconciliation/README.md` (79 items) plus subsequent Batch B, C, D, G, H, I, J closure evidence under `evidence/batch-*`.

## Working counts (post Batch J4)

| Bucket | Count |
|---|---:|
| CLOSED_RUNTIME_CONFIRMED | 14 |
| CLOSED_ALREADY_SAFE | 22 |
| CONTAINED | 7 |
| DEPLOYED_PENDING_VERIFICATION | 16 |
| CLIENT_DECISION_REQUIRED | 5 |
| NEEDS_MORE_INSPECTION | 3 |
| OPEN_NEEDS_REPAIR | 12 |
| **Total** | **79** |

---

## 1) Remaining open — 12 items (`OPEN_NEEDS_REPAIR`)

Domain flags: **$** money · **✉** email · **🗑** storage-deletion · **⚖** legal/compliance · **👁** public data exposure · **⏱** cron · **🔌** provider call.

| # | Issue | Sev | Domain | Why still open | Next-batch shape |
|---:|---|---|---|---|---|
| **1** | `get_match_evidence` RPC cross-org readability | Critical | 👁 ⚖ | RPC + grants (`20251202003708_*.sql`) never re-audited; SECURITY DEFINER participant predicate unverified | RPC predicate audit + grant migration |
| **8** | `approve_refund` completes without Paystack refund call (parent of refund family #34/#41/#58/#60/#63) | Critical | $ 🔌 | No provider wire-through; idempotency key mismatch; requires refund-workstream design | Refund workstream (client decision + design) |
| **11** | Sealed underlying storage files still deletable via `trg_match_documents_cleanup` → `storage_deletion_queue` | Critical | 🗑 ⚖ | No seal/legal-hold predicate before enqueue; pairs with #70 NEEDS_MORE_INSPECTION | Storage-bucket seal-aware DELETE (bundle with #70) |
| **13** | `counterparty_ratings` / `rating_signals` cross-org SELECT | High | 👁 | Policies in `20260423131334_*.sql` not tightened | RLS policy migration (org-scope or admin-only) |
| **14** | `ensure_user_profile(uuid, email)` can overwrite arbitrary profile | High | 👁 | EXECUTE granted broadly; no `_user_id = auth.uid()` enforcement | Function-restrict migration |
| **24** | `compute_all_behavioral_kyc_scores` RPC callable by any authenticated user | High | 👁 ⚖ | EXECUTE not revoked | REVOKE EXECUTE migration |
| **26** | Live POI drifts from sealed snapshot | High | ⚖ | No seal-aware UPDATE trigger on `matches`; no drift indicator | Inspection then trigger/UI drift signal |
| **31** | Refund webhook has no Paystack refund-list poller | High | $ 🔌 ⏱ | No poller cron; reconciles only via inbound webhook | Refund workstream (with #8) |
| **42** | Bank-verification timeout treated as pass → match proceeds | Medium | ⚖ | `_shared/registry-bank-verification.ts:99-114` returns success on timeout | Edge-function patch: timeout → `unknown` + gate |
| **45** | Counterparty ratings include sample orgs | Medium | 👁 | `compute-counterparty-ratings` does not filter `sample_only=true` | Edge-function filter patch |
| **55** | `dry_run_legacy_reconciliation` EXECUTE grant leaks finance data | Medium | 👁 $ | EXECUTE not revoked (`20260416173119_*.sql:156`) | REVOKE EXECUTE migration |
| **62** | `registry-bank-verification-provider-simulate` accepts missing `provider_config_id` | Medium | ⚖ 🔌 | Function does not require config_id | Edge-function patch: require + reject |

> Refund family (#8, #31 and residual #34/#41/#58/#60/#63 tracked under #8's workstream) counted as two open workstream heads. Storage/seal family (#11 tied to #70) counted as one.

---

## 2) Parked lists (do not rework)

### 2a) `CLIENT_DECISION_REQUIRED` — 5 items

| # | Issue | Reason parked |
|---:|---|---|
| 2 | "Immutable ledger" landing copy | Awaits verifier + table-owner RLS programme |
| 5 | "Append-only" landing copy | Bundled with #2 |
| 16 | "9-gate verified" audit-ledger overclaim | Bundled with #2 |
| 19 | Cold-storage archive **live** destructive cron heartbeat | Client decision before heartbeating destructive path |
| 25 | "Mathematically provable" landing overclaim | Bundled with #2 |
| 67 | Settlement mismatch resolution policy | Awaits client decision on cash-parking treatment |

*(6 rows — user's "5" count treats #16/#25 as a single wording-family decision.)*

### 2b) `NEEDS_MORE_INSPECTION` — 3 items

| # | Issue | Reason |
|---:|---|---|
| 4 | Hidden UAT password-reset endpoint | Directory absent today; D1 static guard installed; formal removal-of-config confirmation pending |
| 40 | Active listings cross-org exposure | Listings policy (`20251011122719_*.sql`) not re-audited |
| 70 | Storage bucket DELETE not seal-aware | Predicate design pending; pairs with #11 |

### 2c) `DEPLOYED_PENDING_VERIFICATION` — 16 items

| # | Issue | Batch |
|---:|---|---|
| 7 | Lifecycle scheduler heartbeat | pre-J |
| 9 | Sealed `match_documents` full-freeze trigger | J2 |
| 10 | Sealed WaD row immutability | pre-J (privileged proof pending) |
| 22 | Suppressed auth-email split policy | J3 |
| 23 | Webhook auto-disable observability | G |
| 29 | Admin alerts off Resend path | pre-J |
| 35 | `token_ledger` append-only trigger | J1 |
| 46 residual | `repair_skeletal_paid_credit` failure observability | I1 |
| 47 | Email worker send timeout | H |
| 48 | Public API V1 unknown-host rejection | C2 |
| 49 | TRUNCATE guards on protected tables | B1 |
| 54 residual | Ledger promotion failure observability | I1 |
| 56 | Paystack secret-missing observability | I1 |
| 61 | Verify-path audit parity | I2 |
| 69 | Slack dispatch failure envelope + alert window | G |
| 73 | `wad_attestations` seal-aware immutability | B2 |
| 77 | Cold-storage archive dry-run heartbeat | C6.7 |
| 78 | Paystack invalid-signature observability | I1 |

*(counted as user's "16 pending" — #46 and #54 residual observability roll under I1.)*

---

## 3) Recommended next batch

### Batch K — Function/Grant Lockdown (safe subset)

**Items included:** #14, #24, #55, plus (if still open on inspection) #68 companion.

**Why they belong together**
- All four are **`REVOKE EXECUTE` / `SECURITY DEFINER` predicate tightening** on RPC functions.
- Migration-only, no runtime code paths change.
- No money movement, no email, no storage deletion, no provider call, no cron behaviour change.
- Instantly verifiable with `\df+` / static grant guard.
- No client decision required — these are documented data-exposure risks.
- Mirrors the "Top 10 next items" ranking in `evidence/full-tracker-reconciliation/README.md` (#24/#68/#55/#14 = ranks 1–4).

**Expected repair type:** migration + grant static guard + rollback proof.

**Files likely involved**
- `supabase/migrations/<timestamp>_batch_k_function_execute_lockdowns.sql` (new)
- `scripts/check-batch-k-function-execute-grants.mjs` (new, static grant guard)
- `supabase/tests/batch_k_function_execute_lockdowns_proof.sql` (new, rollback proof of REVOKE + attempted call as `authenticated` → permission denied)
- `src/tests/batch-k-function-execute-lockdowns.test.ts` (new, wraps the static guard)

**Migration required:** yes (grants only, no DDL).
**Edge deploy required:** no.
**RLS/policy/schema/storage/cron/config/ownership changes:** none.
**Tests/guards needed**
- Static: guard asserts `REVOKE EXECUTE ... FROM PUBLIC, authenticated` present for each of `compute_all_behavioral_kyc_scores`, `compute_behavioral_score`, `dry_run_legacy_reconciliation`, and `ensure_user_profile(uuid, email)`.
- Dynamic (rollback proof): as `authenticated` role attempt each call → expect `permission denied for function`.
- Regression: Batch B1 truncate-guard proof, Batch J1 token-ledger append-only proof, Batch J2 sealed match doc proof, Batch I1/I2 payment observability tests, all continue to pass.

**Risk level:** Low.
- Blast radius = four function grants.
- Reversible via a symmetric `GRANT EXECUTE` migration.
- No client-visible surface change (functions were never legitimately callable from client code — only from admin/service paths).

**Sandbox verifiable:** yes. Rollback proof runs entirely in-transaction; static grant guard is a file scan.

**Exact next status string (pre-inspection):**
`BATCH_K_FUNCTION_EXECUTE_LOCKDOWN_INSPECTION_REQUESTED`

**Exact next status string (post safe apply):**
`BATCH_K_FUNCTION_EXECUTE_LOCKDOWN_DEPLOYED_PENDING_VERIFICATION`

---

## Confirmation

No files edited under `src/`, `supabase/`, `scripts/`, or elsewhere in the runtime tree. No migrations, edge deploys, RLS/grant/policy/schema/storage/cron/config/ownership changes. No data mutation. No provider/email/notification side effects.
