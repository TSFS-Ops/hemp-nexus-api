/**
 * P-5 Batch 4 Stage 5 — next-action callout for the org-user surface.
 *
 * Pure presentation. Derives the next user-visible action from the
 * safe case summary + evidence list returned by the org-user edge
 * function. NO admin-only signals (provider internals, funder data,
 * audit log, finality) are referenced.
 */
import type {
  P5B4OrgUserCaseSummary,
  P5B4OrgUserEvidenceTask,
} from "@/lib/p5-batch4/org-user-client";

export interface P5B4DeskNextActionProps {
  summary: P5B4OrgUserCaseSummary;
  evidence: P5B4OrgUserEvidenceTask[];
}

export function P5B4DeskNextAction({ summary, evidence }: P5B4DeskNextActionProps) {
  const missing = evidence.filter(
    (e) =>
      e.evidence_status === "requested" ||
      e.evidence_status === "rejected" ||
      e.evidence_status === "expired" ||
      e.evidence_status === "more_information_requested",
  );

  let headline = "You're up to date — no action required right now.";
  let detail: string | null = null;

  if (missing.length > 0) {
    headline = `Upload ${missing.length} document${missing.length === 1 ? "" : "s"} to keep this case moving.`;
    detail = missing.map((m) => m.evidence_label).join(" · ");
  } else if (summary.execution_status === "evidence_under_review") {
    headline = "Our team is reviewing your submitted documents.";
  } else if (summary.execution_status === "waiting_for_internal_review") {
    headline = "Internal review in progress.";
  } else if (summary.execution_status === "provider_dependent") {
    headline = "Awaiting a Provider-Dependent confirmation.";
  } else if (summary.execution_status === "blocked") {
    headline = "An item needs to be cleared before this case can continue.";
  } else if (summary.execution_status === "final_approval_pending") {
    headline = "Awaiting final approval.";
  } else if (
    summary.execution_status === "finality_recorded" ||
    summary.execution_status === "closed" ||
    summary.execution_status === "archived"
  ) {
    headline = "This case is complete.";
  }

  return (
    <section
      className="space-y-1 rounded-md border border-primary/30 bg-primary/5 p-4"
      data-testid="p5b4-desk-next-action"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">
        Next action
      </p>
      <p className="text-sm text-foreground" data-testid="p5b4-desk-next-action-headline">
        {headline}
      </p>
      {detail ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="p5b4-desk-next-action-detail"
        >
          {detail}
        </p>
      ) : null}
      {summary.due_at ? (
        <p className="text-xs text-muted-foreground">
          Due {new Date(summary.due_at).toLocaleDateString()}
        </p>
      ) : null}
    </section>
  );
}
