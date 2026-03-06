import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, RefreshCw, Webhook, AlertCircle, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { EmptyState } from "@/components/ui/error-state";

interface WebhookDeliveryLog {
  id: string;
  webhook_endpoint_id: string;
  event_type: string;
  response_status_code: number | null;
  response_body: string | null;
  error_message: string | null;
  delivery_attempt: number;
  delivered_at: string;
  webhook_endpoints: {
    url: string;
  };
}

export default function WebhookDeliveryLogs() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [retrying, setRetrying] = useState<string | null>(null);

  const handleRetry = async (deliveryId: string) => {
    setRetrying(deliveryId);
    try {
      await apiFetch("webhook-retry", {
        method: "POST",
        body: JSON.stringify({ delivery_id: deliveryId }),
      });
      toast.success("Webhook replayed successfully");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to retry webhook delivery");
    } finally {
      setRetrying(null);
    }
  };

  const { data: logs, isLoading, refetch } = useQuery({
    queryKey: ["webhook-deliveries", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("webhook_deliveries")
        .select("*, webhook_endpoints!inner(url)")
        .order("delivered_at", { ascending: false })
        .limit(50);

      if (statusFilter === "success") {
        query = query.gte("response_status_code", 200).lt("response_status_code", 300);
      } else if (statusFilter === "failed") {
        query = query.or("response_status_code.is.null,response_status_code.lt.200,response_status_code.gte.300");
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as WebhookDeliveryLog[];
    },
  });

  const getStatusBadge = (log: WebhookDeliveryLog) => {
    if (log.error_message) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <XCircle className="h-3 w-3" />
          Error
        </Badge>
      );
    }

    const status = log.response_status_code || 0;
    if (status >= 200 && status < 300) {
      return (
        <Badge variant="default" className="flex items-center gap-1 bg-green-600">
          <CheckCircle2 className="h-3 w-3" />
          {status}
        </Badge>
      );
    } else if (status >= 400) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <XCircle className="h-3 w-3" />
          {status}
        </Badge>
      );
    } else {
      return (
        <Badge variant="secondary" className="flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {status}
        </Badge>
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="h-5 w-5" />
          Webhook Delivery Logs
        </CardTitle>
        <CardDescription>
          Track webhook delivery attempts, response codes, and failure reasons for debugging.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Deliveries</SelectItem>
                <SelectItem value="success">Successful</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading} className="touch-target h-9 sm:h-8">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Results */}
        <div className="min-h-[300px]">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : logs && logs.length > 0 ? (
          <>
            {/* Mobile card view */}
            <div className="space-y-3 md:hidden">
              {logs.map((log) => (
                <div key={log.id} className="p-3 border rounded-lg">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <Badge variant="outline" className="text-xs">{log.event_type}</Badge>
                    {getStatusBadge(log)}
                  </div>
                  <div className="space-y-1 text-xs">
                    <p className="text-muted-foreground">
                      {new Date(log.delivered_at).toLocaleString()}
                    </p>
                    <p className="font-mono truncate text-muted-foreground">
                      {log.webhook_endpoints.url}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Attempt:</span>
                      <span>{log.delivery_attempt}</span>
                    </div>
                    {(log.error_message || log.response_body) && (
                      <p className="text-muted-foreground truncate">
                        {log.error_message || log.response_body}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="border rounded-lg overflow-hidden hidden md:block">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Timestamp</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead className="hidden lg:table-cell">Endpoint URL</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden xl:table-cell">Attempt</TableHead>
                      <TableHead className="hidden xl:table-cell">Details</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(log.delivered_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{log.event_type}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-xs truncate hidden lg:table-cell">
                          {log.webhook_endpoints.url}
                        </TableCell>
                        <TableCell>{getStatusBadge(log)}</TableCell>
                        <TableCell className="text-xs hidden xl:table-cell">{log.delivery_attempt}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate hidden xl:table-cell">
                          {log.error_message || log.response_body || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {(log.error_message || !log.response_status_code || log.response_status_code >= 300) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={retrying === log.id}
                              onClick={() => handleRetry(log.id)}
                            >
                              {retrying === log.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3 w-3" />
                              )}
                              <span className="ml-1 text-xs">Retry</span>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        ) : (
          <EmptyState title="No webhook delivery logs found" message="Logs will appear here once webhooks are triggered." />
        )}
      </CardContent>
    </Card>
  );
}
