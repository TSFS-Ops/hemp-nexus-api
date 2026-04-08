import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ErrorState } from "@/components/ui/error-state";
import { InlineLoader } from "@/components/ui/inline-loader";
import { QUERY_LIMIT_ADMIN } from "@/lib/constants";
import type { Tables } from "@/integrations/supabase/types";

type GovDoc = Tables<"governance_documents">;

export function AdminGovernanceDocsPanel() {
  const [docs, setDocs] = useState<GovDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const fetchDocs = async () => {
    setLoading(true);
    setError(null);
    try {
      const { count } = await supabase.from("governance_documents").select("id", { count: "exact", head: true });
      setTotal(count);
      const { data, error: fetchErr } = await supabase.from("governance_documents").select("*").order("created_at", { ascending: false }).limit(QUERY_LIMIT_ADMIN);
      if (fetchErr) throw fetchErr;
      setDocs(data || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load governance documents";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDocs(); }, []);

  const statusBadge = (status: string) => {
    switch (status) {
      case "validated": return <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200">Validated</Badge>;
      case "pending": return <Badge variant="secondary">Pending</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (error && docs.length === 0) return <ErrorState title="Failed to load governance documents" message={error} onRetry={fetchDocs} />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Governance Documents</CardTitle>
          <CardDescription>Regulatory and governance documents linked to deals and registries.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={fetchDocs} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {total !== null && docs.length >= QUERY_LIMIT_ADMIN && (
          <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>Showing {docs.length} of {total} documents.</AlertDescription></Alert>
        )}

        {loading && docs.length === 0 ? <InlineLoader message="Loading governance documents…" /> : docs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground"><FileText className="h-8 w-8 mx-auto mb-2 opacity-50" /><p className="text-sm">No governance documents registered.</p><p className="text-xs mt-1">Documents are created via the governance-docs API endpoint.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Registry ID</TableHead><TableHead>Deal Reference</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Token Burned</TableHead><TableHead>Validated</TableHead><TableHead>Created</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {docs.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-mono text-xs">{doc.registry_id.slice(0, 8)}…</TableCell>
                    <TableCell className="font-mono text-xs">{doc.deal_reference_id.slice(0, 8)}…</TableCell>
                    <TableCell><Badge variant="outline">{doc.deal_reference_type}</Badge></TableCell>
                    <TableCell>{statusBadge(doc.status)}</TableCell>
                    <TableCell>{doc.token_burned ? <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200">Yes</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{doc.validated_at ? format(new Date(doc.validated_at), "dd MMM yyyy") : "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(doc.created_at), "dd MMM yyyy")}</TableCell>
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
