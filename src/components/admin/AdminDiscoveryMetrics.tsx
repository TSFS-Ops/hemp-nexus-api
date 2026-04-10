import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, RefreshCw, TrendingUp, Search, Zap, Info, BarChart3 } from "lucide-react";
import { format } from "date-fns";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const QUERY_LIMIT = 200;

export function AdminDiscoveryMetrics() {
  const [timeRange, setTimeRange] = useState<string>("7d");

  const days = timeRange === "1d" ? 1 : timeRange === "7d" ? 7 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startIso = startDate.toISOString();

  // Fetch raw search logs
  const { data: searchLogs, isLoading, refetch } = useQuery({
    queryKey: ["admin-discovery-search-logs", timeRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("discovery_search_logs")
        .select("*")
        .gte("created_at", startIso)
        .order("created_at", { ascending: false })
        .limit(QUERY_LIMIT);
      if (error) throw error;
      return data as any[];
    },
  });

  // Fetch total count for truncation detection
  const { data: totalCount } = useQuery({
    queryKey: ["admin-discovery-search-logs-count", timeRange],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("discovery_search_logs")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startIso);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Compute aggregates from raw logs
  const logs = searchLogs || [];
  const totalSearches = logs.length;
  const ftsHits = logs.filter(l => l.fts_result_count > 0).length;
  const fallbacks = logs.filter(l => l.ilike_fallback_used).length;
  const ftsHitRate = totalSearches > 0 ? ((ftsHits / totalSearches) * 100) : 0;
  const fallbackRate = totalSearches > 0 ? ((fallbacks / totalSearches) * 100) : 0;
  const avgResults = totalSearches > 0
    ? logs.reduce((s, l) => s + l.total_results_returned, 0) / totalSearches
    : 0;
  const avgResponseMs = totalSearches > 0
    ? logs.reduce((s, l) => s + (l.response_time_ms || 0), 0) / totalSearches
    : 0;
  const avgParseTokens = totalSearches > 0
    ? logs.reduce((s, l) => s + l.parse_token_count, 0) / totalSearches
    : 0;
  const zeroResultSearches = logs.filter(l => l.total_results_returned === 0).length;
  const zeroResultRate = totalSearches > 0 ? ((zeroResultSearches / totalSearches) * 100) : 0;

  const isTruncated = totalCount != null && logs.length >= QUERY_LIMIT && totalCount > logs.length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Discovery Baseline Metrics</h2>
          <p className="text-muted-foreground mt-2">
            Structured parse-level measurement for the SOW 12% uplift target
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1d">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {isTruncated && (
        <Alert>
          <BarChart3 className="h-4 w-4" />
          <AlertDescription>
            Showing {logs.length} of {totalCount} search logs. Results are capped at {QUERY_LIMIT}.
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Searches</CardTitle>
            <Search className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSearches}</div>
            <p className="text-xs text-muted-foreground">In selected period</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">FTS Hit Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {ftsHitRate.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Full-text search returned ≥1 result
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fallback Rate</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>% of searches where FTS returned 0 and ILIKE fallback was used. Lower is better — means FTS parse quality is high.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${fallbackRate > 30 ? "text-destructive" : "text-amber-600"}`}>
              {fallbackRate.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              ILIKE fallback used
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response</CardTitle>
            <Zap className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Math.round(avgResponseMs)}ms</div>
            <p className="text-xs text-muted-foreground">
              Avg {avgResults.toFixed(1)} results · {avgParseTokens.toFixed(1)} tokens parsed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Key quality indicator */}
      <Card>
        <CardHeader>
          <CardTitle>Parse Quality Indicators</CardTitle>
          <CardDescription>
            These metrics form the baseline for measuring the SOW 12% parse-level improvement
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 border rounded-lg text-center">
              <div className="text-3xl font-bold">{ftsHitRate.toFixed(1)}%</div>
              <div className="text-sm text-muted-foreground mt-1">FTS Hit Rate (baseline)</div>
              <div className="text-xs text-muted-foreground mt-1">
                Target: {(ftsHitRate * 1.12).toFixed(1)}% (+12%)
              </div>
            </div>
            <div className="p-4 border rounded-lg text-center">
              <div className="text-3xl font-bold">{zeroResultRate.toFixed(1)}%</div>
              <div className="text-sm text-muted-foreground mt-1">Zero-Result Rate</div>
              <div className="text-xs text-muted-foreground mt-1">
                Target: {Math.max(0, zeroResultRate * 0.88).toFixed(1)}% (−12%)
              </div>
            </div>
            <div className="p-4 border rounded-lg text-center">
              <div className="text-3xl font-bold">{avgParseTokens.toFixed(1)}</div>
              <div className="text-sm text-muted-foreground mt-1">Avg Parse Tokens</div>
              <div className="text-xs text-muted-foreground mt-1">
                Higher = better query decomposition
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Search Logs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Search Operations</CardTitle>
          <CardDescription>
            Per-search breakdown: query parse quality, method, result counts, latency
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Query</TableHead>
                    <TableHead>Parsed Product</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>FTS Hits</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.slice(0, 50).map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="max-w-[200px] truncate text-xs" title={log.raw_query}>
                        {log.raw_query}
                      </TableCell>
                      <TableCell className="text-xs">
                        {log.parsed_product || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={log.ilike_fallback_used ? "destructive" : "default"}>
                          {log.ilike_fallback_used ? "ILIKE" : "FTS"}
                        </Badge>
                      </TableCell>
                      <TableCell>{log.fts_result_count}</TableCell>
                      <TableCell>{log.total_results_returned}</TableCell>
                      <TableCell>{log.parse_token_count}</TableCell>
                      <TableCell>{log.response_time_ms ? `${log.response_time_ms}ms` : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(log.created_at), "MMM dd, HH:mm")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No search operations recorded in selected period. Searches will appear here automatically once users interact with the discovery engine.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Methodology */}
      <Card>
        <CardHeader>
          <CardTitle>Baseline Measurement Methodology</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 border rounded-lg">
              <h4 className="font-semibold mb-2">What is measured</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• <strong>FTS Hit Rate:</strong> % of searches where Postgres GIN full-text search returns ≥1 result</li>
                <li>• <strong>Fallback Rate:</strong> % of searches that fell through to ILIKE (lower = better parse quality)</li>
                <li>• <strong>Zero-Result Rate:</strong> % of searches returning nothing (absolute quality floor)</li>
                <li>• <strong>Parse Tokens:</strong> How many meaningful search terms were extracted from user input</li>
              </ul>
            </div>
            <div className="p-4 border rounded-lg bg-primary/5">
              <h4 className="font-semibold mb-2">SOW 12% Uplift Target</h4>
              <p className="text-sm text-muted-foreground mb-2">
                The current FTS Hit Rate is the <strong>baseline</strong>. To prove 12% improvement:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Record the baseline FTS Hit Rate over 7–30 days</li>
                <li>• Implement taxonomy / synonym improvements</li>
                <li>• Measure the new FTS Hit Rate over the same period</li>
                <li>• Delta must be ≥ 12% relative improvement</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
