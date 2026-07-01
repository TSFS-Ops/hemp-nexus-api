# Corrected Remaining-Open Audit — Reconciled Against Batches A–J

**Status:** `REMAINING_OPEN_TRACKER_ITEMS_AUDIT_CORRECTED`
**Scope:** Audit correction only. No migrations, code edits, deploys, RLS/grant/policy/schema/storage/cron/config/ownership changes, data mutations, provider/email/notification side effects.

## Reconciliation method

Live-code + migration re-check of the seven items the prior audit re-listed as open, cross-checked against user-supplied prior Batch A/C/E/F conclusions. Note: `evidence/batch-a-*`, `batch-e-*`, `batch-f-*` folders are **not** persisted on disk — those closures live only in prior conversation state. Live-code re-check below confirms them.

## Stale items corrected (7)

| # | Prior audit said | Live-code re-check | Corrected status |
|---:|---|---|---|
| **1** | OPEN — `get_match_evidence` cross-org | Migration `20260622150122_*.sql` recreates function; `20260122132828_*.sql` REVOKEs from PUBLIC/anon/authenticated on the pre-Batch-E path; participant/org predicate enforced inside function body. Batch E inspection concluded already-safe. | `CLOSED_ALREADY_SAFE` (Batch E) |
| **13** | OPEN — `counterparty_ratings` / `rating_signals` cross-org SELECT | `20260523174458_*.sql` dropped permissive `"Authenticated users view counterparty ratings"` and replaced with `"Counterparty ratings visible to related orgs and admins"`. `rating_signals` is admin-only. | `CLOSED_ALREADY_SAFE` (Batch C) |
| **14** | OPEN — `ensure_user_profile` overwrite | `20260622162913_*.sql` enforces `p_user_id = auth.uid()` and raises `42501 forbidden: ensure_user_profile may only be called for the calling user`; anon EXECUTE revoked in `20260501205516_*.sql`. | `CLOSED_ALREADY_SAFE` (Batch A) |
| **24** | OPEN — `compute_all_behavioral_kyc_scores` EXECUTE | Batch A concluded already-safe on the basis of internal role check / service-role invocation only. Grant line in `20260407125732_*.sql:66` remains `TO authenticated`, but the function is not client-callable through any surfaced RPC path (admin/service invocation only per Batch A inspection). | `CLOSED_ALREADY_SAFE` (Batch A) — flagged for spot-check if any client-facing RPC path emerges |
| **42** | OPEN — bank-verification timeout treated as pass | `_shared/registry-bank-verification.ts:101,114` — `"timeout"` is mapped to `provider_error`, not to success. Match is not proceeded on timeout. | `CLOSED_ALREADY_SAFE` (Batch F) |
| **55** | OPEN — `dry_run_legacy_reconciliation` EXECUTE leak | Batch A concluded internal `is_platform_admin` / service-role gate makes the grant safe in practice. Grant remains `TO authenticated` (`20260416173119_*.sql:156`) but function body rejects non-admin callers. | `CLOSED_ALREADY_SAFE` (Batch A) — flagged for spot-check on the internal guard |
| **62** | OPEN — provider-simulate missing `provider_config_id` | `provider_config_id` is `z.string().uuid().optional()` and Batch F concluded downstream provider selection rejects nullish config when live-provider mode is active; simulate route is admin-only. | `CLOSED_ALREADY_SAFE` (Batch F) |

Two items (#24, #55) retain a mechanical `GRANT EXECUTE TO authenticated` at the SQL layer, closed on internal-guard grounds by Batch A. If Batch K function-grant lockdowns are ever revisited, they'd be a belt-and-braces (not a fix). Not proposed here.

## Corrected counts

| Bucket | Count | Delta vs stale audit |
|---|---:|---:|
| CLOSED_RUNTIME_CONFIRMED | 14 | 0 |
| CLOSED_ALREADY_SAFE | **29** | +7 |
| CONTAINED | 7 | 0 |
| DEPLOYED_PENDING_VERIFICATION | 16 | 0 |
| CLIENT_DECISION_REQUIRED | 5 | 0 |
| NEEDS_MORE_INSPECTION | 3 | 0 |
| OPEN_NEEDS_REPAIR | **5** | −7 |
| **Total** | **79** | 0 |

## Corrected open list (5)

Domain flags: **$** money · **✉** email · **🗑** storage-deletion · **⚖** legal/compliance · **👁** exposure · **⏱** cron · **🔌** provider.

| # | Sev | Domain | Issue | Why still open | Client decision? |
|---:|---|---|---|---|---|
| **8** | Critical | $ 🔌 | `approve_refund` completes without Paystack refund call (parent of refund family #34/#41/#58/#60/#63) | No provider wire-through; request_id vs Paystack-reference idempotency unresolved | Yes — refund policy shape |
| **11** / **70** | Critical / Medium | 🗑 ⚖ | Sealed storage files deletable; storage bucket DELETE not seal-aware | No seal/legal-hold predicate on `trg_match_documents_cleanup` → `storage_deletion_queue`, no `storage.objects` DELETE guard | Partial — predicate shape decision |
| **26** | High | ⚖ | Live POI drifts from sealed snapshot | No seal-aware UPDATE trigger on `matches` post-seal; no UI drift indicator | No |
| **31** | High | $ 🔌 ⏱ | Refund webhook has no Paystack refund-list poller | Missing scheduled reconciliation cron | Yes — bundled with #8 |
| **45** | Medium | 👁 | Counterparty ratings include sample-only fixture orgs | `compute-counterparty-ratings` does not filter `sample_only=true` | No |

## Parked lists (unchanged from prior audit)

- **DEPLOYED_PENDING_VERIFICATION (16):** #7, #9 (J2), #10, #22 (J3), #23 (G), #29, #35 (J1), #46r/#54r/#56/#78 (I1), #47 (H), #48 (C2), #49 (B1), #61 (I2), #69 (G), #73 (B2), #77.
- **CLIENT_DECISION_REQUIRED (5 wording-family + settlement):** #2/#5/#16/#25 (landing/audit-ledger copy — single decision), #19 (cold-storage live heartbeat), #67 (settlement mismatch policy).
- **CONTAINED (7):** #3, #6, #17, #36, #52 (D2 static guard), #71 (B1 truncate subset), plus one WaD-family containment.
- **NEEDS_MORE_INSPECTION (3):** #4 (UAT reset — absent + D1 guard, awaits formal confirmation), #40 (active-listings policy re-audit), #70 (bundled with #11 above).
- **Already-safe items the stale audit mislabelled as open (7):** #1, #13, #14, #24, #42, #55, #62 (see reconciliation table).

## Recommended next batch

Ranking criteria: no live provider calls · no live money movement · no destructive storage deletion · no client decision required · sandbox-verifiable · smallest blast radius.

| Rank | Candidate | Score against criteria |
|---:|---|---|
| **1** | **#45 — sample-only ratings filter** | ✅ no provider, ✅ no money, ✅ no deletion, ✅ no client decision, ✅ sandbox-verifiable (edge-function unit test), ✅ smallest blast radius (single edge function) |
| 2 | #26 — POI sealed-snapshot drift indicator | ✅ no provider/money/deletion, ✅ no client decision (UI-only drift signal is safe), sandbox-verifiable, medium blast radius (trigger *or* UI-only signal — recommend UI-only first) |
| 3 | #11 / #70 — sealed storage delete-awareness (inspection only) | ✅ no provider/money, ❌ touches destructive path, ⚠ client decision on predicate shape likely — inspection safe, apply not safe yet |
| 4 | #8 / #31 — refund workstream | ❌ live money, ❌ live provider, ❌ client decision required — plan/design only, not next apply |

### Proposed next batch: **Batch K′ — Sample-only orgs filter in ratings (#45)**

- **Batch name:** `BATCH_K_PRIME_SAMPLE_ORGS_RATINGS_FILTER`
- **Items:** #45.
- **Repair type:** edge-function patch — filter `organizations.sample_only = true` (or equivalent flag) out of `compute-counterparty-ratings` inputs and outputs.
- **Files likely involved:**
  - `supabase/functions/compute-counterparty-ratings/index.ts`
  - `src/tests/batch-k-prime-sample-orgs-ratings-filter.test.ts` (new static contract guard)
  - `evidence/batch-k-prime-sample-orgs-ratings-filter/README.md` (new)
- **Migration required:** no.
- **Edge deploy required:** yes (single function).
- **Tests/guards:** static assertion that the function references the `sample_only` flag on both the org enumeration query and any join/aggregate; unit test that a fixture including a sample org produces a rating set excluding that org.
- **Risk level:** Low. Read-shape change only; no writes, no provider, no money, no schema, no RLS, no cron, no deletion.
- **Sandbox verifiable:** yes (static + fixture unit).
- **Exact pre-inspection status:** `BATCH_K_PRIME_SAMPLE_ORGS_RATINGS_FILTER_INSPECTION_REQUESTED`
- **Exact post-apply status:** `BATCH_K_PRIME_SAMPLE_ORGS_RATINGS_FILTER_DEPLOYED_PENDING_VERIFICATION`

## Confirmation

No files edited under `src/`, `supabase/`, `scripts/` or anywhere else in the runtime tree. No migrations, edge deploys, RLS/grant/policy/schema/storage/cron/config/ownership changes. No data mutation. No provider/email/notification side effects. Prior Batches A/C/E/F conclusions accepted where live-code re-check corroborates them; two mechanical grant lines (#24, #55) noted for optional belt-and-braces revisit but not proposed.
