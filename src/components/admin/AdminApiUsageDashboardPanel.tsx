/**
 * AdminApiUsageDashboardPanel — API Usage Dashboard V1 · Batch 2
 *
 * Platform Admin operational dashboard. Internal-only. Composes the
 * cross-cutting summary cards on top of the existing
 *   • AdminApiMonitoringPanel  (per-client/per-env detail · Batch 9)
 *   • AdminApiSecuritySignalsPanel (security signals · Batch 9)
 *
 * Summary data is read via the SECURITY DEFINER RPC
 *   `get_api_usage_dashboard_summary`
 * which itself routes through `can_access_api_monitoring`. The RPC never
 * returns request_body / response_body / IP / user_agent / key material /
 * documents / evidence / governance / POI / WaD / payment / compliance
 * fields. Recent production errors expose ONLY timestamp, endpoint, method,
 * status code, error code, environment, request_id and api_client_id.
 *
 * Sections are organised so the operator can separate, at a glance:
 *   • Production vs Sandbox traffic
 *   • Billable vs Non-billable traffic
 *   • Operational health (latency, errors, rate-limits)
 *   • Commercial signals (quota threshold, keys lifecycle)
 *   • Security signals (delegated to AdminApiSecuritySignalsPanel)
 *   • Client-support signals (delegated to per-client panel)
 *
 * No mutations are performed by this view. CSV export and per-request log
 * drill-down are intentionally deferred to later batches.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { RefreshCw, ShieldAlert, Lock, AlertTriangle } from "lucide-react";
import { AdminApiMonitoringPanel } from "@/components/admin/AdminApiMonitoringPanel";
import { AdminApiSecuritySignalsPanel } from "@/components/admin/AdminApiSecuritySignalsPanel";
import { AdminApiUsageAlertsPanel } from "@/components/admin/AdminApiUsageAlertsPanel";

type Summary = {
  generated_at: string;
  today_start: string;
  today_end: string;
  month_start: string;
  month_end: string;
  today: {
    calls: number;
    production_calls: number;
    sandbox_calls: number;
    billable_calls: number;
    non_billable_calls: number;
    error_count: number;
  };
  month: {
    calls: number;
    production_calls: number;
    sandbox_calls: number;
    billable_calls: number;
    non_billable_calls: number;
    error_count: number;
    error_rate_pct: number | null;
    rate_limit_events: number;
    p50_response_ms: number | null;
    p95_response_ms: number | null;
  };
  active_api_clients: number;
  active_production_keys: number;
  keys_expiring_14d: number;
  quota_threshold_clients: number;
  top_endpoints: Array<{ endpoint: string; calls: number; errors: number }>;
  recent_production_errors: Array<{
    created_at: string;
    endpoint: string;
    method: string;
    status_code: number;
    error_code: string | null;
    environment: string;
    request_id: string | null;
    api_client_id: string | null;
  }>;
};

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return s;
  }
}

function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-300 bg-red-50"
      : tone === "warning"
      ? "border-amber-300 bg-amber-50"
      : "border-border bg-card";
  return (
    <div className={`rounded-sm border ${toneClass} p-3`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-xl font-semibold mt-1 font-mono">{value}</div>
      {hint ? (
        <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>
      ) : null}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mt-6 mb-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {subtitle ? (
        <div className="text-[11px] text-muted-foreground">{subtitle}</div>
      ) : null}
    </div>
  );
}

export function AdminApiUsageDashboardPanel() {
  const { user, roles } = useAuth();
  const roleStrings = (roles ?? []) as readonly string[];
  const isPlatformAdmin = roleStrings.includes("platform_admin");
  // Existing helper routes platform_admin / api_admin / auditor through.
  const hasAccess =
    isPlatformAdmin ||
    roleStrings.includes("api_admin") ||
    roleStrings.includes("auditor");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user || !hasAccess) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc(
        "get_api_usage_dashboard_summary" as never,
        {} as never,
      );
      if (error) throw error;
      setSummary((data as unknown as Summary) ?? null);
    } catch (e: any) {
      toast.error(`Failed to load API usage summary: ${e?.message || e}`);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [user, hasAccess]);

  useEffect(() => {
    void load();
  }, [load]);

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
        <ShieldAlert className="inline h-4 w-4 mr-1" /> Platform Admin API
        Usage Dashboard is restricted to platform_admin, api_admin and
        auditor.
      </div>
    );
  }

  const today = summary?.today;
  const month = summary?.month;
  const errRate = month?.error_rate_pct ?? null;
  const errTone: "default" | "warning" | "danger" =
    errRate === null ? "default" : errRate >= 5 ? "danger" : errRate >= 1 ? "warning" : "default";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Internal — Izenzo Platform Admin API Usage (not client-facing)
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 max-w-2xl">
            Operational view only. No raw payloads, IP addresses, user agents
            or key material are surfaced. Estimates shown for visibility — not
            invoices. Latency and error figures are for the current UTC month
            unless labelled otherwise.
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
        </div>
      </div>

      {/* ─── TODAY vs MONTH ─────────────────────────────────────────── */}
      <SectionHeader
        title="Volume — today / current UTC month"
        subtitle="Total traffic across all clients."
      />
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="Calls today" value={fmtNum(today?.calls)} />
        <StatCard label="Calls this month" value={fmtNum(month?.calls)} />
        <StatCard label="Active API clients" value={fmtNum(summary?.active_api_clients)} />
        <StatCard label="Active production keys" value={fmtNum(summary?.active_production_keys)} />
        <StatCard
          label="Keys expiring (14d)"
          value={fmtNum(summary?.keys_expiring_14d)}
          tone={summary && summary.keys_expiring_14d > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Quota-threshold clients"
          value={fmtNum(summary?.quota_threshold_clients)}
          hint="≥ 80% of allowance used"
          tone={summary && summary.quota_threshold_clients > 0 ? "warning" : "default"}
        />
      </div>

      {/* ─── PRODUCTION vs SANDBOX ─────────────────────────────────── */}
      <SectionHeader
        title="Production vs Sandbox"
        subtitle="Sandbox traffic is non-billable and isolated from production data."
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Production · today" value={fmtNum(today?.production_calls)} />
        <StatCard label="Production · month" value={fmtNum(month?.production_calls)} />
        <StatCard label="Sandbox · today" value={fmtNum(today?.sandbox_calls)} />
        <StatCard label="Sandbox · month" value={fmtNum(month?.sandbox_calls)} />
      </div>

      {/* ─── BILLABLE vs NON-BILLABLE ──────────────────────────────── */}
      <SectionHeader
        title="Billable vs Non-billable"
        subtitle="Health checks, errors and certain non-revenue calls are non-billable."
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Billable · today" value={fmtNum(today?.billable_calls)} />
        <StatCard label="Billable · month" value={fmtNum(month?.billable_calls)} />
        <StatCard label="Non-billable · today" value={fmtNum(today?.non_billable_calls)} />
        <StatCard label="Non-billable · month" value={fmtNum(month?.non_billable_calls)} />
      </div>

      {/* ─── OPERATIONAL HEALTH ────────────────────────────────────── */}
      <SectionHeader
        title="Operational health"
        subtitle="Latency, errors and rate-limit events for the current UTC month."
      />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="Failed calls"
          value={fmtNum(month?.error_count)}
          tone={month && month.error_count > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Error rate"
          value={errRate === null ? "—" : `${fmtNum(errRate, 2)}%`}
          tone={errTone}
        />
        <StatCard
          label="Rate-limit events"
          value={fmtNum(month?.rate_limit_events)}
          tone={month && month.rate_limit_events > 0 ? "warning" : "default"}
        />
        <StatCard
          label="p50 response (ms)"
          value={fmtNum(month?.p50_response_ms, 0)}
        />
        <StatCard
          label="p95 response (ms)"
          value={fmtNum(month?.p95_response_ms, 0)}
        />
      </div>

      {/* ─── TOP ENDPOINTS + RECENT PRODUCTION ERRORS ──────────────── */}
      <SectionHeader title="Top endpoints (this month)" />
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">Endpoint</th>
                <th className="p-2 text-right">Calls</th>
                <th className="p-2 text-right">Errors</th>
                <th className="p-2 text-right">Error %</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={4} className="p-3 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && (!summary || summary.top_endpoints.length === 0) && (
                <tr>
                  <td colSpan={4} className="p-3 text-center text-muted-foreground">
                    No endpoint traffic this month.
                  </td>
                </tr>
              )}
              {!loading &&
                summary?.top_endpoints.map((e) => {
                  const pct = e.calls > 0 ? (e.errors / e.calls) * 100 : 0;
                  return (
                    <tr key={e.endpoint} className="border-t border-border">
                      <td className="p-2 font-mono">{e.endpoint}</td>
                      <td className="p-2 text-right">{fmtNum(e.calls)}</td>
                      <td className="p-2 text-right">{fmtNum(e.errors)}</td>
                      <td className="p-2 text-right">{fmtNum(pct, 2)}%</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <SectionHeader
        title="Latest production errors (last 24h, up to 20)"
        subtitle="Timestamp, endpoint, status and request_id only. No payloads, no IPs, no key material."
      />
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">When (UTC)</th>
                <th className="p-2">Endpoint</th>
                <th className="p-2">Method</th>
                <th className="p-2">Status</th>
                <th className="p-2">Error code</th>
                <th className="p-2">Request ID</th>
                <th className="p-2">API client</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="p-3 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading &&
                (!summary || summary.recent_production_errors.length === 0) && (
                  <tr>
                    <td colSpan={7} className="p-3 text-center text-muted-foreground">
                      No production errors in the last 24 hours.
                    </td>
                  </tr>
                )}
              {!loading &&
                summary?.recent_production_errors.map((e, i) => (
                  <tr key={`${e.created_at}:${i}`} className="border-t border-border">
                    <td className="p-2 font-mono">{fmtDate(e.created_at)}</td>
                    <td className="p-2 font-mono">{e.endpoint}</td>
                    <td className="p-2">{e.method}</td>
                    <td className="p-2">
                      <Badge variant="outline" className="bg-red-50 text-red-800 border-red-300">
                        {e.status_code}
                      </Badge>
                    </td>
                    <td className="p-2">{e.error_code ?? "—"}</td>
                    <td className="p-2 font-mono text-[10px]">
                      {e.request_id ? e.request_id.slice(0, 12) + "…" : "—"}
                    </td>
                    <td className="p-2 font-mono text-[10px]">
                      {e.api_client_id ? e.api_client_id.slice(0, 8) + "…" : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ─── DEFERRALS NOTICE ──────────────────────────────────────── */}
      <div className="mt-4 rounded-sm border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
        <AlertTriangle className="inline h-3.5 w-3.5 mr-1 text-amber-700" />
        <strong>Batch 2 deferrals:</strong> CSV export of this dashboard,
        request-log detail drill-down, alert generation and the
        <code className="mx-1">platform_support</code> read-only role are
        intentionally not in this batch and will be addressed in later
        batches. Per-client export remains available via the existing
        Monitoring panel below for <code>platform_admin</code> only.
      </div>

      {/* ─── EMBED EXISTING PER-CLIENT MONITORING + SECURITY ───────── */}
      <SectionHeader
        title="Per-client API monitoring (drill-down)"
        subtitle="Existing internal monitoring panel — filters, statuses and CSV export."
      />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">API Monitoring · per client</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminApiMonitoringPanel />
        </CardContent>
      </Card>

      <SectionHeader
        title="Security signals"
        subtitle="Auth failures, rate-limit pressure and IP allowlist exceptions."
      />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">API Security · signals</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminApiSecuritySignalsPanel />
        </CardContent>
      </Card>

      <SectionHeader
        title="Alerts & suspicious activity (Batch 4)"
        subtitle="Internal-only alerts generated from existing logs and key lifecycle. Flags do not auto-clear."
      />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">API Usage Alerts · internal</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminApiUsageAlertsPanel />
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminApiUsageDashboardPanel;
