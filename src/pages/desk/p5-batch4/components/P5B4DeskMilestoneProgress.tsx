/**
 * P-5 Batch 4 Stage 5 — milestone progress for the org-user surface.
 *
 * Shows a progress bar (completed / total) and the canonical
 * milestone path with the user-safe status labels. Read-only — only
 * the platform admin completes milestones. Org users see status and
 * which step is current.
 */
import { Progress } from "@/components/ui/progress";
import { P5B4DeskStatusBadge } from "./P5B4DeskStatusBadge";
import type { P5B4OrgUserMilestone } from "@/lib/p5-batch4/org-user-client";

export interface P5B4DeskMilestoneProgressProps {
  milestones: P5B4OrgUserMilestone[];
  currentMilestoneKey: string | null;
}

export function P5B4DeskMilestoneProgress({
  milestones,
  currentMilestoneKey,
}: P5B4DeskMilestoneProgressProps) {
  const sorted = [...milestones].sort((a, b) => a.sort_order - b.sort_order);
  const total = sorted.length;
  const completed = sorted.filter(
    (m) =>
      m.milestone_status === "complete" ||
      m.milestone_status === "waived" ||
      m.milestone_status === "not_applicable",
  ).length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <section
      className="space-y-3 rounded-md border border-border bg-card p-4"
      data-testid="p5b4-desk-milestone-progress"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Case progress</h2>
        <span
          className="text-xs text-muted-foreground"
          data-testid="p5b4-desk-progress-fraction"
        >
          {completed}/{total} steps · {pct}%
        </span>
      </header>
      <Progress value={pct} aria-label="Case progress" />
      <ol className="space-y-2">
        {sorted.map((m) => {
          const isCurrent = m.milestone_key === currentMilestoneKey;
          return (
            <li
              key={m.id}
              data-testid="p5b4-desk-milestone-row"
              data-key={m.milestone_key}
              data-current={isCurrent || undefined}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {m.milestone_name}
                  {isCurrent ? (
                    <span className="ml-2 text-xs font-normal text-primary">
                      Current step
                    </span>
                  ) : null}
                </span>
                {m.milestone_status === "overdue" && m.overdue_label ? (
                  <span className="text-xs text-destructive">{m.overdue_label}</span>
                ) : null}
              </div>
              <P5B4DeskStatusBadge kind="milestone" value={m.milestone_status} />
            </li>
          );
        })}
        {sorted.length === 0 ? (
          <li className="text-sm text-muted-foreground">No steps yet.</li>
        ) : null}
      </ol>
    </section>
  );
}
