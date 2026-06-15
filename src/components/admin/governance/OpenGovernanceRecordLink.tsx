/**
 * OpenGovernanceRecordLink - HQ-only deep-link to the Governance Record view.
 *
 * Renders null unless the current user is a platform admin and at least one
 * anchor id is supplied. Lives under /hq/governance-records?<param>=<uuid>.
 *
 * Phase 1 only. No mutations, no PDF, no counterparty exposure.
 */

import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export interface OpenGovernanceRecordLinkProps {
  matchId?: string | null;
  poiId?: string | null;
  engagementId?: string | null;
  pendingEngagementId?: string | null;
  tradeRequestId?: string | null;
  variant?: "button" | "inline";
  size?: "sm" | "default";
  label?: string;
  className?: string;
}

function buildHref(p: OpenGovernanceRecordLinkProps): string | null {
  if (p.matchId) return `/hq/governance-records?match=${encodeURIComponent(p.matchId)}`;
  if (p.poiId) return `/hq/governance-records?poi=${encodeURIComponent(p.poiId)}`;
  if (p.engagementId)
    return `/hq/governance-records?engagement=${encodeURIComponent(p.engagementId)}`;
  if (p.pendingEngagementId)
    return `/hq/governance-records?pending_engagement=${encodeURIComponent(p.pendingEngagementId)}`;
  if (p.tradeRequestId)
    return `/hq/governance-records?trade_request=${encodeURIComponent(p.tradeRequestId)}`;
  return null;
}

export function OpenGovernanceRecordLink(props: OpenGovernanceRecordLinkProps) {
  const { isPlatformAdmin } = useAuth();
  const href = buildHref(props);
  if (!isPlatformAdmin || !href) return null;

  const label = props.label ?? "Open Governance Record";

  if (props.variant === "inline") {
    return (
      <Link
        to={href}
        data-testid="open-governance-record-link"
        className={`inline-flex items-center gap-1 text-xs font-mono text-emerald-700 hover:text-emerald-900 underline-offset-2 hover:underline ${props.className ?? ""}`}
      >
        <ShieldCheck className="h-3 w-3" aria-hidden />
        {label}
      </Link>
    );
  }

  return (
    <Button
      asChild
      variant="outline"
      size={props.size ?? "sm"}
      data-testid="open-governance-record-link"
      className={props.className}
    >
      <Link to={href}>
        <ShieldCheck className="h-4 w-4 mr-1.5" aria-hidden />
        {label}
      </Link>
    </Button>
  );
}
