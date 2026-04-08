/**
 * PoiEventsTimeline - Displays the Intent state transition history for a match.
 * Fetches from poi_events table, ordered chronologically.
 */

import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GitBranch, ArrowRight, User, Clock } from "lucide-react";
import { format } from "date-fns";

interface PoiEventsTimelineProps {
  matchId: string;
}

const STATE_COLORS: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  ELIGIBLE: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  COMPLETION_REQUESTED: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  ANNULLED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  EXPIRED: "bg-muted text-muted-foreground",
  REJECTED: "bg-destructive/10 text-destructive",
};

export function PoiEventsTimeline({ matchId }: PoiEventsTimelineProps) {
  const { data: events, isLoading, isError } = useQuery({
    queryKey: ["poi-events", matchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("poi_events")
        .select("id, from_state, to_state, actor_user_id, reason, created_at")
        .eq("match_id", matchId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data || [];
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Failed to load POI activity log.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          POI Activity Log
        </CardTitle>
        <CardDescription className="text-xs">
          Trade Request state transitions for this match
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!events || events.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No POI transitions recorded yet.
          </p>
        ) : (
          <div className="space-y-0">
            {events.map((event, index) => (
              <div key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                {/* Vertical connector line */}
                {index < events.length - 1 && (
                  <div className="absolute left-[9px] top-5 bottom-0 w-px bg-border" />
                )}

                {/* Dot */}
                <div className="relative z-10 mt-1 h-[18px] w-[18px] shrink-0 rounded-full border-2 border-primary bg-background" />

                {/* Content */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${STATE_COLORS[event.from_state] || ""}`}>
                      {event.from_state}
                    </Badge>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${STATE_COLORS[event.to_state] || ""}`}>
                      {event.to_state}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(event.created_at), "dd MMM yyyy, HH:mm")}
                    </span>
                    {event.actor_user_id && (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        <span className="font-mono truncate max-w-[80px]">
                          {event.actor_user_id.substring(0, 8)}…
                        </span>
                      </span>
                    )}
                  </div>

                  {event.reason && (
                    <p className="text-xs text-muted-foreground italic">
                      "{event.reason}"
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
