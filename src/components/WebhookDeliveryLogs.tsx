import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Webhook, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

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
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");

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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Deliveries</SelectItem>
                <SelectItem value="success">Successful</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : logs && logs.length > 0 ? (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Endpoint URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Details</TableHead>
              </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs">
                      {new Date(log.delivered_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.event_type}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-xs truncate">
                      {log.webhook_endpoints.url}
                    </TableCell>
                    <TableCell>{getStatusBadge(log)}</TableCell>
                    <TableCell className="text-xs">{log.delivery_attempt}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                      {log.error_message || log.response_body || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No webhook delivery logs found.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
