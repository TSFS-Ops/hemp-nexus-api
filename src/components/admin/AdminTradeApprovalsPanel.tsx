import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, ShieldX, RefreshCw, Loader2, Clock, CheckCircle, XCircle, RotateCw } from "lucide-react";
import { toast } from "sonner";

interface TradeApproval {
  id: string;
  org_id: string;
  status: string;
  approved_at: string | null;
  approved_by: string | null;
  risk_band: string | null;
  valid_until: string | null;
  created_at: string;
  org_name?: string;
  is_valid?: boolean;
}

const statusColour: Record<string, string> = {
  approved: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  revoked: "bg-destructive/10 text-destructive border-destructive/20",
  expired: "bg-amber-500/10 text-amber-700 border-amber-200",
  pending: "bg-muted text-muted-foreground border-muted",
};

const riskColour: Record<string, string> = {
  low: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  medium: "bg-amber-500/10 text-amber-700 border-amber-200",
  high: "bg-destructive/10 text-destructive border-destructive/20",
};

export function AdminTradeApprovalsPanel() {
  const [approvals, setApprovals] = useState<TradeApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchApprovals = async () => {
    setLoading(true);
    try {
      // Direct table query + org name enrichment
      const { data: approvalsData, error } = await supabase
        .from("trade_approvals")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const orgIds = [...new Set((approvalsData || []).map((a) => a.org_id))];
      const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", orgIds);
      const orgMap = new Map((orgs || []).map((o) => [o.id, o.name]));

      const enriched = (approvalsData || []).map((a) => ({
        ...a,
        org_name: orgMap.get(a.org_id) || "Unknown",
        is_valid: a.status === "approved" && (!a.valid_until || new Date(a.valid_until) > new Date()),
      }));

      setApprovals(enriched);
    } catch (err) {
      console.error("Failed to fetch trade approvals:", err);
      toast.error("Failed to load approvals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchApprovals(); }, []);

  const revokeApproval = async (orgId: string) => {
    setActionLoading(orgId);
    try {
      const { error } = await supabase
        .from("trade_approvals")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("org_id", orgId);

      if (error) throw error;
      toast.success("Approval revoked");
      fetchApprovals();
    } catch (err) {
      console.error("Revoke error:", err);
      toast.error("Failed to revoke");
    } finally {
      setActionLoading(null);
    }
  };

  const renewApproval = async (orgId: string) => {
    setActionLoading(orgId);
    try {
      const newExpiry = new Date();
      newExpiry.setFullYear(newExpiry.getFullYear() + 1);

      const { error } = await supabase
        .from("trade_approvals")
        .update({
          status: "approved",
          valid_until: newExpiry.toISOString(),
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("org_id", orgId);

      if (error) throw error;
      toast.success("Approval renewed for 1 year");
      fetchApprovals();
    } catch (err) {
      console.error("Renew error:", err);
      toast.error("Failed to renew");
    } finally {
      setActionLoading(null);
    }
  };

  const stats = {
    total: approvals.length,
    approved: approvals.filter((a) => a.is_valid).length,
    revoked: approvals.filter((a) => a.status === "revoked").length,
    expiring: approvals.filter((a) => {
      if (!a.valid_until || a.status !== "approved") return false;
      const daysLeft = (new Date(a.valid_until).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return daysLeft > 0 && daysLeft <= 30;
    }).length,
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Trade Approvals</h2>
          <p className="text-muted-foreground mt-1">
            Organisations must be "Approved to Trade" before the collapse engine will accept their transactions
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchApprovals}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total", value: stats.total, icon: ShieldCheck },
          { label: "Active", value: stats.approved, icon: CheckCircle },
          { label: "Revoked", value: stats.revoked, icon: ShieldX },
          { label: "Expiring <30d", value: stats.expiring, icon: Clock },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold">{s.value}</p>
                </div>
                <s.icon className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Approval Register</CardTitle>
          <CardDescription>
            Controls which organisations can submit collapse requests. Linked to due-diligence risk scores.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {approvals.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No trade approvals issued yet</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Risk Band</TableHead>
                    <TableHead>Approved</TableHead>
                    <TableHead>Valid Until</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvals.map((a) => {
                    const isExpired = a.valid_until && new Date(a.valid_until) < new Date();
                    const displayStatus = isExpired && a.status === "approved" ? "expired" : a.status;

                    return (
                      <TableRow key={a.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{a.org_name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{a.org_id.substring(0, 8)}…</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusColour[displayStatus] || ""}>
                            {displayStatus}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {a.risk_band ? (
                            <Badge variant="outline" className={riskColour[a.risk_band] || ""}>
                              {a.risk_band}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {a.approved_at ? new Date(a.approved_at).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {a.valid_until ? (
                            <span className={isExpired ? "text-destructive font-medium" : "text-muted-foreground"}>
                              {new Date(a.valid_until).toLocaleDateString()}
                              {isExpired && " (expired)"}
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {(a.status === "approved" || displayStatus === "expired") && (
                              <Button
                                size="sm" variant="outline"
                                onClick={() => renewApproval(a.org_id)}
                                disabled={actionLoading === a.org_id}
                              >
                                <RotateCw className="h-3 w-3 mr-1" /> Renew
                              </Button>
                            )}
                            {a.status === "approved" && (
                              <Button
                                size="sm" variant="outline"
                                onClick={() => revokeApproval(a.org_id)}
                                disabled={actionLoading === a.org_id}
                              >
                                <XCircle className="h-3 w-3 mr-1" /> Revoke
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
