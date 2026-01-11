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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { 
  FileText, 
  Upload, 
  Download, 
  Loader2, 
  Shield, 
  AlertCircle,
  FileCheck,
  Clock
} from "lucide-react";
import { format } from "date-fns";

interface MatchDocument {
  id: string;
  match_id: string;
  doc_type: string;
  filename: string;
  storage_path: string;
  sha256_hash: string;
  file_size: number | null;
  mime_type: string | null;
  status: string;
  created_at: string;
  expiry_date: string | null;
}

interface MatchDocumentsProps {
  matchId: string;
  orgId: string;
}

const DOC_TYPES = [
  { value: "invoice", label: "Invoice" },
  { value: "certificate", label: "Certificate" },
  { value: "contract", label: "Contract" },
  { value: "shipping", label: "Shipping Document" },
  { value: "compliance", label: "Compliance Document" },
  { value: "other", label: "Other" },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function MatchDocuments({ matchId, orgId }: MatchDocumentsProps) {
  const [documents, setDocuments] = useState<MatchDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDocuments();
  }, [matchId]);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("match_documents")
        .select("*")
        .eq("match_id", matchId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (err) {
      console.error("Error fetching documents:", err);
      toast.error("Failed to load documents");
    } finally {
      setLoading(false);
    }
  };

  const computeFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    
    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError("File size exceeds 10MB limit");
      setSelectedFile(null);
      return;
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("File type not allowed. Please use PDF, JPEG, PNG, or Word documents.");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !docType) {
      toast.error("Please select a file and document type");
      return;
    }

    try {
      setUploading(true);
      setError(null);

      // Compute file hash
      const sha256Hash = await computeFileHash(selectedFile);

      // Check for duplicate hash
      const existingDoc = documents.find((doc) => doc.sha256_hash === sha256Hash);
      if (existingDoc) {
        setError("This exact file has already been uploaded");
        setUploading(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in to upload documents");
        return;
      }

      // Create storage path: orgId/matchId/timestamp_filename
      const timestamp = Date.now();
      const storagePath = `${orgId}/${matchId}/${timestamp}_${selectedFile.name}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from("match-documents")
        .upload(storagePath, selectedFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Insert document record
      const { error: insertError } = await supabase
        .from("match_documents")
        .insert({
          match_id: matchId,
          org_id: orgId,
          uploader_user_id: session.user.id,
          doc_type: docType,
          filename: selectedFile.name,
          storage_path: storagePath,
          sha256_hash: sha256Hash,
          file_size: selectedFile.size,
          mime_type: selectedFile.type,
          status: "uploaded",
        });

      if (insertError) throw insertError;

      // Create audit log
      await supabase.from("audit_logs").insert({
        org_id: orgId,
        actor_user_id: session.user.id,
        action: "document.uploaded",
        entity_type: "match_document",
        entity_id: matchId,
        metadata: {
          filename: selectedFile.name,
          doc_type: docType,
          sha256_hash: sha256Hash,
          file_size: selectedFile.size,
        },
      });

      toast.success("Document uploaded successfully");
      setSelectedFile(null);
      setDocType("");
      fetchDocuments();
    } catch (err: any) {
      console.error("Error uploading document:", err);
      setError(err.message || "Failed to upload document");
      toast.error("Failed to upload document");
    } finally {
      setUploading(false);
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

  const getStatusBadge = (status: string, expiryDate: string | null) => {
    if (expiryDate && new Date(expiryDate) < new Date()) {
      return <Badge variant="destructive">Expired</Badge>;
    }
    
    switch (status) {
      case "uploaded":
        return <Badge variant="secondary">Uploaded</Badge>;
      case "verified":
        return <Badge variant="default">Verified</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "Unknown";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Documents
            </CardTitle>
            <CardDescription>
              Upload and manage documents related to this match
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Upload Section */}
        <div className="border rounded-lg p-4 space-y-4">
          <h4 className="font-medium flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Upload Document
          </h4>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="file">Select File</Label>
              <Input
                id="file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={handleFileSelect}
                disabled={uploading}
              />
              <p className="text-xs text-muted-foreground">
                Max 10MB. PDF, JPEG, PNG, or Word documents.
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="docType">Document Type</Label>
              <Select value={docType} onValueChange={setDocType} disabled={uploading}>
                <SelectTrigger id="docType">
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {selectedFile && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileCheck className="h-4 w-4" />
              Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})
            </div>
          )}

          <Button
            onClick={handleUpload}
            disabled={uploading || !selectedFile || !docType}
            className="w-full sm:w-auto"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload Document
              </>
            )}
          </Button>
        </div>

        {/* Documents List */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            Loading documents...
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
            No documents uploaded yet
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Hash</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium truncate max-w-[200px]">
                          {doc.filename}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {DOC_TYPES.find((t) => t.value === doc.doc_type)?.label || doc.doc_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatFileSize(doc.file_size)}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(doc.status, doc.expiry_date)}
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
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {format(new Date(doc.created_at), "MMM dd, yyyy")}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownload(doc)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </TableCell>
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
