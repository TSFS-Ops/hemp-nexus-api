import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Activity, TrendingUp, AlertCircle, Clock, BarChart3, Calendar } from "lucide-react";

interface AnalyticsData {
  totalRequests: number;
  successRate: number;
  avgResponseTime: number;
  topEndpoints: Array<{ endpoint: string; count: number }>;
  requestsByHour: Array<{ hour: string; count: number }>;
  errorsByEndpoint: Array<{ endpoint: string; errors: number; total: number }>;
  requestsByApiKey: Array<{ apiKeyName: string; count: number }>;
}

export default function ApiAnalytics() {
  const [timeRange, setTimeRange] = useState<"24h" | "7d" | "30d">("7d");
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<AnalyticsData>({
    totalRequests: 0,
    successRate: 0,
    avgResponseTime: 0,
    topEndpoints: [],
    requestsByHour: [],
    errorsByEndpoint: [],
    requestsByApiKey: [],
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchAnalytics();
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
    setLoading(true);
    try {
      const startDate = getTimeRangeDate();

      // Fetch audit logs for the time range
      const { data: logs, error: logsError } = await supabase
        .from("audit_logs")
        .select("*, api_keys!inner(name)")
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: false });

      if (logsError) throw logsError;

      // Fetch rate limits for additional metrics
      const { data: rateLimits, error: rateLimitsError } = await supabase
        .from("rate_limits")
        .select("*")
        .gte("window_start", startDate.toISOString());

      if (rateLimitsError) throw rateLimitsError;

      // Process the data
      const totalRequests = logs?.length || 0;
      
      // Calculate success rate from metadata (assuming metadata contains status codes)
      const successfulRequests = logs?.filter((log) => {
        const metadata = log.metadata as any;
        const status = metadata?.status_code;
        return status && status >= 200 && status < 400;
      }).length || 0;
      const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;

      // Calculate average response time from metadata
      const responseTimes = logs
        ?.map((log) => {
          const metadata = log.metadata as any;
          return metadata?.response_time_ms;
        })
        .filter((time): time is number => typeof time === "number") || [];
      const avgResponseTime = responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

      // Top endpoints by request count
      const endpointCounts: Record<string, number> = {};
      logs?.forEach((log) => {
        const metadata = log.metadata as any;
        const endpoint = metadata?.endpoint || log.entity_type;
        endpointCounts[endpoint] = (endpointCounts[endpoint] || 0) + 1;
      });
      const topEndpoints = Object.entries(endpointCounts)
        .map(([endpoint, count]) => ({ endpoint, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Requests by hour
      const hourCounts: Record<string, number> = {};
      logs?.forEach((log) => {
        const hour = new Date(log.created_at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
        });
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      });
      const requestsByHour = Object.entries(hourCounts)
        .map(([hour, count]) => ({ hour, count }))
        .slice(-24);

      // Errors by endpoint
      const endpointErrors: Record<string, { errors: number; total: number }> = {};
      logs?.forEach((log) => {
        const metadata = log.metadata as any;
        const endpoint = metadata?.endpoint || log.entity_type;
        const status = metadata?.status_code;
        if (!endpointErrors[endpoint]) {
          endpointErrors[endpoint] = { errors: 0, total: 0 };
        }
        endpointErrors[endpoint].total += 1;
        if (status && status >= 400) {
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

      setAnalytics({
        totalRequests,
        successRate,
        avgResponseTime,
        topEndpoints,
        requestsByHour,
        errorsByEndpoint,
        requestsByApiKey,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load analytics data",
        variant: "destructive",
      });
      console.error("Analytics error:", error);
    } finally {
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
            API Usage Analytics
          </h2>
          <p className="text-muted-foreground mt-1">
            Monitor API performance and usage patterns
          </p>
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
            <div className="text-3xl font-bold text-red-600">
              {(100 - analytics.successRate).toFixed(1)}%
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="volume" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="volume">Request Volume</TabsTrigger>
          <TabsTrigger value="endpoints">Top Endpoints</TabsTrigger>
          <TabsTrigger value="errors">Error Analysis</TabsTrigger>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
        </TabsList>

        {/* Request Volume Over Time */}
        <TabsContent value="volume">
          <Card>
            <CardHeader>
              <CardTitle>Request Volume Over Time</CardTitle>
              <CardDescription>API requests grouped by time period</CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.requestsByHour.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={analytics.requestsByHour}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="hour"
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      name="Requests"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  No request data available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Top Endpoints */}
        <TabsContent value="endpoints">
          <Card>
            <CardHeader>
              <CardTitle>Top Endpoints by Request Count</CardTitle>
              <CardDescription>Most frequently called API endpoints</CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.topEndpoints.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={analytics.topEndpoints} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis
                      dataKey="endpoint"
                      type="category"
                      width={150}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="count" fill="#3b82f6" name="Requests" />
                  </BarChart>
                </ResponsiveContainer>
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
