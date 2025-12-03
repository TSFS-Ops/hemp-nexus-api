import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, RefreshCw, Download, Shield } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AdminAuditLogs() {
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);

  const { data: auditLogs, isLoading, refetch } = useQuery({
    queryKey: ["admin-audit-logs", actionFilter, entityFilter, search],
    queryFn: async () => {
      let query = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }

      if (entityFilter !== "all") {
        query = query.eq("entity_type", entityFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const { data: adminAuditLogs } = useQuery({
    queryKey: ["admin-admin-audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data || [];
    },
  });

  const exportLogs = () => {
    if (!auditLogs || auditLogs.length === 0) {
      toast.error("No logs to export");
      return;
    }

    const headers = ["ID", "Action", "Entity Type", "Entity ID", "Actor", "Created At", "Metadata"];
    const rows = auditLogs.map(log => [
      log.id,
      log.action,
      log.entity_type,
      log.entity_id || "",
      log.actor_user_id || log.actor_api_key_id || "",
      log.created_at,
      JSON.stringify(log.metadata),
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Audit logs exported");
  };

  const getActionBadge = (action: string) => {
    const colors: Record<string, string> = {
      "intent.confirmed": "bg-green-600",
      "match.created": "bg-blue-600",
      "signal.created": "bg-purple-600",
      "api_key.created": "bg-cyan-600",
      "api_key.revoked": "bg-red-600",
      "org.updated": "bg-orange-600",
    };
    return (
      <Badge className={colors[action] || "bg-gray-600"}>
        {action}
      </Badge>
    );
  };

  const uniqueActions = auditLogs ? [...new Set(auditLogs.map(l => l.action))] : [];
  const uniqueEntities = auditLogs ? [...new Set(auditLogs.map(l => l.entity_type))] : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Audit Logs</h2>
          <p className="text-muted-foreground mt-2">
            Complete audit trail of all binding actions and admin operations
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" onClick={exportLogs}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Important Notice */}
      <Card className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
            <div>
              <h4 className="font-semibold text-green-800 dark:text-green-200">Binding Actions Only</h4>
              <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                This log contains only <strong>binding actions</strong> that create legal intent records.
                "Confirm Intent" actions appear here. Soft actions (skip, maybe later) are tracked 
                separately in Behavioral Analytics and do NOT appear in this audit trail.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Audit Logs */}
      <Card>
        <CardHeader>
          <CardTitle>API Audit Trail</CardTitle>
          <CardDescription>
            Intent confirmations, match creations, and other binding actions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {uniqueActions.map(action => (
                  <SelectItem key={action} value={action}>{action}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Entity Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                {uniqueEntities.map(entity => (
                  <SelectItem key={entity} value={entity}>{entity}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : auditLogs && auditLogs.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity Type</TableHead>
                    <TableHead>Entity ID</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>{getActionBadge(log.action)}</TableCell>
                      <TableCell className="font-medium">{log.entity_type}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.entity_id?.substring(0, 8)}...
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {(log.actor_user_id || log.actor_api_key_id)?.substring(0, 8)}...
                      </TableCell>
                      <TableCell>
                        {format(new Date(log.created_at), "MMM dd HH:mm:ss")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedLog(log);
                            setShowDetailsDialog(true);
                          }}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No audit logs found.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Admin Actions Log */}
      <Card>
        <CardHeader>
          <CardTitle>Admin Actions</CardTitle>
          <CardDescription>
            Administrative operations performed by admin users
          </CardDescription>
        </CardHeader>
        <CardContent>
          {adminAuditLogs && adminAuditLogs.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Target Type</TableHead>
                    <TableHead>Target ID</TableHead>
                    <TableHead>Admin</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adminAuditLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Badge variant="outline">{log.action}</Badge>
                      </TableCell>
                      <TableCell>{log.target_type}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.target_id?.substring(0, 8) || "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.admin_user_id?.substring(0, 8)}...
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.ip_address || "-"}
                      </TableCell>
                      <TableCell>
                        {format(new Date(log.created_at), "MMM dd HH:mm")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No admin audit logs found.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Audit Log Details</DialogTitle>
            <DialogDescription>
              Complete information for this audit entry
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Action</label>
                  <p>{getActionBadge(selectedLog.action)}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Entity Type</label>
                  <p>{selectedLog.entity_type}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Entity ID</label>
                  <p className="font-mono text-sm">{selectedLog.entity_id}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Organization</label>
                  <p className="font-mono text-sm">{selectedLog.org_id}</p>
                </div>
              </div>
              
              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Metadata</label>
                  <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-60 mt-1">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-muted-foreground">Timestamp</label>
                <p>{format(new Date(selectedLog.created_at), "PPpp")}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
