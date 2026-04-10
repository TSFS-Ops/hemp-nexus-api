import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { format } from "date-fns";
import { ErrorState } from "@/components/ui/error-state";
import { InlineLoader } from "@/components/ui/inline-loader";
import { QUERY_LIMIT_ADMIN } from "@/lib/constants";
import type { Tables } from "@/integrations/supabase/types";

type OrgDirector = Tables<"org_directors">;
type UboLink = Tables<"ubo_links">;
type OwnershipLink = Tables<"ownership_links">;

export function AdminUboPanel() {
  const [directors, setDirectors] = useState<OrgDirector[]>([]);
  const [ubos, setUbos] = useState<UboLink[]>([]);
  const [ownerships, setOwnerships] = useState<OwnershipLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setDirectors(dirRes.data || []);
      setUbos(uboRes.data || []);
      setOwnerships(ownRes.data || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load UBO data";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  if (error && directors.length === 0 && ubos.length === 0) return <ErrorState title="Failed to load UBO data" message={error} onRetry={fetchAll} />;

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
        {loading ? <InlineLoader message="Loading UBO data…" /> : (
          <>
            {(directors.length >= QUERY_LIMIT_ADMIN || ubos.length >= QUERY_LIMIT_ADMIN || ownerships.length >= QUERY_LIMIT_ADMIN) && (
              <Alert className="mb-4"><AlertTriangle className="h-4 w-4" /><AlertDescription>One or more tabs may be truncated at {QUERY_LIMIT_ADMIN} rows. Use filters to narrow results.</AlertDescription></Alert>
            )}
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
                    <TableHeader><TableRow>
                      <TableHead>Full Name</TableHead><TableHead>Role</TableHead><TableHead>Org ID</TableHead><TableHead>Nationality</TableHead><TableHead>PEP</TableHead><TableHead>Ownership %</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {directors.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">{d.full_name}</TableCell>
                          <TableCell><Badge variant="outline">{d.role}</Badge></TableCell>
                          <TableCell className="font-mono text-xs">{d.org_id.slice(0, 8)}…</TableCell>
                          <TableCell className="text-sm">{d.nationality || "-"}</TableCell>
                          <TableCell>{d.is_pep ? <Badge variant="destructive">PEP</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                          <TableCell>{d.ownership_percentage != null ? `${d.ownership_percentage}%` : "-"}</TableCell>
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
                    <TableHeader><TableRow>
                      <TableHead>Person Entity</TableHead><TableHead>Company Entity</TableHead><TableHead>Ownership %</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead>Verified</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {ubos.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-mono text-xs">{u.person_entity_id.slice(0, 8)}…</TableCell>
                          <TableCell className="font-mono text-xs">{u.company_entity_id.slice(0, 8)}…</TableCell>
                          <TableCell className="font-semibold">{u.ownership_percentage}%</TableCell>
                          <TableCell><Badge variant="outline">{u.verification_method || "-"}</Badge></TableCell>
                          <TableCell>
                            {u.status === "verified" ? <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200">Verified</Badge> : <Badge variant="secondary">{u.status}</Badge>}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {u.verified_at ? format(new Date(u.verified_at), "dd MMM yyyy") : "-"}
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
                    <TableHeader><TableRow>
                      <TableHead>Owner Entity</TableHead><TableHead>Company Entity</TableHead><TableHead>Ownership %</TableHead><TableHead>Org ID</TableHead><TableHead>Created</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {ownerships.map((o) => (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-xs">{o.owner_entity_id.slice(0, 8)}…</TableCell>
                          <TableCell className="font-mono text-xs">{o.company_entity_id.slice(0, 8)}…</TableCell>
                          <TableCell className="font-semibold">{o.ownership_percent}%</TableCell>
                          <TableCell className="font-mono text-xs">{o.org_id.slice(0, 8)}…</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{format(new Date(o.created_at), "dd MMM yyyy")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
          </>
        )}
      </CardContent>
    </Card>
  );
}
