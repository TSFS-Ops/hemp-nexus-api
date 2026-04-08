import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  FileText,
  Shield,
  CheckCircle,
  Clock,
  Search,
  RefreshCw,
  Download,
  ShieldCheck,
} from "lucide-react";
import { format } from "date-fns";

interface MatchDocument {
  id: string;
  match_id: string;
  org_id: string;
  doc_type: string;
  filename: string;
  storage_path: string;
  sha256_hash: string;
  file_size: number | null;
  mime_type: string | null;
  status: string;
  created_at: string;
  verified_at: string | null;
  verified_by: string | null;
  verification_notes: string | null;
  match?: {
    commodity: string;
    buyer_name: string;
    seller_name: string;
  };
}

export function AdminDocumentVerification() {
  const [documents, setDocuments] = useState<MatchDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<MatchDocument | null>(null);
  const [verificationNotes, setVerificationNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "verified">("pending");

  useEffect(() => {
    fetchDocuments();
  }, [filter]);

  const fetchDocuments = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from("match_documents")
        .select(`
          *,
          match:matches(commodity, buyer_name, seller_name)
        `)
        .order("created_at", { ascending: false });

      if (filter === "pending") {
        query = query.is("verified_at", null);
      } else if (filter === "verified") {
        query = query.not("verified_at", "is", null);
      }

      const { data, error } = await query;

      if (error) throw error;
      setDocuments((data as MatchDocument[]) || []);
    } catch (err) {
      console.error("Error fetching documents:", err);
      toast.error("Failed to load documents");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!selectedDoc) return;

    try {
      setSubmitting(true);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in");
        return;
      }

      const { error: updateError } = await supabase
        .from("match_documents")
        .update({
          status: "verified",
          verified_at: new Date().toISOString(),
          verified_by: session.user.id,
          verification_notes: verificationNotes || null,
        })
        .eq("id", selectedDoc.id);

      if (updateError) throw updateError;

      // Create audit log
      await supabase.from("admin_audit_logs").insert({
        admin_user_id: session.user.id,
        action: "document_verified",
        target_type: "match_document",
        target_id: selectedDoc.id,
        details: {
          match_id: selectedDoc.match_id,
          filename: selectedDoc.filename,
          doc_type: selectedDoc.doc_type,
          sha256_hash: selectedDoc.sha256_hash,
          verification_notes: verificationNotes,
        },
      });

      toast.success("Document verified successfully");
      setSelectedDoc(null);
      setVerificationNotes("");
      fetchDocuments();
    } catch (err) {
      console.error("Error verifying document:", err);
      toast.error("Failed to verify document");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async (doc: MatchDocument) => {
    try {
      const { data, error } = await supabase.storage
        .from("match-documents")
        .download(doc.storage_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error downloading document:", err);
      toast.error("Failed to download document");
    }
  };

  const filteredDocuments = documents.filter((doc) => {
    const query = searchQuery.toLowerCase();
    return (
      doc.filename.toLowerCase().includes(query) ||
      doc.doc_type.toLowerCase().includes(query) ||
      doc.sha256_hash.toLowerCase().includes(query) ||
      doc.match?.commodity?.toLowerCase().includes(query) ||
      doc.match?.buyer_name?.toLowerCase().includes(query) ||
      doc.match?.seller_name?.toLowerCase().includes(query)
    );
  });

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Document Verification</h2>
        <p className="text-muted-foreground mt-2">
          Review and verify documents uploaded to matches
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                Document Queue
              </CardTitle>
              <CardDescription>
                {filter === "pending"
                  ? "Documents awaiting verification"
                  : filter === "verified"
                  ? "Verified documents"
                  : "All uploaded documents"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border overflow-hidden">
                <Button
                  variant={filter === "pending" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none"
                  onClick={() => setFilter("pending")}
                >
                  Pending
                </Button>
                <Button
                  variant={filter === "verified" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none"
                  onClick={() => setFilter("verified")}
                >
                  Verified
                </Button>
                <Button
                  variant={filter === "all" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none"
                  onClick={() => setFilter("all")}
                >
                  All
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={fetchDocuments} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by filename, type, hash, or match details..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading documents...</div>
          ) : filteredDocuments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              No documents found
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Match</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Hash</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDocuments.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium truncate max-w-[150px]">
                            {doc.filename}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div className="font-medium">{doc.match?.commodity || "-"}</div>
                          <div className="text-muted-foreground text-xs">
                            {doc.match?.buyer_name} ↔ {doc.match?.seller_name}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{doc.doc_type}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatFileSize(doc.file_size)}
                      </TableCell>
                      <TableCell>
                        {doc.verified_at ? (
                          <Badge variant="default" className="gap-1">
                            <CheckCircle className="h-3 w-3" />
                            Verified
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <Clock className="h-3 w-3" />
                            Pending
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Shield className="h-3 w-3 text-green-500" />
                          <code className="text-xs font-mono">
                            {doc.sha256_hash.slice(0, 8)}...
                          </code>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(doc.created_at), "MMM dd, yyyy")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownload(doc)}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          {!doc.verified_at && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedDoc(doc);
                                setVerificationNotes("");
                              }}
                            >
                              Verify
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Verification Dialog */}
      <Dialog open={!!selectedDoc} onOpenChange={(open) => !open && setSelectedDoc(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Verify Document</DialogTitle>
            <DialogDescription>
              Review and verify this document. Verification creates an audit trail.
            </DialogDescription>
          </DialogHeader>

          {selectedDoc && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">Filename</Label>
                  <p className="font-medium">{selectedDoc.filename}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Type</Label>
                  <p className="font-medium">{selectedDoc.doc_type}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Size</Label>
                  <p className="font-medium">{formatFileSize(selectedDoc.file_size)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Uploaded</Label>
                  <p className="font-medium">
                    {format(new Date(selectedDoc.created_at), "MMM dd, yyyy HH:mm")}
                  </p>
                </div>
              </div>

              <div className="p-3 bg-muted rounded-lg">
                <Label className="text-muted-foreground">SHA-256 Hash</Label>
                <code className="text-xs font-mono block mt-1 break-all">
                  {selectedDoc.sha256_hash}
                </code>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Verification Notes (optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Add notes about the verification..."
                  value={verificationNotes}
                  onChange={(e) => setVerificationNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedDoc(null)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleVerify} disabled={submitting}>
              {submitting ? "Verifying..." : "Mark as Verified"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
