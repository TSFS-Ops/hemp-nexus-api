import { useEffect, useState, useCallback } from "react";
import { downloadCSV } from "@/lib/download-utils";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Download, RefreshCw, ExternalLink, Activity, Server } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { RequestCorrelationDialog } from "@/components/admin/RequestCorrelationDialog";

interface ApiLog {
  id: string;
  created_at: string;
  endpoint: string;
  method: string;
  status_code: number;
  response_time_ms: number;
  error_message: string | null;
  request_id: string | null;
  api_keys: { name: string } | null;
  organizations: { name: string } | null;
}

interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
  org_id: string;
  metadata: Record<string, unknown> | null;
  organizations?: { name: string } | null;
}

export function GlobalApiLogs() {
  const [activeTab, setActiveTab] = useState("requests");
  
  const API_LOG_LIMIT = 200;
  const BUSINESS_LOG_LIMIT = 200;
  
  // API Logs state
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [endpointFilter, setEndpointFilter] = useState<string>("all");
  const [selectedLog, setSelectedLog] = useState<ApiLog | null>(null);
  const [correlationOpen, setCorrelationOpen] = useState(false);
  const [correlationRequestId, setCorrelationRequestId] = useState<string | null>(null);
  const [apiTotalCount, setApiTotalCount] = useState(0);
  
  // Business Events state
  const [businessLogs, setBusinessLogs] = useState<AuditLog[]>([]);
  const [businessLoading, setBusinessLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [businessTotalCount, setBusinessTotalCount] = useState(0);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);

      let query = supabase
        .from("api_request_logs")
        .select(`
          *,
          api_keys (name),
          organizations (name)
        `, { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(API_LOG_LIMIT);

      if (statusFilter !== "all") {
        if (statusFilter === "success") {
          query = query.gte("status_code", 200).lt("status_code", 300);
        } else if (statusFilter === "error") {
          query = query.gte("status_code", 400);
        }
      }

      if (endpointFilter !== "all") {
        query = query.eq("endpoint", endpointFilter);
      }

      const { data, error, count } = await query;

      if (error) throw error;
      setLogs(data || []);
      setApiTotalCount(count ?? data?.length ?? 0);
    } catch (error) {
      console.error("Error fetching logs:", error);
      toast.error("Failed to load API logs");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, endpointFilter]);

  const fetchBusinessLogs = useCallback(async () => {
    try {
      setBusinessLoading(true);

      let query = supabase
        .from("audit_logs")
        .select(`
          id, action, entity_type, entity_id, created_at, org_id, metadata,
          organizations:org_id (name)
        `, { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(BUSINESS_LOG_LIMIT);

      if (actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }

      const { data, error, count } = await query;

      if (error) throw error;
      setBusinessLogs((data || []) as unknown as AuditLog[]);
      setBusinessTotalCount(count ?? data?.length ?? 0);
    } catch (error) {
      console.error("Error fetching business logs:", error);
      toast.error("Failed to load business events");
    } finally {
      setBusinessLoading(false);
    }
  }, [actionFilter]);

  useEffect(() => {
    if (activeTab === "requests") {
      fetchLogs();
    } else {
      fetchBusinessLogs();
    }
  }, [activeTab, fetchLogs, fetchBusinessLogs]);

  const exportLogs = async () => {
    if (activeTab === "requests") {
      if (filteredLogs.length === 0) { toast.error("No logs to export"); return; }
      const headers = ["Timestamp", "Method", "Endpoint", "Status", "Response Time (ms)", "Organisation", "API Key", "Request ID", "Error"];
      const rows = filteredLogs.map(l => [
        new Date(l.created_at).toISOString(), l.method, l.endpoint, l.status_code,
        l.response_time_ms, l.organizations?.name || "", l.api_keys?.name || "",
        l.request_id || "", l.error_message || "",
      ]);
      downloadCSV(headers, rows, `api-logs-${new Date().toISOString().split('T')[0]}.csv`);
      if (apiTotalCount > API_LOG_LIMIT) {
        toast.success(`Exported ${filteredLogs.length} of ${apiTotalCount} total logs. Only the most recent ${API_LOG_LIMIT} are available.`, { duration: 5000 });
      } else {
        toast.success(`Exported ${filteredLogs.length} API logs`);
      }
    } else {
      if (businessLogs.length === 0) { toast.error("No events to export"); return; }
      const headers = ["Timestamp", "Organisation", "Action", "Entity Type", "Entity ID", "Hash", "Metadata"];
      const rows = businessLogs.map(l => [
        new Date(l.created_at).toISOString(), l.organizations?.name || "", l.action,
        l.entity_type, l.entity_id || "",
        (l.metadata && typeof l.metadata === 'object' && 'hash' in l.metadata) ? String(l.metadata.hash) : "",
        JSON.stringify(l.metadata || {}),
      ]);
      downloadCSV(headers, rows, `business-events-${new Date().toISOString().split('T')[0]}.csv`);
      if (businessTotalCount > BUSINESS_LOG_LIMIT) {
        toast.success(`Exported ${businessLogs.length} of ${businessTotalCount} total events. Only the most recent ${BUSINESS_LOG_LIMIT} are available.`, { duration: 5000 });
      } else {
        toast.success(`Exported ${businessLogs.length} business events`);
      }
    }
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return { variant: "default" as const, className: "bg-green-500 hover:bg-green-600" };
    if (status >= 400 && status < 500) return { variant: "default" as const, className: "bg-yellow-500 hover:bg-yellow-600" };
    if (status >= 500) return { variant: "destructive" as const, className: "" };
    return { variant: "secondary" as const, className: "" };
  };

  const getActionBadge = (action: string) => {
    // Primary business events - intent and match related
    const colors: Record<string, string> = {
      "intent.confirmed": "bg-green-500/10 text-green-600 border-green-500/20",
      "intent.declared": "bg-green-500/10 text-green-600 border-green-500/20",
      "match.created": "bg-blue-500/10 text-blue-600 border-blue-500/20",
      "search.completed": "bg-purple-500/10 text-purple-600 border-purple-500/20",
      // Legacy invite events - deprecated styling (muted)
      "invite.created": "bg-muted/50 text-muted-foreground border-muted",
      "invite.accepted": "bg-muted/50 text-muted-foreground border-muted",
      "invite.declined": "bg-muted/50 text-muted-foreground border-muted",
    };
    return (
      <Badge variant="outline" className={colors[action] || ""}>
        {action}
      </Badge>
    );
  };

  const filteredLogs = logs.filter((log) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      log.endpoint.toLowerCase().includes(searchLower) ||
      log.method.toLowerCase().includes(searchLower) ||
      log.request_id?.toLowerCase().includes(searchLower) ||
      log.api_keys?.name.toLowerCase().includes(searchLower) ||
      log.organizations?.name.toLowerCase().includes(searchLower)
    );
  });

  const uniqueEndpoints = Array.from(new Set(logs.map((log) => log.endpoint)));
  const uniqueActions = Array.from(new Set(businessLogs.map((log) => log.action)));

  return (
    <div className="p-6 space-y-6">
      <RequestCorrelationDialog
        open={correlationOpen}
        onOpenChange={setCorrelationOpen}
        requestId={correlationRequestId}
      />
      
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">API Logs</h2>
          <p className="text-muted-foreground mt-2">
            Monitor all API requests and business events across the platform
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={activeTab === "requests" ? fetchLogs : fetchBusinessLogs} 
            variant="outline" 
            size="sm"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading || businessLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button onClick={exportLogs} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="requests" className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            API Requests
          </TabsTrigger>
          <TabsTrigger value="business" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Business Events (Audit)
          </TabsTrigger>
        </TabsList>

        {/* API Requests Tab */}
        <TabsContent value="requests" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by endpoint, method, request ID, API key, or org..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                      aria-label="Search API logs"
                    />
                  </div>
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="success">Success (2xx)</SelectItem>
                    <SelectItem value="error">Errors (4xx, 5xx)</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={endpointFilter} onValueChange={setEndpointFilter}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Filter by endpoint" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Endpoints</SelectItem>
                    {uniqueEndpoints.map((endpoint) => (
                      <SelectItem key={endpoint} value={endpoint}>
                        {endpoint}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {apiTotalCount > API_LOG_LIMIT && (
                <p className="text-sm text-muted-foreground mb-3">
                  Showing {logs.length} of {apiTotalCount} API requests. Only the most recent {API_LOG_LIMIT} are displayed.
                </p>
              )}
              {loading ? (
                <div className="text-center py-8">Loading logs...</div>
              ) : filteredLogs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No logs found</p>
                </div>
              ) : (
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Endpoint</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Response Time</TableHead>
                        <TableHead>Organisation</TableHead>
                        <TableHead>API Key</TableHead>
                        <TableHead>Request ID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLogs.map((log) => (
                        <TableRow
                          key={log.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedLog(log)}
                        >
                          <TableCell className="font-mono text-xs">
                            {format(new Date(log.created_at), "MMM dd, HH:mm:ss")}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{log.method}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[200px] truncate">
                            {log.endpoint}
                          </TableCell>
                          <TableCell>
                            <Badge variant={getStatusColor(log.status_code).variant} className={getStatusColor(log.status_code).className}>
                              {log.status_code}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {log.response_time_ms}ms
                          </TableCell>
                          <TableCell className="text-xs">
                            {log.organizations?.name || "-"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {log.api_keys?.name || "-"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {log.request_id ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCorrelationRequestId(log.request_id!);
                                  setCorrelationOpen(true);
                                }}
                                title="View correlated audit logs"
                              >
                                {log.request_id.slice(0, 8)}...
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {selectedLog && (
            <Card>
              <CardHeader>
                <CardTitle>Request Details</CardTitle>
                <CardDescription>
                  Request ID: {selectedLog.request_id || "N/A"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Method</div>
                    <div className="mt-1">{selectedLog.method}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Status Code</div>
                    <div className="mt-1">{selectedLog.status_code}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Response Time</div>
                    <div className="mt-1">{selectedLog.response_time_ms}ms</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Timestamp</div>
                    <div className="mt-1 text-xs">
                      {format(new Date(selectedLog.created_at), "PPpp")}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-2">Endpoint</div>
                  <code className="block p-2 bg-muted rounded text-xs">{selectedLog.endpoint}</code>
                </div>
                {selectedLog.error_message && (
                  <div>
                    <div className="text-sm font-medium text-destructive mb-2">Error Message</div>
                    <code className="block p-2 bg-destructive/10 rounded text-xs">
                      {selectedLog.error_message}
                    </code>
                  </div>
                )}
                <Button onClick={() => setSelectedLog(null)} variant="outline" size="sm">
                  Close Details
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Business Events Tab */}
        <TabsContent value="business" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row gap-4">
                <Select value={actionFilter} onValueChange={setActionFilter}>
                  <SelectTrigger className="w-[200px]">
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
              </div>
            </CardHeader>
            <CardContent>
              {businessLoading ? (
                <div className="text-center py-8">Loading business events...</div>
              ) : businessLogs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No business events found</p>
                </div>
              ) : (
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Organisation</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Entity</TableHead>
                        <TableHead>Hash</TableHead>
                        <TableHead className="text-right">Proof</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {businessLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="font-mono text-xs">
                            {format(new Date(log.created_at), "MMM dd, HH:mm:ss")}
                          </TableCell>
                          <TableCell className="text-sm">
                            {log.organizations?.name || "-"}
                          </TableCell>
                          <TableCell>{getActionBadge(log.action)}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {log.entity_type}
                            {log.entity_id && (
                              <span className="text-muted-foreground ml-1">
                                {log.entity_id.substring(0, 8)}...
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {log.metadata && typeof log.metadata === 'object' && 'hash' in log.metadata
                              ? String(log.metadata.hash).substring(0, 12) + "..."
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {(log.action === "intent.confirmed" || log.action === "match.created") && log.entity_id && (
                              <Button variant="ghost" size="sm" asChild>
                                <Link to={`/dashboard/matches/${log.entity_id}`}>
                                  <ExternalLink className="h-4 w-4 mr-1" />
                                  Open Proof
                                </Link>
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
