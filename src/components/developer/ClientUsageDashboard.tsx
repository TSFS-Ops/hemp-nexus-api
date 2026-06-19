/**
 * Public API V1 · Batch 8 — Client Usage Dashboard.
 *
 * Client-facing dashboard that shows ONE api_client's own usage for a
 * billing period. Authorised viewers:
 *   • platform_admin (any client)
 *   • api_admin / auditor (read-only, any client)
 *   • org_admin of api_clients.org_id (their own client only)
 *
 * Cross-client leakage is prevented at the database via the SECURITY
 * DEFINER RPC `get_api_client_usage_summary` + `can_view_api_client_usage`.
 *
 * Hard exclusions (Batch 8): no payment collection, no invoices, no tax
 * logic, no /v1/docs, no /v1/docs/openapi.json, no public /v1/usage/current
 * endpoint, no internal monitoring dashboard, no support intake, no
 * webhook changes, no write API, no evidence/document/POI/WaD/payment/
 * compliance fields, no raw key material, no raw key hashes.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Download, Info, Loader2, RefreshCw } from "lucide-react";

interface ApiClientOption {
  id: string;
  legal_entity_name: string;
  org_id: string;
}

interface UsageSummary {
  api_client_id: string;
  api_client_name: string;
  plan_id: string | null;
  plan_name: string | null;
  currency: string | null;
  monthly_fee: number;
  billing_period_start: string;
  billing_period_end: string;
  total_requests: number;
  successful_lookup_calls: number;
  successful_summary_calls: number;
  billable_calls: number;
  non_billable_calls: number;
  sandbox_calls: number;
  production_calls: number;
  error_count: number;
  rate_limit_events: number;
  monthly_included_allowance: number;
  allowance_used: number;
  overage_calls: number;
  overage_allowed: boolean;
  estimated_overage_amount: number;
  estimated_total_amount: number;
  usage_percentage: number | null;
  last_successful_call: string | null;
  last_failed_call: string | null;
  disclaimer: string;
  generated_at: string;
}

/** ALLOWED CSV columns — kept in sync with get_api_client_usage_csv_rows. */
const CSV_COLUMNS = [
  "billing_period_start",
  "billing_period_end",
  "request_timestamp",
  "endpoint",
  "method",
  "environment",
  "status_code",
  "billable",
  "error_code",
  "response_time_ms",
  "external_reference",
  "request_id",
] as const;

/** Forbidden tokens — guard against accidental column drift. */
const FORBIDDEN_CSV_TOKENS = [
  "api_key", "key_hash", "secret", "bearer", "password",
  "document", "evidence", "governance", "poi", "wad",
  "payment", "credit_card", "bank", "compliance_note",
  "internal_note", "private_contact",
];

function monthOptions(count = 6): Array<{ value: string; label: string }> {
  const now = new Date();
  const opts: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    opts.push({
      value: d.toISOString(),
      label: d.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
    });
  }
  return opts;
}

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-GB");
}

function fmtMoney(n: number | null | undefined, currency: string | null): string {
  if (n === null || n === undefined) return "—";
  const cur = currency ?? "";
  return `${cur ? cur + " " : ""}${n.toFixed(2)}`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function ClientUsageDashboard() {
  const [clients, setClients] = useState<ApiClientOption[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [period, setPeriod] = useState<string>(monthOptions(1)[0].value);
  const [envFilter, setEnvFilter] = useState<string>("all");
  const [endpointFilter, setEndpointFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [billableFilter, setBillableFilter] = useState<string>("all");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Load clients the viewer is allowed to see (RLS on api_clients already
  // restricts to platform_admin / api_admin / auditor; org admins read via
  // a separate path — see notes in completion report).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("api_clients")
          .select("id, legal_entity_name, org_id")
          .order("legal_entity_name", { ascending: true });
        if (cancelled) return;
        if (error) {
          toast.error("Unable to load API clients", { description: error.message });
          return;
        }
        const list = (data ?? []) as ApiClientOption[];
        setClients(list);
        if (list.length > 0 && !selectedClient) setSelectedClient(list[0].id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        toast.error("Unable to load API clients", { description: msg });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSummary = async () => {
    if (!selectedClient) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_api_client_usage_summary", {
        p_api_client_id: selectedClient,
        p_period_start: period,
      } as never);
      if (error) {
        setSummary(null);
        toast.error("Unable to load usage", { description: error.message });
      } else {
        setSummary(data as unknown as UsageSummary);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Unable to load usage", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedClient) loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient, period]);

  const exportCsv = async () => {
    if (!selectedClient || !summary) return;
    setExporting(true);
    try {
      const args = {
        p_api_client_id: selectedClient,
        p_period_start: summary.billing_period_start,
        p_period_end: summary.billing_period_end,
        p_environment: envFilter === "all" ? null : envFilter,
        p_endpoint: endpointFilter === "all" ? null : endpointFilter,
        p_status: statusFilter === "all" ? null : statusFilter,
        p_billable: billableFilter === "all" ? null : billableFilter,
      } as never;
      const { data, error } = await supabase.rpc("get_api_client_usage_csv_rows", args);
      if (error) {
        toast.error("Export failed", { description: error.message });
        return;
      }
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      // Defensive: ensure no forbidden tokens slipped into the payload.
      const sample = JSON.stringify(rows.slice(0, 5)).toLowerCase();
      for (const t of FORBIDDEN_CSV_TOKENS) {
        if (sample.includes(t)) {
          toast.error("Export blocked", { description: `Forbidden field "${t}" present in payload.` });
          return;
        }
      }
      const header = CSV_COLUMNS.join(",");
      const body = rows
        .map((r) => CSV_COLUMNS.map((c) => csvEscape(r[c])).join(","))
        .join("\n");
      const csv = header + "\n" + body + "\n";
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const periodLabel = summary.billing_period_start.slice(0, 7);
      a.download = `api-usage-${summary.api_client_name.replace(/\W+/g, "-")}-${periodLabel}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Audit (best-effort; client-initiated).
      await supabase.rpc("log_api_client_usage_csv_export", {
        p_api_client_id: selectedClient,
        p_period_start: summary.billing_period_start,
        p_period_end: summary.billing_period_end,
        p_row_count: rows.length,
      } as never);

      toast.success(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Export failed", { description: msg });
    } finally {
      setExporting(false);
    }
  };

  const months = useMemo(() => monthOptions(6), []);

  return (
    <section className="space-y-6" data-testid="client-usage-dashboard">
      {/* Disclaimer */}
      <div className="rounded-sm border border-amber-700/40 bg-amber-950/30 px-4 py-3">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" strokeWidth={1.75} />
          <p className="text-[12.5px] text-amber-200 leading-relaxed" data-testid="usage-disclaimer">
            Usage and charges shown here are estimates for visibility only. This is not an invoice and does not collect payment.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">API client</label>
          <Select value={selectedClient} onValueChange={setSelectedClient}>
            <SelectTrigger className="w-[260px] bg-slate-900 border-slate-800 text-slate-200">
              <SelectValue placeholder="Select client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.legal_entity_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Billing period</label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[200px] bg-slate-900 border-slate-800 text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Environment</label>
          <Select value={envFilter} onValueChange={setEnvFilter}>
            <SelectTrigger className="w-[150px] bg-slate-900 border-slate-800 text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="production">Production</SelectItem>
              <SelectItem value="sandbox">Sandbox</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Endpoint</label>
          <Select value={endpointFilter} onValueChange={setEndpointFilter}>
            <SelectTrigger className="w-[230px] bg-slate-900 border-slate-800 text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="/v1/counterparty/lookup">/v1/counterparty/lookup</SelectItem>
              <SelectItem value="/v1/counterparty/summary">/v1/counterparty/summary</SelectItem>
              <SelectItem value="/v1/health">/v1/health</SelectItem>
              <SelectItem value="/v1/status">/v1/status</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] bg-slate-900 border-slate-800 text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Billable</label>
          <Select value={billableFilter} onValueChange={setBillableFilter}>
            <SelectTrigger className="w-[150px] bg-slate-900 border-slate-800 text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="billable">Billable</SelectItem>
              <SelectItem value="non_billable">Non-billable</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={loadSummary} disabled={loading || !selectedClient}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            Refresh
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={exporting || !summary} data-testid="csv-export-btn">
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
            Export CSV
          </Button>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" data-testid="usage-summary">
          <StatBlock label="API client" value={summary.api_client_name} mono={false} />
          <StatBlock label="Current plan" value={summary.plan_name ?? "— (default allowance)"} mono={false} />
          <StatBlock label="Billing period" value={`${summary.billing_period_start.slice(0, 10)} → ${summary.billing_period_end.slice(0, 10)}`} />
          <StatBlock label="Overage allowed" value={summary.overage_allowed ? "Yes" : "No"} />

          <StatBlock label="Total requests" value={fmtNumber(summary.total_requests)} />
          <StatBlock label="Successful lookups" value={fmtNumber(summary.successful_lookup_calls)} />
          <StatBlock label="Successful summaries" value={fmtNumber(summary.successful_summary_calls)} />
          <StatBlock label="Error count" value={fmtNumber(summary.error_count)} accent={summary.error_count > 0 ? "amber" : undefined} />

          <StatBlock label="Billable calls" value={fmtNumber(summary.billable_calls)} />
          <StatBlock label="Non-billable calls" value={fmtNumber(summary.non_billable_calls)} />
          <StatBlock label="Sandbox calls" value={fmtNumber(summary.sandbox_calls)} />
          <StatBlock label="Production calls" value={fmtNumber(summary.production_calls)} />

          <StatBlock label="Monthly allowance" value={fmtNumber(summary.monthly_included_allowance)} />
          <StatBlock label="Allowance used" value={fmtNumber(summary.allowance_used)} />
          <StatBlock label="Overage calls" value={fmtNumber(summary.overage_calls)} accent={summary.overage_calls > 0 ? "amber" : undefined} />
          <StatBlock
            label="Usage %"
            value={summary.usage_percentage === null ? "—" : `${summary.usage_percentage.toFixed(1)}%`}
            accent={summary.usage_percentage !== null && summary.usage_percentage >= 100 ? "amber" : undefined}
          />

          <StatBlock label="Estimated overage" value={fmtMoney(summary.estimated_overage_amount, summary.currency)} />
          <StatBlock label="Estimated total (est.)" value={fmtMoney(summary.estimated_total_amount, summary.currency)} />
          <StatBlock label="Rate-limit events" value={fmtNumber(summary.rate_limit_events)} accent={summary.rate_limit_events > 0 ? "amber" : undefined} />
          <StatBlock label="Currency" value={summary.currency ?? "—"} />

          <StatBlock label="Last successful call" value={fmtDate(summary.last_successful_call)} />
          <StatBlock label="Last failed call" value={fmtDate(summary.last_failed_call)} />
        </div>
      )}

      {!summary && !loading && (
        <div className="rounded-sm border border-slate-800 bg-slate-900/40 px-5 py-8 text-center text-[13px] text-slate-400">
          Select an API client to view usage.
        </div>
      )}
    </section>
  );
}

function StatBlock({
  label,
  value,
  mono = true,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: "amber" | "green";
}) {
  const accentClass =
    accent === "amber" ? "text-amber-300" :
    accent === "green" ? "text-emerald-300" :
    "text-slate-100";
  return (
    <div className="rounded-sm border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-1.5 ${mono ? "font-mono" : ""} text-[14px] ${accentClass} break-words`}>
        {value}
      </div>
    </div>
  );
}

export default ClientUsageDashboard;
