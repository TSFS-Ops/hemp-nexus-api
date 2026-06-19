/**
 * AdminApiUsageAlertsPanel — API Usage Dashboard V1 · Batch 4
 *
 * Internal-only alerts & suspicious-activity flags surface.
 * Read-gated by `can_access_api_monitoring` (platform_admin / api_admin /
 * auditor). Mutations (acknowledge/resolve/note) require platform_admin.
 *
 * Never displays payload bodies, full keys, secrets, client IPs,
 * user-agent strings or stack traces — alert metadata is server-side stripped.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { RefreshCw, ShieldAlert, Lock, ShieldCheck, BellRing, UserCheck, UserMinus } from "lucide-react";
import { toast } from "sonner";

type AlertRow = {
  id: string;
  alert_type: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "acknowledged" | "resolved";
  api_client_id: string | null;
  api_client_name: string | null;
  api_key_id: string | null;
  api_key_alias: string | null;
  environment: "sandbox" | "production" | null;
  trigger_value: number | null;
  threshold_value: number | null;
  details: Record<string, unknown>;
  latest_note: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
};

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const SEVERITY_TONE: Record<string, string> = {
  critical: "bg-red-50 text-red-800 border-red-300",
  warning: "bg-amber-50 text-amber-800 border-amber-300",
  info: "bg-slate-100 text-slate-700 border-slate-300",
};
const STATUS_TONE: Record<string, string> = {
  open: "bg-red-50 text-red-800 border-red-300",
  acknowledged: "bg-amber-50 text-amber-900 border-amber-400",
  resolved: "bg-emerald-50 text-emerald-800 border-emerald-300",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return s;
  }
}

export function AdminApiUsageAlertsPanel() {
  const { user, roles } = useAuth();
  const roleStrings = (roles ?? []) as readonly string[];
  const isPlatformAdmin = roleStrings.includes("platform_admin");
  const hasAccess =
    isPlatformAdmin ||
    roleStrings.includes("api_admin") ||
    roleStrings.includes("auditor");

  const [rows, setRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [status, setStatus] = useState<string>("open");
  const [environment, setEnvironment] = useState<string>("any");
  const [severity, setSeverity] = useState<string>("any");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const [assignment, setAssignment] = useState<string>("any"); // any | mine | unassigned

  const load = useCallback(async () => {
    if (!user || !hasAccess) return;
    setLoading(true);
    try {
      const p_assigned_to =
        assignment === "mine" ? user.id
        : assignment === "unassigned" ? NIL_UUID
        : null;
      const { data, error } = await supabase.rpc(
        "list_api_usage_alerts" as never,
        {
          p_status: status === "any" ? null : status,
          p_environment: environment === "any" ? null : environment,
          p_severity: severity === "any" ? null : severity,
          p_api_client_id: null,
          p_limit: 200,
          p_assigned_to,
        } as never,
      );
      if (error) throw error;
      setRows(((data as unknown as AlertRow[]) || []));
    } catch (e: any) {
      toast.error(`Failed to load alerts: ${e?.message ?? e}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user, hasAccess, status, environment, severity, assignment]);

  useEffect(() => {
    void load();
  }, [load]);

  const runDetection = useCallback(async () => {
    if (!isPlatformAdmin) return;
    setDetecting(true);
    try {
      const { error } = await supabase.rpc("detect_api_usage_alerts" as never);
      if (error) throw error;
      const { error: balErr } = await supabase.rpc(
        "detect_api_token_balance_alerts" as never,
      );
      if (balErr) throw balErr;
      toast.success("Detection sweep complete");
      await load();
    } catch (e: any) {
      toast.error(`Detection failed: ${e?.message ?? e}`);
    } finally {
      setDetecting(false);
    }
  }, [isPlatformAdmin, load]);

  const acknowledge = useCallback(
    async (id: string) => {
      try {
        const { error } = await supabase.rpc(
          "acknowledge_api_usage_alert" as never,
          { p_alert_id: id, p_note: noteDrafts[id] || null } as never,
        );
        if (error) throw error;
        toast.success("Alert acknowledged");
        await load();
      } catch (e: any) {
        toast.error(`Acknowledge failed: ${e?.message ?? e}`);
      }
    },
    [noteDrafts, load],
  );

  const resolve = useCallback(
    async (id: string) => {
      try {
        const { error } = await supabase.rpc(
          "resolve_api_usage_alert" as never,
          { p_alert_id: id, p_note: noteDrafts[id] || null } as never,
        );
        if (error) throw error;
        toast.success("Alert resolved");
        await load();
      } catch (e: any) {
        toast.error(`Resolve failed: ${e?.message ?? e}`);
      }
    },
    [noteDrafts, load],
  );

  const addNote = useCallback(
    async (id: string) => {
      const note = (noteDrafts[id] ?? "").trim();
      if (!note) {
        toast.error("Note is required");
        return;
      }
      try {
        const { error } = await supabase.rpc(
          "add_api_usage_alert_note" as never,
          { p_alert_id: id, p_note: note } as never,
        );
        if (error) throw error;
        toast.success("Note added");
        setNoteDrafts((d) => ({ ...d, [id]: "" }));
        await load();
      } catch (e: any) {
        toast.error(`Add note failed: ${e?.message ?? e}`);
      }
    },
    [noteDrafts, load],
  );

  const assign = useCallback(
    async (id: string, assignee: string | null) => {
      try {
        const { error } = await supabase.rpc(
          "assign_api_usage_alert" as never,
          {
            p_alert_id: id,
            p_assignee: assignee,
            p_note: noteDrafts[id] || null,
          } as never,
        );
        if (error) throw error;
        toast.success(assignee ? "Alert assigned" : "Alert unassigned");
        await load();
      } catch (e: any) {
        toast.error(`Assign failed: ${e?.message ?? e}`);
      }
    },
    [noteDrafts, load],
  );

  const totals = useMemo(
    () => ({
      total: rows.length,
      open: rows.filter((r) => r.status === "open").length,
      critical: rows.filter((r) => r.severity === "critical").length,
      warning: rows.filter((r) => r.severity === "warning").length,
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
        <ShieldAlert className="inline h-4 w-4 mr-1" /> Internal API alerts are
        restricted to platform_admin, api_admin and auditor.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="admin-api-usage-alerts-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Internal — API alerts & suspicious activity (not client-facing)
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 max-w-2xl">
            Alerts are generated from existing API request logs, key lifecycle
            state and rate-limit signals. Flags do not auto-clear. Alert
            metadata never contains payloads, full keys, secrets, IPs or
            stack traces.
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Environment</Label>
            <Select value={environment} onValueChange={setEnvironment}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="sandbox">Sandbox</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Assignment</Label>
            <Select value={assignment} onValueChange={setAssignment}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="mine">Assigned to me</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {isPlatformAdmin && (
            <Button
              variant="default"
              size="sm"
              onClick={() => runDetection()}
              disabled={detecting}
              data-testid="api-usage-alerts-run-detection"
            >
              <BellRing className={`h-3.5 w-3.5 mr-1 ${detecting ? "animate-spin" : ""}`} />
              Run detection sweep
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total (filtered)" value={totals.total} />
        <Stat label="Open" value={totals.open} accent={totals.open > 0 ? "red" : undefined} />
        <Stat label="Critical" value={totals.critical} accent={totals.critical > 0 ? "red" : undefined} />
        <Stat label="Warning" value={totals.warning} accent={totals.warning > 0 ? "amber" : undefined} />
      </div>

      <div className="overflow-x-auto border border-border rounded-sm">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">Severity</th>
              <th className="p-2">Type</th>
              <th className="p-2">Client</th>
              <th className="p-2">Key</th>
              <th className="p-2">Env</th>
              <th className="p-2 text-right">Trigger</th>
              <th className="p-2 text-right">Threshold</th>
              <th className="p-2">Status</th>
              <th className="p-2">Owner</th>
              <th className="p-2">Created</th>
              <th className="p-2">Note / actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={11} className="p-4 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={11} className="p-4 text-center text-muted-foreground">No alerts for the selected filters.</td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="p-2">
                  <Badge variant="outline" className={SEVERITY_TONE[r.severity]}>{r.severity}</Badge>
                </td>
                <td className="p-2 font-mono">{r.alert_type}</td>
                <td className="p-2">
                  <div className="font-medium">{r.api_client_name || (r.api_client_id ? r.api_client_id.slice(0,8) : "—")}</div>
                  {r.api_client_id && (
                    <div className="text-[10px] text-muted-foreground font-mono">{r.api_client_id.slice(0,8)}…</div>
                  )}
                </td>
                <td className="p-2 font-mono">{r.api_key_alias || (r.api_key_id ? r.api_key_id.slice(0,8) + "…" : "—")}</td>
                <td className="p-2">{r.environment ?? "—"}</td>
                <td className="p-2 text-right font-mono">{r.trigger_value ?? "—"}</td>
                <td className="p-2 text-right font-mono">{r.threshold_value ?? "—"}</td>
                <td className="p-2">
                  <Badge variant="outline" className={STATUS_TONE[r.status]}>{r.status}</Badge>
                </td>
                <td className="p-2 text-[11px]">
                  {r.assigned_to ? (
                    <div>
                      <div className="font-mono">
                        {r.assigned_to === user!.id ? "you" : r.assigned_to.slice(0, 8) + "…"}
                      </div>
                      {r.assigned_at && (
                        <div className="text-muted-foreground font-mono text-[10px]">
                          {fmtDate(r.assigned_at)}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="p-2 font-mono">{fmtDate(r.created_at)}</td>
                <td className="p-2">
                  {r.latest_note && (
                    <div className="text-[11px] text-muted-foreground mb-1">
                      Last note: {r.latest_note}
                    </div>
                  )}
                  {isPlatformAdmin && r.status !== "resolved" && (
                    <div className="flex flex-col gap-1">
                      <Input
                        className="h-7 text-xs"
                        placeholder="Internal note (optional)"
                        value={noteDrafts[r.id] ?? ""}
                        onChange={(e) =>
                          setNoteDrafts((d) => ({ ...d, [r.id]: e.target.value }))
                        }
                      />
                      <div className="flex flex-wrap gap-1">
                        {r.status === "open" && (
                          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => acknowledge(r.id)}>
                            Acknowledge
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => resolve(r.id)}>
                          <ShieldCheck className="h-3 w-3 mr-1" /> Resolve
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => addNote(r.id)}>
                          Add note
                        </Button>
                        {r.assigned_to !== user!.id ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            onClick={() => assign(r.id, user!.id)}
                            data-testid={`api-usage-alert-claim-${r.id}`}
                          >
                            <UserCheck className="h-3 w-3 mr-1" />
                            {r.assigned_to ? "Reassign to me" : "Claim"}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[11px]"
                            onClick={() => assign(r.id, null)}
                            data-testid={`api-usage-alert-unassign-${r.id}`}
                          >
                            <UserMinus className="h-3 w-3 mr-1" />
                            Unassign
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-muted-foreground">
        Internal-only. Alerts do not auto-clear; mutations are audit-logged.
        No commercial state (pricing, quota, scopes) is changed by these actions.
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: "red" | "amber" }) {
  const tone = accent === "red" ? "text-red-800" : accent === "amber" ? "text-amber-800" : "text-slate-800";
  return (
    <div className="border border-border rounded-sm bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg ${tone}`}>{value.toLocaleString()}</div>
    </div>
  );
}

export default AdminApiUsageAlertsPanel;
