/**
 * AdminApiMonitoringPanel — Public API V1 · Batch 9
 *
 * Internal operational monitoring view for Izenzo platform_admin /
 * api_admin / auditor only. Distinct from Batch 8 (client-facing
 * usage). All data is read via the SECURITY DEFINER RPC
 * `get_api_monitoring_overview`, which scopes by role and never
 * exposes raw keys, key hashes, secrets, documents, evidence,
 * governance, POI/WaD, payment or compliance fields.
 *
 * Status labels are operational only and do not imply compliance
 * clearance.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { RefreshCw, Download, ShieldAlert, Lock } from "lucide-react";

type Row = {
  api_client_id: string;
  api_client_name: string | null;
  org_id: string | null;
  client_status: string | null;
  environment: "sandbox" | "production";
  plan_id: string | null;
  plan_name: string | null;
  currency: string | null;
  monthly_fee: number | null;
  allowance: number;
  allowance_used: number;
  allowance_used_pct: number | null;
  overage_calls: number;
  overage_allowed: boolean;
  estimated_overage_amount: number;
  estimated_total_amount: number;
  request_count: number;
  successful_lookup_calls: number;
  successful_summary_calls: number;
  billable_calls: number;
  non_billable_calls: number;
  success_rate_pct: number | null;
  error_count: number;
  top_error_code: string | null;
  rate_limit_events: number;
  monthly_limit_events: number;
  failed_auth_attempts: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  key_count: number;
  active_key_count: number;
  suspended_revoked_key_count: number;
  expired_key_count: number;
  next_key_expiry: string | null;
  key_expiry_warning: boolean;
  ip_allowlist_exception_active: boolean;
  last_successful_call: string | null;
  last_failed_call: string | null;
  open_support_tickets: number | null;
  open_support_tickets_status: string;
  status_label:
    | "healthy"
    | "warning"
    | "blocked"
    | "suspended"
    | "no_recent_traffic"
    | "needs_attention";
  period_start: string;
  period_end: string;
};

const STATUS_TONE: Record<Row["status_label"], string> = {
  healthy: "bg-emerald-50 text-emerald-800 border-emerald-300",
  warning: "bg-amber-50 text-amber-800 border-amber-300",
  blocked: "bg-red-50 text-red-800 border-red-300",
  suspended: "bg-orange-50 text-orange-800 border-orange-300",
  no_recent_traffic: "bg-slate-100 text-slate-700 border-slate-300",
  needs_attention: "bg-amber-50 text-amber-900 border-amber-400",
};

// Operational status labels — do not imply compliance clearance.
const STATUS_LABELS: Row["status_label"][] = [
  "healthy",
  "warning",
  "blocked",
  "suspended",
  "no_recent_traffic",
  "needs_attention",
];

// Forbidden columns in the internal monitoring CSV. The dashboard exports
// SUMMARY rows only — never raw request logs, never key material.
const FORBIDDEN_CSV_TOKENS = [
  "key_hash",
  "api_key",
  "secret",
  "request_body",
  "response_body",
  "ip_address",
  "user_agent",
  "document",
  "evidence",
  "governance",
  "poi",
  "wad",
  "payment",
  "compliance",
];

function currentPeriodStartUTC(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return s;
  }
}

function fmtNumber(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined) return "—";
  return Number(n).toFixed(digits);
}

export function AdminApiMonitoringPanel() {
  const { user, roles } = useAuth();
  const isPlatformAdmin = roles?.includes("platform_admin");
  const hasAccess =
    isPlatformAdmin ||
    roles?.includes("api_admin") ||
    roles?.includes("auditor");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [periodStart, setPeriodStart] = useState<string>(currentPeriodStartUTC());
  const [environment, setEnvironment] = useState<string>("any");
  const [statusLabel, setStatusLabel] = useState<string>("any");
  const [apiClientId, setApiClientId] = useState<string>("");
  const [planId, setPlanId] = useState<string>("");
  const [minUsagePct, setMinUsagePct] = useState<string>("");
  const [errorsOnly, setErrorsOnly] = useState(false);

  const load = useCallback(async () => {
    if (!user || !hasAccess) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc(
        "get_api_monitoring_overview" as never,
        {
          p_period_start: periodStart,
          p_environment: environment === "any" ? null : environment,
          p_status_label: statusLabel === "any" ? null : statusLabel,
          p_api_client_id: apiClientId || null,
          p_plan_id: planId || null,
          p_min_usage_pct: minUsagePct === "" ? null : Number(minUsagePct),
          p_errors_only: errorsOnly,
        } as never,
      );
      if (error) throw error;
      setRows(((data as unknown as Row[]) || []));
    } catch (e: any) {
      toast.error(`Failed to load monitoring overview: ${e?.message || e}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    user,
    hasAccess,
    periodStart,
    environment,
    statusLabel,
    apiClientId,
    planId,
    minUsagePct,
    errorsOnly,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodEnd = useMemo(() => {
    const d = new Date(periodStart);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
  }, [periodStart]);

  const handleExportCsv = useCallback(async () => {
    if (!isPlatformAdmin) {
      toast.error("Only platform_admin can export the internal monitoring CSV.");
      return;
    }
    if (rows.length === 0) {
      toast.info("Nothing to export.");
      return;
    }
    const headers = [
      "period_start",
      "period_end",
      "api_client_id",
      "api_client_name",
      "org_id",
      "client_status",
      "environment",
      "plan_name",
      "status_label",
      "request_count",
      "successful_lookup_calls",
      "successful_summary_calls",
      "billable_calls",
      "non_billable_calls",
      "error_count",
      "top_error_code",
      "success_rate_pct",
      "avg_latency_ms",
      "p95_latency_ms",
      "rate_limit_events",
      "monthly_limit_events",
      "failed_auth_attempts",
      "allowance",
      "allowance_used",
      "allowance_used_pct",
      "overage_calls",
      "overage_allowed",
      "estimated_overage_amount",
      "estimated_total_amount",
      "currency",
      "key_count",
      "active_key_count",
      "suspended_revoked_key_count",
      "expired_key_count",
      "next_key_expiry",
      "key_expiry_warning",
      "ip_allowlist_exception_active",
      "last_successful_call",
      "last_failed_call",
      "open_support_tickets",
    ];

    // Defensive: re-scan that no forbidden field name slipped in.
    const headerBlob = headers.join(",").toLowerCase();
    for (const t of FORBIDDEN_CSV_TOKENS) {
      if (headerBlob.includes(t)) {
        toast.error(`CSV export blocked: forbidden column "${t}".`);
        return;
      }
    }

    const escape = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const body = rows
      .map((r) =>
        headers
          .map((h) => escape((r as unknown as Record<string, unknown>)[h]))
          .join(","),
      )
      .join("\n");
    const csv = headers.join(",") + "\n" + body;

    try {
      const { error } = await supabase.rpc(
        "log_api_monitoring_csv_export" as never,
        {
          p_period_start: periodStart,
          p_period_end: periodEnd,
          p_filters: {
            environment: environment === "any" ? null : environment,
            status_label: statusLabel === "any" ? null : statusLabel,
            api_client_id: apiClientId || null,
            plan_id: planId || null,
            min_usage_pct: minUsagePct === "" ? null : Number(minUsagePct),
            errors_only: errorsOnly,
          },
          p_row_count: rows.length,
        } as never,
      );
      if (error) throw error;
    } catch (e: any) {
      toast.error(`Audit log failed; export aborted: ${e?.message || e}`);
      return;
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `api-monitoring-${periodStart.slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} rows (audit logged).`);
  }, [
    isPlatformAdmin,
    rows,
    periodStart,
    periodEnd,
    environment,
    statusLabel,
    apiClientId,
    planId,
    minUsagePct,
    errorsOnly,
  ]);

  if (!user) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        <Lock className="inline h-4 w-4 mr-1" /> Sign in required.
      </div>
    );
  }
  if (!hasAccess) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        <ShieldAlert className="inline h-4 w-4 mr-1" /> Internal monitoring is
        restricted to platform_admin, api_admin and auditor.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Internal — Izenzo operational view (not client-facing)
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 max-w-2xl">
            Operational status labels (healthy / warning / blocked / suspended /
            no_recent_traffic / needs_attention) reflect API health only and do
            not imply compliance clearance. Estimates are visibility only — not
            invoices.
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => load()}
            disabled={loading}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={!isPlatformAdmin || rows.length === 0}
            title={
              isPlatformAdmin
                ? "Export summary rows (audit logged)"
                : "platform_admin only"
            }
          >
            <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 p-3 border border-border rounded-sm bg-card">
        <div>
          <Label className="text-xs">Billing period (UTC month)</Label>
          <Input
            type="month"
            value={periodStart.slice(0, 7)}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              if (y && m) {
                setPeriodStart(new Date(Date.UTC(y, m - 1, 1)).toISOString());
              }
            }}
          />
        </div>
        <div>
          <Label className="text-xs">Environment</Label>
          <Select value={environment} onValueChange={setEnvironment}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="sandbox">Sandbox</SelectItem>
              <SelectItem value="production">Production</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={statusLabel} onValueChange={setStatusLabel}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              {STATUS_LABELS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">API client ID</Label>
          <Input
            placeholder="uuid (optional)"
            value={apiClientId}
            onChange={(e) => setApiClientId(e.target.value.trim())}
          />
        </div>
        <div>
          <Label className="text-xs">Plan ID</Label>
          <Input
            placeholder="uuid (optional)"
            value={planId}
            onChange={(e) => setPlanId(e.target.value.trim())}
          />
        </div>
        <div>
          <Label className="text-xs">Min usage %</Label>
          <Input
            type="number"
            min={0}
            max={1000}
            placeholder="e.g. 80"
            value={minUsagePct}
            onChange={(e) => setMinUsagePct(e.target.value)}
          />
        </div>
        <div className="flex items-end gap-2">
          <Checkbox
            id="errors_only"
            checked={errorsOnly}
            onCheckedChange={(v) => setErrorsOnly(Boolean(v))}
          />
          <Label htmlFor="errors_only" className="text-xs">Errors only</Label>
        </div>
      </div>

      <div className="overflow-x-auto border border-border rounded-sm">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">Status</th>
              <th className="p-2">Client</th>
              <th className="p-2">Env</th>
              <th className="p-2">Plan</th>
              <th className="p-2 text-right">Requests</th>
              <th className="p-2 text-right">Lookups</th>
              <th className="p-2 text-right">Summaries</th>
              <th className="p-2 text-right">Errors</th>
              <th className="p-2">Top err</th>
              <th className="p-2 text-right">Success %</th>
              <th className="p-2 text-right">Avg ms</th>
              <th className="p-2 text-right">p95 ms</th>
              <th className="p-2 text-right">Rate-limit</th>
              <th className="p-2 text-right">Monthly-limit</th>
              <th className="p-2 text-right">Auth fails</th>
              <th className="p-2 text-right">Allowance</th>
              <th className="p-2 text-right">Used %</th>
              <th className="p-2 text-right">Overage</th>
              <th className="p-2 text-right">Est total</th>
              <th className="p-2 text-right">Keys (act/sus/exp)</th>
              <th className="p-2">Next expiry</th>
              <th className="p-2">IP exc</th>
              <th className="p-2">Last ok</th>
              <th className="p-2">Last fail</th>
              <th className="p-2">Tickets</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={25} className="p-4 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={25} className="p-4 text-center text-muted-foreground">No rows for the selected filters.</td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={`${r.api_client_id}:${r.environment}`} className="border-t border-border align-top">
                <td className="p-2">
                  <Badge variant="outline" className={STATUS_TONE[r.status_label]}>
                    {r.status_label}
                  </Badge>
                </td>
                <td className="p-2">
                  <div className="font-medium">{r.api_client_name || r.api_client_id.slice(0, 8)}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{r.api_client_id.slice(0, 8)}…</div>
                  {r.client_status && (
                    <div className="text-[10px] text-muted-foreground">{r.client_status}</div>
                  )}
                </td>
                <td className="p-2">{r.environment}</td>
                <td className="p-2">{r.plan_name || <span className="text-muted-foreground">—</span>}</td>
                <td className="p-2 text-right">{r.request_count}</td>
                <td className="p-2 text-right">{r.successful_lookup_calls}</td>
                <td className="p-2 text-right">{r.successful_summary_calls}</td>
                <td className="p-2 text-right">{r.error_count}</td>
                <td className="p-2">{r.top_error_code || "—"}</td>
                <td className="p-2 text-right">{fmtNumber(r.success_rate_pct, 1)}</td>
                <td className="p-2 text-right">{fmtNumber(r.avg_latency_ms, 0)}</td>
                <td className="p-2 text-right">{fmtNumber(r.p95_latency_ms, 0)}</td>
                <td className="p-2 text-right">{r.rate_limit_events}</td>
                <td className="p-2 text-right">{r.monthly_limit_events}</td>
                <td className="p-2 text-right">{r.failed_auth_attempts}</td>
                <td className="p-2 text-right">{r.allowance}</td>
                <td className="p-2 text-right">{fmtNumber(r.allowance_used_pct, 1)}</td>
                <td className="p-2 text-right">{r.overage_calls}</td>
                <td className="p-2 text-right">
                  {r.currency || ""} {fmtNumber(r.estimated_total_amount, 2)}
                </td>
                <td className="p-2 text-right">
                  {r.active_key_count}/{r.suspended_revoked_key_count}/{r.expired_key_count}
                </td>
                <td className="p-2">
                  {r.next_key_expiry ? (
                    <span className={r.key_expiry_warning ? "text-amber-700" : ""}>
                      {fmtDate(r.next_key_expiry)}
                    </span>
                  ) : "—"}
                </td>
                <td className="p-2">{r.ip_allowlist_exception_active ? "yes" : "no"}</td>
                <td className="p-2">{fmtDate(r.last_successful_call)}</td>
                <td className="p-2">{fmtDate(r.last_failed_call)}</td>
                <td className="p-2 text-muted-foreground">
                  {r.open_support_tickets === null ? "deferred" : r.open_support_tickets}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AdminApiMonitoringPanel;
