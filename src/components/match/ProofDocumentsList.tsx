import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { FileText, Shield, Lock, Users, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { listMatchDocuments } from "@/lib/match-documents-client";

interface ProofDocument {
  id: string;
  doc_type: string;
  filename: string;
  sha256_hash: string;
  file_size: number | null;
  status: string;
  created_at: string;
  title: string | null;
  visibility: string;
}

interface ProofDocumentsListProps {
  matchId: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  certificate: "Certificate",
  contract: "Contract",
  shipping: "Shipping Document",
  compliance: "Compliance Document",
  license: "Licence / Permit",
  quality_report: "Quality Report",
  other: "Other",
};

export function ProofDocumentsList({ matchId }: ProofDocumentsListProps) {
  const [documents, setDocuments] = useState<ProofDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDocuments();
  }, [matchId]);

  const fetchDocuments = async () => {
    try {
      setLoading(true);

      const result = await listMatchDocuments(matchId, { order: "asc" });
      const safeDocs = (result.documents || [])
        .filter((d) => d.status !== "revoked" && d.status !== "archived")
        .map(
          (d): ProofDocument => ({
            id: d.id,
            doc_type: d.doc_type,
            filename: d.filename,
            sha256_hash: d.sha256_hash,
            file_size: d.file_size,
            status: d.status,
            created_at: d.created_at,
            title: d.title,
            visibility: d.visibility,
          })
        );
      setDocuments(safeDocs);
    } catch (err) {
      console.error("Error fetching proof documents:", err);
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getVisibilityIcon = (visibility: string) => {
    switch (visibility) {
      case "private":
        return <Lock className="h-3 w-3" />;
      case "share_with_counterparty":
        return <Users className="h-3 w-3" />;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading documents...</span>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div>
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Supporting Documents
        </h3>
        <p className="text-sm text-muted-foreground">No documents were uploaded for this trade request.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <FileText className="h-4 w-4" />
        Supporting Documents ({documents.length})
      </h3>
      <div className="space-y-2">
        {documents.map((doc) => (
          <div 
            key={doc.id} 
            className="flex items-center justify-between p-3 bg-muted/50 rounded-md border"
          >
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">
                  {doc.title || doc.filename}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}</span>
                  {doc.file_size && (
                    <>
                      <span>•</span>
                      <span>{formatFileSize(doc.file_size)}</span>
                    </>
                  )}
                  <span>•</span>
                  <span>{format(new Date(doc.created_at), "MMM dd, yyyy")}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge variant="outline" className="text-xs flex items-center gap-1">
                {getVisibilityIcon(doc.visibility)}
                {doc.visibility === "private" ? "Private" : "Shared"}
              </Badge>
              <div className="flex items-center gap-1 text-green-600">
                <Shield className="h-3 w-3" />
                <code className="text-xs font-mono">
                  {doc.sha256_hash.slice(0, 8)}...
                </code>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Document hashes are part of the immutable evidence chain.
      </p>
    </div>
  );
}
