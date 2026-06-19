/**
 * AdminApiSecuritySignalsPanel — Public API V1 · Sand/Prod Batch 8
 *
 * Internal-only focused view of operational security signals across
 * api_clients for the current billing period. Reads the same SECURITY
 * DEFINER RPC `get_api_monitoring_overview` used by AdminApiMonitoringPanel,
 * then surfaces only rows with at least one security signal:
 *
 *   • failed_auth_attempts > 0
 *   • rate_limit_events    > 0
 *   • monthly_limit_events > 0
 *   • ip_allowlist_exception_active = true
 *   • status_label in ('blocked','suspended','needs_attention')
 *
 * NEVER exposes raw key material, key hashes, secrets, request bodies,
 * documents, evidence, governance, POI, WaD, payment or compliance
 * fields. No exports — this is a triage surface; full CSV exports remain
 * in AdminApiMonitoringPanel under platform_admin only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { Lock, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

type Row = {
  api_client_id: string;
  api_client_name: string | null;
  environment: "sandbox" | "production";
  client_status: string | null;
  status_label: string;
  failed_auth_attempts: number;
  rate_limit_events: number;
  monthly_limit_events: number;
  ip_allowlist_exception_active: boolean;
  last_failed_call: string | null;
};

const STATUS_TONE: Record<string, string> = {
  healthy: "bg-emerald-50 text-emerald-800 border-emerald-300",
  warning: "bg-amber-50 text-amber-800 border-amber-300",
  blocked: "bg-red-50 text-red-800 border-red-300",
  suspended: "bg-orange-50 text-orange-800 border-orange-300",
  no_recent_traffic: "bg-slate-100 text-slate-700 border-slate-300",
  needs_attention: "bg-amber-50 text-amber-900 border-amber-400",
};

function currentPeriodStartUTC(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function hasSecuritySignal(r: Row): boolean {
  return (
    (r.failed_auth_attempts ?? 0) > 0 ||
    (r.rate_limit_events ?? 0) > 0 ||
    (r.monthly_limit_events ?? 0) > 0 ||
    r.ip_allowlist_exception_active === true ||
    r.status_label === "blocked" ||
    r.status_label === "suspended" ||
    r.status_label === "needs_attention"
  );
}

export function AdminApiSecuritySignalsPanel() {
  const { user, roles } = useAuth();
  const roleStrings = (roles ?? []) as readonly string[];
  const hasAccess =
    roleStrings.includes("platform_admin") ||
    roleStrings.includes("api_admin") ||
    roleStrings.includes("auditor");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [environment, setEnvironment] = useState<string>("any");
  const [periodStart] = useState<string>(currentPeriodStartUTC());

  const load = useCallback(async () => {
    if (!user || !hasAccess) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc(
        "get_api_monitoring_overview" as never,
        {
          p_period_start: periodStart,
          p_environment: environment === "any" ? null : environment,
          p_status_label: null,
          p_api_client_id: null,
          p_plan_id: null,
          p_min_usage_pct: null,
          p_errors_only: false,
        } as never,
      );
      if (error) throw error;
      setRows(((data as unknown as Row[]) || []).filter(hasSecuritySignal));
    } catch (e: any) {
      toast.error(`Failed to load security signals: ${e?.message ?? e}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user, hasAccess, periodStart, environment]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () => ({
      clients: rows.length,
      failedAuth: rows.reduce((s, r) => s + (r.failed_auth_attempts ?? 0), 0),
      rateLimit: rows.reduce((s, r) => s + (r.rate_limit_events ?? 0), 0),
      monthlyLimit: rows.reduce((s, r) => s + (r.monthly_limit_events ?? 0), 0),
      ipExceptions: rows.filter((r) => r.ip_allowlist_exception_active).length,
    }),
    [rows],
  );

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
        <ShieldAlert className="inline h-4 w-4 mr-1" /> Security signals are
        restricted to platform_admin, api_admin and auditor.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Internal — Public API V1 security signals (current UTC month)
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 max-w-2xl">
            Operational signals only — failed authentication attempts, rate-limit
            and monthly-limit blocks, active IP-allowlist exceptions, and clients
            in blocked / suspended / needs_attention status. No raw key
            material, no request bodies, no compliance fields.
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs">Environment</Label>
            <Select value={environment} onValueChange={setEnvironment}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="sandbox">Sandbox</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SignalStat label="Clients with signals" value={totals.clients} />
        <SignalStat label="Failed auth attempts" value={totals.failedAuth} accent={totals.failedAuth > 0 ? "amber" : undefined} />
        <SignalStat label="Rate-limit events" value={totals.rateLimit} accent={totals.rateLimit > 0 ? "amber" : undefined} />
        <SignalStat label="Monthly-limit events" value={totals.monthlyLimit} accent={totals.monthlyLimit > 0 ? "amber" : undefined} />
        <SignalStat label="Active IP exceptions" value={totals.ipExceptions} accent={totals.ipExceptions > 0 ? "amber" : undefined} />
      </div>

      <div className="overflow-x-auto border border-border rounded-sm">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">Status</th>
              <th className="p-2">Client</th>
              <th className="p-2">Env</th>
              <th className="p-2 text-right">Failed auth</th>
              <th className="p-2 text-right">Rate-limit</th>
              <th className="p-2 text-right">Monthly-limit</th>
              <th className="p-2">IP exception</th>
              <th className="p-2">Last failure</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-muted-foreground">
                  No security signals for the selected environment.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={`${r.api_client_id}:${r.environment}`} className="border-t border-border align-top">
                  <td className="p-2">
                    <Badge
                      variant="outline"
                      className={STATUS_TONE[r.status_label] ?? "bg-slate-100 text-slate-700 border-slate-300"}
                    >
                      {r.status_label}
                    </Badge>
                  </td>
                  <td className="p-2">
                    <div className="font-medium">{r.api_client_name || r.api_client_id.slice(0, 8)}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{r.api_client_id.slice(0, 8)}…</div>
                  </td>
                  <td className="p-2">{r.environment}</td>
                  <td className="p-2 text-right">{r.failed_auth_attempts ?? 0}</td>
                  <td className="p-2 text-right">{r.rate_limit_events ?? 0}</td>
                  <td className="p-2 text-right">{r.monthly_limit_events ?? 0}</td>
                  <td className="p-2">{r.ip_allowlist_exception_active ? "yes" : "no"}</td>
                  <td className="p-2 font-mono">
                    {r.last_failed_call ? new Date(r.last_failed_call).toISOString().slice(0, 19).replace("T", " ") : "—"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-muted-foreground">
        Triage view only. Use Admin → API Monitoring for the full operational table and CSV export (platform_admin only).
      </div>
    </div>
  );
}

function SignalStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "amber";
}) {
  const tone = accent === "amber" ? "text-amber-800" : "text-slate-800";
  return (
    <div className="border border-border rounded-sm bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg ${tone}`}>{value.toLocaleString()}</div>
    </div>
  );
}

export default AdminApiSecuritySignalsPanel;
