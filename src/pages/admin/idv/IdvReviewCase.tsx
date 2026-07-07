/**
 * Batch V-UI -- Admin IDV manual-review case detail.
 *
 * Renders safe context and records a decision via the existing
 * `idv-manual-review` edge function.
 *
 * Batch V-UI-Fix-4: "Current status" now reads from the gate-readable
 * `p5scr_idv_records` table (what the user widget and every
 * controlled-action gate actually read) instead of `p5scr_check_results`,
 * which nothing in the person-IDV flow writes to. The post-decision
 * status shown after saving is now the `projected_gate_state` returned
 * by `idv-manual-review` itself, rather than a client-side guess -- so
 * the admin always sees the same state the gate/user will see.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { idvSafeLabel } from "@/components/idv/idv-status-labels";

type Decision =
  | "manual_review_accepted"
  | "manual_review_rejected"
  | "more_information_required"
  | "alternative_document_required"
  | "provider_retry_required"
  | "blocked_pending_admin_decision"
  | "waived_with_reason";

const DECISIONS: Array<{ value: Decision; label: string }> = [
  { value: "manual_review_accepted", label: "Manual review accepted" },
  { value: "manual_review_rejected", label: "Manual review rejected" },
  { value: "more_information_required", label: "More information required" },
  { value: "alternative_document_required", label: "Alternative document required" },
  { value: "provider_retry_required", label: "Provider retry required" },
  { value: "blocked_pending_admin_decision", label: "Blocked pending admin decision" },
  { value: "waived_with_reason", label: "Waived with reason (policy)" },
];

export function IdvReviewCase({ subjectId, onBack }: { subjectId: string; onBack: () => void }) {
  const [decision, setDecision] = useState<Decision>("manual_review_accepted");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [latest, setLatest] = useState<{ state: string; provider_ref: string | null } | null>(null);
  const [subjectLabel, setSubjectLabel] = useState<string | null>(null);
  const [postDecisionStatus, setPostDecisionStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: subj } = await supabase
        .from("p5scr_subjects")
        .select("display_label")
        .eq("id", subjectId)
        .maybeSingle();
      setSubjectLabel((subj?.display_label as string) ?? null);
      // Batch V-UI-Fix-4: read the gate-readable status, not
      // p5scr_check_results (which nothing in this flow writes to).
      const { data: record } = await supabase
        .from("p5scr_idv_records")
        .select("state, provider_ref")
        .eq("subject_id", subjectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setLatest(
        record
          ? { state: (record.state as string), provider_ref: (record.provider_ref as string) ?? null }
          : null,
      );
    })();
  }, [subjectId]);

  async function submit() {
    if (!note.trim()) {
      toast.error("Please add an admin note before saving the decision");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("idv-manual-review", {
        body: {
          subject_id: subjectId,
          decision,
          decision_reason: note.trim(),
          reason: note.trim(),
          provider_status: latest?.state ?? null,
        },
      });
      if (error) {
        toast.error("Failed to save decision");
        return;
      }
      // Batch V-UI-Fix-4: use the server-projected gate state (the same
      // value written to p5scr_idv_records) instead of guessing it on
      // the client, so the admin never sees a status that could drift
      // from what the gate/user actually reads.
      const projected = (data as { projected_gate_state?: string } | null)?.projected_gate_state ?? null;
      setPostDecisionStatus(projected);
      toast.success("Decision recorded");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Manual review case</h1>
        <Button variant="ghost" onClick={onBack}>Back to queue</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Person context</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Person:</span>{" "}
            <span className="font-medium">{subjectLabel ?? subjectId.slice(0, 8)}</span>
          </div>
          {latest && (
            <>
              <div>
                <span className="text-muted-foreground">Current status:</span>{" "}
                <Badge variant="secondary">{idvSafeLabel(latest.state).label}</Badge>
              </div>
              {latest.provider_ref && (
                <div className="text-xs text-muted-foreground">
                  Provider ref: {latest.provider_ref}
                </div>
              )}
            </>
          )}
          <div className="text-xs text-muted-foreground">
            This decision applies to the representative only. It does not
            change the company, funder or API readiness status.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decision</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Decision</Label>
            <Select value={decision} onValueChange={(v) => setDecision(v as Decision)}>
              <SelectTrigger data-testid="idv-review-decision"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DECISIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Admin note</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Reason for this decision"
              data-testid="idv-review-note"
              maxLength={1024}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={submit} disabled={submitting} data-testid="idv-review-save">
              {submitting ? "Saving…" : "Save decision"}
            </Button>
          </div>
          {postDecisionStatus && (
            <div className="rounded border p-3 text-sm" data-testid="idv-review-post-status">
              New status: <Badge variant="secondary">{idvSafeLabel(postDecisionStatus).label}</Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
