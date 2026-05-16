/**
 * AdminRiskAlarmsPanel
 * ────────────────────
 * Operational risk dashboard surfacing reconciliation mismatches across
 * engagements, dispatches, receipts and attestations.
 *
 * Alarms detected:
 *   A1 (critical) accepted_without_notification    — accepted, no dispatch ≤5 min
 *   A2 (high)     receipt_missing_attestation      — receipt exists, attestation missing
 *   A3 (high)     dispatch_stuck_pending           — dispatch pending >10 min
 *   A4 (medium)   delivered_without_message_id     — parity break
 *
 * One-click engagement trace jumps into the existing forensics surface
 * (?sub=forensics&trace=<engagement_id>) where admins can already inspect
 * dispatches, the receipt and the outreach log.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, RefreshCw, Search, Eye, ShieldAlert, ShieldX, ShieldQuestion } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

type Severity = "critical" | "high" | "medium";
type AlarmType =
  | "accepted_without_notification"
  | "receipt_missing_attestation"
  | "dispatch_stuck_pending"
  | "delivered_without_message_id";

interface AlarmRow {
  alarm_id: string;
  alarm_type: AlarmType;
  severity: Severity;
  engagement_id: string | null;
  match_id: string | null;
  org_id: string | null;
  counterparty_email: string | null;
  detected_at: string;
  summary: string;
  detail: Record<string, unknown> | null;
}

const ALARM_LABELS: Record<AlarmType, string> = {
  accepted_without_notification: "Accepted · no notification (5 min SLA)",
  receipt_missing_attestation: "Receipt · missing attestation",
  dispatch_stuck_pending: "Dispatch · stuck pending",
  delivered_without_message_id: "Dispatch · delivered without message_id",
};

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  high: "bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-400",
  medium: "bg-muted text-muted-foreground border-border",
};

const SEVERITY_ICON: Record<Severity, typeof ShieldAlert> = {
  critical: ShieldX,
  high: ShieldAlert,
  medium: ShieldQuestion,
};

const WINDOW_OPTIONS = [
  { label: "Last 1 hour", hours: 1 },
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 24 * 7 },
  { label: "Last 30 days", hours: 24 * 30 },
];

export function AdminRiskAlarmsPanel() {
  const navigate = useNavigate();
  const [severity, setSeverity] = useState<string>("any");
  const [alarmType, setAlarmType] = useState<string>("any");
  const [windowHours, setWindowHours] = useState<number>(24 * 7);
  const [search, setSearch] = useState("");

  const since = useMemo(
    () => new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString(),
    [windowHours],
  );

  const { data: alarms = [], isFetching, isError, error, refetch, dataUpdatedAt } = useQuery<AlarmRow[]>({
    queryKey: ["admin-reconciliation-alarms", since],
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc("admin_get_reconciliation_alarms", {
        p_severity: null,
        p_alarm_type: null,
        p_since: since,
        p_limit: 500,
      });
      if (rpcError) throw rpcError;
      return (data ?? []) as AlarmRow[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    return alarms.filter((a) => {
      if (severity !== "any" && a.severity !== severity) return false;
      if (alarmType !== "any" && a.alarm_type !== alarmType) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [
          a.engagement_id,
          a.match_id,
          a.org_id,
          a.counterparty_email,
          a.summary,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [alarms, severity, alarmType, search]);

  const counts = useMemo(() => {
    const acc = { total: alarms.length, critical: 0, high: 0, medium: 0 };
    for (const a of alarms) acc[a.severity] += 1;
    return acc;
  }, [alarms]);

  const traceEngagement = (engagementId: string | null, email: string | null, matchId: string | null) => {
    // Jump into the existing forensics panel with a pre-filled query.
    const params = new URLSearchParams();
    params.set("sub", "forensics");
    if (matchId) params.set("trace_match", matchId);
    if (email) params.set("trace_email", email);
    if (engagementId) params.set("trace_engagement", engagementId);
    navigate(`/hq/engagements?${params.toString()}`);
  };

  return (
    <div className="space-y-5">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile label="Total alarms" value={counts.total} />
        <SummaryTile label="Critical" value={counts.critical} tone="critical" />
        <SummaryTile label="High" value={counts.high} tone="high" />
        <SummaryTile label="Medium" value={counts.medium} tone="medium" />
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-2">
            <Label htmlFor="risk-search" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Search
            </Label>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="risk-search"
                placeholder="match id, engagement id, email, org…"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any severity</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Alarm type</Label>
            <Select value={alarmType} onValueChange={setAlarmType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">All types</SelectItem>
                {Object.entries(ALARM_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Window</Label>
            <Select value={String(windowHours)} onValueChange={(v) => setWindowHours(Number(v))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map((o) => (
                  <SelectItem key={o.hours} value={String(o.hours)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Showing <span className="font-medium text-foreground">{filtered.length}</span> of {alarms.length} alarms · auto-refreshes every 60s
            </p>
            <div className="flex items-center gap-3">
              {/* Batch T — UI-012: visible last-updated chip. */}
              <p
                className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground"
                data-testid="risk-alarms-last-updated"
              >
                Last updated{" "}
                {dataUpdatedAt
                  ? formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true })
                  : "—"}
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error state */}
      {isError && (
        <div className="border border-destructive/30 bg-destructive/5 rounded-sm p-4 text-sm text-destructive">
          <strong className="font-medium">Failed to load alarms.</strong>{" "}
          {(error as Error)?.message ?? "Unknown error."}
        </div>
      )}

      {/* Alarm table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[110px]">Severity</TableHead>
                <TableHead>Alarm</TableHead>
                <TableHead>Detected</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead className="text-right w-[140px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isFetching && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    Loading reconciliation alarms…
                  </TableCell>
                </TableRow>
              )}
              {!isFetching && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    <AlertTriangle className="h-5 w-5 mx-auto mb-2 text-[hsl(var(--emerald))]" />
                    No reconciliation alarms in the selected window.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((a) => {
                const Icon = SEVERITY_ICON[a.severity];
                return (
                  <TableRow key={a.alarm_id}>
                    <TableCell>
                      <Badge variant="outline" className={SEVERITY_STYLES[a.severity]}>
                        <Icon className="h-3 w-3 mr-1" />
                        {a.severity}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm text-foreground">
                        {ALARM_LABELS[a.alarm_type]}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {a.summary}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="text-foreground">
                        {format(new Date(a.detected_at), "yyyy-MM-dd HH:mm")}
                      </div>
                      <div className="text-muted-foreground">
                        {formatDistanceToNow(new Date(a.detected_at), { addSuffix: true })}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-mono text-foreground truncate max-w-[200px]">
                        {a.counterparty_email ?? "—"}
                      </div>
                      {a.match_id && (
                        <div className="text-muted-foreground font-mono">
                          match {a.match_id.slice(0, 8)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => traceEngagement(a.engagement_id, a.counterparty_email, a.match_id)}
                        disabled={!a.engagement_id && !a.match_id && !a.counterparty_email}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Trace
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: Severity;
}) {
  const toneClass =
    tone === "critical"
      ? "border-destructive/30 bg-destructive/5"
      : tone === "high"
      ? "border-amber-300 bg-amber-500/5 dark:bg-amber-500/10"
        : tone === "medium"
          ? "border-border bg-muted/40"
          : "border-border bg-card";
  const valueClass =
    tone === "critical"
      ? "text-destructive"
      : tone === "high"
        ? "text-amber-700 dark:text-amber-400"
        : "text-foreground";
  return (
    <div className={`rounded-sm border ${toneClass} px-4 py-3`}>
      <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
        {label}
      </div>
      <div className={`text-2xl font-semibold mt-1 ${valueClass}`}>{value}</div>
    </div>
  );
}
