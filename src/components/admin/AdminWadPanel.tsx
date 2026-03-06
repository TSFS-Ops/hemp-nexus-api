import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Shield, Download, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { ErrorState } from "@/components/ui/error-state";
import * as WadState from "@/lib/wad-state";
import { apiFetch } from "@/lib/api-client";
import { supabase } from "@/integrations/supabase/client";

interface Wad {
  id: string;
  poi_id: string;
  org_id: string;
  status: string;
  seal_hash: string | null;
  sealed_at: string | null;
  created_at: string;
  buyer_org_id: string | null;
  seller_org_id: string | null;
  revoked_reason: string | null;
}

export function AdminWadPanel() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [revokeWadId, setRevokeWadId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revoking, setRevoking] = useState(false);
  const [accessReason, setAccessReason] = useState("");
  const [accessWadId, setAccessWadId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: wads = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-wads", statusFilter],
    queryFn: async () => {
      const path = statusFilter !== "all" ? `wad?status=${statusFilter}` : "wad";
      return apiFetch<Wad[]>(path);
    },
  });

  const handleRevoke = async () => {
    if (!revokeWadId || !revokeReason.trim()) {
      toast.error("Revocation reason is required");
      return;
    }

    try {
      setRevoking(true);
      await apiFetch(`wad/${revokeWadId}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason: revokeReason }),
      });

      toast.success("WaD revoked");
      setRevokeWadId(null);
      setRevokeReason("");
      queryClient.invalidateQueries({ queryKey: ["admin-wads"] });
    } catch (error: any) {
      toast.error(error.message || "Failed to revoke WaD");
    } finally {
      setRevoking(false);
    }
  };

  const handleDownloadCertificate = async (wadId: string) => {
    if (!accessReason.trim()) {
      toast.error("Access reason is required for admin downloads");
      return;
    }

    try {
      // Log admin access with reason
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", session.user.id).maybeSingle();
        if (profile?.org_id) {
          await supabase.from("audit_logs").insert({
            org_id: profile.org_id,
            actor_user_id: session.user.id,
            action: "admin.wad.certificate.downloaded",
            entity_type: "wad",
            entity_id: wadId,
            metadata: { reason: accessReason },
          });
        }
      }

      const certificate = await apiFetch(`wad/${wadId}/certificate`);
      const blob = new Blob([JSON.stringify(certificate, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `wad-certificate-${wadId}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("Certificate downloaded");
      setAccessWadId(null);
      setAccessReason("");
    } catch (error) {
      console.error("[AdminWadPanel] certificate download failed:", error);
      toast.error("Failed to download certificate");
    }
  };

  const filteredWads = wads.filter(wad => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return wad.id.toLowerCase().includes(search) || 
             wad.poi_id.toLowerCase().includes(search);
    }
    return true;
  });

  if (isError) {
    return (
      <div className="p-6">
        <ErrorState title="Failed to load WaDs" onRetry={() => refetch()} type="server" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-8 w-8" />
            WaD Management
          </h2>
          <p className="text-muted-foreground mt-2">
            View and manage all Without-a-Doubt sealed evidence bundles
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All WaDs</CardTitle>
          <CardDescription>
            Admin access to WaDs is logged. Certificate downloads require a reason.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <Input
                placeholder="Search by WaD ID or POI ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="awaiting_attestations">Awaiting Attestations</SelectItem>
                <SelectItem value="sealed">Sealed</SelectItem>
                <SelectItem value="revoked">Revoked</SelectItem>
                <SelectItem value="superseded">Superseded</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <TableSkeleton rows={5} columns={6} />
          ) : filteredWads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No WaDs found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>WaD ID</TableHead>
                  <TableHead>POI ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sealed At</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredWads.map((wad) => (
                  <TableRow key={wad.id}>
                    <TableCell className="font-mono text-xs">
                      {wad.id.substring(0, 8)}...
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {wad.poi_id.substring(0, 8)}...
                    </TableCell>
                    <TableCell><StatusBadge status={wad.status} /></TableCell>
                    <TableCell>
                      {wad.sealed_at ? new Date(wad.sealed_at).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell>
                      {new Date(wad.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {WadState.canDo(wad.status, "download_certificate") && (
                        <Dialog open={accessWadId === wad.id} onOpenChange={(open) => !open && setAccessWadId(null)}>
                          <DialogTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => setAccessWadId(wad.id)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                                Admin Access Reason Required
                              </DialogTitle>
                              <DialogDescription>
                                Your access will be logged. Please provide a reason for downloading this certificate.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="py-4">
                              <Label htmlFor="access-reason">Access Reason</Label>
                              <Textarea
                                id="access-reason"
                                placeholder="e.g., Compliance review, audit request, dispute resolution..."
                                value={accessReason}
                                onChange={(e) => setAccessReason(e.target.value)}
                                className="mt-2"
                              />
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setAccessWadId(null)}>
                                Cancel
                              </Button>
                              <Button 
                                onClick={() => handleDownloadCertificate(wad.id)}
                                disabled={!accessReason.trim()}
                              >
                                <Download className="h-4 w-4 mr-2" />
                                Download Certificate
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      )}
                      
                      {WadState.canDo(wad.status, "revoke") && (
                        <Dialog open={revokeWadId === wad.id} onOpenChange={(open) => !open && setRevokeWadId(null)}>
                          <DialogTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => setRevokeWadId(wad.id)}
                            >
                              <XCircle className="h-4 w-4 text-destructive" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2 text-destructive">
                                <XCircle className="h-5 w-5" />
                                Revoke WaD
                              </DialogTitle>
                              <DialogDescription>
                                This action cannot be undone. The WaD will be marked as revoked but not deleted.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="py-4">
                              <Label htmlFor="revoke-reason">Revocation Reason (required)</Label>
                              <Textarea
                                id="revoke-reason"
                                placeholder="Explain why this WaD is being revoked..."
                                value={revokeReason}
                                onChange={(e) => setRevokeReason(e.target.value)}
                                className="mt-2"
                              />
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setRevokeWadId(null)}>
                                Cancel
                              </Button>
                              <Button 
                                variant="destructive"
                                onClick={handleRevoke}
                                disabled={revoking || !revokeReason.trim()}
                              >
                                {revoking && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Revoke WaD
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
