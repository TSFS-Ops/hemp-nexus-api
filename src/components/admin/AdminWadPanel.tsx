import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Shield, Eye, Download, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

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
  const [wads, setWads] = useState<Wad[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [revokeWadId, setRevokeWadId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revoking, setRevoking] = useState(false);
  const [accessReason, setAccessReason] = useState("");
  const [accessWadId, setAccessWadId] = useState<string | null>(null);

  useEffect(() => {
    fetchWads();
  }, [statusFilter]);

  const fetchWads = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Authentication required to view WaDs");
        return;
      }

      let url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wad`;
      if (statusFilter !== "all") {
        url += `?status=${statusFilter}`;
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || `WaD fetch failed (${response.status})`);
      }

      const data = await response.json();
      setWads(data);
    } catch (error) {
      console.error("[AdminWadPanel] fetch failed:", error);
      toast.error("Failed to load WaDs", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeWadId || !revokeReason.trim()) {
      toast.error("Revocation reason is required");
      return;
    }

    try {
      setRevoking(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wad/${revokeWadId}/revoke`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason: revokeReason }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to revoke");
      }

      toast.success("WaD revoked");
      setRevokeWadId(null);
      setRevokeReason("");
      fetchWads();
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Log admin access with reason
      await supabase.from("audit_logs").insert({
        org_id: (await supabase.from("profiles").select("org_id").eq("id", session.user.id).single()).data?.org_id,
        actor_user_id: session.user.id,
        action: "admin.wad.certificate.downloaded",
        entity_type: "wad",
        entity_id: wadId,
        metadata: { reason: accessReason },
      });

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wad/${wadId}/certificate`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to download certificate");
      }

      const certificate = await response.json();
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
      toast.error("Failed to download certificate");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return <Badge variant="secondary">Draft</Badge>;
      case "awaiting_attestations":
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Awaiting</Badge>;
      case "sealed":
        return <Badge className="bg-green-600">Sealed</Badge>;
      case "revoked":
        return <Badge variant="destructive">Revoked</Badge>;
      case "superseded":
        return <Badge variant="outline">Superseded</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
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
        <Button variant="outline" onClick={fetchWads} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
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

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
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
                    <TableCell>{getStatusBadge(wad.status)}</TableCell>
                    <TableCell>
                      {wad.sealed_at ? new Date(wad.sealed_at).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell>
                      {new Date(wad.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {wad.status === "sealed" && (
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
                      
                      {wad.status !== "revoked" && (
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
