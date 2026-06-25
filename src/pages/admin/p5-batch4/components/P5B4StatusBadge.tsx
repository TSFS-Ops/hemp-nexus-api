/**
 * P-5 Batch 4 Stage 4 — status badge.
 *
 * Renders execution / readiness / milestone / blocker / evidence status
 * using the Batch 4 SSOT vocabularies. Provider-dependent statuses are
 * rendered with the wording-safe label and never as "verified" /
 * "compliant" / "bankable" / "live-provider verified".
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

export interface P5B4StatusBadgeProps {
  kind: "execution" | "readiness" | "milestone" | "blocker" | "evidence";
  value: AnyStatus;
}

const ALLOWED: Record<P5B4StatusBadgeProps["kind"], readonly string[]> = {
  execution: P5B4_EXECUTION_STATUSES,
  readiness: P5B4_READINESS_STATUSES,
  milestone: P5B4_MILESTONE_STATUSES,
  blocker: P5B4_BLOCKER_STATUSES,
  evidence: P5B4_EVIDENCE_STATUSES,
};

function tone(value: string): string {
  if (
    value === "rejected" ||
    value === "blocked" ||
    value === "escalated" ||
    value === "overridden" ||
    value === "expired"
  )
    return "bg-destructive/10 text-destructive border-destructive/30";
  if (
    value === "complete" ||
    value === "accepted" ||
    value === "resolved" ||
    value === "ready_for_finality" ||
    value === "finality_recorded" ||
    value === "approved_to_proceed"
  )
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (value === "provider_dependent" || value === "more_information_requested")
    return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-muted text-foreground border-border";
}

function label(kind: P5B4StatusBadgeProps["kind"], value: string): string {
  if (value === "provider_dependent") return P5B4_PROVIDER_DEPENDENT_SAFE_LABEL;
  return value.replace(/_/g, " ");
}

export function P5B4StatusBadge({ kind, value }: P5B4StatusBadgeProps) {
  if (!ALLOWED[kind].includes(value)) {
    return (
      <span
        data-testid="p5b4-status-badge-invalid"
        className="inline-flex items-center rounded-md border border-destructive/30 bg-destructive/5 px-2 py-0.5 text-xs text-destructive"
      >
        unknown
      </span>
    );
  }
  return (
    <span
      data-testid="p5b4-status-badge"
      data-kind={kind}
      data-value={value}
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
        tone(value),
      )}
    >
      {label(kind, value)}
    </span>
  );
}
