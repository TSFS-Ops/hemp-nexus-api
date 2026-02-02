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
import { Textarea } from "@/components/ui/textarea";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { 
  FileText, 
  Upload, 
  Download, 
  Loader2, 
  Shield, 
  AlertCircle,
  FileCheck,
  Clock,
  MoreHorizontal,
  Share2,
  History,
  Lock,
  Users,
  EyeOff
} from "lucide-react";
import { format } from "date-fns";
import { DocumentSharingDialog } from "./DocumentSharingDialog";
import { DocumentAccessLogs } from "./DocumentAccessLogs";

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
  title: string | null;
  notes: string | null;
  visibility: string;
  valid_from: string | null;
  valid_to: string | null;
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
  { value: "license", label: "License / Permit" },
  { value: "quality_report", label: "Quality Report" },
  { value: "other", label: "Other" },
];

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private", icon: Lock, description: "Only your organization" },
  { value: "share_with_counterparty", label: "Share with Counterparty", icon: Users, description: "Both buyer and seller" },
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB (aligned with bucket limit)
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

export function MatchDocuments({ matchId, orgId }: MatchDocumentsProps) {
  const [documents, setDocuments] = useState<MatchDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [error, setError] = useState<string | null>(null);
  const [sessionOrgId, setSessionOrgId] = useState<string | null>(null);
  
  // Dialog states
  const [sharingDoc, setSharingDoc] = useState<MatchDocument | null>(null);
  const [accessLogsDoc, setAccessLogsDoc] = useState<MatchDocument | null>(null);

  useEffect(() => {
    const getSessionOrgId = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("org_id")
          .eq("id", session.user.id)
          .single();
        if (profile) {
          setSessionOrgId(profile.org_id);
        }
      }
    };
    getSessionOrgId();
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [matchId]);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("match_documents")
        .select("id, match_id, doc_type, filename, storage_path, sha256_hash, file_size, mime_type, status, created_at, expiry_date, title, notes, visibility, valid_from, valid_to")
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
      setError("File size exceeds 50MB limit");
      setSelectedFile(null);
      return;
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("File type not allowed. Please use PDF, images, or Office documents.");
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

      const effectiveOrgId = sessionOrgId || orgId;
      if (!effectiveOrgId) {
        toast.error("Could not determine organization");
        return;
      }

      // Storage path format: <org_id>/poi/<match_id>/<doc_id>/<filename>
      // First folder must be org_id to satisfy storage RLS policy
      const docId = crypto.randomUUID();
      const storagePath = `${effectiveOrgId}/poi/${matchId}/${docId}/${selectedFile.name}`;

      const { error: uploadError } = await supabase.storage
        .from("match-documents")
        .upload(storagePath, selectedFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from("match_documents")
        .insert({
          id: docId,
          match_id: matchId,
          org_id: effectiveOrgId,
          uploader_user_id: session.user.id,
          uploader_org_id: effectiveOrgId,
          doc_type: docType,
          filename: selectedFile.name,
          storage_path: storagePath,
          sha256_hash: sha256Hash,
          file_size: selectedFile.size,
          mime_type: selectedFile.type,
          status: "uploaded",
          title: title || null,
          notes: notes || null,
          visibility: visibility,
        });

      if (insertError) throw insertError;

      // Audit log
      await supabase.from("audit_logs").insert({
        org_id: effectiveOrgId,
        actor_user_id: session.user.id,
        action: "document.uploaded",
        entity_type: "match_document",
        entity_id: matchId,
        metadata: {
          document_id: docId,
          filename: selectedFile.name,
          doc_type: docType,
          sha256_hash: sha256Hash,
          file_size: selectedFile.size,
          visibility: visibility,
          title: title || null,
        },
      });

      toast.success("Document uploaded successfully");
      resetForm();
      fetchDocuments();
    } catch (err: unknown) {
      console.error("Error uploading document:", err);
      const message = err instanceof Error ? err.message : "Failed to upload document";
      setError(message);
      toast.error("Failed to upload document");
    } finally {
      setUploading(false);
    }
  };

  const resetForm = () => {
    setSelectedFile(null);
    setDocType("");
    setTitle("");
    setNotes("");
    setVisibility("private");
  };

  const handleDownload = async (doc: MatchDocument) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in to download documents");
        return;
      }

      // Use edge function for proper access logging
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/document-download/${doc.id}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to get download URL");
      }

      const { data } = await response.json();
      
      // Open signed URL
      const a = document.createElement("a");
      a.href = data.download_url;
      a.download = doc.filename;
      a.click();
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
      case "revoked":
        return <Badge variant="destructive">Revoked</Badge>;
      case "archived":
        return <Badge variant="outline">Archived</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getVisibilityBadge = (visibility: string) => {
    switch (visibility) {
      case "private":
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Lock className="h-3 w-3" />
            Private
          </Badge>
        );
      case "share_with_counterparty":
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            Shared
          </Badge>
        );
      case "share_with_roles":
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <Share2 className="h-3 w-3" />
            Role-based
          </Badge>
        );
      default:
        return <Badge variant="outline">{visibility}</Badge>;
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "Unknown";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Documents
              </CardTitle>
              <CardDescription>
                Upload and manage documents related to this POI. Documents are stored securely with explicit sharing controls.
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
                  accept=".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx,.xls,.xlsx"
                  onChange={handleFileSelect}
                  disabled={uploading}
                />
                <p className="text-xs text-muted-foreground">
                  Max 50MB. PDF, images, or Office documents.
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="docType">Document Type *</Label>
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

              <div className="space-y-2">
                <Label htmlFor="title">Title (optional)</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Invoice #12345"
                  disabled={uploading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="visibility">Visibility</Label>
                <Select value={visibility} onValueChange={setVisibility} disabled={uploading}>
                  <SelectTrigger id="visibility">
                    <SelectValue placeholder="Select visibility..." />
                  </SelectTrigger>
                  <SelectContent>
                    {VISIBILITY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex items-center gap-2">
                          <opt.icon className="h-4 w-4" />
                          <span>{opt.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {visibility === "private" 
                    ? "Only your organization can view this document"
                    : "Both buyer and seller can view this document"}
                </p>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any relevant notes..."
                  disabled={uploading}
                  rows={2}
                />
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
                    <TableHead>Visibility</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Hash</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((doc) => (
                    <TableRow key={doc.id} className={doc.status === "revoked" ? "opacity-60" : ""}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <span className="font-medium truncate max-w-[200px] block">
                              {doc.title || doc.filename}
                            </span>
                            {doc.title && (
                              <span className="text-xs text-muted-foreground truncate max-w-[200px] block">
                                {doc.filename}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {DOC_TYPES.find((t) => t.value === doc.doc_type)?.label || doc.doc_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {getVisibilityBadge(doc.visibility)}
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem 
                              onClick={() => handleDownload(doc)}
                              disabled={doc.status === "revoked"}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Download
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setSharingDoc(doc)}>
                              <Share2 className="h-4 w-4 mr-2" />
                              Sharing Settings
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setAccessLogsDoc(doc)}>
                              <History className="h-4 w-4 mr-2" />
                              Access History
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Info text */}
          <p className="text-xs text-muted-foreground text-center">
            Documents are stored per POI. Sharing is explicit and all access is logged for compliance.
          </p>
        </CardContent>
      </Card>

      {/* Dialogs */}
      {sharingDoc && (
        <DocumentSharingDialog
          open={!!sharingDoc}
          onOpenChange={(open) => !open && setSharingDoc(null)}
          document={sharingDoc}
          onVisibilityChanged={fetchDocuments}
        />
      )}

      {accessLogsDoc && (
        <DocumentAccessLogs
          open={!!accessLogsDoc}
          onOpenChange={(open) => !open && setAccessLogsDoc(null)}
          documentId={accessLogsDoc.id}
          documentName={accessLogsDoc.title || accessLogsDoc.filename}
        />
      )}
    </>
  );
}
