import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, TrendingUp, Search, Zap, Info } from "lucide-react";
import { format } from "date-fns";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DiscoveryLog {
  id: string;
  created_at: string;
  metadata: {
    baseline_results?: number;
    enriched_results?: number;
    uplift_pct?: number;
    enrichment_reasons?: Record<string, number>;
    options_created?: number;
  };
  entity_id: string;
}

export function AdminDiscoveryMetrics() {
  const [timeRange, setTimeRange] = useState<string>("7d");

  const { data: discoveryLogs, isLoading, refetch } = useQuery({
    queryKey: ["admin-discovery-metrics", timeRange],
    queryFn: async () => {
      const days = timeRange === "1d" ? 1 : timeRange === "7d" ? 7 : 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("action", "sr_discover_completed")
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data as DiscoveryLog[];
    },
  });

  // Calculate aggregate metrics
  const aggregateMetrics = {
    totalDiscoveries: discoveryLogs?.length || 0,
    avgUplift: 0,
    totalBaseline: 0,
    totalEnriched: 0,
    reasonBreakdown: {} as Record<string, number>,
  };

  if (discoveryLogs && discoveryLogs.length > 0) {
    let upliftSum = 0;
    discoveryLogs.forEach(log => {
      const meta = log.metadata || {};
      aggregateMetrics.totalBaseline += meta.baseline_results || 0;
      aggregateMetrics.totalEnriched += meta.enriched_results || 0;
      upliftSum += meta.uplift_pct || 0;
      
      // Aggregate enrichment reasons
      if (meta.enrichment_reasons) {
        Object.entries(meta.enrichment_reasons).forEach(([reason, count]) => {
          aggregateMetrics.reasonBreakdown[reason] = 
            (aggregateMetrics.reasonBreakdown[reason] || 0) + (count as number);
        });
      }
    });
    aggregateMetrics.avgUplift = upliftSum / discoveryLogs.length;
  }

  const overallUpliftPct = aggregateMetrics.totalBaseline > 0
    ? ((aggregateMetrics.totalEnriched - aggregateMetrics.totalBaseline) / aggregateMetrics.totalBaseline) * 100
    : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">12% Discovery Engine Metrics</h2>
          <p className="text-muted-foreground mt-2">
            Track uplift from enhanced discovery vs baseline AI search
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

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Discoveries</CardTitle>
            <Search className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{aggregateMetrics.totalDiscoveries}</div>
            <p className="text-xs text-muted-foreground">Search operations completed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Uplift</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              +{aggregateMetrics.avgUplift.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">Per discovery operation</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overall Uplift</CardTitle>
            <Zap className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {aggregateMetrics.totalBaseline} → {aggregateMetrics.totalEnriched}
            </div>
            <p className="text-xs text-muted-foreground">
              +{overallUpliftPct.toFixed(1)}% more results
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Engine Contribution</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Extra results found by 12% engine that baseline missed</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {aggregateMetrics.totalEnriched - aggregateMetrics.totalBaseline}
            </div>
            <p className="text-xs text-muted-foreground">Additional results surfaced</p>
          </CardContent>
        </Card>
      </div>

      {/* Enrichment Reasons Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Why Results Were Surfaced</CardTitle>
          <CardDescription>
            Breakdown of heuristics used by the 12% discovery engine
          </CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(aggregateMetrics.reasonBreakdown).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(aggregateMetrics.reasonBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{reason}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-32 bg-muted rounded-full h-2">
                        <div 
                          className="bg-primary h-2 rounded-full" 
                          style={{ 
                            width: `${(count / Math.max(...Object.values(aggregateMetrics.reasonBreakdown))) * 100}%` 
                          }}
                        />
                      </div>
                      <span className="text-sm font-medium w-12 text-right">{count}</span>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">
              No enrichment data available yet
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recent Discovery Operations */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Discovery Operations</CardTitle>
          <CardDescription>
            Individual search operations with baseline vs enriched metrics
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : discoveryLogs && discoveryLogs.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Signal ID</TableHead>
                    <TableHead>Baseline</TableHead>
                    <TableHead>Enriched</TableHead>
                    <TableHead>Uplift</TableHead>
                    <TableHead>Options Created</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {discoveryLogs.map((log) => {
                    const meta = log.metadata || {};
                    const uplift = meta.uplift_pct || 0;
                    return (
                      <TableRow key={log.id}>
                        <TableCell className="font-mono text-xs">
                          {log.entity_id?.substring(0, 8)}...
                        </TableCell>
                        <TableCell>{meta.baseline_results || 0}</TableCell>
                        <TableCell>{meta.enriched_results || 0}</TableCell>
                        <TableCell>
                          <Badge 
                            variant={uplift > 0 ? "default" : "secondary"}
                            className={uplift > 10 ? "bg-green-600" : ""}
                          >
                            {uplift > 0 ? "+" : ""}{uplift.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell>{meta.options_created || 0}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(log.created_at), "MMM dd, HH:mm")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No discovery operations found in selected time range
            </div>
          )}
        </CardContent>
      </Card>

      {/* Explanation Card */}
      <Card>
        <CardHeader>
          <CardTitle>How the 12% Discovery Engine Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 border rounded-lg">
              <h4 className="font-semibold mb-2">Baseline AI Search</h4>
              <p className="text-sm text-muted-foreground">
                Standard multi-provider search (Brave, DuckDuckGo, Google, Bing) 
                using semantic queries based on the signal content.
              </p>
            </div>
            <div className="p-4 border rounded-lg bg-primary/5">
              <h4 className="font-semibold mb-2">12% Engine Enhancement</h4>
              <p className="text-sm text-muted-foreground">
                Additional discovery layer using supply chain adjacency, synonym expansion,
                regional heuristics, and B2B platform searches to find results baseline missed.
              </p>
            </div>
          </div>
          
          <div className="p-4 border rounded-lg">
            <h4 className="font-semibold mb-2">Enrichment Strategies</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• <strong>Supply chain adjacency:</strong> Find related products in the value chain</li>
              <li>• <strong>Synonym expansion:</strong> Search with alternative terms (supplier → manufacturer)</li>
              <li>• <strong>Regional expansion:</strong> Search specific trade hubs within regions</li>
              <li>• <strong>B2B platform:</strong> Target business-to-business marketplaces</li>
              <li>• <strong>Industry heuristics:</strong> Sector-specific search patterns</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
