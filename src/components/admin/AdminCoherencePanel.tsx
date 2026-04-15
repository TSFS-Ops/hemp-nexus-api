import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Brain, TrendingUp, Target, Zap } from "lucide-react";
import { TruncationBanner } from "@/components/ui/truncation-banner";

const COHERENCE_LIMIT = 100;
import { format } from "date-fns";
import * as MatchState from "@/lib/match-state";
import { MatchStatusBadge } from "@/components/ui/match-status-badge";

/**
 * AdminCoherencePanel
 * 
 * Displays coherence scoring metrics based on the SOW's Coherence Engine specification:
 * - Intention Vector representation (buyer/seller)
 * - Cosine similarity scoring
 * - Match threshold decisions
 * - Coherence analytics over time
 */
export function AdminCoherencePanel() {
  const { data: matchAnalytics, isLoading, refetch } = useQuery({
    queryKey: ["admin-coherence-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_analytics")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data || [];
    },
  });

  const { data: recentMatches } = useQuery({
    queryKey: ["admin-coherence-matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return data || [];
    },
  });

  // Calculate summary stats
  const summary = matchAnalytics ? {
    avgMatchRate: matchAnalytics.reduce((sum, m) => sum + (m.match_rate || 0), 0) / (matchAnalytics.length || 1),
    avgOptionsPerSignal: matchAnalytics.reduce((sum, m) => sum + (m.avg_options_per_signal || 0), 0) / (matchAnalytics.length || 1),
    totalMatches: matchAnalytics.reduce((sum, m) => sum + (m.total_matches || 0), 0),
    totalSignals: matchAnalytics.reduce((sum, m) => sum + (m.total_signals || 0), 0),
  } : { avgMatchRate: 0, avgOptionsPerSignal: 0, totalMatches: 0, totalSignals: 0 };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Coherence Engine</h2>
          <p className="text-muted-foreground mt-2">
            Vector-based intention matching with cosine similarity scoring
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Coherence Engine Explanation */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Brain className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div>
              <h4 className="font-semibold text-blue-800 dark:text-blue-200">Mathematical Framework</h4>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                Each buyer/seller is represented as an <strong>intention vector</strong> encoding: price band, 
                quantity, urgency, compliance status, reliability history, and behavior patterns.
                Matches are found when <code>coherence(x,y) ≥ θ</code> using cosine similarity.
              </p>
              <div className="mt-3 p-3 bg-blue-100 dark:bg-blue-900 rounded font-mono text-xs">
                coherence(x′,y′) = ⟨x′,y′⟩ / (‖x′‖ · ‖y′‖)  →  Score in [-1, 1]
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Match Rate</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(summary.avgMatchRate * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">Avg coherence threshold success</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Options/Signal</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary.avgOptionsPerSignal.toFixed(1)}
            </div>
            <p className="text-xs text-muted-foreground">Avg matching options found</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Matches</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalMatches}</div>
            <p className="text-xs text-muted-foreground">Coherence threshold crossed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Signals</CardTitle>
            <Brain className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalSignals}</div>
            <p className="text-xs text-muted-foreground">Intention vectors processed</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Matches with Coherence Info */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Match Decisions</CardTitle>
          <CardDescription>
            Matches where coherence(buyer, seller) ≥ threshold
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : recentMatches && recentMatches.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Commodity</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Seller</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentMatches.map((match) => (
                    <TableRow key={match.id}>
                      <TableCell className="font-medium">{match.commodity}</TableCell>
                      <TableCell>{match.buyer_name}</TableCell>
                      <TableCell>{match.seller_name}</TableCell>
                      <TableCell>
                        {match.price_currency} {match.price_amount?.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <MatchStatusBadge status={match.status} />
                      </TableCell>
                      <TableCell>
                        {format(new Date(match.created_at), "MMM dd HH:mm")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No matches found.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Threshold Explanation */}
      <Card>
        <CardHeader>
          <CardTitle>Threshold Configuration</CardTitle>
          <CardDescription>Match decision rules based on coherence scoring</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 border rounded-lg text-center">
              <div className="text-3xl font-bold text-green-600">+1</div>
              <div className="text-sm font-medium mt-1">Perfect Alignment</div>
              <div className="text-xs text-muted-foreground">Vectors point same direction</div>
            </div>
            <div className="p-4 border rounded-lg text-center">
              <div className="text-3xl font-bold text-gray-500">0</div>
              <div className="text-sm font-medium mt-1">Orthogonal</div>
              <div className="text-xs text-muted-foreground">No relationship</div>
            </div>
            <div className="p-4 border rounded-lg text-center">
              <div className="text-3xl font-bold text-red-600">-1</div>
              <div className="text-sm font-medium mt-1">Direct Opposition</div>
              <div className="text-xs text-muted-foreground">Incompatible intentions</div>
            </div>
          </div>
          <div className="mt-4 p-4 bg-muted rounded-lg">
            <p className="text-sm">
              <strong>Dynamic Threshold (θ):</strong> The match threshold adjusts based on user behavior, 
              Trade Request outcomes, and real-world match accuracy. Higher θ = stricter matching, 
              Lower θ = broader discovery.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
