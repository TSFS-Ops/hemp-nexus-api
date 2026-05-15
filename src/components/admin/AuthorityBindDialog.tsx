/**
 * AuthorityBindDialog - Links a person entity to a company entity (ATB record)
 * or creates a UBO link. Calls the authority-bind edge function.
 */

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch } from "@/lib/api-client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Link2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface Entity {
  id: string;
  legal_name: string;
  entity_type: string;
}

interface AuthorityBindDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyEntity?: Entity | null;
  onSuccess: () => void;
}

export function AuthorityBindDialog({ open, onOpenChange, companyEntity, onSuccess }: AuthorityBindDialogProps) {
  const [type, setType] = useState<"atb" | "ubo">("atb");
  const [companyId, setCompanyId] = useState(companyEntity?.id || "");
  const [personId, setPersonId] = useState("");
  const [method, setMethod] = useState("board_resolution");
  const [ownershipPct, setOwnershipPct] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [companies, setCompanies] = useState<Entity[]>([]);
  const [individuals, setIndividuals] = useState<Entity[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(true);

  useEffect(() => {
    if (open) {
      loadEntities();
      if (companyEntity) setCompanyId(companyEntity.id);
    }
  }, [open, companyEntity]);

  const loadEntities = async () => {
    setLoadingEntities(true);
    const [compRes, indRes] = await Promise.all([
      supabase.from("entities").select("id, legal_name, entity_type").eq("entity_type", "COMPANY").eq("status", "VERIFIED").order("legal_name").limit(200),
      supabase.from("entities").select("id, legal_name, entity_type").eq("entity_type", "INDIVIDUAL").eq("status", "VERIFIED").order("legal_name").limit(200),
    ]);
    setCompanies(compRes.data || []);
    setIndividuals(indRes.data || []);
    setLoadingEntities(false);
  };

  const handleSubmit = async () => {
    setError(null);

    if (!companyId || !personId) {
      setError("Select both a company and a person entity.");
      return;
    }
    if (type === "ubo" && (!ownershipPct || Number(ownershipPct) <= 0 || Number(ownershipPct) > 100)) {
      setError("Ownership percentage must be between 0.01 and 100.");
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        type,
        company_entity_id: companyId,
        person_entity_id: personId,
      };
      if (type === "atb") body.method = method;
      if (type === "ubo") body.ownership_percentage = Number(ownershipPct);

      const data = await apiFetch<any>("authority-bind", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });

      if (data?.status === "ERROR") {
        throw new Error(data.message || data.error?.message || "Failed to create record");
      }

      toast.success(type === "atb" ? "Authority-to-Bind record created" : "UBO link created");
      onSuccess();
      onOpenChange(false);
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create record";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setType("atb");
    setPersonId("");
    setMethod("board_resolution");
    setOwnershipPct("");
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            {type === "atb" ? "Authority to Bind" : "UBO Link"}
          </DialogTitle>
          <DialogDescription>
            {type === "atb"
              ? "Link a person who has legal authority to bind a company entity."
              : "Record beneficial ownership between a person and a company entity."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Record Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as "atb" | "ubo")}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="atb">Authority to Bind (ATB)</SelectItem>
                <SelectItem value="ubo">Beneficial Ownership (UBO)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Company Entity</Label>
            {loadingEntities ? (
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading...
              </div>
            ) : (
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select company..." />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.legal_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <Label>Person Entity</Label>
            {loadingEntities ? (
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading...
              </div>
            ) : (
              <Select value={personId} onValueChange={setPersonId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select person..." />
                </SelectTrigger>
                <SelectContent>
                  {individuals.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.legal_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {type === "atb" && (
            <div>
              <Label>Method of Authority</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="board_resolution">Board Resolution</SelectItem>
                  <SelectItem value="power_of_attorney">Power of Attorney</SelectItem>
                  <SelectItem value="directors_authority">Director's Authority</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {type === "ubo" && (
            <div>
              <Label>Ownership Percentage</Label>
              <Input
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                value={ownershipPct}
                onChange={(e) => setOwnershipPct(e.target.value)}
                placeholder="e.g. 25.5"
                className="mt-1"
              />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/5 p-3 rounded-md">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button onClick={handleSubmit} disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {type === "atb" ? "Create ATB Record" : "Create UBO Link"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
