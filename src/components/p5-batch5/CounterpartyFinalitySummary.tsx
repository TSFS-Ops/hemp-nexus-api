/**
 * P-5 Batch 5 — Phase 5
 * Counterparty / Applicant finality summary.
 *
 * Displays the minimum a counterparty/applicant may see about a finality
 * record. Hides internal ratings logic, other counterparties, funder
 * notes, full Memory history and raw scoring logic.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  P5B5_FINALITY_STATUS_LABELS,
  type P5B5CorrectionStatus,
  type P5B5DisputeStatus,
  type P5B5EvidenceCompletenessStatus,
  type P5B5FinalityStatus,
  type P5B5FinalOutcomeCode,
  type P5B5ProviderDependencyStatus,
} from "@/lib/p5-batch5/outcomes";
import { P5B5_APPROVED_PHRASES, P5B5_APPROVED_TOOLTIPS } from "@/lib/p5-batch5/wording";
import { canPerformFinalityAction, type P5B5PermissionContext, type P5B5Role } from "@/lib/p5-batch5/permissions";
import P5B5WarningBanners from "./WarningBanners";

export interface P5B5CounterpartyFinalitySummaryProps {
  role: P5B5Role;
  context?: P5B5PermissionContext;
  data: {
    finality_status: P5B5FinalityStatus;
    final_outcome_code: P5B5FinalOutcomeCode | null;
    final_outcome_label: string | null;
    evidence_completeness_status: P5B5EvidenceCompletenessStatus | null;
    dispute_status: P5B5DisputeStatus;
    correction_status: P5B5CorrectionStatus;
    provider_dependency_status: P5B5ProviderDependencyStatus | null;
    own_evidence_summary: string | null;
    finality_summary: string | null;
  };
  onRequestDisputeOrCorrection?: () => void;
}

export function CounterpartyFinalitySummary({
  role,
  context,
  data,
  onRequestDisputeOrCorrection,
}: P5B5CounterpartyFinalitySummaryProps) {
  const canRequest = canPerformFinalityAction(role, "mark_dispute", context);

  return (
    <Card data-p5b5-counterparty-summary>
      <CardHeader>
        <CardTitle className="text-base">Finality summary</CardTitle>
        <CardDescription title={P5B5_APPROVED_TOOLTIPS.WHAT_IS_FINALITY}>
          {P5B5_APPROVED_PHRASES.EVIDENCE_BASIS}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <P5B5WarningBanners input={data} />

        <div className="grid grid-cols-2 gap-2 text-xs">
          <Stat label="Status" value={P5B5_FINALITY_STATUS_LABELS[data.finality_status]} />
          <Stat label="Outcome" value={data.final_outcome_label ?? data.final_outcome_code ?? "—"} />
          <Stat label="Evidence" value={data.evidence_completeness_status ?? "—"} />
          <Stat label="Dispute" value={data.dispute_status} />
          <Stat label="Correction" value={data.correction_status} />
        </div>

        {data.own_evidence_summary && (
          <p className="text-sm">
            <span className="font-medium">Your submitted evidence: </span>
            {data.own_evidence_summary}
          </p>
        )}
        {data.finality_summary && (
          <p className="text-sm">
            <span className="font-medium">Shared finality summary: </span>
            {data.finality_summary}
          </p>
        )}

        {canRequest && onRequestDisputeOrCorrection && (
          <div>
            <Button variant="outline" size="sm" onClick={onRequestDisputeOrCorrection}>
              Request dispute or correction
            </Button>
          </div>
        )}

        <div className="text-[11px] text-muted-foreground">
          <Badge variant="outline">Counterparty view</Badge> Internal scoring logic, funder
          and platform notes are not shown here.
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}

export default CounterpartyFinalitySummary;
