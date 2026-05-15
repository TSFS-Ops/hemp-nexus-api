import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, Eye, Share2, EyeOff, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

interface DocumentAccessLogsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  documentName: string;
}

interface AccessLog {
  id: string;
  accessor_user_id: string;
  accessor_org_id: string | null;
  action: string;
  access_reason: string | null;
  is_admin_access: boolean;
  ip_address: string | null;
  created_at: string;
}

export function DocumentAccessLogs({
  open,
  onOpenChange,
  documentId,
  documentName,
}: DocumentAccessLogsProps) {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open && documentId) {
      fetchLogs();
    }
  }, [open, documentId]);

  const ACCESS_LOG_LIMIT = 50;
  const [logsTotal, setLogsTotal] = useState(0);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const { data, error, count } = await supabase
        .from("document_access_logs")
        .select(
          "id, accessor_user_id, accessor_org_id, action, access_reason, is_admin_access, ip_address, created_at",
          { count: "exact" },
        )
        .eq("document_id", documentId)
        .order("created_at", { ascending: false })
        .limit(ACCESS_LOG_LIMIT);

      if (error) throw error;
      setLogs(data || []);
      setLogsTotal(count ?? data?.length ?? 0);
    } catch (err) {
      console.error("Error fetching access logs:", err);
    } finally {
      setLoading(false);
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case "download":
        return <Download className="h-4 w-4" />;
      case "view":
        return <Eye className="h-4 w-4" />;
      case "share":
        return <Share2 className="h-4 w-4" />;
      case "revoke":
        return <EyeOff className="h-4 w-4" />;
      case "visibility_change":
        return <AlertTriangle className="h-4 w-4" />;
      default:
        return <Eye className="h-4 w-4" />;
    }
  };

  const getActionBadge = (action: string, isAdmin: boolean) => {
    const variant = isAdmin ? "destructive" : "secondary";
    return (
      <Badge variant={variant} className="flex items-center gap-1">
        {getActionIcon(action)}
        {action.replace("_", " ")}
        {isAdmin && " (Admin)"}
      </Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Access History</DialogTitle>
          <DialogDescription>
            Access log for "{documentName}"
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No access history recorded yet
          </div>
        ) : (
          <div className="border rounded-md overflow-hidden">
            {logsTotal > ACCESS_LOG_LIMIT && (
              <div className="border-b bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Showing {ACCESS_LOG_LIMIT} of {logsTotal.toLocaleString()} access events - older entries are preserved in the audit trail.
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      {getActionBadge(log.action, log.is_admin_access)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(log.created_at), "MMM dd, yyyy HH:mm")}
                    </TableCell>
                    <TableCell>
                      {log.access_reason ? (
                        <span className="text-sm">{log.access_reason}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.ip_address ? (
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">
                          {log.ip_address}
                        </code>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex justify-end pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
