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
