import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, FileCheck, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

interface P3Wad {
  id: string;
  org_id: string;
  poi_id: string;
  state: string;
  issued_at: string | null;
  denial_reasons: any[] | null;
  created_at: string;
}

interface GovDoc {
  id: string;
  org_id: string;
  registry_id: string;
  deal_reference_id: string;
  deal_reference_type: string;
  status: string;
  token_burned: boolean;
  validated_at: string | null;
  created_at: string;
}

interface GovRegistry {
  id: string;
  org_id: string;
  doc_type: string;
  category: string;
  jurisdiction_code: string;
  industry_code: string;
  mandatory_flag: boolean;
  active: boolean;
  fixed_token_burn_amount: number;
}

const WAD_STATE_COLOURS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ISSUED: "default",
  DENIED: "destructive",
  PENDING: "outline",
};

export function AdminWadGovernancePanel() {
  const [wads, setWads] = useState<P3Wad[]>([]);
  const [govDocs, setGovDocs] = useState<GovDoc[]>([]);
  const [registry, setRegistry] = useState<GovRegistry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    const [wadRes, docRes, regRes] = await Promise.all([
      supabase.from("p3_wads").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("governance_documents").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("governance_doc_registry").select("*").order("doc_type", { ascending: true }),
    ]);
    setWads((wadRes.data as P3Wad[]) || []);
    setGovDocs((docRes.data as GovDoc[]) || []);
    setRegistry((regRes.data as GovRegistry[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const issuedCount = wads.filter((w) => w.state === "ISSUED").length;
  const deniedCount = wads.filter((w) => w.state === "DENIED").length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">WaD Hard-Gates & Governance</h2>
          <p className="text-muted-foreground mt-1">
            Signed Deal issuance with 7 deterministic hard-gate enforcement
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4" /> WaDs Issued
            </CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{issuedCount}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> WaDs Denied
            </CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{deniedCount}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileCheck className="h-4 w-4" /> Gov Documents
            </CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{govDocs.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Registry Entries
            </CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{registry.length}</p></CardContent>
        </Card>
      </div>

      <Tabs defaultValue="wads">
        <TabsList>
          <TabsTrigger value="wads">WaD Issuances</TabsTrigger>
          <TabsTrigger value="gov-docs">Governance Documents</TabsTrigger>
          <TabsTrigger value="registry">Document Registry</TabsTrigger>
        </TabsList>

        <TabsContent value="wads">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>POI</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Denial Reasons</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wads.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No WaD issuance attempts yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    wads.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-mono text-xs">{w.id.slice(0, 8)}…</TableCell>
                        <TableCell className="font-mono text-xs">{w.poi_id.slice(0, 8)}…</TableCell>
                        <TableCell>
                          <Badge variant={WAD_STATE_COLOURS[w.state] || "secondary"}>{w.state}</Badge>
                        </TableCell>
                        <TableCell>{w.issued_at ? format(new Date(w.issued_at), "dd MMM yyyy HH:mm") : "-"}</TableCell>
                        <TableCell className="max-w-[250px] truncate text-xs">
                          {w.denial_reasons
                            ? (w.denial_reasons as any[]).map((d: any) => d.gate).join(", ")
                            : "-"}
                        </TableCell>
                        <TableCell>{format(new Date(w.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gov-docs">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Deal Ref</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Token Burned</TableHead>
                    <TableHead>Validated</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {govDocs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No governance documents submitted yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    govDocs.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-mono text-xs">{d.id.slice(0, 8)}…</TableCell>
                        <TableCell className="font-mono text-xs">{d.deal_reference_id.slice(0, 8)}…</TableCell>
                        <TableCell>{d.deal_reference_type}</TableCell>
                        <TableCell>
                          <Badge variant={d.status === "validated" ? "default" : "outline"}>{d.status}</Badge>
                        </TableCell>
                        <TableCell>{d.token_burned ? "Yes" : "No"}</TableCell>
                        <TableCell>
                          {d.validated_at ? format(new Date(d.validated_at), "dd MMM yyyy HH:mm") : "-"}
                        </TableCell>
                        <TableCell>{format(new Date(d.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="registry">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Doc Type</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Jurisdiction</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead>Mandatory</TableHead>
                    <TableHead>Token Burn</TableHead>
                    <TableHead>Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registry.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No governance document types registered yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    registry.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.doc_type}</TableCell>
                        <TableCell>{r.category}</TableCell>
                        <TableCell>{r.jurisdiction_code}</TableCell>
                        <TableCell>{r.industry_code}</TableCell>
                        <TableCell>
                          <Badge variant={r.mandatory_flag ? "default" : "secondary"}>
                            {r.mandatory_flag ? "Yes" : "No"}
                          </Badge>
                        </TableCell>
                        <TableCell>{r.fixed_token_burn_amount}</TableCell>
                        <TableCell>
                          <Badge variant={r.active ? "default" : "destructive"}>
                            {r.active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
