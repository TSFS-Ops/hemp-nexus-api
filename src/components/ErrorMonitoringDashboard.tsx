import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertCircle,
  XCircle,
  RefreshCw,
  Search,
  Filter,
  TrendingUp,
  Clock
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface ErrorLog {
  id: string;
  created_at: string;
  endpoint: string;
  method: string;
  status_code: number;
  error_message: string | null;
  request_body: any;
  response_body: any;
  response_time_ms: number;
  ip_address: string | null;
  user_agent: string | null;
}

export default function ErrorMonitoringDashboard() {
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [stats, setStats] = useState({
    total: 0,
    last24h: 0,
    avgResponseTime: 0,
    errorRate: 0
  });

  const fetchErrors = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("api_request_logs")
        .select("*")
        .gte("status_code", 400)
        .order("created_at", { ascending: false })
        .limit(100);

      if (statusFilter !== "all") {
        const statusCode = parseInt(statusFilter);
        query = query.eq("status_code", statusCode);
      }

      const { data, error } = await query;

      if (error) throw error;

      setErrors(data || []);

      // Calculate stats
      if (data) {
        const last24h = data.filter(
          (log) =>
            new Date(log.created_at) > new Date(Date.now() - 24 * 60 * 60 * 1000)
        );

        const avgResponseTime =
          data.reduce((sum, log) => sum + log.response_time_ms, 0) / data.length || 0;

        // Fetch all logs to calculate error rate
        const { data: allLogs } = await supabase
          .from("api_request_logs")
          .select("status_code", { count: "exact" })
          .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        const totalRequests = allLogs?.length || 0;
        const errorRate = totalRequests > 0 ? (last24h.length / totalRequests) * 100 : 0;

        setStats({
          total: data.length,
          last24h: last24h.length,
          avgResponseTime: Math.round(avgResponseTime),
          errorRate: parseFloat(errorRate.toFixed(2))
        });
      }
    } catch (error) {
      console.error("Error fetching logs:", error);
      toast.error("Failed to fetch error logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchErrors();

    // Set up real-time subscription
    const channel = supabase
      .channel("error-logs")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "api_request_logs",
          filter: "status_code=gte.400"
        },
        (payload) => {
          console.log("New error detected:", payload);
          setErrors((current) => [payload.new as ErrorLog, ...current].slice(0, 100));
          toast.error("New API error detected");
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [statusFilter]);

  const filteredErrors = errors.filter(
    (error) =>
      error.endpoint.toLowerCase().includes(searchTerm.toLowerCase()) ||
      error.error_message?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      error.method.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (statusCode: number) => {
    if (statusCode >= 500) return "text-red-500 bg-red-50 dark:bg-red-950";
    if (statusCode >= 400) return "text-yellow-500 bg-yellow-50 dark:bg-yellow-950";
    return "text-muted-foreground";
  };

  const getStatusLabel = (statusCode: number) => {
    if (statusCode === 400) return "Bad Request";
    if (statusCode === 401) return "Unauthorized";
    if (statusCode === 403) return "Forbidden";
    if (statusCode === 404) return "Not Found";
    if (statusCode === 429) return "Rate Limited";
    if (statusCode === 500) return "Server Error";
    if (statusCode === 503) return "Service Unavailable";
    return "Error";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">Error Monitoring</h2>
          <p className="text-muted-foreground">
            Real-time tracking of failed API requests and errors
          </p>
        </div>
        <Button onClick={fetchErrors} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Errors</CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">In last 100 logs</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Last 24 Hours</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.last24h}</div>
            <p className="text-xs text-muted-foreground">Recent errors</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgResponseTime}ms</div>
            <p className="text-xs text-muted-foreground">For errors</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.errorRate}%</div>
            <p className="text-xs text-muted-foreground">Last 24 hours</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by endpoint, method, or error message..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Status Code" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status Codes</SelectItem>
                <SelectItem value="400">400 - Bad Request</SelectItem>
                <SelectItem value="401">401 - Unauthorized</SelectItem>
                <SelectItem value="403">403 - Forbidden</SelectItem>
                <SelectItem value="404">404 - Not Found</SelectItem>
                <SelectItem value="429">429 - Rate Limited</SelectItem>
                <SelectItem value="500">500 - Server Error</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Error Logs */}
      <div className="space-y-3">
        {filteredErrors.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No errors found matching your filters
            </CardContent>
          </Card>
        ) : (
          filteredErrors.map((error) => (
            <Card key={error.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        {error.method}
                      </Badge>
                      <code className="text-sm">{error.endpoint}</code>
                    </div>
                    <CardDescription>
                      {formatDistanceToNow(new Date(error.created_at), { addSuffix: true })}
                      {error.ip_address && ` • ${error.ip_address}`}
                    </CardDescription>
                  </div>
                  <Badge className={getStatusColor(error.status_code)}>
                    {error.status_code} - {getStatusLabel(error.status_code)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {error.error_message && (
                  <div className="rounded-lg bg-destructive/10 p-3">
                    <p className="text-sm font-medium text-destructive">Error Message:</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {error.error_message}
                    </p>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  {error.request_body && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Request Body:</p>
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(error.request_body, null, 2)}
                      </pre>
                    </div>
                  )}

                  {error.response_body && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Response Body:</p>
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(error.response_body, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Response time: {error.response_time_ms}ms
                  </div>
                  {error.user_agent && (
                    <div className="truncate">User Agent: {error.user_agent}</div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
