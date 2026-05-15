/**
 * GovernanceDocSubmit - Submit governance documents for a match/POI.
 * Calls the governance-docs edge function to register documents against
 * the governance_doc_registry.
 */

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, AlertCircle, CheckCircle2, Clock, ShieldCheck, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, generateIdempotencyKey } from "@/lib/api-client";

interface RegistryEntry {
  id: string;
  doc_type: string;
  category: string;
  mandatory_flag: boolean;
  jurisdiction_code: string;
}

interface GovernanceDoc {
  id: string;
  registry_id: string;
  status: string;
  created_at: string;
  validated_at: string | null;
  governance_doc_registry: {
    doc_type: string;
    category: string;
    mandatory_flag: boolean;
  } | null;
}

interface GovernanceDocSubmitProps {
  matchId: string;
  orgId: string;
}

export function GovernanceDocSubmit({ matchId, orgId }: GovernanceDocSubmitProps) {
  const queryClient = useQueryClient();
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [submitted, setSubmitted] = useState<GovernanceDoc[]>([]);
  const [selectedRegistryId, setSelectedRegistryId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg"];
  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

  const DRAFT_KEY = `gov-doc-draft:${matchId}`;

  // Restore draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft.selectedRegistryId) setSelectedRegistryId(draft.selectedRegistryId);
      }
    } catch { /* ignore corrupt localStorage */ }
  }, [DRAFT_KEY]);

  // Emergency-save on session expiry
  useEffect(() => {
    const handler = () => {
      if (selectedRegistryId) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ selectedRegistryId }));
      }
    };
    window.addEventListener("izenzo:session-expiry", handler);
    return () => window.removeEventListener("izenzo:session-expiry", handler);
  }, [selectedRegistryId, DRAFT_KEY]);

  // Clear draft after successful submit
  const clearDraft = () => localStorage.removeItem(DRAFT_KEY);

  useEffect(() => {
    loadData();
  }, [matchId, orgId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load registry entries
      const regRes = await supabase
        .from("governance_doc_registry")
        .select("id, doc_type, category, mandatory_flag, jurisdiction_code")
        .eq("active", true)
        .eq("org_id", orgId)
        .order("category");

      // Registry may be org-scoped, fallback to loading all
      let regData = regRes.data || [];
      if (regData.length === 0) {
        const { data: allReg } = await supabase
          .from("governance_doc_registry")
          .select("id, doc_type, category, mandatory_flag, jurisdiction_code")
          .eq("active", true)
          .order("category")
          .limit(50);
        regData = allReg || [];
      }

      // Deduplicate by doc_type
      const seen = new Set<string>();
      const dedupedRegistry = regData.filter((r) => {
        if (seen.has(r.doc_type)) return false;
        seen.add(r.doc_type);
        return true;
      });
      setRegistry(dedupedRegistry);

      // Load submitted governance docs via apiFetch (proper error handling)
      try {
        const docsResponse = await apiFetch<{ status: string; data: GovernanceDoc[] }>(
          `governance-docs?deal_reference_id=${matchId}`,
          { method: "GET" }
        );
        if (docsResponse?.data) {
          setSubmitted(docsResponse.data);
        } else if (Array.isArray(docsResponse)) {
          setSubmitted(docsResponse as unknown as GovernanceDoc[]);
        }
      } catch (docsErr) {
        console.error("Error loading submitted governance docs:", docsErr);
        // Don't block the whole form if loading submitted docs fails
      }
    } catch (err) {
      console.error("Error loading governance data:", err);
      setError("Failed to load governance documents. Please refresh to retry.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Only PDF, PNG, or JPEG files are accepted.");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("File must be under 10 MB.");
      return;
    }
    setError(null);
    setSelectedFile(file);
  };

  const handleSubmit = async () => {
    if (!selectedRegistryId) {
      setError("Please select a document type.");
      return;
    }
    if (!selectedFile) {
      setError("Please attach a document file (PDF, PNG, or JPEG).");
      return;
    }
    setError(null);
    setSubmitting(true);

    let storagePath = "";
    try {
      // 1. Upload file to storage
      const ext = selectedFile.name.split(".").pop() || "pdf";
      storagePath = `${orgId}/${matchId}/gov_${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("match-documents")
        .upload(storagePath, selectedFile, {
          contentType: selectedFile.type,
          upsert: false,
        });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      // 2. Register governance doc via apiFetch (proper error surfacing).
      // The governance-docs edge function hard-enforces Idempotency-Key on
      // mutating requests via assertIdempotencyKey — generate one per submit
      // so retries from the user clicking twice are safely deduplicated.
      await apiFetch("governance-docs", {
        method: "POST",
        idempotencyKey: generateIdempotencyKey("gov_doc"),
        body: JSON.stringify({
          registry_id: selectedRegistryId,
          deal_reference_id: matchId,
          deal_reference_type: "POI",
          document_path: storagePath,
        }),
      });

      toast.success("Governance document uploaded and submitted for review");
      setSelectedRegistryId("");
      setSelectedFile(null);
      clearDraft();
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadData();
      queryClient.invalidateQueries({ queryKey: ["gov-doc-count", matchId] });
    } catch (err) {
      // Clean up orphaned file if upload succeeded but registration failed
      if (storagePath) {
        supabase.storage.from("match-documents").remove([storagePath]).catch((cleanupErr) => {
          console.error("[GovernanceDocSubmit] Failed to clean up orphaned file:", storagePath, cleanupErr);
        });
      }
      const msg = err instanceof Error ? err.message : "Failed to submit governance document";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const submittedRegistryIds = new Set(submitted.map((d) => d.registry_id));
  const availableRegistry = registry.filter((r) => !submittedRegistryIds.has(r.id));

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-5 w-5" />
          Governance Documents
        </CardTitle>
        <CardDescription>
          Supporting documents strengthen your evidence bundle. Upload governance documents for this trade.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Already submitted */}
        {submitted.length > 0 && (
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Submitted</Label>
            {submitted.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between p-2 bg-muted rounded-md text-sm">
                <div className="flex items-center gap-2">
                  {doc.status === "VALIDATED" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <Clock className="h-4 w-4 text-yellow-500" />
                  )}
                  <span className="font-medium">
                    {doc.governance_doc_registry?.doc_type?.replace(/_/g, " ") || "Document"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={doc.status === "VALIDATED" ? "default" : "secondary"} className="text-xs">
                    {doc.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Submit new */}
        {availableRegistry.length > 0 ? (
          <div className="space-y-3 pt-2 border-t">
            <div>
              <Label>Document Type</Label>
              <Select value={selectedRegistryId} onValueChange={setSelectedRegistryId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select governance document..." />
                </SelectTrigger>
                <SelectContent>
                  {availableRegistry.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.doc_type.replace(/_/g, " ")}
                      {", "}
                      {r.jurisdiction_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Attach Document</Label>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleFileChange}
                  className="flex-1"
                />
                {selectedFile && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">PDF, PNG, or JPEG. Max 10 MB.</p>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/5 p-3 rounded-md">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button onClick={handleSubmit} disabled={submitting || !selectedRegistryId || !selectedFile} className="w-full" size="sm">
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Upload className="h-4 w-4 mr-2" />
              Submit Governance Document
            </Button>
          </div>
        ) : registry.length > 0 ? (
          <div className="flex items-center gap-2 p-3 bg-muted rounded-md text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>All governance documents have been submitted.</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No governance document requirements found for your organisation. Contact your admin if this is unexpected.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
