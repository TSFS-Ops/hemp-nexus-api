import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Clock, RefreshCw, Loader2, AlertTriangle, Archive } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ErrorState } from "@/components/ui/error-state";
import { InlineLoader } from "@/components/ui/inline-loader";
import { QUERY_LIMIT_ADMIN } from "@/lib/constants";

interface RetentionFlag {
  id: string;
  table_name: string;
  record_id: string;
  flag_type: string;
  record_date: string;
  flagged_at: string;
}

export function AdminRetentionFlagsPanel() {
  const [flags, setFlags] = useState<RetentionFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");

  const fetchFlags = async () => {
    setLoading(true);
    setError(null);
    try {
      let countQuery = supabase.from("retention_flags").select("id", { count: "exact", head: true });
      if (typeFilter !== "all") countQuery = countQuery.eq("flag_type", typeFilter);
      const { count } = await countQuery;
      setTotal(count);

      let query = supabase
        .from("retention_flags")
        .select("*")
        .order("flagged_at", { ascending: false })
        .limit(QUERY_LIMIT_ADMIN);

      if (typeFilter !== "all") query = query.eq("flag_type", typeFilter);

      const { data, error: fetchErr } = await query;
      if (fetchErr) throw fetchErr;
      setFlags((data as RetentionFlag[]) || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load retention flags";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFlags(); }, [typeFilter]);

  const flagBadge = (type: string) => {
    switch (type) {
      case "expired": return <Badge variant="destructive">Expired</Badge>;
      case "approaching_expiry": return <Badge className="bg-amber-500/10 text-amber-700 border-amber-200">Approaching Expiry</Badge>;
      default: return <Badge variant="secondary">{type}</Badge>;
    }
  };

  if (error && flags.length === 0) {
    return <ErrorState title="Failed to load retention flags" description={error} onRetry={fetchFlags} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Archive className="h-5 w-5" />Data Retention Flags</CardTitle>
        <CardDescription>Records approaching or exceeding the 7-year retention policy. Scanned daily by the retention engine.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All flags</SelectItem>
              <SelectItem value="approaching_expiry">Approaching expiry</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchFlags} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {total !== null && flags.length >= QUERY_LIMIT_ADMIN && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Showing {flags.length} of {total} flags. Refine filters for more.</AlertDescription>
          </Alert>
        )}

        {loading && flags.length === 0 ? (
          <InlineLoader message="Loading retention flags…" />
        ) : flags.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No retention flags raised.</p>
            <p className="text-xs mt-1">All records are within the 7-year retention window.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead>Record ID</TableHead>
                  <TableHead>Flag Type</TableHead>
                  <TableHead>Record Date</TableHead>
                  <TableHead>Flagged At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flags.map((flag) => (
                  <TableRow key={flag.id}>
                    <TableCell><Badge variant="outline">{flag.table_name}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{flag.record_id.slice(0, 8)}…</TableCell>
                    <TableCell>{flagBadge(flag.flag_type)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(flag.record_date), "dd MMM yyyy")}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(flag.flagged_at), "dd MMM yyyy HH:mm")}</TableCell>
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
