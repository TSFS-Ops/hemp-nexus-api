import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ErrorState } from "@/components/ui/error-state";
import { InlineLoader } from "@/components/ui/inline-loader";
import { QUERY_LIMIT_ADMIN } from "@/lib/constants";
import type { Tables } from "@/integrations/supabase/types";

type RiskSnapshot = Tables<"risk_snapshots">;

export function AdminRiskSnapshotsPanel() {
  const [snapshots, setSnapshots] = useState<RiskSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const fetchSnapshots = async () => {
    setLoading(true);
    setError(null);
    try {
      const { count } = await supabase.from("risk_snapshots").select("id", { count: "exact", head: true });
      setTotal(count);
      const { data, error: fetchErr } = await supabase.from("risk_snapshots").select("*").order("created_at", { ascending: false }).limit(QUERY_LIMIT_ADMIN);
      if (fetchErr) throw fetchErr;
      setSnapshots(data || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load risk snapshots";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSnapshots(); }, []);

  const bandBadge = (band: string) => {
    switch (band) {
      case "low": return <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200">Low</Badge>;
      case "medium": return <Badge className="bg-amber-500/10 text-amber-700 border-amber-200">Medium</Badge>;
      case "high": return <Badge variant="destructive">High</Badge>;
      default: return <Badge variant="secondary">{band}</Badge>;
    }
  };

  if (error && snapshots.length === 0) return <ErrorState title="Failed to load risk snapshots" message={error} onRetry={fetchSnapshots} />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" />Risk Snapshots</CardTitle>
          <CardDescription>Point-in-time risk assessments captured during due diligence and trade approval flows.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={fetchSnapshots} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {total !== null && snapshots.length >= QUERY_LIMIT_ADMIN && (
          <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>Showing {snapshots.length} of {total} snapshots.</AlertDescription></Alert>
        )}

        {loading && snapshots.length === 0 ? <InlineLoader message="Loading risk snapshots…" /> : snapshots.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground"><ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-50" /><p className="text-sm">No risk snapshots recorded.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Entity ID</TableHead><TableHead>Org ID</TableHead><TableHead>Score</TableHead><TableHead>Band</TableHead><TableHead>Inputs</TableHead><TableHead>Captured</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {snapshots.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.entity_id.slice(0, 8)}…</TableCell>
                    <TableCell className="font-mono text-xs">{s.org_id.slice(0, 8)}…</TableCell>
                    <TableCell className="font-semibold">{s.risk_score.toFixed(1)}</TableCell>
                    <TableCell>{bandBadge(s.risk_band)}</TableCell>
                    <TableCell className="text-xs max-w-[150px] truncate">
                      {typeof s.inputs === "object" && s.inputs ? Object.keys(s.inputs).length + " factors" : "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(s.created_at), "dd MMM yyyy HH:mm")}</TableCell>
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
