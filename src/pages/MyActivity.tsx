import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, CheckCircle2, FileText, Activity, Clock, Hash, Eye, ChevronRight, TrendingUp, AlertCircle } from "lucide-react";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { ROUTES, MATCH_STATUS } from "@/lib/constants";
import * as MatchState from "@/lib/match-state";
import { MatchStatusBadge } from "@/components/ui/match-status-badge";
import { format, formatDistanceToNow } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";
import { SectionHeader } from "@/components/ui/section-header";

type Match = Tables<"matches">;
type Signal = Tables<"signals">;

type AuditLogItem = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
  metadata: any;
};

export default function MyActivity() {
  const { user, session, isLoading: loading, isAdmin } = useAuth();
  const navigate = useNavigate();

  // Fetch matches
  const { data: matches, isLoading: matchesLoading } = useQuery({
    queryKey: ["my-matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as Match[];
    },
    enabled: !!session,
  });

  // Fetch signals
  const { data: signals, isLoading: signalsLoading } = useQuery({
    queryKey: ["my-signals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signals")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as Signal[];
    },
    enabled: !!session,
  });

  // Fetch audit logs
  const { data: auditLogs, isLoading: auditLoading } = useQuery({
    queryKey: ["my-audit-logs"],
    queryFn: async () => {
      if (!session?.access_token) return [] as AuditLogItem[];

      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
      const params = new URLSearchParams({ limit: "50" });

      const response = await fetch(`${baseUrl}/audit-logs?${params.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "Failed to load audit logs");
      }

      const json = await response.json();
      return (json.items || []) as AuditLogItem[];
    },
    enabled: !!session,
  });

  if (loading) {
    return <FullPageLoader />;
  }

  const confirmedMatches = matches?.filter(m => MatchState.isSettled(m.status)) || [];
  const pendingMatches = matches?.filter(m => !MatchState.isSettled(m.status)) || [];

  const stats = {
    totalMatches: matches?.length || 0,
    confirmedIntents: confirmedMatches.length,
    pendingMatches: pendingMatches.length,
    totalSignals: signals?.length || 0,
  };

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-muted-foreground">Please sign in to view your activity.</p>
        <Button onClick={() => navigate(ROUTES.AUTH)} className="bg-foreground text-background hover:bg-foreground/90">Sign In</Button>
      </div>
    );
  }

  return (
    <DashboardLayout isAdmin={isAdmin}>
      <div className="space-y-6">
        <SectionHeader
          title="My Activity"
          description="View your matches, intent confirmations, and activity history"
        />

        {/* Stats Overview */}
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Matches</p>
                  <p className="text-2xl font-bold">{stats.totalMatches}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Confirmed Intents</p>
                  <p className="text-2xl font-bold">{stats.confirmedIntents}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Pending Matches</p>
                  <p className="text-2xl font-bold">{stats.pendingMatches}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-amber-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Signals</p>
                  <p className="text-2xl font-bold">{stats.totalSignals}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Activity className="h-5 w-5 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="matches" className="space-y-6">
          <TabsList>
            <TabsTrigger value="matches">Matches</TabsTrigger>
            <TabsTrigger value="intents">Intent Confirmations</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
          </TabsList>

          {/* Matches Tab */}
          <TabsContent value="matches" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Matches</CardTitle>
                <CardDescription>Your trade matches with counterparties</CardDescription>
              </CardHeader>
              <CardContent>
                {matchesLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : matches && matches.length > 0 ? (
                  <div className="space-y-3">
                    {matches.map((match) => (
                      <div
                        key={match.id}
                        className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => navigate(`/dashboard/matches/${match.id}`)}
                      >
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                            <FileText className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium">{match.commodity}</p>
                            <p className="text-sm text-muted-foreground">
                              {match.buyer_name} ↔ {match.seller_name}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-sm font-medium">
                              {match.quantity_amount ?? "—"} {match.quantity_unit ?? ""}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(match.created_at), { addSuffix: true })}
                            </p>
                          </div>
                          <MatchStatusBadge status={match.status} />
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No matches yet</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Use the search to find counterparties and create matches
                    </p>
                    <Button variant="outline" className="mt-4" onClick={() => navigate("/dashboard")}>
                      Go to Search
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Intent Confirmations Tab */}
          <TabsContent value="intents" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Intent Confirmations</CardTitle>
                <CardDescription>Matches where you've confirmed interest</CardDescription>
              </CardHeader>
              <CardContent>
                {matchesLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : confirmedMatches.length > 0 ? (
                  <div className="space-y-3">
                    {confirmedMatches.map((match) => (
                      <div
                        key={match.id}
                        className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => navigate(`/dashboard/matches/${match.id}`)}
                      >
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          </div>
                          <div>
                            <p className="font-medium">{match.commodity}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Hash className="h-3 w-3 text-muted-foreground" />
                              <code className="text-xs text-muted-foreground font-mono">
                                {match.hash?.substring(0, 16)}...
                              </code>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-sm font-medium">
                              {match.price_currency} {match.price_amount.toLocaleString()}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Confirmed {match.settled_at ? formatDistanceToNow(new Date(match.settled_at), { addSuffix: true }) : ""}
                            </p>
                          </div>
                          <Button variant="ghost" size="sm">
                            <Eye className="h-4 w-4 mr-1" />
                            Evidence
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <CheckCircle2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No confirmed intents yet</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Confirm intent on a match to create a proof-of-interest record
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity Log Tab */}
          <TabsContent value="activity" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Activity Log</CardTitle>
                <CardDescription>Audit trail of your actions</CardDescription>
              </CardHeader>
              <CardContent>
                {auditLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : auditLogs && auditLogs.length > 0 ? (
                  <div className="space-y-1">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center gap-4 p-3 rounded hover:bg-muted/30 transition-colors"
                      >
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <Activity className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">
                            {formatActionLabel(log.action)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {log.entity_type} {log.entity_id ? `• ${log.entity_id.substring(0, 8)}...` : ""}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground text-right">
                          {format(new Date(log.created_at), "MMM d, HH:mm")}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Activity className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No activity yet</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Your actions will appear here as you use the platform
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function formatActionLabel(action: string): string {
  const labels: Record<string, string> = {
    "search.initiated": "Started a search",
    "search.completed": "Completed search",
    "match.created": "Created a match",
    "match.settled": "Confirmed intent",
    "signal.created": "Created a signal",
    "signal.updated": "Updated a signal",
    "api_key.created": "Created API key",
    "api_key.revoked": "Revoked API key",
    "webhook.created": "Configured webhook",
    "intent.confirmed": "Confirmed intent",
  };
  return labels[action] || action.replace(/[._]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
