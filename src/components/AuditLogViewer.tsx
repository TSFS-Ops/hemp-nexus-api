import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Filter } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

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
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  
  // Filters
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [limit, setLimit] = useState("20");

  const BASE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

  const fetchAuditLogs = async () => {
    if (!apiKey) {
      toast({
        title: "No API Key",
        description: "Please set an API key for testing first",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("limit", limit);
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
      
      toast({
        title: "Audit Logs Retrieved",
        description: `Found ${data.items.length} logs (${data.totalCount} total)`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getActionBadgeVariant = (action: string) => {
    if (action.includes("created")) return "default";
    if (action.includes("settled") || action.includes("updated")) return "secondary";
    if (action.includes("deleted") || action.includes("revoked")) return "destructive";
    return "outline";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit Log Viewer</CardTitle>
        <CardDescription>
          Query audit logs with filters. All actions are logged for compliance.
        </CardDescription>
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
              <Button variant="ghost" size="sm" onClick={fetchAuditLogs} disabled={loading}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity Type</TableHead>
                    <TableHead>Entity ID</TableHead>
                    <TableHead>Actor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs">
                        {new Date(log.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getActionBadgeVariant(log.action)}>
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{log.entity_type}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.entity_id ? log.entity_id.substring(0, 8) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {log.actor_api_key_id ? "API Key" : "User"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
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
