import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Users, Search, RefreshCw, Loader2, AlertTriangle, Building, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ErrorState } from "@/components/ui/error-state";
import { InlineLoader } from "@/components/ui/inline-loader";
import { QUERY_LIMIT_ADMIN } from "@/lib/constants";

interface OrgDirector {
  id: string;
  org_id: string;
  entity_id: string;
  role: string;
  appointed_at: string | null;
  resigned_at: string | null;
  created_at: string;
}

interface UboLink {
  id: string;
  org_id: string;
  person_entity_id: string;
  company_entity_id: string;
  ownership_percentage: number | null;
  control_type: string | null;
  verified_at: string | null;
  created_at: string;
}

interface OwnershipLink {
  id: string;
  parent_entity_id: string;
  child_entity_id: string;
  ownership_percentage: number | null;
  link_type: string;
  created_at: string;
}

export function AdminUboPanel() {
  const [directors, setDirectors] = useState<OrgDirector[]>([]);
  const [ubos, setUbos] = useState<UboLink[]>([]);
  const [ownerships, setOwnerships] = useState<OwnershipLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [dirRes, uboRes, ownRes] = await Promise.all([
        supabase.from("org_directors").select("*").order("created_at", { ascending: false }).limit(QUERY_LIMIT_ADMIN),
        supabase.from("ubo_links").select("*").order("created_at", { ascending: false }).limit(QUERY_LIMIT_ADMIN),
        supabase.from("ownership_links").select("*").order("created_at", { ascending: false }).limit(QUERY_LIMIT_ADMIN),
      ]);

      if (dirRes.error) throw dirRes.error;
      if (uboRes.error) throw uboRes.error;
      if (ownRes.error) throw ownRes.error;

      setDirectors((dirRes.data as OrgDirector[]) || []);
      setUbos((uboRes.data as UboLink[]) || []);
      setOwnerships((ownRes.data as OwnershipLink[]) || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load UBO data";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  if (error && directors.length === 0 && ubos.length === 0) {
    return <ErrorState title="Failed to load UBO data" description={error} onRetry={fetchAll} />;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />UBO & Ownership</CardTitle>
          <CardDescription>Directors, ultimate beneficial owners, and entity ownership chains.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <InlineLoader message="Loading UBO data…" />
        ) : (
          <Tabs defaultValue="directors">
            <TabsList>
              <TabsTrigger value="directors">Directors ({directors.length})</TabsTrigger>
              <TabsTrigger value="ubos">UBOs ({ubos.length})</TabsTrigger>
              <TabsTrigger value="ownership">Ownership ({ownerships.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="directors" className="mt-4">
              {directors.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">No directors registered.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Org ID</TableHead>
                        <TableHead>Entity ID</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Appointed</TableHead>
                        <TableHead>Resigned</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {directors.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono text-xs">{d.org_id.slice(0, 8)}…</TableCell>
                          <TableCell className="font-mono text-xs">{d.entity_id.slice(0, 8)}…</TableCell>
                          <TableCell><Badge variant="outline">{d.role}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {d.appointed_at ? format(new Date(d.appointed_at), "dd MMM yyyy") : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {d.resigned_at ? format(new Date(d.resigned_at), "dd MMM yyyy") : "Active"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="ubos" className="mt-4">
              {ubos.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">No UBO records registered.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Person Entity</TableHead>
                        <TableHead>Company Entity</TableHead>
                        <TableHead>Ownership %</TableHead>
                        <TableHead>Control Type</TableHead>
                        <TableHead>Verified</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ubos.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-mono text-xs">{u.person_entity_id.slice(0, 8)}…</TableCell>
                          <TableCell className="font-mono text-xs">{u.company_entity_id.slice(0, 8)}…</TableCell>
                          <TableCell className="font-semibold">{u.ownership_percentage != null ? `${u.ownership_percentage}%` : "—"}</TableCell>
                          <TableCell><Badge variant="outline">{u.control_type || "direct"}</Badge></TableCell>
                          <TableCell>
                            {u.verified_at ? (
                              <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200">
                                {format(new Date(u.verified_at), "dd MMM yyyy")}
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Unverified</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="ownership" className="mt-4">
              {ownerships.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">No ownership links registered.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Parent Entity</TableHead>
                        <TableHead>Child Entity</TableHead>
                        <TableHead>Ownership %</TableHead>
                        <TableHead>Link Type</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ownerships.map((o) => (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-xs">{o.parent_entity_id.slice(0, 8)}…</TableCell>
                          <TableCell className="font-mono text-xs">{o.child_entity_id.slice(0, 8)}…</TableCell>
                          <TableCell className="font-semibold">{o.ownership_percentage != null ? `${o.ownership_percentage}%` : "—"}</TableCell>
                          <TableCell><Badge variant="outline">{o.link_type}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{format(new Date(o.created_at), "dd MMM yyyy")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
