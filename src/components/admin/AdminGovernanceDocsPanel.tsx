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

interface GovDoc {
  id: string;
  title: string;
  doc_type: string;
  version: string | null;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export function AdminGovernanceDocsPanel() {
  const [docs, setDocs] = useState<GovDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const fetchDocs = async () => {
    setLoading(true);
    setError(null);
    try {
      const { count } = await supabase
        .from("governance_documents")
        .select("id", { count: "exact", head: true });
      setTotal(count);

      const { data, error: fetchErr } = await supabase
        .from("governance_documents")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(QUERY_LIMIT_ADMIN);

      if (fetchErr) throw fetchErr;
      setDocs((data as GovDoc[]) || []);
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
      case "active": return <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200">Active</Badge>;
      case "draft": return <Badge variant="secondary">Draft</Badge>;
      case "superseded": return <Badge variant="outline">Superseded</Badge>;
      case "archived": return <Badge className="bg-amber-500/10 text-amber-700 border-amber-200">Archived</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (error && docs.length === 0) {
    return <ErrorState title="Failed to load governance documents" description={error} onRetry={fetchDocs} />;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Governance Documents</CardTitle>
          <CardDescription>Framework documents, policies, and regulatory references.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={fetchDocs} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {total !== null && docs.length >= QUERY_LIMIT_ADMIN && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Showing {docs.length} of {total} documents.</AlertDescription>
          </Alert>
        )}

        {loading && docs.length === 0 ? (
          <InlineLoader message="Loading governance documents…" />
        ) : docs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No governance documents registered.</p>
            <p className="text-xs mt-1">Documents are created via the governance-docs API endpoint.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Effective From</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">{doc.title}</TableCell>
                    <TableCell><Badge variant="outline">{doc.doc_type}</Badge></TableCell>
                    <TableCell className="text-sm">{doc.version || "1.0"}</TableCell>
                    <TableCell>{statusBadge(doc.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {doc.effective_from ? format(new Date(doc.effective_from), "dd MMM yyyy") : "—"}
                    </TableCell>
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
