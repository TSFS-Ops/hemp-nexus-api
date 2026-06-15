/**
 * D2b - minimal admin "Binding Review Resolver" dialog.
 *
 * Lives only inside the Pending Engagements admin panel. There is no
 * client-facing surface - counterparties never see the candidate JSON
 * or the resolution actions. The dialog is a thin wrapper around the
 * server endpoint:
 *
 *   POST /poi-engagements/:id/resolve-binding
 *     body { resolution, selected_org_id?, notes }
 *
 * The server is the source of truth for validation and state-machine
 * transitions. This dialog only collects the inputs and surfaces the
 * server's response.
 */

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";

type Resolution =
  | "confirmed_canonical"
  | "rejected"
  | "deferred_no_review_needed";

export interface BindingReviewEngagement {
  id: string;
  match_id: string;
  operational_state?: string | null;
  binding_candidates?: unknown;
  binding_resolution?: string | null;
}

interface Props {
  open: boolean;
  engagement: BindingReviewEngagement | null;
  onClose: () => void;
  onResolved: () => void;
}

export function BindingReviewResolverDialog({
  open,
  engagement,
  onClose,
  onResolved,
}: Props) {
  const [resolution, setResolution] = useState<Resolution>("confirmed_canonical");
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const candidates = useMemo<Array<Record<string, unknown>>>(() => {
    const raw = engagement?.binding_candidates;
    if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
    return [];
  }, [engagement]);

  const candidateOrgIds = useMemo(() => {
    const ids: string[] = [];
    for (const c of candidates) {
      const v = (c as { org_id?: unknown }).org_id;
      if (typeof v === "string" && v.length > 0) ids.push(v);
    }
    return ids;
  }, [candidates]);

  const reset = () => {
    setResolution("confirmed_canonical");
    setSelectedOrgId("");
    setNotes("");
    setSubmitting(false);
  };

  const close = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const submit = async () => {
    if (!engagement) return;
    if (notes.trim().length < 20 || notes.trim().length > 1000) {
      toast.error("Notes must be 20–1000 characters.");
      return;
    }
    if (resolution === "confirmed_canonical" && !selectedOrgId.trim()) {
      toast.error("Select a candidate organisation to confirm.");
      return;
    }
    setSubmitting(true);
    try {
      const idemKey = `binding-resolve-${engagement.id}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const body: Record<string, unknown> = {
        resolution,
        notes: notes.trim(),
      };
      if (resolution === "confirmed_canonical") {
        body.selected_org_id = selectedOrgId.trim();
      }
      const { data, error } = await supabase.functions.invoke(
        `poi-engagements/${engagement.id}/resolve-binding`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idemKey },
          body,
        },
      );
      if (error) {
        const ctx = (error as { context?: { body?: unknown } }).context;
        let message: string = (error as { message?: string }).message ?? "Failed to resolve binding review.";
        try {
          const ctxBody = ctx?.body;
          const parsed = typeof ctxBody === "string" ? JSON.parse(ctxBody) : ctxBody;
          if (parsed && typeof parsed === "object") {
            const code = (parsed as { code?: string; error?: string }).code
              ?? (parsed as { code?: string; error?: string }).error;
            const msg = (parsed as { message?: string }).message;
            if (code) message = msg ? `${code}: ${msg}` : code;
          }
        } catch { /* ignore parse failures */ }
        throw new Error(message);
      }
      toast.success(
        resolution === "rejected"
          ? "Binding review marked rejected - engagement remains blocked."
          : "Binding review resolved.",
      );
      void data;
      reset();
      onResolved();
      onClose();
    } catch (err) {
      console.error("resolve-binding failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to resolve binding review.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!engagement) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Resolve binding review</DialogTitle>
          <DialogDescription>
            Engagement <span className="font-mono">{engagement.id.substring(0, 8)}…</span>
            {" "}is parked in <span className="font-mono">binding_review_required</span>.
            Pick the resolution that reflects what you found, and explain it for the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Candidate identities (raw)
            </Label>
            <pre className="mt-1 text-xs bg-slate-50 border border-slate-200 rounded-sm p-3 max-h-60 overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(engagement.binding_candidates ?? null, null, 2)}
            </pre>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Resolution
            </Label>
            <RadioGroup
              value={resolution}
              onValueChange={(v) => setResolution(v as Resolution)}
              className="mt-2 space-y-2"
            >
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="confirmed_canonical" id="binding-confirmed" />
                <div>
                  <div className="text-sm font-medium">Confirm a canonical organisation</div>
                  <div className="text-xs text-muted-foreground">
                    Bind the engagement to one of the candidate orgs and unblock outreach.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="deferred_no_review_needed" id="binding-deferred" />
                <div>
                  <div className="text-sm font-medium">Mark "no review needed"</div>
                  <div className="text-xs text-muted-foreground">
                    Clear the binding-review block without binding to a specific org.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="rejected" id="binding-rejected" />
                <div>
                  <div className="text-sm font-medium">Reject - keep blocked</div>
                  <div className="text-xs text-muted-foreground">
                    Record that the candidates are not credible. Engagement stays in binding review.
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>

          {resolution === "confirmed_canonical" && (
            <div>
              <Label htmlFor="binding-selected-org" className="text-xs uppercase tracking-wide text-muted-foreground">
                Selected organisation ID
              </Label>
              <input
                id="binding-selected-org"
                type="text"
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                placeholder="UUID of the canonical org"
                list="binding-candidate-org-ids"
                className="mt-1 w-full font-mono text-xs border border-slate-300 rounded-sm px-2 py-1.5"
              />
              {candidateOrgIds.length > 0 && (
                <datalist id="binding-candidate-org-ids">
                  {candidateOrgIds.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
              )}
              {candidateOrgIds.length > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Suggestions from candidates: {candidateOrgIds.map((id) => id.substring(0, 8) + "…").join(", ")}
                </p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="binding-notes" className="text-xs uppercase tracking-wide text-muted-foreground">
              Admin notes (20–1000 chars, audited)
            </Label>
            <Textarea
              id="binding-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Explain how you reached this resolution. Saved verbatim into the audit log."
              className="mt-1"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {notes.trim().length} / 1000
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Save resolution
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
