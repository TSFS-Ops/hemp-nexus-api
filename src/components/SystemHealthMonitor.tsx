import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Activity, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  RefreshCw,
  Clock,
  TrendingUp
} from "lucide-react";
import { toast } from "sonner";

interface HealthCheck {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  responseTime?: number;
  details?: any;
}

interface HealthData {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  totalResponseTime: string;
  checks: HealthCheck[];
  summary: {
    healthy: number;
    degraded: number;
    unhealthy: number;
    total: number;
  };
}

export default function SystemHealthMonitor() {
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchHealthData = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/healthz`
      );
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      const data = await response.json();
      setHealthData(data);
      setLastChecked(new Date());
      
      if (data.status === "unhealthy") {
        toast.error("System health check failed!");
      } else if (data.status === "degraded") {
        toast.warning("System performance degraded");
      }
    } catch (error) {
      console.error("Health check error:", error);
      toast.error("Failed to fetch health data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealthData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchHealthData();
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "degraded":
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case "unhealthy":
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Activity className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "healthy":
        return <Badge className="bg-green-500">Healthy</Badge>;
      case "degraded":
        return <Badge className="bg-yellow-500">Degraded</Badge>;
      case "unhealthy":
        return <Badge variant="destructive">Unhealthy</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">System Health Monitor</h2>
          <p className="text-muted-foreground">
            Real-time monitoring of all system components
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <Activity className={`h-4 w-4 mr-2 ${autoRefresh ? "animate-pulse" : ""}`} />
            Auto-refresh {autoRefresh ? "ON" : "OFF"}
          </Button>
          <Button onClick={fetchHealthData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Overall Status */}
      {healthData && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getStatusIcon(healthData.status)}
                <div>
                  <CardTitle>Overall Status</CardTitle>
                  <CardDescription>
                    Last checked: {lastChecked?.toLocaleTimeString()}
                  </CardDescription>
                </div>
              </div>
              {getStatusBadge(healthData.status)}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Total Checks</p>
                <p className="text-2xl font-bold">{healthData.summary.total}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Healthy</p>
                <p className="text-2xl font-bold text-green-500">
                  {healthData.summary.healthy}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Degraded</p>
                <p className="text-2xl font-bold text-yellow-500">
                  {healthData.summary.degraded}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Unhealthy</p>
                <p className="text-2xl font-bold text-red-500">
                  {healthData.summary.unhealthy}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Total response time: {healthData.totalResponseTime}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Individual Health Checks */}
      {healthData && (
        <div className="grid gap-4 md:grid-cols-2">
          {healthData.checks.map((check, index) => (
            <Card key={index}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(check.status)}
                    <CardTitle className="text-lg">
                      {check.name.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                    </CardTitle>
                  </div>
                  {getStatusBadge(check.status)}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-2">
                  {check.message}
                </p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {check.responseTime}ms
                  </div>
                  {check.details && (
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      {Object.entries(check.details).map(([key, value]) => (
                        <span key={key}>
                          {key}: {String(value)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!healthData && !loading && (
        <Alert>
          <AlertDescription>
            No health data available. Click refresh to check system status.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
