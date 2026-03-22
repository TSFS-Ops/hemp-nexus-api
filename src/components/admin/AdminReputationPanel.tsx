import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Star, Search, RefreshCw, Loader2, AlertTriangle, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ErrorState } from "@/components/ui/error-state";
import { InlineLoader } from "@/components/ui/inline-loader";
import { QUERY_LIMIT_ADMIN } from "@/lib/constants";

interface ReputationScore {
  id: string;
  org_id: string;
  score: number;
  risk_band: string;
  total_matches: number | null;
  completed_matches: number | null;
  dispute_count: number | null;
  avg_response_time_seconds: number | null;
  computed_at: string;
  created_at: string;
}

export function AdminReputationPanel() {
  const [scores, setScores] = useState<ReputationScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState<number | null>(null);

  const fetchScores = async () => {
    setLoading(true);
    setError(null);
    try {
      const { count } = await supabase
        .from("reputation_scores")
        .select("id", { count: "exact", head: true });
      setTotal(count);

      let query = supabase
        .from("reputation_scores")
        .select("*")
        .order("score", { ascending: false })
        .limit(QUERY_LIMIT_ADMIN);

      if (search.trim()) {
        query = query.eq("org_id", search.trim());
      }

      const { data, error: fetchErr } = await query;
      if (fetchErr) throw fetchErr;
      setScores((data as ReputationScore[]) || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load reputation scores";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchScores(); }, []);

  const bandBadge = (band: string) => {
    switch (band) {
      case "excellent": return <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200">Excellent</Badge>;
      case "good": return <Badge className="bg-blue-500/10 text-blue-700 border-blue-200">Good</Badge>;
      case "fair": return <Badge className="bg-amber-500/10 text-amber-700 border-amber-200">Fair</Badge>;
      case "poor": return <Badge variant="destructive">Poor</Badge>;
      default: return <Badge variant="secondary">{band}</Badge>;
    }
  };

  if (error && scores.length === 0) {
    return <ErrorState title="Failed to load reputation scores" description={error} onRetry={fetchScores} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Star className="h-5 w-5" />Reputation Scores</CardTitle>
        <CardDescription>Organisation reputation computed from match history, response times, and dispute rates.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by org ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchScores()}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={fetchScores} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {total !== null && scores.length >= QUERY_LIMIT_ADMIN && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Showing {scores.length} of {total} scores.</AlertDescription>
          </Alert>
        )}

        {loading && scores.length === 0 ? (
          <InlineLoader message="Loading reputation scores…" />
        ) : scores.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No reputation scores computed yet.</p>
            <p className="text-xs mt-1">Scores are generated via the calculate-reputation function.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Org ID</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Band</TableHead>
                  <TableHead>Matches</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Disputes</TableHead>
                  <TableHead>Computed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scores.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.org_id.slice(0, 8)}…</TableCell>
                    <TableCell className="font-semibold">{s.score.toFixed(1)}</TableCell>
                    <TableCell>{bandBadge(s.risk_band)}</TableCell>
                    <TableCell>{s.total_matches ?? 0}</TableCell>
                    <TableCell>{s.completed_matches ?? 0}</TableCell>
                    <TableCell>{s.dispute_count ?? 0}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(s.computed_at), "dd MMM yyyy HH:mm")}</TableCell>
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
