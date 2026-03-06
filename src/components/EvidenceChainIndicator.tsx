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
      const { data: events, error } = await supabase
        .from("match_events")
        .select("id, event_type, payload_hash, previous_event_hash")
        .eq("match_id", matchId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      if (!events || events.length === 0) {
        return { eventCount: 0, chainValid: true, hasIntentConfirmed: false };
      }

      let isValid = true;
      let hasIntent = false;

      for (let i = 0; i < events.length; i++) {
        const expectedPreviousHash = i === 0 ? null : events[i - 1].payload_hash;
        if (events[i].previous_event_hash !== expectedPreviousHash) {
          isValid = false;
        }
        if (events[i].event_type === "intent.confirmed" || events[i].event_type === "match.settled") {
          hasIntent = true;
        }
      }

      return { eventCount: events.length, chainValid: isValid, hasIntentConfirmed: hasIntent };
    },
    staleTime: 5 * 60 * 1000,
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