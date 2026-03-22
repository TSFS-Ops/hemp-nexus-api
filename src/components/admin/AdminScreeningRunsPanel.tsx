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
import type { Tables } from "@/integrations/supabase/types";

type ScreeningRun = Tables<"screening_runs">;

export function AdminScreeningRunsPanel() {
  const [runs, setRuns] = useState<ScreeningRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const fetchRuns = async () => {
    setLoading(true);
    setError(null);
    try {
      const { count } = await supabase.from("screening_runs").select("id", { count: "exact", head: true });
      setTotal(count);
      const { data, error: fetchErr } = await supabase.from("screening_runs").select("*").order("ran_at", { ascending: false }).limit(QUERY_LIMIT_ADMIN);
      if (fetchErr) throw fetchErr;
      setRuns(data || []);
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
      case "clear": return <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200">Clear</Badge>;
      case "hit": return <Badge variant="destructive">Hit</Badge>;
      case "pending": return <Badge variant="secondary">Pending</Badge>;
      case "error": return <Badge variant="destructive">Error</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (error && runs.length === 0) return <ErrorState title="Failed to load screening runs" message={error} onRetry={fetchRuns} />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><ScanSearch className="h-5 w-5" />Screening Runs</CardTitle>
          <CardDescription>Sanctions, PEP, and adverse media screening results per entity.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRuns} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {total !== null && runs.length >= QUERY_LIMIT_ADMIN && (
          <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>Showing {runs.length} of {total} runs.</AlertDescription></Alert>
        )}

        {loading && runs.length === 0 ? <InlineLoader message="Loading screening runs…" /> : runs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground"><ScanSearch className="h-8 w-8 mx-auto mb-2 opacity-50" /><p className="text-sm">No screening runs recorded.</p><p className="text-xs mt-1">Screenings are triggered via the dilisense-screen function.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Entity ID</TableHead><TableHead>Provider</TableHead><TableHead>Status</TableHead><TableHead>Org ID</TableHead><TableHead>Ran At</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-mono text-xs">{run.entity_id.slice(0, 8)}…</TableCell>
                    <TableCell><Badge variant="outline">{run.provider}</Badge></TableCell>
                    <TableCell>{statusBadge(run.status)}</TableCell>
                    <TableCell className="font-mono text-xs">{run.org_id.slice(0, 8)}…</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(run.ran_at), "dd MMM yyyy HH:mm")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
