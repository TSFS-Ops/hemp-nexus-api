/**
 * P-5 Batch 3 — Stage 5 funder outcome form.
 *
 * Funder records an outcome. Funder approval is NEVER final; Izenzo admin
 * review is required before any finality impact. One funder's outcome does
 * not change another funder's view. Calls only p5b3SubmitOutcome via wrapper.
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { P5B3_OUTCOME_TYPES, type P5B3OutcomeType } from "@/lib/p5-batch3/constants";
import { p5b3SubmitOutcome } from "@/lib/p5-batch3/rpc";
import { requiresAdminReview } from "@/lib/p5-batch3/outcomes";
import { P5B3FunderShell } from "./components/P5B3FunderShell";

const LABELS: Record<P5B3OutcomeType, string> = {
  interested: "Interested",
  not_interested: "Not Interested / Declined",
  credit_review_pending: "Credit Review Pending",
  conditional_support: "Conditional Support Recorded",
  term_sheet_requested: "Term Sheet Requested",
  term_sheet_provided: "Term Sheet Provided",
  funding_approved_subject_to_admin: "Funding Decision Submitted — Admin Review Required",
  declined: "Declined",
};

export default function P5Batch3FunderOutcomes() {
  const { grantId } = useParams();
  const [outcome, setOutcome] = useState<P5B3OutcomeType>("interested");
  const [conditions, setConditions] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!grantId) return;
    setBusy(true);
    try {
      await p5b3SubmitOutcome({
        p_grant_id: grantId,
        p_outcome_type: outcome,
        p_conditions: conditions.trim() || null,
        p_term_sheet_document_id: null,
      });
      toast.success("Outcome submitted. Izenzo admin will review where required.");
      setConditions("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <P5B3FunderShell
      title="Record an outcome"
      description={`Grant ${grantId ?? ""} — funder decisions are not, by themselves, final.`}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Funder outcome</CardTitle>
          <CardDescription>
            Funder approval is not finality. Izenzo admin review is required before any
            finality or Memory impact is considered. Your decision does not affect any
            other funder's view of this transaction.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Outcome</Label>
            <Select value={outcome} onValueChange={(v) => setOutcome(v as P5B3OutcomeType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {P5B3_OUTCOME_TYPES.map((o) => (
                  <SelectItem key={o} value={o}>{LABELS[o]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {requiresAdminReview(outcome) ? (
              <p className="text-xs text-muted-foreground">
                Admin review required before any finality impact.
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="p5b3-funder-conditions">Conditions / notes (optional)</Label>
            <Textarea
              id="p5b3-funder-conditions"
              rows={4}
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              placeholder="Any conditions attached to this outcome."
            />
          </div>
          <Button onClick={submit} disabled={busy || !grantId}>
            Submit outcome
          </Button>
        </CardContent>
      </Card>
    </P5B3FunderShell>
  );
}
