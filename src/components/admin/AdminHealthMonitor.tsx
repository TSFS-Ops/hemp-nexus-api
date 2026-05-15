/**
 * AdminHealthMonitor - Live health monitoring dashboard.
 * Polls /healthz every 30s and displays subsystem status, response times,
 * and a rolling history of checks.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Activity,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Wifi,
  WifiOff,
  Database,
  Shield,
  Key,
  Webhook,
  BarChart3,
  Radio,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const POLL_INTERVAL = 30_000; // 30 seconds
const MAX_HISTORY = 60; // Keep last 30 minutes of data

interface HealthCheck {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  responseTime?: number;
  details?: Record<string, unknown>;
}

interface HealthSnapshot {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  totalResponseTime: string;
  checks: HealthCheck[];
  summary: { healthy: number; degraded: number; unhealthy: number; total: number };
}

interface HistoryEntry {
  timestamp: string;
  status: "healthy" | "degraded" | "unhealthy";
  totalResponseTime: number;
  checksCount: number;
}

const STATUS_CONFIG = {
  healthy: { icon: CheckCircle2, label: "Healthy", variant: "default" as const, color: "text-emerald-600" },
  degraded: { icon: AlertTriangle, label: "Degraded", variant: "secondary" as const, color: "text-yellow-600" },
  unhealthy: { icon: XCircle, label: "Unhealthy", variant: "destructive" as const, color: "text-destructive" },
};

const SUBSYSTEM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  database: Database,
  auth_system: Shield,
  api_keys_table: Key,
  signals_table: Radio,
  matches_table: Activity,
  api_performance: BarChart3,
  webhook_system: Webhook,
};

export function AdminHealthMonitor() {
  const [current, setCurrent] = useState<HealthSnapshot | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/healthz`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      const data = await res.json() as HealthSnapshot;
      setCurrent(data);
      setLastError(null);
      setConsecutiveFailures(0);

      const responseMs = parseInt(data.totalResponseTime?.replace("ms", "") || "0", 10);
      setHistory(prev => {
        const entry: HistoryEntry = {
          timestamp: data.timestamp,
          status: data.status,
          totalResponseTime: responseMs,
          checksCount: data.summary?.total ?? 0,
        };
        return [...prev, entry].slice(-MAX_HISTORY);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Health check failed";
      setLastError(msg);
      setConsecutiveFailures(prev => prev + 1);

      setHistory(prev => {
        const entry: HistoryEntry = {
          timestamp: new Date().toISOString(),
          status: "unhealthy",
          totalResponseTime: 0,
          checksCount: 0,
        };
        return [...prev, entry].slice(-MAX_HISTORY);
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    if (polling) {
      intervalRef.current = setInterval(fetchHealth, POLL_INTERVAL);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchHealth, polling]);

  const togglePolling = () => {
    if (polling && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setPolling(!polling);
    toast.info(polling ? "Health polling paused" : "Health polling resumed");
  };

  // Uptime calculation
  const uptimePercent = history.length > 0
    ? ((history.filter(h => h.status === "healthy").length / history.length) * 100).toFixed(1)
    : "-";

  const avgResponseTime = history.length > 0
    ? Math.round(history.reduce((sum, h) => sum + h.totalResponseTime, 0) / history.filter(h => h.totalResponseTime > 0).length || 0)
    : 0;

  if (loading && !current) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const overallConfig = current ? STATUS_CONFIG[current.status] : STATUS_CONFIG.unhealthy;
  const OverallIcon = overallConfig.icon;

  return (
    <div className="space-y-4">
      {/* Overall Status Banner */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <OverallIcon className={`h-6 w-6 ${overallConfig.color}`} />
              <div>
                <CardTitle className="text-lg">Platform Health</CardTitle>
                <CardDescription>
                  {current ? `Last check: ${new Date(current.timestamp).toLocaleTimeString()}` : "No data"}
                  {polling && " • Polling every 30s"}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={togglePolling}
                className="gap-1.5"
              >
                {polling ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
                {polling ? "Pause" : "Resume"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setLoading(true); fetchHealth(); }}
                disabled={loading}
                className="gap-1.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Check Now
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-md bg-muted/50">
              <p className="text-2xl font-bold text-foreground">{uptimePercent}%</p>
              <p className="text-xs text-muted-foreground">Uptime (session)</p>
            </div>
            <div className="text-center p-3 rounded-md bg-muted/50">
              <p className="text-2xl font-bold text-foreground">{avgResponseTime}ms</p>
              <p className="text-xs text-muted-foreground">Avg Response</p>
            </div>
            <div className="text-center p-3 rounded-md bg-muted/50">
              <p className="text-2xl font-bold text-foreground">{current?.summary?.total ?? 0}</p>
              <p className="text-xs text-muted-foreground">Subsystems</p>
            </div>
            <div className="text-center p-3 rounded-md bg-muted/50">
              <p className="text-2xl font-bold text-foreground">{history.length}</p>
              <p className="text-xs text-muted-foreground">Checks (session)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Consecutive failure alert */}
      {consecutiveFailures >= 3 && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            Health check has failed {consecutiveFailures} consecutive times. Last error: {lastError}
          </AlertDescription>
        </Alert>
      )}

      {/* Subsystem Detail Table */}
      {current?.checks && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Subsystem Status</CardTitle>
            <CardDescription>Detailed health status for each backend component</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subsystem</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Response Time</TableHead>
                  <TableHead className="hidden sm:table-cell">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {current.checks.map((check) => {
                  const config = STATUS_CONFIG[check.status];
                  const StatusIcon = config.icon;
                  const SubIcon = SUBSYSTEM_ICONS[check.name] || Activity;
                  return (
                    <TableRow key={check.name}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <SubIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">{check.name.replace(/_/g, " ")}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={config.variant} className="gap-1 text-xs">
                          <StatusIcon className="h-3 w-3" />
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className={`text-sm font-mono ${
                          (check.responseTime ?? 0) > 1000 ? "text-destructive" :
                          (check.responseTime ?? 0) > 500 ? "text-yellow-600" : "text-muted-foreground"
                        }`}>
                          {check.responseTime != null ? `${check.responseTime}ms` : "-"}
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground max-w-[250px] truncate">
                        {check.message || "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Rolling History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Check History
          </CardTitle>
          <CardDescription>
            Rolling 30-minute window ({history.length} checks recorded)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No history yet. First check in progress…</p>
          ) : (
            <div className="flex items-end gap-0.5 h-16 overflow-hidden">
              {history.map((entry, i) => {
                const barColor =
                  entry.status === "healthy" ? "bg-[hsl(var(--emerald))]" :
                  entry.status === "degraded" ? "bg-yellow-500" : "bg-destructive";
                const heightPercent = entry.totalResponseTime > 0
                  ? Math.max(10, Math.min(100, (entry.totalResponseTime / 3000) * 100))
                  : 100;
                return (
                  <div
                    key={i}
                    className={`flex-1 min-w-[3px] rounded-t-sm ${barColor} transition-all`}
                    style={{ height: `${heightPercent}%` }}
                    title={`${new Date(entry.timestamp).toLocaleTimeString()}: ${entry.status} (${entry.totalResponseTime}ms)`}
                  />
                );
              })}
            </div>
          )}
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-muted-foreground">
              {history.length > 0 ? new Date(history[0].timestamp).toLocaleTimeString() : ""}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {history.length > 0 ? new Date(history[history.length - 1].timestamp).toLocaleTimeString() : ""}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
