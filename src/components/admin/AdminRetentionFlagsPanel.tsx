import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Clock, RefreshCw, Loader2, AlertTriangle, Archive, Shield,
  CheckCircle2, Lock, Trash2, Eye, FileText, ShieldAlert,
  HardDrive, Download, Hash
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ErrorState } from "@/components/ui/error-state";
import { InlineLoader } from "@/components/ui/inline-loader";
import { QUERY_LIMIT_ADMIN } from "@/lib/constants";

interface RetentionFlag {
  id: string;
  table_name: string;
  record_id: string;
  flag_type: string;
  record_created_at: string;
  retention_expires_at: string;
  flagged_at: string;
  archived_at: string | null;
  retention_status: string;
  retention_action: string | null;
  enforcement_applied_at: string | null;
  resolution_status: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  last_scan_at: string | null;
  org_id: string | null;
  archive_storage_path: string | null;
  archive_hash: string | null;
  archive_size_bytes: number | null;
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Clock }> = {
  active: { label: "Active", variant: "secondary", icon: Clock },
  flagged: { label: "Flagged for Action", variant: "default", icon: AlertTriangle },
  retained: { label: "Retained", variant: "outline", icon: Shield },
  archived: { label: "Archived", variant: "outline", icon: Archive },
  quarantined: { label: "Quarantined", variant: "destructive", icon: Lock },
  pending_deletion: { label: "Pending Deletion", variant: "destructive", icon: Trash2 },
  deleted: { label: "Deleted", variant: "destructive", icon: Trash2 },
  resolved: { label: "Resolved", variant: "secondary", icon: CheckCircle2 },
};

const ACTION_LABELS: Record<string, string> = {
  archive: "Archive record",
  quarantine: "Quarantine from UI",
  mark_readonly: "Mark read-only",
  schedule_deletion: "Schedule for deletion",
  retain: "Retain under policy",
  no_action: "No action required",
};

export function AdminRetentionFlagsPanel() {
  const [flags, setFlags] = useState<RetentionFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [tableFilter, setTableFilter] = useState("all");
  const [resolveFlag, setResolveFlag] = useState<RetentionFlag | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [resolveAction, setResolveAction] = useState("acknowledged");
  const [resolving, setResolving] = useState(false);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [archiveStats, setArchiveStats] = useState<{ count: number; totalBytes: number }>({ count: 0, totalBytes: 0 });
  const [triggeringArchive, setTriggeringArchive] = useState(false);
  const fetchFlags = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch counts by status using individual count queries (avoids fetching all rows)
      const statusKeys = ["active", "flagged", "retained", "archived", "quarantined", "pending_deletion", "deleted", "resolved"];
      const countResults = await Promise.all(
        statusKeys.map(async (s) => {
          const { count } = await supabase
            .from("retention_flags")
            .select("id", { count: "exact", head: true })
            .eq("retention_status", s);
          return [s, count ?? 0] as [string, number];
        })
      );
      setStats(Object.fromEntries(countResults));

      // Fetch archive stats (count + total size of cold-stored records)
      const { count: archivedCount } = await supabase
        .from("retention_flags")
        .select("id", { count: "exact", head: true })
        .not("archive_storage_path", "is", null);

      // Sum archive sizes — fetch actual values for summation
      const { data: archiveSizeData } = await supabase
        .from("retention_flags")
        .select("archive_size_bytes")
        .not("archive_storage_path", "is", null)
        .not("archive_size_bytes", "is", null)
        .limit(1000);

      const totalBytes = (archiveSizeData || []).reduce(
        (sum, r) => sum + (r.archive_size_bytes || 0), 0
      );
      setArchiveStats({ count: archivedCount ?? 0, totalBytes });
      // Count query
      let countQ = supabase.from("retention_flags").select("id", { count: "exact", head: true });
      if (statusFilter !== "all") countQ = countQ.eq("retention_status", statusFilter);
      if (tableFilter !== "all") countQ = countQ.eq("table_name", tableFilter);
      const { count } = await countQ;
      setTotal(count);

      // Data query
      let query = supabase
        .from("retention_flags")
        .select("*")
        .order("retention_expires_at", { ascending: true })
        .limit(QUERY_LIMIT_ADMIN);
      if (statusFilter !== "all") query = query.eq("retention_status", statusFilter);
      if (tableFilter !== "all") query = query.eq("table_name", tableFilter);
      const { data, error: fetchErr } = await query;
      if (fetchErr) throw fetchErr;
      setFlags((data || []) as RetentionFlag[]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load retention flags";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, tableFilter]);

  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  const handleResolve = async () => {
    if (!resolveFlag || !resolveNote.trim()) return;
    setResolving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Session expired. Please sign in again.");
        return;
      }

      const { error: updateErr } = await supabase
        .from("retention_flags")
        .update({
          resolution_status: resolveAction,
          resolution_note: resolveNote.trim(),
          resolved_at: new Date().toISOString(),
          resolved_by: session.user.id,
          retention_status: resolveAction === "dismissed" ? "resolved" : resolveFlag.retention_status,
        })
        .eq("id", resolveFlag.id);

      if (updateErr) throw updateErr;

      // Verify update succeeded (RLS truthfulness)
      const { data: check } = await supabase
        .from("retention_flags")
        .select("id, resolution_status")
        .eq("id", resolveFlag.id)
        .maybeSingle();

      if (!check || check.resolution_status !== resolveAction) {
        toast.error("Resolution may not have been saved. Check permissions.");
        return;
      }

      // Audit
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profile?.org_id) {
        await supabase.from("audit_logs").insert({
          org_id: profile.org_id,
          actor_user_id: session.user.id,
          action: `retention.resolved.${resolveAction}`,
          entity_type: resolveFlag.table_name,
          entity_id: resolveFlag.record_id,
          metadata: {
            flag_id: resolveFlag.id,
            resolution_status: resolveAction,
            resolution_note: resolveNote.trim(),
            previous_status: resolveFlag.retention_status,
          },
        });
      }

      toast.success("Retention flag resolved");
      setResolveFlag(null);
      setResolveNote("");
      fetchFlags();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resolve flag");
    } finally {
      setResolving(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const triggerArchival = async () => {
    setTriggeringArchive(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("cold-storage-archive", {
        method: "POST",
      });
      if (invokeErr) throw invokeErr;
      const result = data as { processed?: number; failed?: number };
      toast.success(
        `Cold storage archival complete: ${result?.processed ?? 0} records archived, ${result?.failed ?? 0} failed`
      );
      fetchFlags();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to trigger archival");
    } finally {
      setTriggeringArchive(false);
    }
  };

  const statusBadge = (status: string) => {
    const config = STATUS_CONFIG[status];
    if (!config) return <Badge variant="secondary">{status}</Badge>;
    const Icon = config.icon;
    return (
      <Badge variant={config.variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const actionBadge = (action: string | null) => {
    if (!action) return <span className="text-muted-foreground text-xs">-</span>;
    return <Badge variant="outline" className="text-xs">{ACTION_LABELS[action] || action}</Badge>;
  };

  if (error && flags.length === 0) {
    return <ErrorState title="Failed to load retention flags" message={error} onRetry={fetchFlags} />;
  }

  const actionableCount = (stats["flagged"] || 0) + (stats["pending_deletion"] || 0);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Eye className="h-4 w-4" />
              Active
            </div>
            <p className="text-2xl font-bold mt-1">{stats["active"] || 0}</p>
            <p className="text-xs text-muted-foreground">Approaching expiry</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ShieldAlert className="h-4 w-4" />
              Action Required
            </div>
            <p className="text-2xl font-bold mt-1">{actionableCount}</p>
            <p className="text-xs text-muted-foreground">Flagged or pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Archive className="h-4 w-4" />
              Archived
            </div>
            <p className="text-2xl font-bold mt-1">{(stats["archived"] || 0) + (stats["retained"] || 0)}</p>
            <p className="text-xs text-muted-foreground">Enforced under policy</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <HardDrive className="h-4 w-4" />
              Cold Storage
            </div>
            <p className="text-2xl font-bold mt-1">{archiveStats.count}</p>
            <p className="text-xs text-muted-foreground">{formatBytes(archiveStats.totalBytes)} stored</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              Resolved
            </div>
            <p className="text-2xl font-bold mt-1">{stats["resolved"] || 0}</p>
            <p className="text-xs text-muted-foreground">Reviewed and closed</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Data Retention Enforcement
              </CardTitle>
              <CardDescription className="mt-1">
                Records evaluated against the 7-year retention policy. Actions are enforced automatically; review and resolution require admin approval.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={triggerArchival}
              disabled={triggeringArchive}
              className="shrink-0"
            >
              {triggeringArchive ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <HardDrive className="h-4 w-4 mr-2" />
              )}
              Run Archival
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="flagged">Flagged for Action</SelectItem>
                <SelectItem value="retained">Retained</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
                <SelectItem value="quarantined">Quarantined</SelectItem>
                <SelectItem value="pending_deletion">Pending Deletion</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tableFilter} onValueChange={setTableFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filter by record type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Record Types</SelectItem>
                <SelectItem value="audit_logs">Audit Logs</SelectItem>
                <SelectItem value="collapse_ledger">Completion Ledger</SelectItem>
                <SelectItem value="match_events">Match Events</SelectItem>
                <SelectItem value="matches">Matches</SelectItem>
                <SelectItem value="screening_results">Screening Results</SelectItem>
                <SelectItem value="match_documents">Documents</SelectItem>
                <SelectItem value="wads">WaDs</SelectItem>
                <SelectItem value="compliance_cases">Compliance Cases</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={fetchFlags} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>

          {total !== null && flags.length >= QUERY_LIMIT_ADMIN && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>Showing {flags.length} of {total} flags. Apply filters to narrow results.</AlertDescription>
            </Alert>
          )}

          {loading && flags.length === 0 ? (
            <InlineLoader message="Loading retention enforcement data…" />
          ) : flags.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No retention flags match the current filter.</p>
              <p className="text-xs mt-1">All records are within the 7-year retention window.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Record Type</TableHead>
                    <TableHead>Record ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Record Created</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Enforced</TableHead>
                    <TableHead>Cold Storage</TableHead>
                    <TableHead>Resolution</TableHead>
                    <TableHead className="text-right">Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flags.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>
                        <Badge variant="outline">{f.table_name.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{f.record_id.slice(0, 8)}…</TableCell>
                      <TableCell>{statusBadge(f.retention_status)}</TableCell>
                      <TableCell>{actionBadge(f.retention_action)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(f.record_created_at), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(f.retention_expires_at), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {f.enforcement_applied_at
                          ? format(new Date(f.enforcement_applied_at), "dd MMM yyyy")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {f.archive_storage_path ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="secondary" className="gap-1 text-xs cursor-help">
                                <HardDrive className="h-3 w-3" />
                                Stored
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <div className="space-y-1 text-xs">
                                <p className="font-medium">Cold Storage Archive</p>
                                <p className="font-mono break-all">{f.archive_storage_path}</p>
                                {f.archive_hash && (
                                  <p className="flex items-center gap-1">
                                    <Hash className="h-3 w-3" />
                                    {f.archive_hash.slice(0, 16)}…
                                  </p>
                                )}
                                {f.archive_size_bytes != null && (
                                  <p>{formatBytes(f.archive_size_bytes)}</p>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            {["archived", "quarantined"].includes(f.retention_status) ? "Pending" : "-"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {f.resolution_status ? (
                          <Badge variant="outline" className="text-xs capitalize">
                            {f.resolution_status}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!f.resolution_status && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setResolveFlag(f);
                              setResolveNote("");
                              setResolveAction("acknowledged");
                            }}
                          >
                            Review
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

      {/* Resolve Dialog */}
      <Dialog open={!!resolveFlag} onOpenChange={(open) => !open && setResolveFlag(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Review Retention Flag
            </DialogTitle>
            <DialogDescription>
              Review and resolve this retention flag. Your action will be audit-logged.
            </DialogDescription>
          </DialogHeader>
          {resolveFlag && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Record Type</span>
                  <p className="font-medium">{resolveFlag.table_name.replace(/_/g, " ")}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <div className="mt-1">{statusBadge(resolveFlag.retention_status)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Assigned Action</span>
                  <div className="mt-1">{actionBadge(resolveFlag.retention_action)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Expires</span>
                  <p className="font-medium">{format(new Date(resolveFlag.retention_expires_at), "dd MMM yyyy")}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Resolution Action</Label>
                <Select value={resolveAction} onValueChange={setResolveAction}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="acknowledged">Acknowledged - action accepted</SelectItem>
                    <SelectItem value="extended">Extended - retention period extended</SelectItem>
                    <SelectItem value="dismissed">Dismissed - flag invalid</SelectItem>
                    <SelectItem value="completed">Completed - action fully applied</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="resolve-note">Resolution Note (required)</Label>
                <Textarea
                  id="resolve-note"
                  placeholder="Explain your decision…"
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveFlag(null)}>Cancel</Button>
            <Button onClick={handleResolve} disabled={resolving || !resolveNote.trim()}>
              {resolving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Resolve Flag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
