import { useState, useEffect, useCallback } from "react";
import { useDraftPersistence } from "@/hooks/use-draft-persistence";
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
import { listMatchDocuments } from "@/lib/match-documents-client";
import { apiFetch } from "@/lib/api-client";

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

interface UploadDraft { docType: string; title: string; notes: string; visibility: string }

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

  // Draft persistence for upload form fields (file itself cannot be persisted)
  const getCurrentUploadDraft = useCallback((): UploadDraft | null => {
    if (!docType && !title && !notes) return null;
    return { docType, title, notes, visibility };
  }, [docType, title, notes, visibility]);

  const { restoreDraft, clearDraft: clearUploadDraft, hasRestoredDraft } = useDraftPersistence<UploadDraft>(
    `doc-upload-${matchId}`,
    getCurrentUploadDraft
  );

  useEffect(() => {
    if (hasRestoredDraft) {
      const draft = restoreDraft();
      if (draft) {
        if (draft.docType) setDocType(draft.docType);
        if (draft.title) setTitle(draft.title);
        if (draft.notes) setNotes(draft.notes);
        if (draft.visibility) setVisibility(draft.visibility);
        toast.info("Your unsaved document form has been restored. Re-select the file to continue.");
      }
    }
  }, [hasRestoredDraft]);

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
      setError(null);

      // Load via backend function to avoid direct table query failures and keep access
      // logic centralized with the same rules as downloads.
      const docs = await listMatchDocuments(matchId, { order: "desc" });
      setDocuments(docs as unknown as MatchDocument[]);
    } catch (err) {
      console.error("Error fetching documents:", err);
      const message = err instanceof Error ? err.message : "Failed to load documents";
      setError(message);
      toast.error("Failed to load documents", { description: message });
    } finally {
      setLoading(false);
    }
  };

  /** Map of allowed MIME types to their expected magic byte signatures */
  const MAGIC_BYTES: Record<string, number[][]> = {
    "application/pdf": [[0x25, 0x50, 0x44, 0x46]], // %PDF
    "image/jpeg": [[0xFF, 0xD8, 0xFF]],
    "image/png": [[0x89, 0x50, 0x4E, 0x47]],
    "image/gif": [[0x47, 0x49, 0x46]],
    // Office Open XML (docx, xlsx) — PK zip header
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [[0x50, 0x4B, 0x03, 0x04]],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [[0x50, 0x4B, 0x03, 0x04]],
    // Legacy Office — OLE compound file
    "application/msword": [[0xD0, 0xCF, 0x11, 0xE0]],
    "application/vnd.ms-excel": [[0xD0, 0xCF, 0x11, 0xE0]],
  };

  const validateMagicBytes = async (file: File): Promise<boolean> => {
    const signatures = MAGIC_BYTES[file.type];
    if (!signatures) return true; // No signature to check — allow (MIME already validated)
    const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    return signatures.some(sig =>
      sig.every((byte, i) => header[i] === byte)
    );
  };

  const computeFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const ALLOWED_EXTENSIONS = ".pdf, .jpg, .jpeg, .png, .gif, .doc, .docx, .xls, .xlsx";

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    
    if (!file) {
      setSelectedFile(null);
      return;
    }

    // Pre-upload size feedback
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      setError(`File is ${sizeMB} MB, which exceeds the 50 MB limit. Choose a smaller file.`);
      setSelectedFile(null);
      e.target.value = "";
      return;
    }

    // Pre-upload type feedback
    if (!ALLOWED_TYPES.includes(file.type)) {
      const ext = file.name.split('.').pop()?.toLowerCase() || "unknown";
      setError(
        `".${ext}" files are not supported. Allowed: PDF, JPEG, PNG, GIF, Word (.doc/.docx), and Excel (.xls/.xlsx).`
      );
      setSelectedFile(null);
      e.target.value = "";
      return;
    }

    // Validate magic bytes to prevent MIME spoofing (e.g. .exe renamed to .pdf)
    const validMagic = await validateMagicBytes(file);
    if (!validMagic) {
      setError("File content does not match the declared file type. The file may be corrupted or renamed.");
      setSelectedFile(null);
      e.target.value = "";
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !docType) {
      toast.error("Please select a file and document type");
      return;
    }
    if (uploading) return;

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
      // Sanitise filename in storage path to prevent path traversal
      const safeStorageName = selectedFile.name
        .replace(/[/\\:*?"<>|\x00-\x1f]/g, "_")
        .replace(/\.{2,}/g, "_")
        .slice(0, 255);
      const storagePath = `${effectiveOrgId}/poi/${matchId}/${docId}/${safeStorageName}`;

      const { error: uploadError } = await supabase.storage
        .from("match-documents")
        .upload(storagePath, selectedFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Sanitise filename: strip path traversal, null bytes, and non-printable chars
      const sanitisedFilename = selectedFile.name
        .replace(/[/\\:*?"<>|\x00-\x1f]/g, "_")
        .replace(/\.{2,}/g, "_")
        .slice(0, 255);

      const { error: insertError } = await supabase
        .from("match_documents")
        .insert({
          id: docId,
          match_id: matchId,
          org_id: effectiveOrgId,
          uploader_user_id: session.user.id,
          uploader_org_id: effectiveOrgId,
          doc_type: docType,
          filename: sanitisedFilename,
          storage_path: storagePath,
          sha256_hash: sha256Hash,
          file_size: selectedFile.size,
          mime_type: selectedFile.type,
          status: "uploaded",
          title: title || null,
          notes: notes || null,
          visibility: visibility,
        });

      if (insertError) {
        // Clean up orphaned storage blob since DB insert failed
        console.error("DB insert failed after storage upload, cleaning up blob:", storagePath);
        await supabase.storage.from("match-documents").remove([storagePath]).catch((cleanupErr) => {
          console.error("Failed to clean up orphaned storage blob:", cleanupErr);
        });
        throw insertError;
      }

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
    clearUploadDraft();
  };

  const handleDownload = async (doc: MatchDocument) => {
    try {
      const { data } = await apiFetch<{ data: { download_url: string } }>(
        `document-download/${doc.id}`
      );

      const a = document.createElement("a");
      a.href = data.download_url;
      a.download = doc.filename;
      a.click();
    } catch (err) {
      console.error("Error downloading document:", err);
      toast.error("Failed to download document");
    }
  };

  const handleOpenDocument = async (doc: MatchDocument) => {
    try {
      const { data } = await apiFetch<{ data: { download_url: string } }>(
        `document-download/${doc.id}`
      );

      window.open(data.download_url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Error opening document:", err);
      toast.error("Failed to open document");
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
                  accept={ALLOWED_EXTENSIONS}
                  onChange={handleFileSelect}
                  disabled={uploading}
                />
                <p className="text-xs text-muted-foreground">
                  Max 50 MB. Accepted: PDF, JPEG, PNG, GIF, Word, Excel.
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
                              onClick={() => handleOpenDocument(doc)}
                              disabled={doc.status === "revoked"}
                            >
                              <FileCheck className="h-4 w-4 mr-2" />
                              Open
                            </DropdownMenuItem>
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
