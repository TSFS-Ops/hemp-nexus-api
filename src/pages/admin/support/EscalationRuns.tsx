/**
 * Admin: Support escalation cron runs.
 * Shows the recent runs of the SLA escalation cron, with per-gate counts,
 * duration, and any RPC error messages for troubleshooting.
 * platform_admin gated in the router.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

type EscalationDetail = {
  ticket_id: string;
  gate: string;
  from_priority: string;
  to_priority: string;
};

type RunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: "ok" | "error";
  escalated_count: number;
  first_response_count: number;
  resolution_count: number;
  error_message: string | null;
  escalations: EscalationDetail[] | null;
};

const PAGE_SIZE = 50;

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

function fmtDuration(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function AdminSupportEscalationRuns() {
  const { toast } = useToast();
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("support_escalation_runs")
        .select(
          "id, started_at, finished_at, duration_ms, status, escalated_count, first_response_count, resolution_count, error_message, escalations"
        )
        .order("started_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      setRows((data ?? []) as RunRow[]);
    } catch (e) {
      toast({
        title: "Failed to load escalation runs",
        description: (e as Error).message,
        variant: "destructive",
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    const last24 = list.filter(
      (r) => Date.now() - new Date(r.started_at).getTime() < 24 * 3600 * 1000
    );
    return {
      total: list.length,
      last24_runs: last24.length,
      last24_errors: last24.filter((r) => r.status === "error").length,
      last24_escalated: last24.reduce((acc, r) => acc + (r.escalated_count ?? 0), 0),
      last24_first_response: last24.reduce(
        (acc, r) => acc + (r.first_response_count ?? 0),
        0
      ),
      last24_resolution: last24.reduce((acc, r) => acc + (r.resolution_count ?? 0), 0),
    };
  }, [rows]);

  if (rows === null) return <FullPageLoader />;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Escalation cron runs</h1>
          <p className="text-sm text-muted-foreground">
            Recent executions of the SLA auto-escalation job, with per-gate counts
            and any RPC errors.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/support">Back to queue</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            disabled={loading}
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Runs (last 24h)" value={stats.last24_runs} />
        <StatCard
          label="Errors (last 24h)"
          value={stats.last24_errors}
          tone={stats.last24_errors > 0 ? "danger" : "ok"}
        />
        <StatCard label="Escalations (24h)" value={stats.last24_escalated} />
        <StatCard label="First-response (24h)" value={stats.last24_first_response} />
        <StatCard label="Resolution (24h)" value={stats.last24_resolution} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent runs</CardTitle>
          <CardDescription>
            Last {PAGE_SIZE} executions. Expand a row to see the escalated tickets
            and error detail.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No cron runs recorded yet. Once the job fires, entries will appear here.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6" />
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Escalated</TableHead>
                  <TableHead className="text-right">First-response</TableHead>
                  <TableHead className="text-right">Resolution</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const open = !!expanded[r.id];
                  return (
                    <>
                      <TableRow key={r.id} className={r.status === "error" ? "bg-destructive/5" : ""}>
                        <TableCell>
                          <Collapsible
                            open={open}
                            onOpenChange={(v) =>
                              setExpanded((prev) => ({ ...prev, [r.id]: v }))
                            }
                          >
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                {open ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </CollapsibleTrigger>
                          </Collapsible>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {fmtDate(r.started_at)}
                        </TableCell>
                        <TableCell>
                          {r.status === "ok" ? (
                            <Badge variant="secondary">ok</Badge>
                          ) : (
                            <Badge variant="destructive">error</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {r.escalated_count}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {r.first_response_count}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {r.resolution_count}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {fmtDuration(r.duration_ms)}
                        </TableCell>
                      </TableRow>
                      {open ? (
                        <TableRow key={`${r.id}-detail`} className="bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={6} className="py-3">
                            <RunDetail run={r} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "danger";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            tone === "danger" && value > 0 ? "text-destructive" : ""
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function RunDetail({ run }: { run: RunRow }) {
  const escalations = run.escalations ?? [];
  return (
    <div className="space-y-3">
      {run.error_message ? (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-3">
          <div className="text-xs font-semibold uppercase text-destructive">
            RPC error
          </div>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-destructive">
            {run.error_message}
          </pre>
        </div>
      ) : null}

      <div className="text-xs text-muted-foreground">
        Finished: <span className="font-mono">{fmtDate(run.finished_at)}</span>
        {" · "}Duration:{" "}
        <span className="font-mono">{fmtDuration(run.duration_ms)}</span>
      </div>

      {escalations.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          No tickets were escalated in this run.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket</TableHead>
              <TableHead>Gate</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {escalations.map((e, idx) => (
              <TableRow key={`${run.id}-${idx}`}>
                <TableCell className="font-mono text-xs">
                  <Link
                    to={`/admin/support/tickets/${e.ticket_id}`}
                    className="underline underline-offset-2"
                  >
                    {e.ticket_id.slice(0, 8)}…
                  </Link>
                </TableCell>
                <TableCell className="text-xs">{e.gate}</TableCell>
                <TableCell className="text-xs">{e.from_priority}</TableCell>
                <TableCell className="text-xs">{e.to_priority}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
