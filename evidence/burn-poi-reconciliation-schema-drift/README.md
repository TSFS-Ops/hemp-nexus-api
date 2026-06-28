# burn-poi-reconciliation schema-drift repair

## Root cause
`supabase/functions/burn-poi-reconciliation/index.ts` queried `pois.match_id`,
which does **not** exist on the live schema. Every scheduled run of jobid 31
(`burn-poi-reconciliation-daily`) failed with:

```
POI_FETCH_FAILED: column pois.match_id does not exist
```

Three open `admin_risk_items` rows (self-incident, staleness, heartbeat) all
trace to the same root cause.

## Canonical bridge
POI ↔ match linkage on the live schema is resolved through the
`poi_engagements` bridge table:

```
pois.id → poi_engagements.poi_id → poi_engagements.match_id → matches.id
```

## Scope of repair
Function-source repair only. **No** changes to:
- cron job 31 (schedule, command, payload, auth) — unchanged
- database schema, RLS, grants — unchanged
- business-state tables (pois, wads, matches, poi_engagements, token_ledger,
  ledger_events, balances, payments, refunds, registry, notifications,
  acceptance_receipts, email_send_log) — function remains read-only over all
  of these
- deploy manifest function name or `verify_jwt` posture
- the 3 existing open risk rows (left open until runtime confirmation)

## Sections changed
1. **Section 1 — BURN_WITHOUT_POI**: `pois.select("match_id").in("match_id", ...)`
   replaced with `poi_engagements.select("match_id, poi_id").in("match_id", ...).not("poi_id", "is", null)`.
2. **Section 2 — POI_WITHOUT_BURN**: removed `match_id` from `pois.select(...)`;
   added bridge query `poi_engagements.select("poi_id, match_id").in("poi_id", candidatePoiIds)`.
   POIs with **no** engagement bridge row are skipped (unilateral / fresh POIs
   have no expected counterparty burn pairing). Coverage is checked across
   **all** linked match_ids per POI.
3. **Section 4a — ENGAGEMENT_WITHOUT_POI**: coverage probe now uses
   `poi_engagements` (with non-null `poi_id`) instead of `pois.match_id`.
4. **Section 4b — WAD_POI_DRIFT**: removed `match_id` from `pois.select(...)`;
   poi → match linkage now resolved through `poi_engagements`. WaD org-mismatch
   checks now consider **all** engagements for the POI rather than only the
   first.
5. **Header comment block** updated to document the canonical bridge and the
   absence of `pois.match_id`.

## Sections unchanged
- Section 3 STATE_WITHOUT_LEDGER (already used `matches` + `ledger_events`)
- Section 4 MINTED_WITHOUT_ENGAGEMENT (already used `poi_engagements`)
- Section 5 risk-row writer (idempotent by title) and Section 5b stale-risk
  auto-close sweep
- Section 6 audit row writer
- Self-incident writer (`recordSelfIncident`)
- Internal-key / service-role / platform_admin auth posture

## Volume context
Past 7 days: zero POI mints and zero `declare_intent` burns recorded. No live
money risk was masked by the failing cron.

## Tests / guards
`src/tests/burn-poi-reconciliation-schema-drift-guard.test.ts` pins:
- zero `pois.select("...match_id...")` patterns remain
- canonical poi_engagements bridge usage in Sections 1, 2, 4a, 4b
- mutation safety: no writes to any business-state table
- regression: all six drift sections still exist
- internal-key / service-role / platform_admin auth posture preserved
- no `cron.schedule` / `cron.alter_job` / `cron.unschedule` in the function

## Cron / deploy
- Cron jobid 31 left **active and unchanged**.
- Function deployed under the same name (`burn-poi-reconciliation`) with
  unchanged auth posture.
- `verify_jwt` posture unchanged.

## Risk-row status
The 3 existing open risk rows (`fe13ee9a`, `a652d4e2`, `82b15c9b`) are **not**
resolved in this batch. They will be auto-closed by the Section 5b sweep once
the next scheduled tick of jobid 31 succeeds and finds zero matching live
drift conditions, OR they will be re-asserted with fresh self-incident detail
if the run still fails.

## Final status
- Before next scheduled tick: `BURN_POI_RECONCILIATION_SCHEMA_DRIFT_SOURCE_REPAIR_DEPLOYED`
- After successful tick:     `BURN_POI_RECONCILIATION_SCHEMA_DRIFT_REPAIR_RUNTIME_CONFIRMED`

Tracker is **not advanced** until runtime confirmation from the next scheduled
tick.

---

## Follow-up drift: `matches.updated_at` (distinct from `pois.match_id`)

### Root cause
After the prior `pois.match_id` repair, the next scheduled tick of jobid 31
(`burn-poi-reconciliation-daily`) failed with:

```
MINTED_MATCH_FETCH_FAILED: column matches.updated_at does not exist
```

This is a **separate** schema drift from the previous `pois.match_id` issue.
`public.matches` has no canonical row-level `updated_at` column. The 41
columns on the live table include only the following timestamps:

- `created_at`
- `settled_at`
- `counterparty_sighted_at`
- `buyer_committed_at`
- `seller_committed_at`
- `ai_last_run_at`

State transitions are captured via per-event timestamp columns and the
append-only `match_events` table, not a single mutable timestamp.

### Chosen replacement
Section 3 STATE_WITHOUT_LEDGER now windows on `created_at`.

Why not per-state timestamps:
- They are sparse — null on rows that have not reached that state.
- A `coalesce(...)` across them would silently change reconciliation semantics.
- The detector only needs a lookback horizon (LOOKBACK_DAYS), and
  `created_at` is the only row-level timestamp present on every match.
- The downstream `ledger_events.poi.minted` join is unchanged, so coverage
  semantics are preserved.

### Scope of repair
Source-only patch to `supabase/functions/burn-poi-reconciliation/index.ts`,
Section 3 only. **No** changes to:

- cron jobid 31 (schedule, command, payload, auth)
- database schema, RLS, grants, indexes, config
- business-state tables (function remains read-only over `pois`,
  `poi_engagements`, `matches`, `wads`, `ledger_events`, `token_ledger`,
  balances, payments, refunds, registry, notifications, `email_send_log`,
  `acceptance_receipts`)
- function name or `verify_jwt` posture
- the 3 existing open risk rows
- C6.5 / C6.6 / C6.7 (cron observability tracks remain untouched)

### Volume context
Past 7 days: 0 POI mints, 0 `declare_intent` burns. No live money risk was
masked by the failing cron. This is an observability/reporting failure only.

### Tests / guards added
`src/tests/burn-poi-reconciliation-schema-drift-guard.test.ts` extended with
a `matches.updated_at schema-drift guards` block pinning:

- no `matches`-scoped `.select/.gte/.lte/.order/.filter` references `updated_at`
- Section 3 windows on `.gte("created_at", sinceIso)`
- Section 3 orders by `.order("created_at", { ascending: false })`
- Section 3 row-type annotation no longer claims `updated_at`
- Section 3 payload no longer includes `updated_at: row.updated_at`
- header docstring documents that matches has no canonical `updated_at`

Existing mutation-safety and cron-posture guards re-asserted.

### Cron / deploy
- Cron jobid 31 left **active and unchanged**.
- Function will redeploy under the same name (`burn-poi-reconciliation`).
- `verify_jwt` posture unchanged.
- No manual invocation. No reconciliation run triggered by this change.

### Status
- Before next scheduled tick: `BURN_POI_RECONCILIATION_SCHEMA_DRIFT_MATCHES_UPDATED_AT_SOURCE_REPAIR_DEPLOYED_PENDING_TICK`
- After clean tick at 03:30 UTC:  `BURN_POI_RECONCILIATION_SCHEMA_DRIFT_MATCHES_UPDATED_AT_REPAIR_RUNTIME_CONFIRMED`

Tracker is **not advanced** until the next scheduled tick succeeds and the
existing open risk rows are either cleared by the Section 5b sweep or
re-asserted with fresh detail.
