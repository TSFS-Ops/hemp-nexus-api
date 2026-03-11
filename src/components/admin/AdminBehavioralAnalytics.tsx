import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, TrendingUp, MousePointer, Clock, Eye } from "lucide-react";
import { format } from "date-fns";

export function AdminBehavioralAnalytics() {
  const [timeRange, setTimeRange] = useState<string>("7d");
  const [actionFilter, setActionFilter] = useState<string>("all");

  const { data: behavioralData, isLoading, refetch } = useQuery({
    queryKey: ["admin-behavioral-analytics", timeRange, actionFilter],
    queryFn: async () => {
      const daysAgo = parseInt(timeRange) || 7;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysAgo);

      let query = supabase
        .from("behavioral_signals")
        .select("*")
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: false })
        .limit(500);

      if (actionFilter !== "all") {
        query = query.eq("action_type", actionFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Calculate analytics
  const analytics = behavioralData ? {
    total: behavioralData.length,
    byType: behavioralData.reduce((acc, item) => {
      acc[item.action_type] = (acc[item.action_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    recentTrend: behavioralData.slice(0, 50),
  } : { total: 0, byType: {}, recentTrend: [] };

  const actionTypes = [
    { value: "skip", label: "Skip", color: "bg-yellow-500" },
    { value: "maybe_later", label: "Maybe Later", color: "bg-blue-500" },
    { value: "not_now", label: "Not Now", color: "bg-orange-500" },
    { value: "view", label: "View", color: "bg-gray-500" },
    { value: "browse", label: "Browse", color: "bg-purple-500" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Behavioural Analytics</h2>
          <p className="text-muted-foreground mt-2">
            Non-binding user interactions. These do NOT create audit/evidence records.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Time Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24h</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Important Notice */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <MousePointer className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <h4 className="font-semibold text-amber-800 dark:text-amber-200">Non-Binding Signals Only</h4>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                This panel shows soft actions (skip, maybe later, view, etc.) that help improve UX.
                These actions have <strong>no legal meaning</strong> and do NOT create audit records or evidence chains.
                Only "Confirm Intent" creates binding records.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Interactions</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.total}</div>
            <p className="text-xs text-muted-foreground">Last {timeRange} days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Skips</CardTitle>
            <MousePointer className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.byType['skip'] || 0}</div>
            <p className="text-xs text-muted-foreground">User skipped matches</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Maybe Later</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.byType['maybe_later'] || 0}</div>
            <p className="text-xs text-muted-foreground">Deferred decisions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Views</CardTitle>
            <Eye className="h-4 w-4 text-gray-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.byType['view'] || 0}</div>
            <p className="text-xs text-muted-foreground">Match detail views</p>
          </CardContent>
        </Card>
      </div>

      {/* Action Type Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Action Type Breakdown</CardTitle>
          <CardDescription>Distribution of non-binding user actions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {actionTypes.map(type => (
                  <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {actionTypes.map(type => {
                const count = analytics.byType[type.value] || 0;
                const percentage = analytics.total > 0 ? (count / analytics.total * 100).toFixed(1) : 0;
                return (
                  <div key={type.value} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                    <div className="text-sm font-medium sm:w-24 sm:flex-shrink-0">{type.label}</div>
                    <div className="flex items-center gap-2 sm:gap-4 flex-1">
                      <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${type.color} transition-all`} 
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <div className="text-sm text-right whitespace-nowrap min-w-[70px] sm:min-w-[80px]">
                        {count} ({percentage}%)
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest behavioural signals (non-binding)</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : behavioralData && behavioralData.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-auto">
              {behavioralData.slice(0, 50).map((signal) => (
                <div key={signal.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 border rounded-lg">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="capitalize text-xs">
                      {signal.action_type.replace('_', ' ')}
                    </Badge>
                    {signal.match_id && (
                      <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px] sm:max-w-none">
                        Match: {signal.match_id.substring(0, 8)}...
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(signal.created_at), "MMM dd HH:mm")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No behavioural signals recorded yet.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
