import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScanSearch, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ErrorState } from "@/components/ui/error-state";
import { InlineLoader } from "@/components/ui/inline-loader";
import { QUERY_LIMIT_ADMIN } from "@/lib/constants";

interface ScreeningRun {
  id: string;
  org_id: string;
  screening_type: string;
  provider: string | null;
  status: string;
  entities_screened: number | null;
  hits_found: number | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export function AdminScreeningRunsPanel() {
  const [runs, setRuns] = useState<ScreeningRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const fetchRuns = async () => {
    setLoading(true);
    setError(null);
    try {
      const { count } = await supabase
        .from("screening_runs")
        .select("id", { count: "exact", head: true });
      setTotal(count);

      const { data, error: fetchErr } = await supabase
        .from("screening_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(QUERY_LIMIT_ADMIN);

      if (fetchErr) throw fetchErr;
      setRuns((data as ScreeningRun[]) || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load screening runs";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRuns(); }, []);

  const statusBadge = (status: string) => {
    switch (status) {
      case "completed": return <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200">Completed</Badge>;
      case "running": return <Badge className="bg-blue-500/10 text-blue-700 border-blue-200">Running</Badge>;
      case "failed": return <Badge variant="destructive">Failed</Badge>;
      case "pending": return <Badge variant="secondary">Pending</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (error && runs.length === 0) {
    return <ErrorState title="Failed to load screening runs" description={error} onRetry={fetchRuns} />;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><ScanSearch className="h-5 w-5" />Screening Runs</CardTitle>
          <CardDescription>Batch screening executions for sanctions, PEP, and adverse media checks.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRuns} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {total !== null && runs.length >= QUERY_LIMIT_ADMIN && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Showing {runs.length} of {total} runs.</AlertDescription>
          </Alert>
        )}

        {loading && runs.length === 0 ? (
          <InlineLoader message="Loading screening runs…" />
        ) : runs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <ScanSearch className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No screening runs recorded.</p>
            <p className="text-xs mt-1">Runs are triggered via the dilisense-screen function when a screening provider is configured.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Org ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Entities</TableHead>
                  <TableHead>Hits</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const durationMs = run.completed_at && run.started_at
                    ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
                    : null;
                  return (
                    <TableRow key={run.id}>
                      <TableCell className="font-mono text-xs">{run.org_id.slice(0, 8)}…</TableCell>
                      <TableCell><Badge variant="outline">{run.screening_type}</Badge></TableCell>
                      <TableCell className="text-sm">{run.provider || "—"}</TableCell>
                      <TableCell>{statusBadge(run.status)}</TableCell>
                      <TableCell>{run.entities_screened ?? "—"}</TableCell>
                      <TableCell className={run.hits_found && run.hits_found > 0 ? "font-semibold text-destructive" : ""}>
                        {run.hits_found ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(run.started_at), "dd MMM yyyy HH:mm")}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {durationMs !== null ? `${(durationMs / 1000).toFixed(1)}s` : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
