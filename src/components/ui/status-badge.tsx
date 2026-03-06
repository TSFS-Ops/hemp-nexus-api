/**
 * StatusBadge — Single source of truth for status→visual mapping.
 *
 * Replaces 8+ ad-hoc statusBadge/statusColour functions scattered
 * across admin panels and match views.
 *
 * Usage:
 *   <StatusBadge status="active" />
 *   <StatusBadge status="blocked" domain="entity" />
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Semantic colour classes keyed by normalised status string */
const STATUS_STYLES: Record<string, string> = {
  // Success / active
  active: "bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-400",
  confirmed: "bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-400",
  resolved: "bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-400",
  approved: "bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-400",
  settled: "bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-400",
  verified: "bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-400",

  // Warning / pending
  pending: "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400",
  suspended: "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400",
  under_review: "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400",
  expired: "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400",
  open: "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400",

  // Danger / blocked
  blocked: "bg-destructive/10 text-destructive border-destructive/20",
  revoked: "bg-destructive/10 text-destructive border-destructive/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  escalated: "bg-destructive/10 text-destructive border-destructive/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",

  // Neutral
  archived: "bg-muted text-muted-foreground border-muted",
  inactive: "bg-muted text-muted-foreground border-muted",
  draft: "bg-muted text-muted-foreground border-muted",
  matched: "bg-primary/10 text-primary border-primary/20",
};

interface StatusBadgeProps {
  status: string;
  /** Optional label override (default: humanises the status string) */
  label?: string;
  className?: string;
}

function humanise(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const styles = STATUS_STYLES[status.toLowerCase()] ?? "bg-muted text-muted-foreground border-muted";

  return (
    <Badge variant="outline" className={cn(styles, className)}>
      {label ?? humanise(status)}
    </Badge>
  );
}
