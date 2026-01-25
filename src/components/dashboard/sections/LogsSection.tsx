import { useState, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, RefreshCw, Download, Activity, Server, ExternalLink } from "lucide-react";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { format } from "date-fns";

interface ApiLog {
  id: string;
  endpoint: string;
  method: string;
  status_code: number;
  response_time_ms: number;
  created_at: string;
  request_id: string | null;
  error_message: string | null;
}

interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export function LogsSection() {
  const { session } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("activity");
  
  // API Request Logs state
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [endpointFilter, setEndpointFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  
  // Activity Logs state
  const [activityLogs, setActivityLogs] = useState<AuditLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityFilter, setActivityFilter] = useState("all");

  const fetchLogs = useCallback(async () => {
    if (!session) return;

    setIsLoading(true);
    try {
      let query = supabase
        .from("api_request_logs")
        .select("id, endpoint, method, status_code, response_time_ms, created_at, request_id, error_message")
        .order("created_at", { ascending: false })
        .limit(100);

      if (endpointFilter !== "all") {
        query = query.ilike("endpoint", `%${endpointFilter}%`);
      }

      if (statusFilter === "success") {
        query = query.gte("status_code", 200).lt("status_code", 300);
      } else if (statusFilter === "error") {
        query = query.gte("status_code", 400);
      }

      const { data, error } = await query;

      if (error) throw error;
      setLogs(data || []);
    } catch (error) {
      console.error("Error fetching logs:", error);
      toast({
        variant: "destructive",
        title: "Error fetching logs",
        description: "Could not load API request logs.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [session, endpointFilter, statusFilter, toast]);

  const fetchActivityLogs = useCallback(async () => {
    if (!session) {
      setActivityLogs([]);
      setActivityLoading(false);
      return;
    }

    setActivityLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("audit-logs", {
        body: { limit: 100 }
      });

      if (error) throw error;
      setActivityLogs(data?.items || []);
    } catch (error) {
      console.error("Failed to fetch activity logs:", error);
      toast({
        variant: "destructive",
        title: "Failed to fetch activity logs",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setActivityLoading(false);
    }
  }, [session, toast]);

  useEffect(() => {
    if (activeTab === "activity") {
      fetchActivityLogs();
    } else {
      fetchLogs();
    }
  }, [activeTab, fetchLogs, fetchActivityLogs]);

  const filteredLogs = logs.filter((log) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      log.endpoint.toLowerCase().includes(query) ||
      log.request_id?.toLowerCase().includes(query) ||
      log.method.toLowerCase().includes(query)
    );
  });

  const filteredActivityLogs = activityLogs.filter((log) => {
    if (activityFilter === "all") return true;
    return log.action === activityFilter;
  });

  const getStatusBadge = (status: number) => {
    if (status >= 200 && status < 300) {
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800 font-mono text-xs">{status}</Badge>;
    }
    if (status >= 400 && status < 500) {
      return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 font-mono text-xs">{status}</Badge>;
    }
    if (status >= 500) {
      return <Badge variant="destructive" className="font-mono text-xs">{status}</Badge>;
    }
    return <Badge variant="secondary" className="font-mono text-xs">{status}</Badge>;
  };

  const getActionBadge = (action: string) => {
    const colors: Record<string, string> = {
      "intent.confirmed": "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800",
      "match.created": "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800",
      "search.completed": "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800",
      "invite.created": "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800",
      "invite.accepted": "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
      "invite.declined": "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800",
    };
    return (
      <Badge variant="outline" className={`font-mono text-xs ${colors[action] || ""}`}>
        {action}
      </Badge>
    );
  };

  const exportToCSV = () => {
    if (filteredLogs.length === 0) return;

    const headers = ["Timestamp", "Method", "Endpoint", "Status", "Response Time (ms)", "Request ID"];
    const rows = filteredLogs.map((log) => [
      new Date(log.created_at).toISOString(),
      log.method,
      log.endpoint,
      log.status_code,
      log.response_time_ms,
      log.request_id || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `api-logs-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();

    toast({ title: "Exported", description: `${filteredLogs.length} logs exported to CSV.` });
  };

  const uniqueActions = [...new Set(activityLogs.map((log) => log.action))];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Logs</h1>
        <p className="text-muted-foreground">
          View activity events and API request history
        </p>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="activity" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Activity / Proof Events
          </TabsTrigger>
          <TabsTrigger value="requests" className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            API Request Logs
          </TabsTrigger>
        </TabsList>

        {/* Activity / Proof Events Tab */}
        <TabsContent value="activity" className="space-y-4 mt-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={activityFilter} onValueChange={setActivityFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Filter by action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {uniqueActions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {action}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="icon"
              onClick={fetchActivityLogs}
              disabled={activityLoading}
            >
              <RefreshCw className={`h-4 w-4 ${activityLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {activityLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : filteredActivityLogs.length === 0 ? (
            <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
              <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No activity events found</p>
              <p className="text-sm mt-1">Confirm intent to generate proof events</p>
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Entity</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Hash</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Proof</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredActivityLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                          {format(new Date(log.created_at), "MMM d, HH:mm:ss")}
                        </td>
                        <td className="px-4 py-3">
                          {getActionBadge(log.action)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {log.entity_type}
                          {log.entity_id && (
                            <span className="text-muted-foreground ml-1">
                              {log.entity_id.substring(0, 8)}...
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {log.metadata && typeof log.metadata === 'object' && 'hash' in log.metadata
                            ? String(log.metadata.hash).substring(0, 12) + "..."
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(log.action === "intent.confirmed" || log.action === "match.created") && log.entity_id && (
                            <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
                              <Link to={`/dashboard/matches/${log.entity_id}`}>
                                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                                Open Proof
                              </Link>
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Showing {filteredActivityLogs.length} activity events
          </p>
        </TabsContent>

        {/* API Request Logs Tab */}
        <TabsContent value="requests" className="space-y-4 mt-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by endpoint, request ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                aria-label="Search logs"
              />
            </div>
            <Select value={endpointFilter} onValueChange={setEndpointFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Endpoint" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All endpoints</SelectItem>
                <SelectItem value="search">/search</SelectItem>
                <SelectItem value="match">/match</SelectItem>
                <SelectItem value="signals">/signals</SelectItem>
                <SelectItem value="webhooks">/webhooks</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={fetchLogs} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
              <Button variant="outline" size="icon" onClick={exportToCSV} disabled={filteredLogs.length === 0}>
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {isLoading ? (
            <TableSkeleton rows={8} columns={6} />
          ) : filteredLogs.length === 0 ? (
            <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
              <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No logs found matching your filters.</p>
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Method</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Endpoint</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Latency</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Request ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                          {format(new Date(log.created_at), "MMM d, HH:mm:ss")}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary" className="font-mono text-xs">
                            {log.method}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{log.endpoint}</td>
                        <td className="px-4 py-3">{getStatusBadge(log.status_code)}</td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                          {log.response_time_ms}ms
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {log.request_id ? log.request_id.substring(0, 8) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Showing {filteredLogs.length} of {logs.length} logs (last 100)
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
