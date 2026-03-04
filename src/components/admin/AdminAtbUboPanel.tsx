import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldCheck, Users, FileCheck, AlertTriangle, Loader2, RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

interface AuthorityRecord {
  id: string;
  org_id: string;
  company_entity_id: string;
  person_entity_id: string;
  method: string;
  status: string;
  verified_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface UboLink {
  id: string;
  org_id: string;
  company_entity_id: string;
  person_entity_id: string;
  ownership_percentage: number;
  status: string;
  verified_at: string | null;
  verification_method: string;
  created_at: string;
}

const statusColour: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-700 border-amber-200",
  verified: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  expired: "bg-muted text-muted-foreground border-muted",
};

export function AdminAtbUboPanel() {
  const [atbRecords, setAtbRecords] = useState<AuthorityRecord[]>([]);
  const [uboLinks, setUboLinks] = useState<UboLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [atbRes, uboRes] = await Promise.all([
        supabase.from("authority_records").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("ubo_links").select("*").order("created_at", { ascending: false }).limit(200),
      ]);

      if (atbRes.error) throw atbRes.error;
      if (uboRes.error) throw uboRes.error;

      setAtbRecords(atbRes.data || []);
      setUboLinks((uboRes.data as unknown as UboLink[]) || []);
    } catch (err) {
      console.error("Failed to fetch ATB/UBO data:", err);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const updateStatus = async (id: string, type: "atb" | "ubo", status: "verified" | "rejected") => {
    setActionLoading(id);
    try {
      const table = type === "atb" ? "authority_records" : "ubo_links";
      const updateData: Record<string, unknown> = { status };
      if (status === "verified") {
        updateData.verified_at = new Date().toISOString();
      }

      const { error } = await supabase.from(table).update(updateData).eq("id", id);
      if (error) throw error;

      toast.success(`Record ${status}`);
      fetchData();
    } catch (err) {
      console.error("Update error:", err);
      toast.error("Failed to update record");
    } finally {
      setActionLoading(null);
    }
  };

  const atbStats = {
    total: atbRecords.length,
    verified: atbRecords.filter((r) => r.status === "verified").length,
    pending: atbRecords.filter((r) => r.status === "pending").length,
  };

  const uboStats = {
    total: uboLinks.length,
    verified: uboLinks.filter((r) => r.status === "verified").length,
    pending: uboLinks.filter((r) => r.status === "pending").length,
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
          <h2 className="text-3xl font-bold tracking-tight">Authority & Ownership</h2>
          <p className="text-muted-foreground mt-1">
            Manage Authority-to-Bind (ATB) records and Ultimate Beneficial Ownership (UBO) links
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "ATB Records", value: atbStats.total, icon: FileCheck },
          { label: "ATB Verified", value: atbStats.verified, icon: ShieldCheck },
          { label: "UBO Links", value: uboStats.total, icon: Users },
          { label: "UBO Pending", value: uboStats.pending, icon: AlertTriangle },
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

      <Tabs defaultValue="atb">
        <TabsList>
          <TabsTrigger value="atb">Authority-to-Bind ({atbStats.total})</TabsTrigger>
          <TabsTrigger value="ubo">UBO Links ({uboStats.total})</TabsTrigger>
        </TabsList>

        <TabsContent value="atb">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Authority-to-Bind Records</CardTitle>
              <CardDescription>Who is authorised to legally bind each company entity (WaD Gate #4)</CardDescription>
            </CardHeader>
            <CardContent>
              {atbRecords.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No ATB records found</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Company Entity</TableHead>
                        <TableHead>Person Entity</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {atbRecords.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell className="font-mono text-xs">{record.company_entity_id.substring(0, 8)}…</TableCell>
                          <TableCell className="font-mono text-xs">{record.person_entity_id.substring(0, 8)}…</TableCell>
                          <TableCell className="text-xs">{record.method}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusColour[record.status] || ""}>{record.status}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {record.expires_at ? new Date(record.expires_at).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(record.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {record.status === "pending" && (
                              <div className="flex gap-1 justify-end">
                                <Button
                                  size="sm" variant="outline"
                                  onClick={() => updateStatus(record.id, "atb", "verified")}
                                  disabled={actionLoading === record.id}
                                >
                                  <CheckCircle className="h-3 w-3 mr-1" /> Verify
                                </Button>
                                <Button
                                  size="sm" variant="outline"
                                  onClick={() => updateStatus(record.id, "atb", "rejected")}
                                  disabled={actionLoading === record.id}
                                >
                                  <XCircle className="h-3 w-3 mr-1" /> Reject
                                </Button>
                              </div>
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
        </TabsContent>

        <TabsContent value="ubo">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">UBO Ownership Links</CardTitle>
              <CardDescription>Beneficial ownership chain — must total ≥100% per entity for WaD Gate #3</CardDescription>
            </CardHeader>
            <CardContent>
              {uboLinks.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No UBO links found</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Company Entity</TableHead>
                        <TableHead>Person Entity</TableHead>
                        <TableHead className="text-right">Ownership %</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {uboLinks.map((link) => (
                        <TableRow key={link.id}>
                          <TableCell className="font-mono text-xs">{link.company_entity_id.substring(0, 8)}…</TableCell>
                          <TableCell className="font-mono text-xs">{link.person_entity_id.substring(0, 8)}…</TableCell>
                          <TableCell className="text-right font-bold">{link.ownership_percentage}%</TableCell>
                          <TableCell className="text-xs">{link.verification_method}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusColour[link.status] || ""}>{link.status}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(link.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {link.status === "pending" && (
                              <div className="flex gap-1 justify-end">
                                <Button
                                  size="sm" variant="outline"
                                  onClick={() => updateStatus(link.id, "ubo", "verified")}
                                  disabled={actionLoading === link.id}
                                >
                                  <CheckCircle className="h-3 w-3 mr-1" /> Verify
                                </Button>
                                <Button
                                  size="sm" variant="outline"
                                  onClick={() => updateStatus(link.id, "ubo", "rejected")}
                                  disabled={actionLoading === link.id}
                                >
                                  <XCircle className="h-3 w-3 mr-1" /> Reject
                                </Button>
                              </div>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
