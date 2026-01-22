import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Download, RefreshCw, ExternalLink } from "lucide-react";
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

export function GlobalApiLogs() {
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [endpointFilter, setEndpointFilter] = useState<string>("all");
  const [selectedLog, setSelectedLog] = useState<ApiLog | null>(null);
  const [correlationOpen, setCorrelationOpen] = useState(false);
  const [correlationRequestId, setCorrelationRequestId] = useState<string | null>(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from("api_request_logs")
        .select(`
          *,
          api_keys (name),
          organizations (name)
        `)
        .order("created_at", { ascending: false })
        .limit(100);

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

      const { data, error } = await query;

      if (error) throw error;
      setLogs(data || []);
    } catch (error) {
      console.error("Error fetching logs:", error);
      toast.error("Failed to load API logs");
    } finally {
      setLoading(false);
    }
  };

  const exportLogs = async () => {
    try {
      toast.info("Export functionality coming soon");
      // TODO: Implement CSV/PDF export
    } catch (error) {
      toast.error("Failed to export logs");
    }
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return { variant: "default" as const, className: "bg-green-500 hover:bg-green-600" };
    if (status >= 400 && status < 500) return { variant: "default" as const, className: "bg-yellow-500 hover:bg-yellow-600" };
    if (status >= 500) return { variant: "destructive" as const, className: "" };
    return { variant: "secondary" as const, className: "" };
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

  // Get unique endpoints for filter
  const uniqueEndpoints = Array.from(new Set(logs.map((log) => log.endpoint)));

  return (
    <div className="p-6 space-y-6">
      <RequestCorrelationDialog
        open={correlationOpen}
        onOpenChange={setCorrelationOpen}
        requestId={correlationRequestId}
      />
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">API Request Logs</h2>
          <p className="text-muted-foreground mt-2">
            Monitor all API requests across the platform
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchLogs} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={exportLogs} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

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
          {loading ? (
            <div className="text-center py-8">Loading logs...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No logs found</div>
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
                    <TableHead>Organization</TableHead>
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
    </div>
  );
}
