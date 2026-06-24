/**
 * P5StatusBadge — Stage 4
 *
 * Renders a P-5 status using the Stage 1 SSOT labels only. Never renders
 * forbidden wording (Verified / Bankable / Cleared / etc.).
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { P5_STATUS_LABELS, type P5Status } from "@/lib/p5-governance/constants";

const TONE: Record<P5Status, string> = {
  not_started: "bg-muted text-muted-foreground border-muted",
  incomplete: "bg-muted text-muted-foreground border-muted",
  submitted: "bg-primary/10 text-primary border-primary/20",
  under_review: "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400",
  more_information_required:
    "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400",
  internally_ready: "bg-primary/10 text-primary border-primary/20",
  provider_dependent: "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400",
  conditional_ready: "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400",
  ready_to_proceed:
    "bg-[hsl(var(--emerald))]/10 text-emerald-700 border-emerald-200 dark:text-emerald-400",
  on_hold: "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400",
  blocked: "bg-destructive/10 text-destructive border-destructive/20",
  escalated: "bg-destructive/10 text-destructive border-destructive/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  waived: "bg-muted text-muted-foreground border-muted",
  override_approved: "bg-muted text-muted-foreground border-muted",
  reopened: "bg-primary/10 text-primary border-primary/20",
  archived_superseded: "bg-muted text-muted-foreground border-muted",
};

export function P5StatusBadge({
  status,
  className,
}: {
  status: P5Status;
  className?: string;
}) {
  const tone = TONE[status] ?? "bg-muted text-muted-foreground border-muted";
  return (
    <Badge variant="outline" className={cn(tone, className)} data-p5-status={status}>
      {P5_STATUS_LABELS[status]}
    </Badge>
  );
}
