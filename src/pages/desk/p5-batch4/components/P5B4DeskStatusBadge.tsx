/**
 * P-5 Batch 4 Stage 5 — desk-side status badge.
 *
 * Org-user safe rendering. Uses Batch 4 SSOT vocabularies only. The
 * provider-dependent status is substituted with the wording-safe
 * label, never the SSOT-forbidden provider words.
 */
import { cn } from "@/lib/utils";
import {
  P5B4_BLOCKER_STATUSES,
  P5B4_EVIDENCE_STATUSES,
  P5B4_EXECUTION_STATUSES,
  P5B4_MILESTONE_STATUSES,
  P5B4_READINESS_STATUSES,
  type P5B4BlockerStatus,
  type P5B4EvidenceStatus,
  type P5B4ExecutionStatus,
  type P5B4MilestoneStatus,
  type P5B4ReadinessStatus,
} from "@/lib/p5-batch4/constants";
import { P5B4_PROVIDER_DEPENDENT_SAFE_LABEL } from "@/lib/p5-batch4/wording-guard";

type AnyStatus =
  | P5B4ExecutionStatus
  | P5B4ReadinessStatus
  | P5B4MilestoneStatus
  | P5B4BlockerStatus
  | P5B4EvidenceStatus;

const ALLOWED = {
  execution: P5B4_EXECUTION_STATUSES,
  readiness: P5B4_READINESS_STATUSES,
  milestone: P5B4_MILESTONE_STATUSES,
  blocker: P5B4_BLOCKER_STATUSES,
  evidence: P5B4_EVIDENCE_STATUSES,
} as const;

export interface P5B4DeskStatusBadgeProps {
  kind: keyof typeof ALLOWED;
  value: AnyStatus;
}

function tone(value: string): string {
  if (["rejected", "blocked", "escalated", "expired"].includes(value))
    return "bg-destructive/10 text-destructive border-destructive/30";
  if (
    [
      "complete",
      "accepted",
      "resolved",
      "ready_for_finality",
      "approved_to_proceed",
    ].includes(value)
  )
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (["provider_dependent", "more_information_requested", "overdue"].includes(value))
    return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-muted text-foreground border-border";
}

function label(value: string): string {
  if (value === "provider_dependent") return P5B4_PROVIDER_DEPENDENT_SAFE_LABEL;
  return value.replace(/_/g, " ");
}

export function P5B4DeskStatusBadge({ kind, value }: P5B4DeskStatusBadgeProps) {
  if (!(ALLOWED[kind] as readonly string[]).includes(value)) {
    return (
      <span
        data-testid="p5b4-desk-status-badge-invalid"
        className="inline-flex items-center rounded-md border border-destructive/30 bg-destructive/5 px-2 py-0.5 text-xs text-destructive"
      >
        unknown
      </span>
    );
  }
  return (
    <span
      data-testid="p5b4-desk-status-badge"
      data-kind={kind}
      data-value={value}
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
        tone(value),
      )}
    >
      {label(value)}
    </span>
  );
}
