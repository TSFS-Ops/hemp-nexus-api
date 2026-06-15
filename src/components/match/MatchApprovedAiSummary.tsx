/**
 * MatchApprovedAiSummary
 * ──────────────────────────────────────────────────────────────────────
 * Phase 4 — Originator-visible approved AI summary.
 *
 * This component is the ONLY place where an external/originator user can
 * see anything sourced from the AI Light-Intel pipeline. It is rendered
 * on the Match page and is gated by the server-side, security-definer
 * function `public.get_match_approved_ai_summary(match_id)`.
 *
 * Hard guarantees (these are why the component exists in this exact
 * shape; please do not loosen them without re-reading the Phase 4 spec):
 *
 *   • The component ONLY reads from `get_match_approved_ai_summary`.
 *     It NEVER selects from `ai_proposed_matches` or any other AI table
 *     directly. RLS on the AI tables remains admin-only.
 *   • The server function returns ONLY whitelisted fields from
 *     `approved_payload`. There is no client-side filtering of raw rows.
 *   • If the server returns no row, the component renders NOTHING.
 *     We never show raw AI output by default.
 *   • There is no "Verified" wording for AI confidence anywhere. We
 *     never show: raw payload, original payload, edited payload, source
 *     URLs/snippets, rejected results, internal/reviewer notes,
 *     confidence numbers, risk flags, provider failures, feedback
 *     reasons, audit internals, buyer/seller identity, price, volume,
 *     bank details, documents, or exact warehouse/location.
 *   • The three user actions ("Flag incorrect information",
 *     "Request more intel", "Ask Izenzo to proceed") only create an
 *     internal admin task via `match-ai-summary-action`. They MUST NOT
 *     change AI approval state, POI state, match state, outreach
 *     state, or anything verification-related — that contract is
 *     enforced by the edge function, not by this component.
 */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchEdgeFunction, EdgeInvokeError } from "@/lib/edge-invoke";
import { toast } from "sonner";
import { Flag, HelpCircle, Send, ShieldCheck, Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ApprovedAiSummaryRow {
  proposed_match_id: string;
  match_id: string;
  suggested_counterparty_name: string | null;
  counterparty_role: string | null;
  jurisdiction: string | null;
  sector_or_product_fit: string | null;
  short_summary: string | null;
  status_label: string | null;
  approved_at: string | null;
}

type DialogAction = "flag_incorrect" | "request_more_intel" | "ask_izenzo_to_proceed";

const DIALOG_COPY: Record<
  DialogAction,
  {
    title: string;
    description: string;
    placeholder: string;
    noteRequired: boolean;
    submitLabel: string;
    successToast: string;
  }
> = {
  flag_incorrect: {
    title: "Flag incorrect information",
    description:
      "Tell Izenzo what looks wrong in the summary above. This goes to our review team — nothing is sent to the counterparty.",
    placeholder: "e.g. The country is wrong — they operate from Kenya, not Ghana.",
    noteRequired: true,
    submitLabel: "Flag for review",
    successToast: "Thanks — Izenzo's review team will take a look.",
  },
  request_more_intel: {
    title: "Request more intel",
    description:
      "Ask Izenzo to keep researching this counterparty. We will review what we have and decide on next steps internally.",
    placeholder: "Optional: anything specific you want us to dig into.",
    noteRequired: false,
    submitLabel: "Request more intel",
    successToast: "Thanks — we will keep researching and follow up internally.",
  },
  ask_izenzo_to_proceed: {
    title: "Ask Izenzo to proceed",
    description:
      "Let Izenzo know you would like us to consider next steps. We do not contact the counterparty automatically — our team reviews first.",
    placeholder: "Optional: any context you'd like us to know.",
    noteRequired: false,
    submitLabel: "Ask Izenzo to proceed",
    successToast: "Thanks — Izenzo is reviewing next steps.",
  },
};

export interface MatchApprovedAiSummaryProps {
  matchId: string;
}

export function MatchApprovedAiSummary({ matchId }: MatchApprovedAiSummaryProps) {
  const queryClient = useQueryClient();
  const [dialogAction, setDialogAction] = useState<DialogAction | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: summary, isLoading } = useQuery<ApprovedAiSummaryRow | null>({
    queryKey: ["match-approved-ai-summary", matchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_match_approved_ai_summary", {
        _match_id: matchId,
      });
      if (error) {
        console.warn("[MatchApprovedAiSummary] rpc error", error);
        return null;
      }
      const row = Array.isArray(data) ? data[0] : data;
      return (row as ApprovedAiSummaryRow | undefined) ?? null;
    },
    enabled: !!matchId,
    staleTime: 60_000,
  });

  // Reset the note field whenever the dialog opens/closes.
  useEffect(() => {
    setNote("");
  }, [dialogAction]);

  // If the server returned no row, we render NOTHING. Phase 4 contract:
  // raw AI is never shown by default.
  if (isLoading || !summary) return null;

  const counterpartyDisplay =
    summary.suggested_counterparty_name && summary.suggested_counterparty_name.trim().length > 0
      ? summary.suggested_counterparty_name
      : "Potential counterparty under review";

  const approvedAtLabel = summary.approved_at
    ? new Date(summary.approved_at).toLocaleString()
    : null;

  const onSubmit = async () => {
    if (!dialogAction) return;
    const copy = DIALOG_COPY[dialogAction];
    const trimmed = note.trim();
    if (copy.noteRequired && trimmed.length < 3) {
      toast.error("Please add a short note so the review team has context.");
      return;
    }
    setSubmitting(true);
    try {
      await fetchEdgeFunction("match-ai-summary-action", {
        method: "POST",
        label: "submit AI summary action",
        body: { match_id: matchId, action: dialogAction, note: trimmed || null },
      });
      toast.success(copy.successToast);
      setDialogAction(null);
      setNote("");
      // The Phase 4 actions never change the approved summary itself,
      // but invalidate just to be safe in case admin acts immediately.
      queryClient.invalidateQueries({ queryKey: ["match-approved-ai-summary", matchId] });
    } catch (err) {
      const msg = err instanceof EdgeInvokeError ? err.message : "Could not submit. Please try again.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Card data-testid="match-approved-ai-summary">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-700" aria-hidden />
              Approved counterparty summary
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {summary.status_label || "Approved summary available"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Izenzo is reviewing next steps. This summary is information only —
            it is not a verified compliance, KYB, or bank-detail check.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SummaryField label="Counterparty" value={counterpartyDisplay} />
            <SummaryField label="Role" value={summary.counterparty_role} />
            <SummaryField label="Country / jurisdiction" value={summary.jurisdiction} />
            <SummaryField label="Sector / product fit" value={summary.sector_or_product_fit} />
          </div>
          {summary.short_summary && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Summary
              </div>
              <p className="text-sm leading-relaxed">{summary.short_summary}</p>
            </div>
          )}
          {approvedAtLabel && (
            <p className="text-xs text-muted-foreground">
              Last approved: {approvedAtLabel}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialogAction("flag_incorrect")}
              data-testid="ai-summary-flag-btn"
            >
              <Flag className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              Flag incorrect information
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialogAction("request_more_intel")}
              data-testid="ai-summary-request-more-btn"
            >
              <HelpCircle className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              Request more intel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setDialogAction("ask_izenzo_to_proceed")}
              data-testid="ai-summary-proceed-btn"
            >
              <Send className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              Ask Izenzo to proceed
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogAction !== null} onOpenChange={(open) => !open && setDialogAction(null)}>
        <DialogContent>
          {dialogAction && (
            <>
              <DialogHeader>
                <DialogTitle>{DIALOG_COPY[dialogAction].title}</DialogTitle>
                <DialogDescription>{DIALOG_COPY[dialogAction].description}</DialogDescription>
              </DialogHeader>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={DIALOG_COPY[dialogAction].placeholder}
                maxLength={2000}
                rows={5}
              />
              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogAction(null)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={onSubmit} disabled={submitting}>
                  {submitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden />}
                  {DIALOG_COPY[dialogAction].submitLabel}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SummaryField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">{label}</div>
      <div className="text-sm">{value && value.trim().length > 0 ? value : <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

export default MatchApprovedAiSummary;
