import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from "recharts";
import { Activity, TrendingUp, AlertCircle, Clock, BarChart3, Calendar, Radio } from "lucide-react";
import { StatsGridSkeleton, CardSkeleton } from "@/components/ui/loading-skeletons";

interface AnalyticsData {
  totalRequests: number;
  successRate: number;
  avgResponseTime: number;
  errorRate: number;
  topEndpoints: Array<{ endpoint: string; count: number; avgResponseTime: number }>;
  requestsByHour: Array<{ hour: string; count: number; errors: number; avgResponseTime: number }>;
  errorsByEndpoint: Array<{ endpoint: string; errors: number; total: number }>;
  requestsByApiKey: Array<{ apiKeyName: string; count: number }>;
  recentRequests: Array<{ time: string; endpoint: string; status: number; responseTime: number }>;
}

export default function ApiAnalytics() {
  const [timeRange, setTimeRange] = useState<"24h" | "7d" | "30d">("24h");
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [analytics, setAnalytics] = useState<AnalyticsData>({
    totalRequests: 0,
    successRate: 0,
    avgResponseTime: 0,
    errorRate: 0,
    topEndpoints: [],
    requestsByHour: [],
    errorsByEndpoint: [],
    requestsByApiKey: [],
    recentRequests: [],
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchAnalytics();
    
    // Set up real-time subscription for api_request_logs
    const channel = supabase
      .channel('api-analytics')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'api_request_logs'
        },
        () => {
          // Refresh analytics when new logs come in
          fetchAnalytics();
        }
      )
      .subscribe();

    // Refresh every 10 seconds for live updates
    const interval = setInterval(() => {
      fetchAnalytics();
    }, 10000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [timeRange]);

  const getTimeRangeDate = () => {
    const now = new Date();
    switch (timeRange) {
      case "24h":
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case "7d":
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case "30d":
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const startDate = getTimeRangeDate();

      // Fetch API request logs (better metrics than audit_logs)
      const { data: logs, error: logsError } = await supabase
        .from("api_request_logs")
        .select("*, api_keys(name)")
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: false });

      if (logsError) throw logsError;

      // Process the data
      const totalRequests = logs?.length || 0;
      
      // Calculate success rate
      const successfulRequests = logs?.filter((log) => 
        log.status_code >= 200 && log.status_code < 400
      ).length || 0;
      const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;
      const errorRate = 100 - successRate;

      // Calculate average response time
      const responseTimes = logs?.map(log => log.response_time_ms).filter((time): time is number => typeof time === "number") || [];
      const avgResponseTime = responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

      // Top endpoints by request count with avg response time
      const endpointData: Record<string, { count: number; totalResponseTime: number }> = {};
      logs?.forEach((log) => {
        const endpoint = log.endpoint;
        if (!endpointData[endpoint]) {
          endpointData[endpoint] = { count: 0, totalResponseTime: 0 };
        }
        endpointData[endpoint].count += 1;
        endpointData[endpoint].totalResponseTime += log.response_time_ms;
      });
      const topEndpoints = Object.entries(endpointData)
        .map(([endpoint, data]) => ({ 
          endpoint, 
          count: data.count,
          avgResponseTime: data.totalResponseTime / data.count
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Requests by hour with errors and response times
      const hourData: Record<string, { count: number; errors: number; totalResponseTime: number }> = {};
      logs?.forEach((log) => {
        const hour = new Date(log.created_at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
        });
        if (!hourData[hour]) {
          hourData[hour] = { count: 0, errors: 0, totalResponseTime: 0 };
        }
        hourData[hour].count += 1;
        hourData[hour].totalResponseTime += log.response_time_ms;
        if (log.status_code >= 400) {
          hourData[hour].errors += 1;
        }
      });
      const requestsByHour = Object.entries(hourData)
        .map(([hour, data]) => ({ 
          hour, 
          count: data.count,
          errors: data.errors,
          avgResponseTime: data.totalResponseTime / data.count
        }))
        .slice(-24);

      // Errors by endpoint
      const endpointErrors: Record<string, { errors: number; total: number }> = {};
      logs?.forEach((log) => {
        const endpoint = log.endpoint;
        if (!endpointErrors[endpoint]) {
          endpointErrors[endpoint] = { errors: 0, total: 0 };
        }
        endpointErrors[endpoint].total += 1;
        if (log.status_code >= 400) {
          endpointErrors[endpoint].errors += 1;
        }
      });
      const errorsByEndpoint = Object.entries(endpointErrors)
        .map(([endpoint, data]) => ({ endpoint, ...data }))
        .filter((item) => item.errors > 0)
        .sort((a, b) => b.errors - a.errors);

      // Requests by API key
      const apiKeyCounts: Record<string, number> = {};
      logs?.forEach((log) => {
        const apiKeyName = (log.api_keys as any)?.name || "Unknown";
        apiKeyCounts[apiKeyName] = (apiKeyCounts[apiKeyName] || 0) + 1;
      });
      const requestsByApiKey = Object.entries(apiKeyCounts)
        .map(([apiKeyName, count]) => ({ apiKeyName, count }))
        .sort((a, b) => b.count - a.count);

      // Recent requests (last 10)
      const recentRequests = logs?.slice(0, 10).map((log) => ({
        time: new Date(log.created_at).toLocaleTimeString(),
        endpoint: log.endpoint,
        status: log.status_code,
        responseTime: log.response_time_ms,
      })) || [];

      setAnalytics({
        totalRequests,
        successRate,
        errorRate,
        avgResponseTime,
        topEndpoints,
        requestsByHour,
        errorsByEndpoint,
        requestsByApiKey,
        recentRequests,
      });
      setLastUpdated(new Date());
      setLoading(false);
    } catch (error: any) {
      console.error("Analytics error:", error);
      setLoading(false);
    }
  };

  const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Real-Time API Monitoring
          </h2>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-muted-foreground">
              Live API performance and usage metrics
            </p>
            <Badge variant="outline" className="flex items-center gap-1.5">
              <Radio className="h-3 w-3 text-green-500 animate-pulse" />
              Live
            </Badge>
            <span className="text-xs text-muted-foreground">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          </div>
        </div>
        <Select value={timeRange} onValueChange={(v: "24h" | "7d" | "30d") => setTimeRange(v)}>
          <SelectTrigger className="w-[180px]">
            <Calendar className="mr-2 h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Last 24 Hours</SelectItem>
            <SelectItem value="7d">Last 7 Days</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Key Metrics */}
      {loading ? (
        <StatsGridSkeleton count={4} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Total Requests
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{analytics.totalRequests.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Success Rate
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">
                {analytics.successRate.toFixed(1)}%
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Avg Response Time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{analytics.avgResponseTime.toFixed(0)}ms</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Error Rate
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${analytics.errorRate > 10 ? 'text-red-600' : analytics.errorRate > 5 ? 'text-yellow-600' : 'text-green-600'}`}>
                {analytics.errorRate.toFixed(1)}%
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="volume" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="volume">Request Volume</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="endpoints">Top Endpoints</TabsTrigger>
          <TabsTrigger value="errors">Error Analysis</TabsTrigger>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
        </TabsList>

        {/* Request Volume Over Time */}
        <TabsContent value="volume">
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Request Volume & Errors Over Time</CardTitle>
                <CardDescription>Real-time API request traffic with error tracking</CardDescription>
              </CardHeader>
              <CardContent>
                {analytics.requestsByHour.length > 0 ? (
                  <ResponsiveContainer width="100%" height={350}>
                    <AreaChart data={analytics.requestsByHour}>
                      <defs>
                        <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorErrors" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="hour"
                        angle={-45}
                        textAnchor="end"
                        height={80}
                        tick={{ fontSize: 12 }}
                        className="text-muted-foreground"
                      />
                      <YAxis className="text-muted-foreground" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="hsl(var(--primary))"
                        fillOpacity={1}
                        fill="url(#colorRequests)"
                        strokeWidth={2}
                        name="Total Requests"
                      />
                      <Area
                        type="monotone"
                        dataKey="errors"
                        stroke="#ef4444"
                        fillOpacity={1}
                        fill="url(#colorErrors)"
                        strokeWidth={2}
                        name="Errors"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    No request data available
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Requests</CardTitle>
                <CardDescription>Live feed of the latest API requests</CardDescription>
              </CardHeader>
              <CardContent>
                {analytics.recentRequests.length > 0 ? (
                  <div className="space-y-2">
                    {analytics.recentRequests.map((req, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                          <Badge variant={req.status < 400 ? "default" : "destructive"}>
                            {req.status}
                          </Badge>
                          <code className="text-sm">{req.endpoint}</code>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span>{req.responseTime}ms</span>
                          <span>{req.time}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    No recent requests
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Performance Metrics */}
        <TabsContent value="performance">
          <Card>
            <CardHeader>
              <CardTitle>Response Time Analysis</CardTitle>
              <CardDescription>Average response times across time periods</CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.requestsByHour.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={analytics.requestsByHour}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="hour"
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      tick={{ fontSize: 12 }}
                      className="text-muted-foreground"
                    />
                    <YAxis 
                      label={{ value: 'Response Time (ms)', angle: -90, position: 'insideLeft' }}
                      className="text-muted-foreground"
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="avgResponseTime"
                      stroke="#10b981"
                      strokeWidth={2}
                      name="Avg Response Time (ms)"
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  No performance data available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Top Endpoints */}
        <TabsContent value="endpoints">
          <Card>
            <CardHeader>
              <CardTitle>Top Endpoints Performance</CardTitle>
              <CardDescription>Most frequently called endpoints with performance metrics</CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.topEndpoints.length > 0 ? (
                <div className="space-y-6">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={analytics.topEndpoints} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" className="text-muted-foreground" />
                      <YAxis
                        dataKey="endpoint"
                        type="category"
                        width={150}
                        tick={{ fontSize: 12 }}
                        className="text-muted-foreground"
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Legend />
                      <Bar dataKey="count" fill="hsl(var(--primary))" name="Requests" />
                    </BarChart>
                  </ResponsiveContainer>
                  
                  <div className="space-y-3">
                    <h4 className="font-semibold">Endpoint Details</h4>
                    {analytics.topEndpoints.map((endpoint, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 rounded-lg border">
                        <code className="text-sm font-mono">{endpoint.endpoint}</code>
                        <div className="flex items-center gap-4">
                          <Badge variant="outline">{endpoint.count} requests</Badge>
                          <Badge variant="secondary">{endpoint.avgResponseTime.toFixed(0)}ms avg</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  No endpoint data available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Error Analysis */}
        <TabsContent value="errors">
          <Card>
            <CardHeader>
              <CardTitle>Error Analysis by Endpoint</CardTitle>
              <CardDescription>Endpoints with the highest error rates</CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.errorsByEndpoint.length > 0 ? (
                <div className="space-y-4">
                  {analytics.errorsByEndpoint.map((item, index) => {
                    const errorRate = (item.errors / item.total) * 100;
                    return (
                      <div key={index} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <code className="text-sm font-mono">{item.endpoint}</code>
                          <div className="flex items-center gap-2">
                            <Badge variant="destructive">
                              {item.errors} errors
                            </Badge>
                            <Badge variant="outline">
                              {errorRate.toFixed(1)}% error rate
                            </Badge>
                          </div>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div
                            className="bg-red-600 h-2 rounded-full transition-all"
                            style={{ width: `${errorRate}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <TrendingUp className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No errors detected - excellent performance!</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Keys Usage */}
        <TabsContent value="keys">
          <Card>
            <CardHeader>
              <CardTitle>Requests by API Key</CardTitle>
              <CardDescription>Usage distribution across API keys</CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.requestsByApiKey.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={analytics.requestsByApiKey}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ apiKeyName, percent }) =>
                          `${apiKeyName.substring(0, 15)}: ${(percent * 100).toFixed(0)}%`
                        }
                        outerRadius={80}
                        fill="#3b82f6"
                        dataKey="count"
                      >
                        {analytics.requestsByApiKey.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>

                  <div className="space-y-3">
                    {analytics.requestsByApiKey.map((item, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 rounded-lg border"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                          />
                          <span className="font-medium">{item.apiKeyName}</span>
                        </div>
                        <Badge variant="outline">{item.count} requests</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  No API key usage data available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
