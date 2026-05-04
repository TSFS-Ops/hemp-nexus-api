import { useState, useEffect, useCallback } from "react";
import { useDraftPersistence } from "@/hooks/use-draft-persistence";
import { supabase } from "@/integrations/supabase/client";
import { fetchEdgeFunction } from "@/lib/edge-invoke";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  DropdownMenuSeparator,
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
  EyeOff,
  RefreshCw,
  ClipboardCheck,
  AlertTriangle,
  ShieldAlert
} from "lucide-react";
import { format } from "date-fns";
import { DocumentSharingDialog } from "./DocumentSharingDialog";
import { DocumentAccessLogs } from "./DocumentAccessLogs";
import { listMatchDocuments } from "@/lib/match-documents-client";
import { getMatchEvidenceCounts } from "@/lib/match-evidence-counts-client";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

/** Detect MIME from first bytes of a file - client-side magic-byte check */
const MAGIC_SIGS: [string, number[]][] = [
  ["application/pdf", [0x25, 0x50, 0x44, 0x46]],
  ["image/png", [0x89, 0x50, 0x4E, 0x47]],
  ["image/jpeg", [0xFF, 0xD8, 0xFF]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
  ["application/zip", [0x50, 0x4B, 0x03, 0x04]],
];
function detectMimeFromHeader(header: Uint8Array): string | null {
  for (const [mime, bytes] of MAGIC_SIGS) {
    if (header.length < bytes.length) continue;
    if (bytes.every((b, i) => header[i] === b)) return mime;
  }
  return null;
}

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
  version?: number;
  supersedes_document_id?: string | null;
  root_document_id?: string | null;
  is_current_version?: boolean;
  superseded_at?: string | null;
  change_notes?: string | null;
  verified_at?: string | null;
  verified_by?: string | null;
  verification_notes?: string | null;
  uploader_user_id?: string | null;
  uploader_org_id?: string | null;
}

interface MatchDocumentsProps {
  matchId: string;
  orgId: string;
}

const DOC_TYPES = [
  { value: "other", label: "Document" },
];

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private", icon: Lock, description: "Only your organisation" },
  { value: "share_with_counterparty", label: "Share with Trading Partner", icon: Users, description: "Both buyer and seller" },
];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB - compliance-grade cap, enforced server-side via bucket config
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

interface UploadDraft { docType: string; title: string; notes: string; visibility: string }

export function MatchDocuments({ matchId, orgId }: MatchDocumentsProps) {
  // Per-side evidence counts power the bilateral POI minimum-evidence banner
  // shown above the upload form. This mirrors the server-enforced
  // MIN_EVIDENCE_PER_SIDE rule (atomic_generate_poi_v2) so users see the
  // requirement on the Documents tab, not only at the POI button.
  const { data: evidenceCounts } = useQuery({
    queryKey: ["match-documents-evidence-counts", matchId],
    queryFn: () => getMatchEvidenceCounts(matchId),
    enabled: !!matchId,
    staleTime: 0,
  });
  const buyerDocsCount = evidenceCounts?.buyerDocumentCount ?? 0;
  const sellerDocsCount = evidenceCounts?.sellerDocumentCount ?? 0;
  const perSideUnmet =
    !!evidenceCounts && (buyerDocsCount === 0 || sellerDocsCount === 0);

  const [documents, setDocuments] = useState<MatchDocument[]>([]);
  // Truncation state: when the server cap is hit we MUST surface a persistent
  // banner — a sonner toast auto-dismisses in <4s and operators routinely
  // missed it, leading to compliance reviews on incomplete document sets.
  const [docsTruncated, setDocsTruncated] = useState(false);
  const [docsTruncationWarning, setDocsTruncationWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("other");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [changeNotes, setChangeNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionOrgId, setSessionOrgId] = useState<string | null>(null);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [historyRootId, setHistoryRootId] = useState<string | null>(null);

  // Participant guard: hold the trio of orgs that are legitimately on this match
  // (initiator/buyer/seller) so we can detect a viewer whose org is NOT a
  // participant and stop them at a clear "wrong-match" panel instead of letting
  // them hit the upload screen and get a useless "Failed to upload document".
  const [matchOrgIds, setMatchOrgIds] = useState<{
    initiator: string | null;
    buyer: string | null;
    seller: string | null;
  } | null>(null);
  
  // Dialog states
  const [sharingDoc, setSharingDoc] = useState<MatchDocument | null>(null);
  const [accessLogsDoc, setAccessLogsDoc] = useState<MatchDocument | null>(null);
  const [replacingDoc, setReplacingDoc] = useState<MatchDocument | null>(null);

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
        toast.info("Document details restored from your previous session. Please re-select the file you wanted to upload — browsers do not allow saved file selections.", {
          duration: 8000,
        });
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

  // Fetch the match's participant org ids so we can render a clear
  // "not a participant" panel instead of failing at the storage layer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: matchErr } = await supabase
        .from("matches")
        .select("org_id, buyer_org_id, seller_org_id")
        .eq("id", matchId)
        .maybeSingle();
      if (cancelled) return;
      if (matchErr || !data) {
        // If we cannot read the match (RLS or missing), leave matchOrgIds null
        // — the participant guard below will treat that as "unknown" and the
        // existing fetchDocuments error path will surface the real reason.
        setMatchOrgIds({ initiator: null, buyer: null, seller: null });
        return;
      }
      setMatchOrgIds({
        initiator: (data as { org_id: string | null }).org_id ?? null,
        buyer: (data as { buyer_org_id: string | null }).buyer_org_id ?? null,
        seller: (data as { seller_org_id: string | null }).seller_org_id ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [matchId]);

  useEffect(() => {
    fetchDocuments();
  }, [matchId]);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load via backend function to avoid direct table query failures and keep access
      // logic centralized with the same rules as downloads.
      const result = await listMatchDocuments(matchId, { order: "desc" });
      setDocuments(result.documents as unknown as MatchDocument[]);
      setDocsTruncated(!!result.truncated);
      setDocsTruncationWarning(result.truncated ? (result.warning || null) : null);
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
    // Office Open XML (docx, xlsx) - PK zip header
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [[0x50, 0x4B, 0x03, 0x04]],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [[0x50, 0x4B, 0x03, 0x04]],
    // Legacy Office - OLE compound file
    "application/msword": [[0xD0, 0xCF, 0x11, 0xE0]],
    "application/vnd.ms-excel": [[0xD0, 0xCF, 0x11, 0xE0]],
  };

  const validateMagicBytes = async (file: File): Promise<boolean> => {
    const signatures = MAGIC_BYTES[file.type];
    if (!signatures) return true; // No signature to check - allow (MIME already validated)
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

  const ALLOWED_EXTENSIONS = ".pdf, .jpg, .jpeg, .png, .doc, .docx, .xls, .xlsx";

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
      setError(`File is ${sizeMB} MB, which exceeds the 20 MB limit. Choose a smaller file.`);
      setSelectedFile(null);
      e.target.value = "";
      return;
    }

    // Pre-upload type feedback
    if (!ALLOWED_TYPES.includes(file.type)) {
      const ext = file.name.split('.').pop()?.toLowerCase() || "unknown";
      setError(
        `".${ext}" files are not supported. Allowed: PDF, JPEG, PNG, Word (.doc/.docx), and Excel (.xls/.xlsx).`
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
    if (!selectedFile) {
      toast.error("Please select a file");
      return;
    }
    if (!docType) setDocType("other");
    if (uploading) return;

    try {
      setUploading(true);
      setError(null);

      // ── Magic-byte validation: inspect first 16 bytes ──
      const headerSlice = selectedFile.slice(0, 16);
      const headerBytes = new Uint8Array(await headerSlice.arrayBuffer());
      const detectedMime = detectMimeFromHeader(headerBytes);
      if (detectedMime === "image/gif") {
        setError("GIF files are not allowed");
        setUploading(false);
        return;
      }
      if (detectedMime && detectedMime !== selectedFile.type) {
        // ZIP-based Office formats are expected
        const isZipOffice = detectedMime === "application/zip" && selectedFile.type.includes("openxmlformats");
        if (!isZipOffice) {
          console.warn(`MIME mismatch: client says ${selectedFile.type}, magic bytes say ${detectedMime}`);
        }
      }

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
        toast.error("Could not determine organisation");
        return;
      }

      // Storage path format: <org_id>/<match_id>/poi/<doc_id>/<filename>
      // First folder = org_id (RLS check), second folder = match_id (RLS cross-ref)
      const docId = crypto.randomUUID();
      // Sanitise filename in storage path to prevent path traversal
      const safeStorageName = selectedFile.name
        .replace(/[/\\:*?"<>|\x00-\x1f]/g, "_")
        .replace(/\.{2,}/g, "_")
        .slice(0, 255);
      const storagePath = `${effectiveOrgId}/${matchId}/poi/${docId}/${safeStorageName}`;

      const { error: uploadError } = await supabase.storage
        .from("match-documents")
        .upload(storagePath, selectedFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // ── Server-side magic-byte re-validation via document-review ──
      // The file is now in storage. Call the edge function to validate server-side.
      // If the server rejects it, clean up the orphaned storage file.
      let validateWarning: string | null = null;
      try {
        const validateResult = await fetchEdgeFunction<{ blocked?: boolean; reason?: string }>(
          "validate-upload",
          {
            method: "POST",
            body: {
              bucket: "match-documents",
              storage_path: storagePath,
              client_mime: selectedFile.type,
              file_size: selectedFile.size,
            },
            label: "validate upload",
          }
        );
        if (validateResult?.blocked) {
          // Clean up orphaned file
          await supabase.storage.from("match-documents").remove([storagePath]);
          setError(validateResult.reason || "Server rejected this file - content does not match declared type.");
          setUploading(false);
          return;
        }
      } catch (validationErr) {
        // If server-side validation cannot be reached, do not treat that as a
        // dead sign-in session. The client-side magic-byte check already ran,
        // and the real upload + DB write below are still protected by storage
        // and table access rules.
        console.warn("Upload validation unavailable; continuing after client-side validation", validationErr);
        validateWarning = "Server validation was unavailable, so the upload used browser-side file checks only.";
      }

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
          magic_bytes_verified: !!detectedMime,
          server_detected_mime: detectedMime || null,
          status: "uploaded",
          title: title || null,
          notes: notes || null,
          visibility: visibility,
          // Version chain: new standalone doc is its own root, version 1, current
          root_document_id: docId,
          version: 1,
          is_current_version: true,
        });

      if (insertError) {
        // Clean up orphaned storage blob since DB insert failed
        console.error("DB insert failed after storage upload, cleaning up blob:", storagePath);
        await supabase.storage.from("match-documents").remove([storagePath]).catch((cleanupErr) => {
          console.error("Failed to clean up orphaned storage blob:", cleanupErr);
        });
        throw insertError;
      }

      // Audit log (best-effort: client cannot insert into audit_logs under RLS,
      // so failure here MUST NOT block the user-visible upload outcome. The
      // canonical audit trail is written server-side by document/storage
      // triggers and downstream edge functions).
      try {
        const { error: auditErr } = await supabase.from("audit_logs").insert({
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
        if (auditErr) {
          console.warn("Client-side audit log write skipped (expected under RLS):", auditErr.message);
        }
      } catch (auditCatchErr) {
        console.warn("Client-side audit log write threw:", auditCatchErr);
      }

      // If this is a replacement upload, link it to the old version
      if (replacingDoc) {
        try {
          await apiFetch(`document-review/${replacingDoc.id}/replace`, {
            method: "POST",
            body: JSON.stringify({ new_document_id: docId, change_notes: changeNotes || null }),
          });
          toast.success(`Document replaced. Version ${(replacingDoc.version || 1) + 1} is now active.`);
        } catch (replaceErr) {
          console.error("Version linking failed:", replaceErr);
          toast.warning("Document uploaded but version linking failed. Contact support.");
        }
      } else {
        toast.success("Document uploaded successfully");
      }
      if (validateWarning) {
        toast.warning("Document uploaded, but server validation could not be completed. Browser-side file checks passed.");
      }

      resetForm();
      fetchDocuments();
    } catch (err: unknown) {
      console.error("Error uploading document:", err);
      const raw = err instanceof Error ? err.message : "Failed to upload document";
      // Map Supabase RLS / storage rejections to a plain-English reason so
      // counterparties on the wrong match don't see the useless generic
      // "Failed to upload document". Storage RLS rejects with a 403 and a
      // body that mentions "row-level security" or "new row violates" — and
      // the storage client surfaces "row violates row-level security policy"
      // or "Unauthorized". Treat those as a participant/permission failure.
      const lower = raw.toLowerCase();
      const isPermission =
        lower.includes("row-level security") ||
        lower.includes("row level security") ||
        lower.includes("violates row") ||
        lower.includes("unauthorized") ||
        lower.includes("not allowed") ||
        lower.includes("permission denied") ||
        lower.includes("403");
      const friendly = isPermission
        ? "Your organisation is not a participant on this trade. You cannot upload documents or complete POI for this match. Please check that you are using the correct match link or ask the initiating party to invite the correct organisation."
        : raw;
      setError(friendly);
      toast.error(
        isPermission ? "Upload not permitted" : "Failed to upload document",
        { description: friendly }
      );
    } finally {
      setUploading(false);
    }
  };

  const resetForm = () => {
    setSelectedFile(null);
    setDocType("");
    setTitle("");
    setNotes("");
    setChangeNotes("");
    setVisibility("private");
    setReplacingDoc(null);
    clearUploadDraft();
  };

  /** Get all docs in the same version chain */
  const getVersionChain = (rootId: string | null | undefined): MatchDocument[] => {
    if (!rootId) return [];
    return documents
      .filter(d => d.root_document_id === rootId)
      .sort((a, b) => (a.version || 1) - (b.version || 1));
  };

  /** Filter: show only current versions unless toggled */
  const visibleDocuments = showSuperseded
    ? documents
    : documents.filter(d => d.is_current_version !== false);

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
      // Capture a blank tab synchronously (before the async call) to avoid popup blockers
      const newTab = window.open("about:blank", "_blank", "noopener,noreferrer");

      const { data } = await apiFetch<{ data: { download_url: string } }>(
        `document-download/${doc.id}`
      );

      if (newTab) {
        newTab.location.href = data.download_url;
      } else {
        // Fallback if popup was blocked: navigate current tab or download
        window.open(data.download_url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.error("Error opening document:", err);
      toast.error("Failed to open document", {
        description: "Try using the Download option instead.",
      });
    }
  };

  const handleRequestReview = async (doc: MatchDocument) => {
    try {
      await apiFetch(`document-review/${doc.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "request_review" }),
      });
      toast.success("Document submitted for review");
      fetchDocuments();
    } catch (err) {
      console.error("Error requesting review:", err);
      toast.error("Failed to submit for review");
    }
  };

  const handleReplaceDocument = async (oldDoc: MatchDocument) => {
    // Set up the upload form pre-filled for replacement
    setReplacingDoc(oldDoc);
    setDocType(oldDoc.doc_type);
    setTitle(oldDoc.title || "");
    setVisibility(oldDoc.visibility);
    toast.info("Select a file to upload as a replacement. The current version will be archived.");
  };

  const getStatusBadge = (status: string, expiryDate: string | null) => {
    if (expiryDate && new Date(expiryDate) < new Date()) {
      return <Badge variant="destructive">Expired</Badge>;
    }
    
    switch (status) {
      case "uploaded":
        return <Badge variant="secondary">Uploaded</Badge>;
      case "pending_review":
        return <Badge className="bg-warning/10 text-warning border-warning/20">Pending Review</Badge>;
      case "accepted":
        return <Badge className="bg-success/10 text-success border-success/20">Accepted</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      case "verified":
        return <Badge variant="default">Verified</Badge>;
      case "revoked":
        return <Badge variant="destructive">Revoked</Badge>;
      case "archived":
        return <Badge variant="outline">Archived (Superseded)</Badge>;
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

  // ── Participant guard ──
  // Compute whether the viewer's org is one of the match's participant orgs
  // (initiator/buyer/seller). If we have BOTH the viewer's org and the
  // match's participant trio loaded, and the viewer's org is not among them,
  // render a clear non-destructive panel instead of the upload UI. This
  // prevents the "wrong-match link" failure mode where storage RLS would
  // reject the upload with an opaque error.
  const viewerOrgId = sessionOrgId || orgId || null;
  const participantsLoaded = matchOrgIds !== null;
  const knownParticipants = matchOrgIds
    ? [matchOrgIds.initiator, matchOrgIds.buyer, matchOrgIds.seller].filter(
        (v): v is string => !!v
      )
    : [];
  const isParticipant =
    !!viewerOrgId &&
    participantsLoaded &&
    knownParticipants.length > 0 &&
    knownParticipants.includes(viewerOrgId);
  // Only block when we have enough info to be sure: viewer org known AND
  // match participants known AND non-empty AND viewer is not among them.
  // If any of those are missing we fall through to the normal UI so we never
  // false-positive a legitimate participant.
  const blockedNonParticipant =
    !!viewerOrgId &&
    participantsLoaded &&
    knownParticipants.length > 0 &&
    !isParticipant;

  if (blockedNonParticipant) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            Your organisation is not a participant on this trade
          </CardTitle>
          <CardDescription>
            You cannot upload documents or complete POI for this match.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-foreground">
            Please check that you are using the correct match link, or ask the
            initiating party to invite your organisation to this trade.
          </p>
          <p className="text-xs text-muted-foreground">
            If you believe this is an error, contact support and quote match ID
            <span className="ml-1 font-mono">{matchId}</span>.
          </p>
        </CardContent>
      </Card>
    );
  }

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
                Upload and manage documents related to this intent. Documents are stored securely with explicit sharing controls.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* ── Per-side POI minimum-evidence banner ──
              Mirrors atomic_generate_poi_v2's MIN_EVIDENCE_PER_SIDE check so
              the rule is visible on the Documents tab, not only at click. */}
          {perSideUnmet && (
            <div
              role="alert"
              className="flex items-start gap-3 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800"
            >
              <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  Bilateral Proof of Intent needs at least 1 document per side
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Currently attached: buyer = <strong>{buyerDocsCount}</strong>,
                  seller = <strong>{sellerDocsCount}</strong>. Upload a supporting
                  document of any type from each side before generating POI.
                </p>
              </div>
            </div>
          )}
          <div className="border rounded-lg p-4 space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              <Upload className="h-4 w-4" />
              {replacingDoc ? `Replace: ${replacingDoc.title || replacingDoc.filename} (v${replacingDoc.version || 1})` : "Upload Document"}
            </h4>
            {replacingDoc && (
              <div className="flex items-center gap-2 p-2 rounded bg-muted text-sm">
                <RefreshCw className="h-4 w-4 text-primary" />
                <span>Uploading a replacement for version {replacingDoc.version || 1}. The previous version will be archived (read-only).</span>
                <Button variant="ghost" size="sm" onClick={() => setReplacingDoc(null)} className="ml-auto">Cancel</Button>
              </div>
            )}
            {replacingDoc && (
              <div className="space-y-2">
                <Label htmlFor="changeNotes">Change Notes (optional)</Label>
                <Input
                  id="changeNotes"
                  value={changeNotes}
                  onChange={(e) => setChangeNotes(e.target.value)}
                  placeholder="Describe what changed in this version…"
                  disabled={uploading}
                />
              </div>
            )}
            
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
                  Max 20 MB. Accepted: PDF, JPEG, PNG, Word, Excel.
                </p>
              </div>
              
              {/* doc_type is auto-defaulted to "other", no dropdown needed */}

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
                    ? "Only your organisation can view this document"
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

          {/* Version filter + Documents List */}
          {!loading && documents.length > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {visibleDocuments.length} document{visibleDocuments.length !== 1 ? "s" : ""}
                {!showSuperseded && documents.length > visibleDocuments.length && (
                  <span> · {documents.length - visibleDocuments.length} superseded hidden</span>
                )}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSuperseded(!showSuperseded)}
                className="text-xs"
              >
                <History className="h-3 w-3 mr-1" />
                {showSuperseded ? "Hide Superseded" : "Show All Versions"}
              </Button>
            </div>
          )}

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
            <div className="space-y-3">
              {docsTruncated && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-warning" />
                  <div>
                    <div className="font-medium">Document list may be incomplete</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {docsTruncationWarning ||
                        "The server returned a partial document set because this match has more documents than the per-request cap. Filter by date, type, or version to see the rest before relying on this list for compliance review."}
                    </div>
                  </div>
                </div>
              )}
              <div className="border rounded-lg overflow-hidden">
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Visibility</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Hash</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleDocuments.map((doc) => {
                    const chain = getVersionChain(doc.root_document_id);
                    const hasHistory = chain.length > 1;
                    return (
                      <TableRow key={doc.id} className={doc.status === "revoked" || doc.status === "archived" ? "opacity-60" : ""}>
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
                              {doc.change_notes && (
                                <span className="text-xs text-muted-foreground/70 italic truncate max-w-[200px] block">
                                  {doc.change_notes}
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
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-mono">v{doc.version || 1}</span>
                            {doc.is_current_version !== false ? (
                              <Badge variant="default" className="text-[10px] px-1 py-0">Current</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 text-muted-foreground">Superseded</Badge>
                            )}
                            {hasHistory && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0 ml-1"
                                title="View version history"
                                onClick={() => setHistoryRootId(doc.root_document_id || doc.id)}
                              >
                                <History className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {getVisibilityBadge(doc.visibility)}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(doc.status, doc.expiry_date)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Shield className="h-3 w-3 text-success" />
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
                              {hasHistory && (
                                <DropdownMenuItem onClick={() => setHistoryRootId(doc.root_document_id || doc.id)}>
                                  <RefreshCw className="h-4 w-4 mr-2" />
                                  Version History ({chain.length} versions)
                                </DropdownMenuItem>
                              )}
                              {doc.status !== "revoked" && doc.status !== "archived" && doc.is_current_version !== false && (
                                <>
                                  <DropdownMenuSeparator />
                                  {(doc.status === "uploaded" || doc.status === "rejected") && (
                                    <DropdownMenuItem onClick={() => handleRequestReview(doc)}>
                                      <ClipboardCheck className="h-4 w-4 mr-2" />
                                      Submit for Review
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem onClick={() => handleReplaceDocument(doc)}>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Replace (New Version)
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            </div>
          )}

          {/* Info text */}
          <p className="text-xs text-muted-foreground text-center">
            Documents are stored per action. Sharing is explicit and all access is logged for compliance.
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

      {/* Version History Dialog */}
      {historyRootId && (
        <Dialog open={!!historyRootId} onOpenChange={(open) => !open && setHistoryRootId(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Version History
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {getVersionChain(historyRootId).reverse().map((doc) => (
                <div
                  key={doc.id}
                  className={`border rounded-lg p-3 space-y-1 ${doc.is_current_version !== false ? "border-primary/50 bg-primary/5" : "opacity-70"}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold">v{doc.version || 1}</span>
                      {doc.is_current_version !== false ? (
                        <Badge variant="default" className="text-[10px]">Current</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Superseded</Badge>
                      )}
                      {getStatusBadge(doc.status, doc.expiry_date)}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => handleOpenDocument(doc)}>
                        Open
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => handleDownload(doc)}>
                        <Download className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm font-medium">{doc.title || doc.filename}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{format(new Date(doc.created_at), "MMM dd, yyyy HH:mm")}</span>
                    <span className="font-mono">{doc.sha256_hash.slice(0, 12)}…</span>
                    {doc.file_size && <span>{formatFileSize(doc.file_size)}</span>}
                  </div>
                  {doc.change_notes && (
                    <p className="text-xs text-muted-foreground italic">
                      Change: {doc.change_notes}
                    </p>
                  )}
                  {doc.superseded_at && (
                    <p className="text-xs text-muted-foreground">
                      Superseded: {format(new Date(doc.superseded_at), "MMM dd, yyyy HH:mm")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
