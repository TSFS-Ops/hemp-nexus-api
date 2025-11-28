import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Award, Star, TrendingUp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ReputationBadgeProps {
  orgId: string;
  showDetails?: boolean;
}

export function ReputationBadge({ orgId, showDetails = false }: ReputationBadgeProps) {
  const { data: reputation } = useQuery({
    queryKey: ["reputation", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reputation_scores")
        .select("*")
        .eq("org_id", orgId)
        .single();
      
      if (error && error.code !== "PGRST116") throw error;
      return data;
    },
  });

  if (!reputation) {
    return (
      <Badge variant="secondary" className="gap-1">
        <Star className="h-3 w-3" />
        New
      </Badge>
    );
  }

  const getLevelColor = (level: string) => {
    switch (level) {
      case "platinum":
        return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      case "gold":
        return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      case "silver":
        return "bg-gray-400/10 text-gray-400 border-gray-400/20";
      case "bronze":
        return "bg-orange-500/10 text-orange-500 border-orange-500/20";
      default:
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    }
  };

  const getLevelIcon = (level: string) => {
    if (level === "platinum" || level === "gold") {
      return <Award className="h-3 w-3" />;
    }
    return <Star className="h-3 w-3" />;
  };

  const tooltipContent = (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-4">
        <span>Overall Score:</span>
        <span className="font-semibold">{reputation.overall_score?.toFixed(1) || 0}/100</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span>Reliability:</span>
        <span>{reputation.reliability_score?.toFixed(1) || 0}/100</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span>Responsiveness:</span>
        <span>{reputation.responsiveness_score?.toFixed(1) || 0}/100</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span>Completion Rate:</span>
        <span>{reputation.completion_score?.toFixed(1) || 0}/100</span>
      </div>
      <div className="border-t pt-2 mt-2">
        <div className="flex items-center justify-between gap-4">
          <span>Total Matches:</span>
          <span className="font-semibold">{reputation.total_matches_completed}</span>
        </div>
        {reputation.avg_response_time_seconds && (
          <div className="flex items-center justify-between gap-4">
            <span>Avg Response:</span>
            <span>{Math.round(reputation.avg_response_time_seconds / 60)}min</span>
          </div>
        )}
      </div>
    </div>
  );

  if (showDetails) {
    return (
      <div className="flex items-center gap-2 p-3 border rounded-lg bg-card">
        <TrendingUp className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <p className="text-sm font-medium">Reputation Score</p>
          <p className="text-2xl font-bold">{reputation.overall_score?.toFixed(1) || 0}</p>
        </div>
        <Badge className={getLevelColor(reputation.reputation_level)}>
          <span className="flex items-center gap-1">
            {getLevelIcon(reputation.reputation_level)}
            {reputation.reputation_level}
          </span>
        </Badge>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className={getLevelColor(reputation.reputation_level)}>
            <span className="flex items-center gap-1">
              {getLevelIcon(reputation.reputation_level)}
              {reputation.reputation_level}
              <span className="ml-1">({reputation.overall_score?.toFixed(0) || 0})</span>
            </span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
