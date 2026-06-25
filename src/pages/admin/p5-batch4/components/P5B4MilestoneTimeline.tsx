/**
 * P-5 Batch 4 Stage 4 — milestone timeline.
 *
 * Renders the milestone path returned by the Stage 3 edge function in
 * canonical SSOT order. Overdue items render the SSOT-defined
 * overdue_label. Mandatory/conditional/optional badges come from the
 * Batch 4 mandatory_type vocabulary.
 */
import { Button } from "@/components/ui/button";
import { P5B4StatusBadge } from "./P5B4StatusBadge";
import { P5B4ReasonedActionDialog } from "./P5B4ReasonedActionDialog";
import { p5b4Admin } from "@/lib/p5-batch4/rpc";
import type { P5B4AdminMilestone } from "@/lib/p5-batch4/summary-client";

export interface P5B4MilestoneTimelineProps {
  caseId: string;
  milestones: P5B4AdminMilestone[];
  onChanged?: () => void;
}

export function P5B4MilestoneTimeline({
  caseId,
  milestones,
  onChanged,
}: P5B4MilestoneTimelineProps) {
  const sorted = [...milestones].sort((a, b) => a.sort_order - b.sort_order);
  return (
    <ol className="space-y-2" data-testid="p5b4-milestone-timeline">
      {sorted.map((m) => {
        const isOverdue = m.milestone_status === "overdue";
        return (
          <li
            key={m.id}
            data-testid="p5b4-milestone-row"
            data-key={m.milestone_key}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
          >
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {m.milestone_name}
                </span>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {m.mandatory_type}
                </span>
              </div>
              {isOverdue ? (
                <span className="text-xs text-destructive">{m.overdue_label}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <P5B4StatusBadge kind="milestone" value={m.milestone_status} />
              {m.milestone_status !== "complete" &&
              m.milestone_status !== "waived" &&
              m.milestone_status !== "not_applicable" ? (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="p5b4-milestone-complete"
                  onClick={async () => {
                    const { error } = await p5b4Admin.completeMilestone(caseId, m.milestone_key);
                    if (error) throw error;
                    onChanged?.();
                  }}
                >
                  Mark complete
                </Button>
              ) : null}
              <P5B4ReasonedActionDialog
                trigger={
                  <Button size="sm" variant="ghost" data-testid="p5b4-milestone-record-audit">
                    Record note
                  </Button>
                }
                title={`Record audit note: ${m.milestone_name}`}
                description="Adds an internal audit event against this case."
                onConfirm={async (reason) => {
                  const { error } = await p5b4Admin.recordAuditEvent(
                    caseId,
                    `milestone_note_${m.milestone_key}`,
                    `Note recorded for ${m.milestone_name}.`,
                    reason,
                  );
                  if (error) throw error;
                  onChanged?.();
                }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
