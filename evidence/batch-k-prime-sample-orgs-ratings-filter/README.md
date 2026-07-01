# Batch K′ — Sample-only orgs filter in counterparty ratings (#45)

**Status:** `BATCH_K_PRIME_SAMPLE_ORGS_RATINGS_FILTER_DEPLOYED_PENDING_VERIFICATION`
**Tracker item:** #45 — `compute-counterparty-ratings` did not filter sample/demo fixture organisations.

## Current exposure (pre-repair)

- Bulk mode enumerated **all** rows in `public.organizations` (1009 total, 10 with `is_demo=true`).
- Single-org mode had no demo-subject guard.
- `matches` query did not exclude rows with `is_demo=true` or `demo_dataset_id IS NOT NULL`.
- No counterparty-side demo-org exclusion existed even when the counterparty was a demo fixture.
- Result: real orgs could receive ratings/signals influenced by demo matches; demo orgs could receive ratings as though they were real counterparties.

## Source of truth

- `public.organizations.is_demo boolean` — 10 rows true today.
- `public.organizations.demo_dataset_id uuid` — 0 rows populated today (kept as belt-and-braces).
- `public.matches.is_demo boolean` and `public.matches.demo_dataset_id uuid` — row-level fixture markers.

No name-based inference used.

## Exclusion rule

1. Preload `demoOrgIds = { org.id | organizations.is_demo = true OR organizations.demo_dataset_id IS NOT NULL }`.
2. **Bulk mode subject enumeration:** `.eq("is_demo", false).is("demo_dataset_id", null)` on `organizations`.
3. **Single-org / any subject:** if `orgId ∈ demoOrgIds`, `computeForOrg` short-circuits with `{ ok: false, reason: "sample_or_demo_org_excluded" }` before any read or write.
4. **Matches query:** `.eq("is_demo", false).is("demo_dataset_id", null)`.
5. **Counterparty-side demo guard:** in-memory drop of any match whose counterparty (buyer or seller opposite the subject) is in `demoOrgIds`.

## Files changed

- `supabase/functions/compute-counterparty-ratings/index.ts` — filter added (`computeForOrg` signature now takes `demoOrgIds: Set<string>`; two guarded queries; one counterparty-side filter).
- `src/tests/batch-k-prime-sample-orgs-ratings-filter.test.ts` — 8 static contract guards (new).

**No other files edited.** No migration, no RLS/grant/policy/schema/storage/cron changes, no other edge functions touched.

## Tests / guards run

`bunx vitest run src/tests/batch-k-prime-sample-orgs-ratings-filter.test.ts` → **8 / 8 passed**.

Assertions:
1. Bulk enumeration filters `is_demo=false` + `demo_dataset_id IS NULL`.
2. `demoOrgIds` set is preloaded from `organizations` (`is_demo.eq.true,demo_dataset_id.not.is.null`).
3. `computeForOrg` accepts `demoOrgIds` and rejects subject orgs in the set with `sample_or_demo_org_excluded`.
4. Matches query excludes demo/fixture rows.
5. Matches whose counterparty is a demo fixture are filtered out.
6. No name/ilike inference.
7. No new broad DELETE — only the pre-existing per-org, per-methodology_version `rating_signals` replace remains; no `counterparty_ratings` delete introduced.
8. No RLS/grant/policy/schema/cron/storage/payment/refund/email tokens introduced.

## Data mutation

**None from this batch.** Behaviour applies to future compute runs.

- Historical `counterparty_ratings` / `rating_signals` rows for demo orgs are **not deleted** (per user directive — separate authorisation required).
- Real-org ratings previously computed with demo counterparties will be corrected on the next recompute for that org.

## Deployment

`compute-counterparty-ratings` deployed via `supabase--deploy_edge_functions`.

## Out of scope — confirmations

No changes to:
- RLS, grants, policies, schema, storage, cron.
- `paystack-webhook`, `payfast`, `token-purchase`, `transaction-reconciliation`, refund logic, token_ledger, `atomic_paid_credit_purchase`, `atomic_token_burn`.
- `process-email-queue`, `send-transactional-email`, `auth-email-hook`, `suppressed_emails`.
- WaD, POI, legal-hold, match-document seal triggers.
- `rating_methodology_versions`, scoring formula, weights, decay half-life, min sample size, band thresholds.
- Historical rating/signal rows.

## Final status

`BATCH_K_PRIME_SAMPLE_ORGS_RATINGS_FILTER_DEPLOYED_PENDING_VERIFICATION`
