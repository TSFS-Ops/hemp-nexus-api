import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileCheck, Search, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ErrorState } from "@/components/ui/error-state";
import { InlineLoader } from "@/components/ui/inline-loader";
import { QUERY_LIMIT_ADMIN } from "@/lib/constants";
import type { Tables } from "@/integrations/supabase/types";

type KycDocument = Tables<"kyc_documents">;

export function AdminKycDocsPanel() {
  const [docs, setDocs] = useState<KycDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [total, setTotal] = useState<number | null>(null);

  const fetchDocs = async () => {
    setLoading(true);
    setError(null);
    try {
      let countQ = supabase.from("kyc_documents").select("id", { count: "exact", head: true });
      if (statusFilter !== "all") countQ = countQ.eq("status", statusFilter);
      const { count } = await countQ;
      setTotal(count);

      let query = supabase.from("kyc_documents").select("*").order("created_at", { ascending: false }).limit(QUERY_LIMIT_ADMIN);
      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (search.trim()) query = query.or(`org_id.eq.${search.trim()},filename.ilike.%${search.trim()}%`);

      const { data, error: fetchErr } = await query;
      if (fetchErr) throw fetchErr;
      setDocs(data || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load KYC documents";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDocs(); }, [statusFilter]);

  const statusBadge = (status: string) => {
    switch (status) {
      case "verified": return <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200">Verified</Badge>;
      case "pending": return <Badge className="bg-amber-500/10 text-amber-700 border-amber-200">Pending</Badge>;
      case "rejected": return <Badge variant="destructive">Rejected</Badge>;
      case "expired": return <Badge variant="secondary">Expired</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (error && docs.length === 0) return <ErrorState title="Failed to load KYC documents" message={error} onRetry={fetchDocs} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileCheck className="h-5 w-5" />KYC Documents</CardTitle>
        <CardDescription>Identity and verification documents uploaded for compliance purposes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by org ID or filename…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && fetchDocs()} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchDocs} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {total !== null && docs.length >= QUERY_LIMIT_ADMIN && (
          <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>Showing {docs.length} of {total} documents.</AlertDescription></Alert>
        )}

        {loading && docs.length === 0 ? <InlineLoader message="Loading KYC documents…" /> : docs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground"><FileCheck className="h-8 w-8 mx-auto mb-2 opacity-50" /><p className="text-sm">No KYC documents found.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Filename</TableHead><TableHead>Doc Type</TableHead><TableHead>Org ID</TableHead><TableHead>Status</TableHead><TableHead>Country</TableHead><TableHead>Created</TableHead><TableHead>Expiry</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {docs.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="max-w-[180px] truncate font-medium">{doc.filename}</TableCell>
                    <TableCell><Badge variant="outline">{doc.doc_type}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{doc.org_id.slice(0, 8)}…</TableCell>
                    <TableCell>{statusBadge(doc.status)}</TableCell>
                    <TableCell className="text-sm">{doc.issuing_country || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(doc.created_at), "dd MMM yyyy")}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{doc.expiry_date ? format(new Date(doc.expiry_date), "dd MMM yyyy") : "—"}</TableCell>
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
