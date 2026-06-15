/**
 * PoiEventsTimeline - Intent state transition history for a match.
 *
 * Phase 1 fix (Governance Record): the legacy `poi_events` table is currently
 * empty in production. Actual POI activity is persisted in `audit_logs` and
 * `event_store`. This component now reads all three sources, normalises them
 * into a single shape, dedupes and sorts chronologically.
 *
 * If no events are found in any source we show the no-event copy. We never
 * synthesise fake POI events.
 */

import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GitBranch, ArrowRight, User, Clock } from "lucide-react";
import { format } from "date-fns";
import { NO_EVENT_COPY } from "@/lib/governance/governance-record";

interface PoiEventsTimelineProps {
  matchId: string;
}

interface PoiTimelineRow {
  id: string;
  from_state: string | null;
  to_state: string | null;
  actor_user_id: string | null;
  reason: string | null;
  created_at: string;
  source: "poi_events" | "audit_logs" | "event_store";
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

function dedupe(rows: PoiTimelineRow[]): PoiTimelineRow[] {
  const seen = new Map<string, PoiTimelineRow>();
  const trust: Record<PoiTimelineRow["source"], number> = {
    event_store: 3,
    poi_events: 2,
    audit_logs: 1,
  };
  for (const r of rows) {
    const bucket = Math.floor(new Date(r.created_at).getTime() / 2000);
    const key = `${r.from_state ?? ""}|${r.to_state ?? ""}|${bucket}`;
    const existing = seen.get(key);
    if (!existing || trust[r.source] > trust[existing.source]) {
      seen.set(key, r);
    }
  }
  return Array.from(seen.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

export function PoiEventsTimeline({ matchId }: PoiEventsTimelineProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["poi-events-merged", matchId],
    queryFn: async (): Promise<PoiTimelineRow[]> => {
      const rows: PoiTimelineRow[] = [];

      // 1. Legacy poi_events (may be empty).
      const { data: poiRows, error: e1 } = await supabase
        .from("poi_events")
        .select("id, from_state, to_state, actor_user_id, reason, created_at")
        .eq("match_id", matchId)
        .order("created_at", { ascending: true });
      if (e1) throw e1;
      for (const r of poiRows ?? []) {
        rows.push({
          id: `poi_events:${r.id}`,
          from_state: r.from_state,
          to_state: r.to_state,
          actor_user_id: r.actor_user_id,
          reason: r.reason,
          created_at: r.created_at,
          source: "poi_events",
        });
      }

      // 2. audit_logs entries with metadata->>match_id matching, action LIKE 'poi.%'.
      const { data: auditRows, error: e2 } = await supabase
        .from("audit_logs")
        .select("id, action, metadata, actor_user_id, created_at, entity_id, entity_type")
        .or(`entity_id.eq.${matchId},and(entity_type.eq.match,entity_id.eq.${matchId})`)
        .like("action", "poi.%")
        .order("created_at", { ascending: true })
        .limit(500);
      if (e2) throw e2;
      for (const r of auditRows ?? []) {
        const m = (r.metadata ?? {}) as Record<string, unknown>;
        rows.push({
          id: `audit_logs:${r.id}`,
          from_state: (m.from_state as string) ?? (m.previous_state as string) ?? null,
          to_state: (m.to_state as string) ?? (m.new_state as string) ?? null,
          actor_user_id: r.actor_user_id,
          reason: (m.reason as string) ?? r.action,
          created_at: r.created_at,
          source: "audit_logs",
        });
      }

      // 3. event_store entries with aggregate_id = match_id, event_type LIKE 'poi.%'.
      const { data: esRows, error: e3 } = await supabase
        .from("event_store")
        .select("id, event_type, payload, actor_id, occurred_at, aggregate_id")
        .eq("aggregate_id", matchId)
        .like("event_type", "poi.%")
        .order("occurred_at", { ascending: true })
        .limit(500);
      if (e3) throw e3;
      for (const r of esRows ?? []) {
        const p = (r.payload ?? {}) as Record<string, unknown>;
        rows.push({
          id: `event_store:${r.id}`,
          from_state: (p.from_state as string) ?? (p.previous_state as string) ?? null,
          to_state: (p.to_state as string) ?? (p.new_state as string) ?? null,
          actor_user_id: r.actor_id,
          reason: (p.reason as string) ?? r.event_type,
          created_at: r.occurred_at,
          source: "event_store",
        });
      }

      return dedupe(rows);
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

  const events = data ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          POI Activity Log
        </CardTitle>
        <CardDescription className="text-xs">
          Trade Request state transitions for this match · sources: poi_events · audit_logs · event_store
        </CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-4" data-testid="poi-no-event-copy">
            {NO_EVENT_COPY}
          </p>
        ) : (
          <div className="space-y-0" data-testid="poi-timeline">
            {events.map((event, index) => (
              <div key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                {index < events.length - 1 && (
                  <div className="absolute left-[9px] top-5 bottom-0 w-px bg-border" />
                )}

                <div className="relative z-10 mt-1 h-[18px] w-[18px] shrink-0 rounded-full border-2 border-primary bg-background" />

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {event.from_state && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${STATE_COLORS[event.from_state] || ""}`}>
                        {event.from_state}
                      </Badge>
                    )}
                    {event.from_state && event.to_state && (
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    {event.to_state && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${STATE_COLORS[event.to_state] || ""}`}>
                        {event.to_state}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                      {event.source}
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
                    <p className="text-xs text-muted-foreground italic">"{event.reason}"</p>
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
