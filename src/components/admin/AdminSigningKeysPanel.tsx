import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Key, Search, RefreshCw, Loader2, AlertTriangle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ErrorState } from "@/components/ui/error-state";
import { InlineLoader } from "@/components/ui/inline-loader";
import { QUERY_LIMIT_ADMIN } from "@/lib/constants";
import type { Tables } from "@/integrations/supabase/types";

type SigningKey = Tables<"signing_keys">;

export function AdminSigningKeysPanel() {
  const [keys, setKeys] = useState<SigningKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState<number | null>(null);

  const fetchKeys = async () => {
    setLoading(true);
    setError(null);
    try {
      const { count } = await supabase.from("signing_keys").select("id", { count: "exact", head: true });
      setTotal(count);

      let query = supabase.from("signing_keys").select("*").order("created_at", { ascending: false }).limit(QUERY_LIMIT_ADMIN);
      if (search.trim()) {
        query = query.or(`org_id.eq.${search.trim()},key_id.ilike.%${search.trim()}%`);
      }

      const { data, error: fetchErr } = await query;
      if (fetchErr) throw fetchErr;
      setKeys(data || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load signing keys";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchKeys(); }, []);

  const statusBadge = (status: string) => {
    switch (status) {
      case "active": return <Badge className="bg-[hsl(var(--emerald))]/10 text-emerald-700 border-emerald-200">Active</Badge>;
      case "revoked": return <Badge variant="destructive">Revoked</Badge>;
      case "rotated": return <Badge variant="secondary">Rotated</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (error && keys.length === 0) return <ErrorState title="Failed to load signing keys" message={error} onRetry={fetchKeys} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" />Signing Keys Registry</CardTitle>
        <CardDescription>Hash-sealed signing keys used for completion ledger signatures and evidence sealing.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by org ID or key ID…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && fetchKeys()} className="pl-9" />
          </div>
          <Button variant="outline" size="sm" onClick={fetchKeys} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {total !== null && keys.length >= QUERY_LIMIT_ADMIN && (
          <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>Showing {keys.length} of {total} keys. Use search to refine.</AlertDescription></Alert>
        )}

        {loading && keys.length === 0 ? <InlineLoader message="Loading signing keys…" /> : keys.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground"><ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-50" /><p className="text-sm">No signing keys found.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Key ID</TableHead><TableHead>Algorithm</TableHead><TableHead>Org ID</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead>Revoked</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-mono text-xs">{key.key_id.slice(0, 16)}…</TableCell>
                    <TableCell><Badge variant="outline">{key.algorithm}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{key.org_id.slice(0, 8)}…</TableCell>
                    <TableCell>{statusBadge(key.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(key.created_at), "dd MMM yyyy")}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{key.revoked_at ? format(new Date(key.revoked_at), "dd MMM yyyy") : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
