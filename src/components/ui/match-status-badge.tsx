/**
 * MatchStatusBadge — Canonical badge for match statuses.
 *
 * Replaces the repeated pattern of:
 *   <StatusBadge status={MatchState.isSettled(match.status) ? "confirmed" : match.status} />
 *
 * Centralises the settled→confirmed mapping so consumers never need to know about it.
 *
 * Usage:
 *   <MatchStatusBadge status={match.status} />
 */

import * as MatchState from "@/lib/match-state";
import { StatusBadge } from "@/components/ui/status-badge";

interface MatchStatusBadgeProps {
  status: string;
  className?: string;
}

export function MatchStatusBadge({ status, className }: MatchStatusBadgeProps) {
  const displayStatus = MatchState.isSettled(status) ? "confirmed" : status;
  const label = MatchState.statusLabel(status);

  return <StatusBadge status={displayStatus} label={label} className={className} />;
}
