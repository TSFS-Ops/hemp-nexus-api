import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { downloadCSV, timestampedFilename } from "@/lib/download-utils";
import { Loader2, RefreshCw, Filter, Shield, Hash, Download } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TableSkeleton } from "@/components/ui/loading-skeletons";

interface AuditLogViewerProps {
  apiKey: string | null;
}

interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
  actor_api_key_id: string | null;
  created_at: string;
  metadata: any;
}

export default function AuditLogViewer({ apiKey }: AuditLogViewerProps) {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  
  // Filters
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [limit, setLimit] = useState("50");
  const [offset, setOffset] = useState(0);

  // NOTE: This component uses X-API-Key auth (for the API testing playground),
  // not session auth — this is intentional and correct.
  const BASE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

  const fetchAuditLogs = async () => {
    if (!apiKey) {
      toast.error("Please set an API key for testing first");
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("limit", limit);
      params.append("offset", String(offset));
      if (action && action !== "all") params.append("action", action);
      if (entityType && entityType !== "all") params.append("entity_type", entityType);
      if (entityId) params.append("entity_id", entityId);
      if (startDate) params.append("start_date", new Date(startDate).toISOString());

      const response = await fetch(`${BASE_URL}/audit-logs?${params.toString()}`, {
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch audit logs");
      }

      const data = await response.json();
      setLogs(data.items);
      setTotalCount(data.totalCount);
      
      toast.success(`Found ${data.items.length} logs (${data.totalCount} total)`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to fetch audit logs");
    } finally {
      setLoading(false);
    }
  };

  const getActionBadgeVariant = (action: string) => {
    if (action.includes("created")) return "default";
    if (action.includes("settled") || action.includes("updated") || action.includes("confirmed")) return "secondary";
    if (action.includes("deleted") || action.includes("revoked")) return "destructive";
    return "outline";
  };

  const exportToCSV = () => {
    if (logs.length === 0) {
      toast.error("No audit logs to export");
      return;
    }

    // CSV headers
    const headers = [
      "Timestamp",
      "Action",
      "Entity Type",
      "Entity ID",
      "Actor Type",
      "SHA-256 Hash",
      "Metadata"
    ];

    // CSV rows
    const rows = logs.map((log) => {
      const hash = (log.metadata as any)?.hash || "";
      const actorType = log.actor_api_key_id ? "API Key" : "User";
      const metadataStr = JSON.stringify(log.metadata || {});
      
      return [
        new Date(log.created_at).toISOString(),
        log.action,
        log.entity_type,
        log.entity_id || "",
        actorType,
        hash,
        metadataStr
      ];
    });

    // Combine headers and rows
    const csvContent = [
      headers.join(","),
      ...rows.map(row => 
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      )
    ].join("\n");

    // Create and download file
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    
    link.setAttribute("href", url);
    link.setAttribute("download", `audit-logs-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (totalCount > logs.length) {
      toast.success(
        `Exported ${logs.length} of ${totalCount} total audit logs. Increase the limit filter to export more.`,
        { duration: 5000 }
      );
    } else {
      toast.success(`Exported all ${logs.length} audit logs to CSV`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Audit Log Viewer
        </CardTitle>
        <CardDescription>
          Query audit logs with filters. All actions are logged for compliance.
        </CardDescription>
        <Alert className="mt-4">
          <Shield className="h-4 w-4" />
          <AlertDescription>
            <strong>Proof-of-Intent Trail:</strong> Match creation and settlement events are immutable audit records 
            containing SHA-256 hashes of deal terms. These logs serve as verifiable proof of intent and settlement.
          </AlertDescription>
        </Alert>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="action">Action Filter</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger id="action">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="match.created">match.created</SelectItem>
                <SelectItem value="match.settled">match.settled</SelectItem>
                <SelectItem value="intent.confirmed">intent.confirmed</SelectItem>
                <SelectItem value="intent.denied">intent.denied</SelectItem>
                <SelectItem value="signal.created">signal.created</SelectItem>
                <SelectItem value="apikey.created">apikey.created</SelectItem>
                <SelectItem value="apikey.revoked">apikey.revoked</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="entityType">Entity Type</Label>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger id="entityType">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="match">match</SelectItem>
                <SelectItem value="signal">signal</SelectItem>
                <SelectItem value="api_key">api_key</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="limit">Limit</Label>
            <Input
              id="limit"
              type="number"
              min="1"
              max="100"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="entityId">Entity ID</Label>
            <Input
              id="entityId"
              placeholder="Optional UUID"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="startDate">Start Date</Label>
            <Input
              id="startDate"
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <Button onClick={fetchAuditLogs} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <Filter className="mr-2 h-4 w-4" />
                  Fetch Logs
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Results */}
        {logs.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {logs.length} of {totalCount} logs
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={exportToCSV}>
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
                <Button variant="ghost" size="sm" onClick={fetchAuditLogs} disabled={loading}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Mobile card view for <768px */}
            <div className="space-y-3 md:hidden">
              {logs.map((log) => {
                const isProofOfIntent =
                  log.action === "match.created" ||
                  log.action === "match.settled" ||
                  log.action === "intent.confirmed";
                const hash = log.metadata?.hash;
                
                return (
                  <div 
                    key={log.id}
                    className={`p-3 border rounded-lg ${isProofOfIntent ? "bg-green-50 dark:bg-green-950/20 border-l-4 border-l-green-600" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={getActionBadgeVariant(log.action)} className="text-xs">
                          {log.action}
                        </Badge>
                        {isProofOfIntent && (
                          <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300 dark:bg-green-900 dark:text-green-100 text-xs">
                            <Shield className="h-3 w-3 mr-1" />
                            Proof
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {log.actor_api_key_id ? "API Key" : "User"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Timestamp</span>
                        <p className="font-mono">{new Date(log.created_at).toLocaleString()}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Entity</span>
                        <p className="font-mono truncate">{log.entity_type}</p>
                      </div>
                      {log.entity_id && (
                        <div>
                          <span className="text-muted-foreground">Entity ID</span>
                          <p className="font-mono truncate">{log.entity_id.substring(0, 8)}</p>
                        </div>
                      )}
                      {hash && (
                        <div>
                          <span className="text-muted-foreground">Hash</span>
                          <div className="flex items-center gap-1">
                            <Hash className="h-3 w-3 text-green-600" />
                            <code className="text-green-700 dark:text-green-400 truncate">
                              {hash.substring(0, 12)}...
                            </code>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table view for ≥768px */}
            <div className="border rounded-lg overflow-hidden hidden md:block">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Timestamp</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="hidden lg:table-cell">Entity Type</TableHead>
                      <TableHead className="hidden lg:table-cell">Entity ID</TableHead>
                      <TableHead>Hash</TableHead>
                      <TableHead className="hidden xl:table-cell">Actor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => {
                      const isProofOfIntent =
                        log.action === "match.created" ||
                        log.action === "match.settled" ||
                        log.action === "intent.confirmed";
                      const hash = log.metadata?.hash;
                      
                      return (
                        <TableRow 
                          key={log.id}
                          className={isProofOfIntent ? "bg-green-50 dark:bg-green-950/20 border-l-4 border-l-green-600" : ""}
                        >
                          <TableCell className="text-xs whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant={getActionBadgeVariant(log.action)}>
                                {log.action}
                              </Badge>
                              {isProofOfIntent && (
                                <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300 dark:bg-green-900 dark:text-green-100">
                                  <Shield className="h-3 w-3 mr-1" />
                                  Proof
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs hidden lg:table-cell">{log.entity_type}</TableCell>
                          <TableCell className="font-mono text-xs hidden lg:table-cell">
                            {log.entity_id ? log.entity_id.substring(0, 8) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {hash ? (
                              <div className="flex items-center gap-2">
                                <Hash className="h-3 w-3 text-green-600 flex-shrink-0" />
                                <code className="text-green-700 dark:text-green-400 truncate max-w-[100px]" title={hash}>
                                  {hash.substring(0, 12)}...
                                </code>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground hidden xl:table-cell">
                            {log.actor_api_key_id ? "API Key" : "User"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Pagination */}
            {totalCount > parseInt(limit) && (
              <div className="flex items-center justify-between pt-3 border-t">
                <p className="text-sm text-muted-foreground">
                  Page {Math.floor(offset / parseInt(limit)) + 1} of {Math.ceil(totalCount / parseInt(limit))}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0 || loading}
                    onClick={() => { setOffset(Math.max(0, offset - parseInt(limit))); }}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset + parseInt(limit) >= totalCount || loading}
                    onClick={() => { setOffset(offset + parseInt(limit)); }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {loading && logs.length === 0 && (
          <TableSkeleton rows={5} columns={6} />
        )}

        {logs.length === 0 && !loading && (
          <div className="text-center py-8 text-muted-foreground">
            No audit logs found. Click "Fetch Logs" to retrieve logs.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
