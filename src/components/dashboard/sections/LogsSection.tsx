import { useState, useCallback, useEffect } from "react";
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
import { Search, RefreshCw, Download } from "lucide-react";
import { TableSkeleton } from "@/components/ui/loading-skeletons";

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

export function LogsSection() {
  const { session } = useAuth();
  const { toast } = useToast();
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [endpointFilter, setEndpointFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

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

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const filteredLogs = logs.filter((log) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      log.endpoint.toLowerCase().includes(query) ||
      log.request_id?.toLowerCase().includes(query) ||
      log.method.toLowerCase().includes(query)
    );
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Logs</h1>
        <p className="text-muted-foreground">
          API request history with filtering and search
        </p>
      </header>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by endpoint, request ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
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

      {/* Results */}
      {isLoading ? (
        <TableSkeleton rows={8} columns={5} />
      ) : filteredLogs.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
          No logs found matching your filters.
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
                      {new Date(log.created_at).toLocaleString()}
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
    </div>
  );
}
