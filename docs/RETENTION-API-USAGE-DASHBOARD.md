# API Usage Dashboard V1 — Retention Alignment (Batch 5)

This is an alignment document. It records the retention rules the API Usage
Dashboard V1 surfaces depend on. **No destructive cleanup is introduced by
Batch 5.** Destructive enforcement is governed by the existing
`per-org-retention-shell` (DATA-004) policy and its scheduled crons.

## Categories

| Category | Source tables | Retention | Enforced by |
|---|---|---|---|
| Detailed request logs | `public.api_request_logs` | **12 months** | DATA-004 retention shell + scheduled purge cron (see `org_retention_policies`). Per-org policy may extend on contractual grounds. |
| Monthly usage summaries | derived (no separate table; aggregated on read via `get_api_monitoring_overview` / `get_api_client_usage_summary`) | **7 years** for billing-support / invoice-support exports | Generated from `api_request_logs`; export rows are audit-logged via `log_api_monitoring_csv_export` / `log_api_client_usage_csv_export` and the file itself is delivered through `auditedDownloadCSVRaw` which writes an `audit_logs` row. |
| Token / credit ledger summaries | `public.token_ledger`, `public.token_transactions`, `public.token_balances` | **7 years** | Existing financial-records policy (DATA-004). |
| Quota / allowance change audit records | `public.audit_logs`, `public.admin_audit_logs` | **7 years** | Existing audit-records policy (DATA-004). |
| Invoice-support exports | CSV files produced via the dashboards | **7 years** for the audit row (export event itself); the file is delivered to the operator browser and not stored server-side. | Audit row in `public.audit_logs` (action `public_api.v1.usage.csv_exported` and `report.exported`). |
| Security events / alerts | `public.api_usage_alerts`, `public.admin_audit_logs` rows for alert assignment / ack / resolve | **≥ 24 months**; longer if legal hold applies | DATA-004 retention shell. Legal holds are honoured via `public.legal_holds`. |

## Why Batch 5 does not run a destructive purge

- DATA-004 already owns the per-org retention shell and the scheduled purge
  crons. Re-implementing destructive cleanup here would duplicate that
  governance and risk over-deletion.
- Batch 5 is a non-rebuild hardening of the existing CSV export surface only.

## What Batch 5 does enforce

1. **Tenant scoping is server-side, not UI-only.** Both
   `get_api_client_usage_csv_rows` and `log_api_client_usage_csv_export`
   call `can_view_api_client_usage(auth.uid(), api_client_id)` before
   returning rows or writing audit, so URL / RPC manipulation cannot
   bypass it.
2. **No payloads / no key material leave the server.** Neither
   `request_body`, `response_body`, full `api_key`, `key_hash`, secrets,
   bearer tokens, webhook secrets, stack traces, provider credentials nor
   internal notes appear in the CSV row shape. Both panels run a
   `FORBIDDEN_CSV_TOKENS` defensive scan before download.
3. **Every export is audit-logged twice.** A domain-specific row in
   `public.audit_logs` (via the `log_api_*_csv_export` RPCs, capturing
   actor, scope, period, filters and row count) and a generic export row
   via `auditedDownloadCSVRaw` (admin path) — neither row contains file
   contents.
4. **No cross-client records in client exports.** The same RPC powers
   admin and client paths; `can_view_api_client_usage` short-circuits
   client admins to their own `org_id`.
5. **Admin exports require a non-empty reason (≥ 10 chars).** Prompted in
   `AdminApiMonitoringPanel.handleExportCsv` before any audit or download.

## Known deferrals (documented, not silently dropped)

| Item | Why deferred |
|---|---|
| Adding `method`, `error_code`, `api_key_id` / key-alias filters to `get_api_client_usage_csv_rows` | Requires an additive RPC signature change. Batch 5 is explicitly scoped as "not a rebuild"; signature-pinning tests live in Batch 1 and would need a coordinated update. Filters are still applied post-RPC by the existing UI where the underlying column is present. |
| Cross-cutting raw-row admin export across all clients in one CSV | `AdminApiMonitoringPanel` exports the aggregated monitoring overview today; raw-row cross-client export would require either widening the client RPC or adding an admin-only raw RPC. Per-client raw export is already available to platform_admin via the existing client RPC (the tenant gate allows admin roles). |
| `platform_support` export path | Role itself is deferred (Batch 2 / Batch 4 deferral). |
| Destructive retention cleanup of `api_request_logs` and `api_usage_alerts` | Owned by DATA-004; do not duplicate. |
