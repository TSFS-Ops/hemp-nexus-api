## Point 6 — Admin/Client Usage Visibility · Gap-fill plan

Existing surfaces (`AdminApiMonitoringPanel`, `ClientUsageDashboard`, `WebhookLogs`, `api-usage-self-summary`, `api_request_logs`, `api_usage_alerts`, `api_keys`, `token_balances`) already cover most of David's spec. Below is only what's missing.

### Confirmed against DB

`api_request_logs` already stores: `billable`, `non_billable_reason`, `environment`, `error_code`, `token_cost_units` (credits burned), `quota_position_after` (closing balance), `request_id`, `endpoint`, `method`, `status_code`, `created_at`, `api_key_id`, `org_id`. No `api_key_alias` and no `opening_balance` column.

### What this build does

**1. New unified SSOT view (read-only)** — `public.v_api_usage_unified`

- Columns David listed: `id`, `org_id`, `api_client_id`, `api_client_name`, `api_key_id`, `api_key_alias` (joined `api_keys.name`, `last_four`), `endpoint`, `method`, `environment`, `request_id`, `created_at`, `status_code`, `status` (`success|error|rate_limited|unauthorized`), `billable`, `non_billable_reason`, `error_code`, `token_cost_units` (credits_burned), `quota_position_after` (closing_balance), `opening_balance` (computed: closing + cost when billable success, else closing).
- `SECURITY INVOKER`, RLS via underlying `api_request_logs` policies. Grants: `authenticated`, `service_role`.

**2. Two new RPCs** (security definer, role-gated, mirror existing CSV RPC contract)

- `get_api_client_usage_rows(p_api_client_id, p_period_start, p_period_end, filters…)` — caller's own client only, paginated (cap 500). Used by ClientUsageDashboard for the new per-request history table and customer CSV.
- `get_api_admin_usage_rows(p_api_client_id, p_period_start, p_period_end, filters…)` — `platform_admin|api_admin|auditor` only, paginated. Used by AdminApiMonitoringPanel drill-down + admin per-row CSV.

Both reuse `can_view_api_client_usage` for the customer one. Both return view columns minus `quota_position_after` raw — exposed as `closing_balance`. Forbidden tokens guarded server-side via existing `safeProjection`.

**3. ClientUsageDashboard gaps**

- Add **Request history** table under the existing summary grid: timestamp · endpoint · env · status · chargeable badge · credits burned · closing balance · non-charge reason · request id (mono). Default 50 rows, "Show more" up to 500.
- CSV columns extended with: `api_key_alias`, `chargeable`, `non_billable_reason`, `credits_burned`, `opening_balance`, `closing_balance`. Existing forbidden-token guard preserved.
- **Dashboard badges row** (compute-on-read, no new tables, no cron):
  - Low balance (`token_balances.balance ≤ minimum_required * 1.25`)
  - Zero balance (`balance ≤ 0`)
  - API key expiring (`expires_at ≤ now+14d`)
  - Suspended/revoked key present
  - Failed production calls > 25 in current period (from summary)
- No new alert table writes; no email; no cron.

**4. AdminApiMonitoringPanel gaps**

- New **Drill-down drawer** opened by clicking a client row → uses `get_api_admin_usage_rows`, same column set as customer view plus client name and org id.
- Existing admin summary CSV unchanged. New admin per-row CSV exported from the drawer (audit-logged via existing `log_api_monitoring_csv_export` extended with `p_scope='per_row'`).
- Same dashboard badges visible per row in summary table (uses existing `key_expiry_warning`, `ip_allowlist_exception_active`, `suspended_revoked_key_count`; adds low/zero balance derived from `token_balances`).

**5. No-credit enforcement verification (containment only)**

- Audit `supabase/functions/_shared/api-artefact-burn.ts` + every chargeable route in `supabase/functions/public-api/index.ts`.
- The `blocked_insufficient_credits` status already exists. Verify every chargeable handler calls the burn helper **before** producing the chargeable response and returns `402 insufficient_credits` on `blocked_insufficient_credits`. If any chargeable handler is missing the pre-call guard, add a single guard call. No ledger, no balance math changes.
- Static test guard added to assert every `chargeable: true` route file calls `burnApiArtefact` before its success response.

**6. Tests**

- `src/tests/point6-unified-usage-view.test.ts` — migration contains the view + grants; columns match David's spec; no forbidden columns; `api_key_alias` derived not raw.
- `src/tests/point6-customer-history-and-csv.test.ts` — new history table renders, CSV columns extended, forbidden-token guard preserved, server RPC name pinned.
- `src/tests/point6-admin-drilldown.test.ts` — drilldown drawer mounted, RPC name pinned, audit-log call still wired, per-row CSV gated to `platform_admin`.
- `src/tests/point6-dashboard-badges.test.ts` — badge thresholds match spec; no alert writes; no cron import.
- `src/tests/point6-no-credit-guard.test.ts` — every chargeable handler in `public-api/index.ts` calls `burnApiArtefact` and returns `insufficient_credits` on block.

### Out of scope (explicitly)

- No automated email/notification alerting (David accepted dashboard-only for P-4).
- No new pricing logic (David's "1 credit per successful chargeable production call" default is already the model).
- No webhook event types, OpenAPI changes, write API, OAuth/SSO, signup or payment collection.
- No changes to `token_ledger` semantics, `atomic_token_credit`, refund flow, RLS on `api_request_logs`/`api_keys`/`token_balances`, full keys, key hashes.
- No `opening_balance` column added to `api_request_logs` (derived in view only).

### Files changed

- **DB migration** — `v_api_usage_unified`, `get_api_client_usage_rows`, `get_api_admin_usage_rows`, extend `log_api_monitoring_csv_export` with optional `p_scope`.
- `src/components/developer/ClientUsageDashboard.tsx` — history table, extended CSV, badges row.
- `src/components/admin/AdminApiMonitoringPanel.tsx` — drill-down drawer + per-row CSV + per-row badges column.
- 5 new test files under `src/tests/`.
- No edge-function code changes unless step 5 finds a gap; if it does, only the affected route file in `supabase/functions/public-api/index.ts` is touched.

### What remains unresolved after this build

- Endpoint-specific pricing surfacing inside usage screens (David partially answered — defaulted to 1 credit per successful chargeable prod call until pricing is finalised).
- Automated email/SMS/in-app alerting for the dashboard badges.
- Customer-visible history beyond current+prior billing period (audit ledger remains retained server-side).
- Negative-balance exception flow if Izenzo later grants written approval.  
  
This plan is good. It is properly scoped to **Point 6 only** and it does not reopen unrelated payment, POI, WaD, refund, Payfast or ledger work.
  I would approve it, with one tightening point: **do not extend** `log_api_monitoring_csv_export` **unless absolutely necessary**. If the existing audit function can already capture the export event through metadata, use that instead. Changing DB functions just for `p_scope='per_row'` is acceptable only if it is backwards-compatible and tested.
  Send this:
  ```text
  Go.

  Proceed with the Point 6 — Admin/Client Usage Visibility gap-fill plan exactly as scoped.

  Approved build approach:

  - Build the read-only unified SSOT view `public.v_api_usage_unified`.
  - Add the two role-gated RPCs:
    - `get_api_client_usage_rows`
    - `get_api_admin_usage_rows`
  - Update the existing `ClientUsageDashboard` only for the missing request-history table, extended CSV, and dashboard badges.
  - Update the existing `AdminApiMonitoringPanel` only for the drill-down drawer, per-row CSV, and per-row badges.
  - Verify insufficient-credit containment only. Add a guard only if a chargeable production route can still proceed at zero balance.
  - Add the five test files listed.

  Keep this strictly limited to Point 6.

  Do not rebuild existing usage surfaces.
  Do not change token ledger semantics.
  Do not change `atomic_token_credit`.
  Do not change credit pricing.
  Do not add endpoint price visibility inside usage screens.
  Do not add automated alerting, cron, email, SMS, WhatsApp, or a new alerts pipeline.
  Do not expose full API keys.
  Do not add an `opening_balance` column to `api_request_logs`; derive it in the unified view only.
  Do not touch Payfast, Paystack webhook logic, refunds, POI, WaD, signup, OAuth/SSO, OpenAPI, or unrelated payment logic.

  One constraint:

  Only extend `log_api_monitoring_csv_export` with `p_scope='per_row'` if this is fully backwards-compatible and covered by tests. If the existing audit function can already record the export safely through existing metadata, use the existing function instead.

  Customer CSV:

  Ship customer CSV in this pass only if it is safely scoped to the caller’s own organisation through the approved RPC path and tests prove there is no org override or cross-organisation leakage. If that cannot be proven safely, ship admin CSV first and defer customer CSV.

  No-credit check:

  Verify the existing burn helper and public API chargeable routes. If the insufficient-credit guard already exists everywhere, do not change route logic. If there is a gap, add the smallest containment only to the affected route.

  Required tests/guards must prove:

  1. unified view exists and exposes only safe fields;
  2. client RPC returns only the caller’s own organisation usage;
  3. admin RPC is role-gated;
  4. admin filters work for client, endpoint, date range, environment, status, chargeable/non-chargeable, API key alias, and error type;
  5. client filters work for endpoint, date range, status, chargeable/non-chargeable, and API key alias where available;
  6. full API keys are never exposed in screen data or CSV;
  7. sandbox and production are clearly separated;
  8. chargeable and non-chargeable requests are distinguishable;
  9. non-charge reason is visible where available;
  10. opening balance is derived only, not stored as a new source column;
  11. admin CSV uses the unified usage source;
  12. customer CSV, if shipped, cannot export another organisation’s data;
  13. dashboard badges are read-only/computed and do not create alert rows or cron jobs;
  14. insufficient-credit handling is verified and, only if needed, contained with a 402 response and zero burn;
  15. no unrelated payment, Paystack, Payfast, refund, POI, WaD, pricing, key-generation, or ledger semantics are changed.

  Return a final summary with:

  - files changed;
  - migrations added;
  - tests added;
  - tests passed;
  - any route where insufficient-credit containment was needed;
  - anything genuinely deferred because it could not be completed safely before 1 July.
  ```