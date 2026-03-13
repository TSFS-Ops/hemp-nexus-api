import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Shield, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

interface EvidenceChainIndicatorProps {
  matchId: string;
  compact?: boolean;
}

export function EvidenceChainIndicator({ matchId, compact = false }: EvidenceChainIndicatorProps) {
  const { data: status, isLoading } = useQuery({
    queryKey: ["evidence-chain", matchId],
    queryFn: async () => {
      // Use server-side verification via the evidence-pack edge function
      // This ensures chain integrity is validated authoritatively, not client-side
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Authentication required for chain verification");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/evidence-pack/${matchId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        // For non-settled matches or permission errors, fall back to no-evidence state
        if (response.status === 403 || response.status === 404) {
          return { eventCount: 0, chainValid: true, hasIntentConfirmed: false };
        }
        throw new Error("Chain verification request failed");
      }

      const pack = await response.json();
      const chainVerification = pack.chainVerification || { valid: true, eventCount: 0 };
      const timeline = pack.canonical?.timeline || [];

      const hasIntent = timeline.some(
        (e: { event_type: string }) =>
          e.event_type === "intent.confirmed" || e.event_type === "match.settled"
      );

      return {
        eventCount: chainVerification.eventCount,
        chainValid: chainVerification.valid,
        hasIntentConfirmed: hasIntent,
      };
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  if (isLoading) {
    return compact ? (
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    ) : (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading
      </Badge>
    );
  }

  if (!status || status.eventCount === 0) {
    return compact ? (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            <p>No evidence events recorded yet</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <Shield className="h-3 w-3" />
        No Evidence
      </Badge>
    );
  }

  const Icon = status.chainValid ? ShieldCheck : ShieldAlert;
  const variant = status.chainValid ? "default" : "destructive";
  const colorClass = status.chainValid 
    ? "text-green-600" 
    : "text-destructive";

  const tooltipContent = (
    <div className="space-y-1">
      <p className="font-medium">
        {status.chainValid ? "Chain Verified" : "Chain Compromised"}
      </p>
      <p className="text-xs">{status.eventCount} event{status.eventCount !== 1 ? 's' : ''} in chain</p>
      {status.hasIntentConfirmed && (
        <p className="text-xs text-green-600">Intent confirmed</p>
      )}
      {!status.chainValid && (
        <p className="text-xs text-destructive">Hash mismatch detected</p>
      )}
    </div>
  );

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Icon className={`h-4 w-4 ${colorClass}`} />
          </TooltipTrigger>
          <TooltipContent>{tooltipContent}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant={variant} 
            className={`gap-1 cursor-help ${status.chainValid ? 'bg-green-600 hover:bg-green-700' : ''}`}
          >
            <Icon className="h-3 w-3" />
            {status.eventCount} Event{status.eventCount !== 1 ? 's' : ''}
            {status.hasIntentConfirmed && ' ✓'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{tooltipContent}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}