import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Plus, ShieldAlert, CheckCircle2, ArrowUpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { InlineLoader } from "@/components/ui/inline-loader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDataFetch } from "@/hooks/use-data-fetch";
import { useAsyncAction } from "@/hooks/use-async-action";
import { useDraftPersistence } from "@/hooks/use-draft-persistence";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Dispute {
  id: string;
  reason: string;
  evidence_notes: string | null;
  status: string;
  resolution_outcome: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  raised_by_org_id: string;
  created_at: string;
}

interface DisputePanelProps {
  matchId: string;
  orgId: string;
}

interface DisputeDraft {
  reason: string;
  evidence: string;
}

export function DisputePanel({ matchId, orgId }: DisputePanelProps) {
  const { user } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  // Resolve/withdraw state
  const [actionDispute, setActionDispute] = useState<Dispute | null>(null);
  const [actionType, setActionType] = useState<string>("");
  const [actionNotes, setActionNotes] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [showActionConfirm, setShowActionConfirm] = useState(false);

  // Draft persistence for dispute form
  const getCurrentDraft = useCallback((): DisputeDraft | null => {
    if (!reason.trim() && !evidence.trim()) return null;
    return { reason, evidence };
  }, [reason, evidence]);

  const { restoreDraft, saveDraft, clearDraft, hasRestoredDraft } = useDraftPersistence<DisputeDraft>(
    `dispute-${matchId}`,
    getCurrentDraft
  );

  // Restore draft on form open
  const handleOpenForm = () => {
    if (!showForm) {
      const draft = restoreDraft();
      if (draft) {
        setReason(draft.reason);
        setEvidence(draft.evidence);
        toast.info("Unsaved dispute draft restored from your previous session.", {
          action: { label: "Discard", onClick: () => { setReason(""); setEvidence(""); clearDraft(); } },
          duration: 8000,
        });
      }
    }
    setShowForm(!showForm);
  };

  // Save draft on every change
  const handleReasonChange = (val: string) => {
    setReason(val);
    saveDraft({ reason: val, evidence });
  };
  const handleEvidenceChange = (val: string) => {
    setEvidence(val);
    saveDraft({ reason, evidence: val });
  };

  const { data: disputes, loading, refetch } = useDataFetch(
    async () => {
      const { data, error } = await supabase
        .from("disputes")
        .select("*")
        .eq("match_id", matchId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as Dispute[]) || [];
    },
    { deps: [matchId], errorMessage: false }
  );

  const { run: handleSubmit, loading: submitting } = useAsyncAction(
    async () => {
      if (!reason.trim() || !user) return;
      const { error } = await supabase.from("disputes").insert({
        match_id: matchId,
        raised_by_org_id: orgId,
        raised_by_user_id: user.id,
        reason: reason.trim(),
        evidence_notes: evidence.trim() || null,
      });
      if (error) throw error;
      setReason("");
      setEvidence("");
      clearDraft();
      setShowForm(false);
      refetch();
    },
    { successMessage: "Dispute raised successfully" }
  );

  const handleSubmitClick = () => {
    if (!reason.trim()) return;
    setShowConfirmDialog(true);
  };

  const confirmAndSubmit = () => {
    setShowConfirmDialog(false);
    handleSubmit();
  };

  // Dispute action handler (withdraw / resolve / escalate)
  const handleDisputeAction = async () => {
    if (!actionDispute || !actionType || !actionNotes.trim() || !user) return;
    setActionSubmitting(true);
    try {
      const updateFields: Record<string, unknown> = {
        status: actionType,
      };
      if (actionType === "resolved") {
        updateFields.resolution_outcome = actionNotes.trim();
        updateFields.resolved_at = new Date().toISOString();
        updateFields.resolved_by = user.id;
      }

      const { error } = await supabase
        .from("disputes")
        .update(updateFields)
        .eq("id", actionDispute.id)
        .eq("raised_by_org_id", orgId); // Only allow the raising org to act

      if (error) throw error;

      // Audit log
      await supabase.from("audit_logs").insert({
        org_id: orgId,
        actor_user_id: user.id,
        action: `dispute.${actionType}`,
        entity_type: "dispute",
        entity_id: actionDispute.id,
        metadata: {
          match_id: matchId,
          previous_status: actionDispute.status,
          new_status: actionType,
          notes: actionNotes.trim(),
        },
      });

      toast.success(
        actionType === "resolved"
          ? "Dispute resolved. Settlement may now proceed."
          : actionType === "escalated"
          ? "Dispute escalated for senior review."
          : `Dispute status updated to ${actionType}.`
      );
      setActionDispute(null);
      setActionType("");
      setActionNotes("");
      setShowActionConfirm(false);
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to update dispute", { description: message });
    } finally {
      setActionSubmitting(false);
    }
  };

    open: { 
      badge: <Badge variant="destructive">Open</Badge>,
      help: "This dispute has been raised and is awaiting review. Settlement is paused until it is resolved."
    },
    under_review: { 
      badge: <Badge variant="secondary">Under Review</Badge>,
      help: "A reviewer is investigating this dispute. You will be notified when a decision is reached."
    },
    resolved: { 
      badge: <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-400">Resolved</Badge>,
      help: "This dispute has been resolved. See the resolution details below."
    },
    escalated: { 
      badge: <Badge variant="destructive">Escalated</Badge>,
      help: "This dispute has been escalated for senior review. Contact support@izenzo.co.za if you need an update."
    },
  };

  const getStatusBadge = (status: string) => {
    const info = statusInfo[status];
    if (!info) return <Badge variant="outline">{status}</Badge>;
    return info.badge;
  };

  const getStatusHelp = (status: string) => {
    return statusInfo[status]?.help || "";
  };

  if (loading) {
    return <InlineLoader />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />Disputes
        </h3>
        <Button variant="outline" size="sm" onClick={handleOpenForm}>
          <Plus className="h-4 w-4 mr-1" />{showForm ? "Cancel" : "Raise Dispute"}
        </Button>
      </div>

      {showForm && (
        <Card className="border-destructive/20">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Raise a Dispute</CardTitle>
            <CardDescription>
              Disputes will freeze settlement until resolved. Provide clear reasons and evidence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Reason for Dispute</Label>
              <Textarea
                value={reason}
                onChange={(e) => handleReasonChange(e.target.value)}
                placeholder="Describe the issue in detail..."
                className="min-h-[80px]"
                aria-label="Dispute reason"
              />
            </div>
            <div className="space-y-2">
              <Label>Supporting Evidence (optional)</Label>
              <Textarea
                value={evidence}
                onChange={(e) => handleEvidenceChange(e.target.value)}
                placeholder="Reference document IDs, communications, or specific discrepancies..."
                aria-label="Evidence notes"
              />
            </div>
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Raising a dispute will notify the counterparty and may freeze settlement. This action is logged in the audit trail.
              </AlertDescription>
            </Alert>
            <LoadingButton
              variant="destructive"
              onClick={handleSubmitClick}
              loading={submitting}
              disabled={!reason.trim()}
              icon={<ShieldAlert className="h-4 w-4" />}
              loadingText="Submitting…"
            >
              Review &amp; Submit Dispute
            </LoadingButton>
          </CardContent>
        </Card>
      )}

      {(!disputes || disputes.length === 0) ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No disputes raised for this match.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {disputes.map((d) => (
            <Card key={d.id}>
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  {getStatusBadge(d.status)}
                  <span className="text-xs text-muted-foreground">{format(new Date(d.created_at), "dd MMM yyyy HH:mm")}</span>
                </div>
                {getStatusHelp(d.status) && (
                  <p className="text-xs text-muted-foreground italic">{getStatusHelp(d.status)}</p>
                )}
                <p className="text-sm font-medium">{d.reason}</p>
                {d.evidence_notes && <p className="text-sm text-muted-foreground">{d.evidence_notes}</p>}
                {d.status === "resolved" && (
                  <div className="bg-muted rounded p-3 text-sm space-y-2">
                    <p className="font-medium">Resolution</p>
                    {d.resolution_outcome ? (
                      <>
                        <p>{d.resolution_outcome}</p>
                        {d.resolved_at && (
                          <p className="text-xs text-muted-foreground">
                            Resolved on {format(new Date(d.resolved_at), "dd MMM yyyy")}
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="space-y-1.5">
                        <p>
                          This dispute was marked as resolved
                          {d.resolved_at
                            ? ` on ${format(new Date(d.resolved_at), "dd MMM yyyy")}`
                            : ""}
                          , but no written explanation was recorded.
                        </p>
                        <p className="text-muted-foreground">
                          What this means: the dispute is closed and settlement may proceed, but we cannot confirm whether it was upheld, rejected, or withdrawn.
                        </p>
                        <p className="text-muted-foreground">
                          If you need clarification, contact{" "}
                          <a href="mailto:support@izenzo.co.za" className="text-primary hover:underline">support@izenzo.co.za</a>{" "}
                          and reference dispute #{d.id.slice(0, 8)}.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dispute confirmation dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm dispute submission</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>You are about to raise a dispute on this match. Please review before submitting:</p>
              <div className="rounded-md border border-border p-3 space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Reason:</span>
                  <p className="font-medium mt-0.5">{reason}</p>
                </div>
                {evidence.trim() && (
                  <div>
                    <span className="text-muted-foreground">Evidence:</span>
                    <p className="mt-0.5">{evidence}</p>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                This will notify the counterparty and may freeze settlement until the dispute is resolved. This action is logged in the audit trail.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back and edit</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAndSubmit} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Submit Dispute
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
