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
import { EmptyState } from "@/components/ui/error-state";
import { format } from "date-fns";
import { toast } from "sonner";
import { auditedDownloadCSV, redactExportMetadata } from "@/lib/download-utils";
import { recordExportAudit } from "@/lib/export-audit";
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
  // Batch S Fix 8: curated action-group filter so support-hardening actions
  // (manual overrides, risk-item resolution, programme, due diligence) are
  // searchable as a group, not just by exact action name.
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [auditPage, setAuditPage] = useState(0);

  const ADMIN_LOG_LIMIT = 200;

  const { data: auditLogData, isLoading, refetch } = useQuery({
    queryKey: ["admin-audit-logs", actionFilter, entityFilter, groupFilter, search, auditPage],
    queryFn: async () => {
      let query = supabase
        .from("audit_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(auditPage * ADMIN_LOG_LIMIT, (auditPage + 1) * ADMIN_LOG_LIMIT - 1);

      if (actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }

      if (entityFilter !== "all") {
        query = query.eq("entity_type", entityFilter);
      }

      // Batch S Fix 8: group filter — prefix match on action.
      // Ticket 2 (POI Gate Admin Visibility): adds a `poi_gate` pseudo-group
      // that surfaces blocked POI attempts (legitimacy + authority denials)
      // through a single filter without inventing new event types.
      const ACTION_GROUPS: Record<string, string> = {
        admin_risk_item: "admin_risk_item.",
        admin_manual_override: "admin.manual_override.",
        programme: "programme.",
        due_diligence: "dd.",
      };
      if (groupFilter === "poi_gate") {
        query = query.in("action", [
          "poi.mint_denied",
          "legitimacy.gate_blocked",
          "intent.denied",
        ]);
      } else if (groupFilter !== "all" && ACTION_GROUPS[groupFilter]) {
        query = query.like("action", `${ACTION_GROUPS[groupFilter]}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { logs: data || [], totalCount: count ?? data?.length ?? 0 };
    },
  });

  const auditLogs = auditLogData?.logs;
  const auditLogTotalCount = auditLogData?.totalCount ?? 0;
  const totalAuditPages = Math.ceil(auditLogTotalCount / ADMIN_LOG_LIMIT);

  const ADMIN_ACTION_LIMIT = 100;

  const { data: adminAuditLogData } = useQuery({
    queryKey: ["admin-admin-audit-logs"],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("admin_audit_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(ADMIN_ACTION_LIMIT);

      if (error) throw error;
      return { logs: data || [], totalCount: count ?? data?.length ?? 0 };
    },
  });

  const adminAuditLogs = adminAuditLogData?.logs;
  const adminAuditTotalCount = adminAuditLogData?.totalCount ?? 0;
  const adminAuditTruncated = adminAuditTotalCount > ADMIN_ACTION_LIMIT;

  const exportLogs = async () => {
    if (!auditLogs || auditLogs.length === 0) {
      toast.error("No logs to export");
      return;
    }

    // DATA-010 Phase 1: prompt operator for a real reason. Cancel ⇒ abort.
    const { promptExportReason } = await import("@/lib/export-purpose");
    const reason = promptExportReason("audit or regulatory review", "admin audit-logs export");
    if (!reason) {
      toast.error("Export cancelled — a reason of at least 10 characters is required.");
      return;
    }

    // Batch O AUD-012: write audit row + AAL2 gate BEFORE handing rows to the
    // operator. If the gate rejects, we never serialise the CSV.
    const audit = await recordExportAudit({
      target_type: "audit_logs",
      format: "csv",
      row_count: auditLogs.length,
      sensitive: true,
      purpose: "audit_or_regulatory_review",
      reason,
      data_categories: ["audit_logs"],
      filters: { actionFilter, entityFilter, search, page: auditPage },
    });
    if (!audit.ok) {
      if (audit.aal_required) {
        toast.error("Step-up authentication (AAL2) required for audit-log export.");
        return;
      }
      toast.error(`Export blocked: ${audit.error ?? "audit write failed"}`);
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
      // Batch O DATA-005: never dump raw metadata — strip ip/user_agent/tokens/secrets/etc.
      JSON.stringify(redactExportMetadata(log.metadata ?? {})),
    ]);

    // Batch U AUD-018: route through auditedDownloadCSV so the prebuild
    // CSV-audit guard cannot regress. AAL2 gate already enforced above;
    // mark sensitive=false here to avoid writing a duplicate audit row.
    await auditedDownloadCSV(headers, rows, {
      reportName: "admin-audit-logs",
      filename: `audit-logs-${new Date().toISOString().split('T')[0]}.csv`,
      target_type: "audit_logs",
      sensitive: false,
      purpose: "audit_or_regulatory_review",
      reason,
      data_categories: ["audit_logs"],
      filters: { actionFilter, entityFilter, search, page: auditPage, demo_excluded: true },
    });

    if (auditLogTotalCount > (auditLogs?.length ?? 0)) {
      toast.success(
        `Exported ${auditLogs?.length} of ${auditLogTotalCount} audit logs (current page). Use pagination to access other pages.`,
        { duration: 5000 }
      );
    } else {
      toast.success(`Exported all ${auditLogs?.length} audit logs`);
    }
  };


  // Ticket 2: POI Gate Admin Visibility — friendly labels + tone for the
  // blocked POI events emitted by the legitimacy + authority gates. Raw
  // event keys remain visible in the details dialog.
  const POI_GATE_LABELS: Record<string, { label: string; tone: string }> = {
    "poi.mint_denied": { label: "POI mint denied", tone: "bg-rose-700" },
    "legitimacy.gate_blocked": {
      label: "Organisation legitimacy gate blocked POI",
      tone: "bg-rose-700",
    },
    "intent.denied": { label: "Blocked POI attempt", tone: "bg-rose-700" },
  };

  const getActionBadge = (action: string) => {
    const poiGate = POI_GATE_LABELS[action];
    if (poiGate) {
      return (
        <Badge className={poiGate.tone} title={action}>
          {poiGate.label}
        </Badge>
      );
    }
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
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Audit Logs</h2>
          <p className="text-muted-foreground mt-1 sm:mt-2 text-sm">
            Complete audit trail of all binding actions and admin operations
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button variant="outline" size="sm" onClick={exportLogs}>
            <Download className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Export</span>
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
                "Send Trade Request" actions appear here. Soft actions (skip, maybe later) are tracked 
                separately in Behavioural Analytics and do NOT appear in this audit trail.
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
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-4 sm:mb-6">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                aria-label="Search audit logs"
              />
            </div>
            <div className="flex gap-2">
              <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setAuditPage(0); }}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {uniqueActions.map(action => (
                    <SelectItem key={action} value={action}>{action}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setAuditPage(0); }}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Entity Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entities</SelectItem>
                  {uniqueEntities.map(entity => (
                    <SelectItem key={entity} value={entity}>{entity}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={groupFilter} onValueChange={(v) => { setGroupFilter(v); setAuditPage(0); }}>
                <SelectTrigger className="w-full sm:w-[200px]" aria-label="Support action group filter">
                  <SelectValue placeholder="Support group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All groups</SelectItem>
                  <SelectItem value="admin_risk_item">admin_risk_item.*</SelectItem>
                  <SelectItem value="admin_manual_override">admin.manual_override.*</SelectItem>
                  <SelectItem value="programme">programme.*</SelectItem>
                  <SelectItem value="due_diligence">due_diligence (dd.*)</SelectItem>
                  <SelectItem value="poi_gate">POI gate (blocked / denied)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {auditLogTotalCount > 0 && (
            <p className="text-sm text-muted-foreground mb-3">
              Showing {auditPage * ADMIN_LOG_LIMIT + 1} to {Math.min((auditPage + 1) * ADMIN_LOG_LIMIT, auditLogTotalCount)} of {auditLogTotalCount} audit logs.
              {totalAuditPages > 1 && ` Page ${auditPage + 1} of ${totalAuditPages}.`}
            </p>
          )}

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : auditLogs && auditLogs.length > 0 ? (
            <>
              {/* Mobile card view */}
              <div className="space-y-3 md:hidden">
                {auditLogs.map((log) => (
                  <div key={log.id} className="border rounded-md p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      {getActionBadge(log.action)}
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(log.created_at), "MMM dd HH:mm")}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      <div>
                        <span className="text-muted-foreground">Entity</span>
                        <p className="font-medium truncate">{log.entity_type}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">ID</span>
                        <p className="font-mono truncate">{log.entity_id?.substring(0, 8)}...</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-9 touch-target"
                      onClick={() => { setSelectedLog(log); setShowDetailsDialog(true); }}
                    >
                      View Details
                    </Button>
                  </div>
                ))}
              </div>

              {/* Desktop table view */}
              <div className="rounded-md border hidden md:block">
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
                            onClick={() => { setSelectedLog(log); setShowDetailsDialog(true); }}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            {totalAuditPages > 1 && (
              <div className="flex items-center justify-between pt-4 border-t mt-4">
                <p className="text-sm text-muted-foreground">
                  Page {auditPage + 1} of {totalAuditPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={auditPage === 0 || isLoading}
                    onClick={() => setAuditPage(p => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={auditPage >= totalAuditPages - 1 || isLoading}
                    onClick={() => setAuditPage(p => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
            </>
          ) : (
            <EmptyState title="No audit logs found" message="Audit logs will appear here once API activity occurs." />
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
          {adminAuditTruncated && (
            <p className="text-sm text-muted-foreground mb-3">
              Showing {adminAuditLogs?.length} of {adminAuditTotalCount} admin actions. Only the most recent {ADMIN_ACTION_LIMIT} are displayed.
            </p>
          )}
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
            <EmptyState title="No admin audit logs found" message="Admin actions will appear here." />
          )}
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Audit Log Details</DialogTitle>
            <DialogDescription>
              Complete information for this audit entry
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
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
                  <label className="text-sm font-medium text-muted-foreground">Organisation</label>
                  <p className="font-mono text-sm">{selectedLog.org_id}</p>
              </div>

              {/* Ticket 2: POI Gate Admin Visibility — promote the most useful
                  gate fields to a labelled summary so HQ operators don't have
                  to read raw JSON to understand a blocked POI attempt. The
                  raw metadata block below remains visible for forensic use. */}
              {selectedLog.action && POI_GATE_LABELS[selectedLog.action] && selectedLog.metadata && (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-3 space-y-2">
                  <p className="text-sm font-semibold text-rose-900">
                    Blocked POI attempt — {POI_GATE_LABELS[selectedLog.action].label}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {selectedLog.metadata.reason_code && (
                      <div><span className="text-muted-foreground">Reason code: </span><span className="font-mono">{String(selectedLog.metadata.reason_code)}</span></div>
                    )}
                    {selectedLog.metadata.reason && (
                      <div><span className="text-muted-foreground">Reason: </span><span className="font-mono">{String(selectedLog.metadata.reason)}</span></div>
                    )}
                    {selectedLog.metadata.legitimacy_reason && (
                      <div><span className="text-muted-foreground">Legitimacy: </span><span className="font-mono">{String(selectedLog.metadata.legitimacy_reason)}</span></div>
                    )}
                    {selectedLog.metadata.authority_reason && (
                      <div><span className="text-muted-foreground">Authority: </span><span className="font-mono">{String(selectedLog.metadata.authority_reason)}</span></div>
                    )}
                    {selectedLog.metadata.gate_position && (
                      <div><span className="text-muted-foreground">Gate position: </span><span className="font-mono">{String(selectedLog.metadata.gate_position)}</span></div>
                    )}
                    {selectedLog.metadata.trade_approval_status && (
                      <div><span className="text-muted-foreground">Trade approval: </span><span className="font-mono">{String(selectedLog.metadata.trade_approval_status)}</span></div>
                    )}
                    {selectedLog.metadata.endpoint && (
                      <div><span className="text-muted-foreground">Source: </span><span className="font-mono">{String(selectedLog.metadata.endpoint)}</span></div>
                    )}
                    {Array.isArray(selectedLog.metadata.held_roles) && (
                      <div className="sm:col-span-2"><span className="text-muted-foreground">Held roles: </span><span className="font-mono">{(selectedLog.metadata.held_roles as string[]).join(", ") || "(none)"}</span></div>
                    )}
                  </div>
                  <p className="text-[11px] text-rose-900/70">
                    Raw event key: <span className="font-mono">{selectedLog.action}</span>
                  </p>
                </div>
              )}
              
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
          <div className="flex justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setShowDetailsDialog(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
