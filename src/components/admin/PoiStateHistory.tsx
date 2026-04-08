import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Shield, ArrowRight } from "lucide-react";
import { toast } from "sonner";

interface PoiEvent {
  id: string;
  match_id: string;
  org_id: string;
  from_state: string;
  to_state: string;
  actor_user_id: string | null;
  actor_api_key_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const STATE_COLOURS: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  ELIGIBLE: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  COMPLETION_REQUESTED: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  EXPIRED: "bg-secondary text-secondary-foreground",
  ANNULLED: "bg-destructive/10 text-destructive",
  REJECTED: "bg-destructive/10 text-destructive",
};

export function PoiStateHistory() {
  const [matchId, setMatchId] = useState("");
  const [events, setEvents] = useState<PoiEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const fetchHistory = async () => {
    if (!matchId.trim()) {
      toast.error("Please enter a match ID");
      return;
    }

    setLoading(true);
    setSearched(true);

    try {
      const { data, error } = await supabase
        .from("poi_events")
        .select("*")
        .eq("match_id", matchId.trim())
        .order("created_at", { ascending: true });

      if (error) throw error;
      setEvents((data as unknown as PoiEvent[]) || []);
    } catch (err) {
      console.error("Failed to fetch intent history:", err);
      toast.error("Failed to fetch Intent state history");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Intent State Transition History
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Enter match ID (UUID)"
            value={matchId}
            onChange={(e) => setMatchId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchHistory()}
            className="font-mono text-sm"
            aria-label="Match ID for intent history lookup"
          />
          <Button onClick={fetchHistory} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>

        {searched && events.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No state transitions found for this match.
          </p>
        )}

        {events.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {events.length} transition{events.length !== 1 ? "s" : ""} recorded
            </p>
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

              {events.map((event, index) => (
                <div key={event.id} className="relative pl-10 pb-6 last:pb-0">
                  {/* Timeline dot */}
                  <div className="absolute left-2.5 top-1.5 h-3 w-3 rounded-full border-2 border-primary bg-background" />

                  <div className="rounded-lg border bg-card p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={STATE_COLOURS[event.from_state] || ""} variant="outline">
                        {event.from_state}
                      </Badge>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <Badge className={STATE_COLOURS[event.to_state] || ""} variant="outline">
                        {event.to_state}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-muted-foreground">
                      <div>
                        <span className="font-medium">Timestamp:</span>{" "}
                        {new Date(event.created_at).toLocaleString("en-GB")}
                      </div>
                      <div>
                        <span className="font-medium">Actor:</span>{" "}
                        <span className="font-mono">
                          {event.actor_user_id?.substring(0, 8) || event.actor_api_key_id?.substring(0, 8) || "system"}...
                        </span>
                      </div>
                      {event.reason && (
                        <div className="col-span-full">
                          <span className="font-medium">Reason:</span> {event.reason}
                        </div>
                      )}
                      <div className="col-span-full">
                        <span className="font-medium">Event ID:</span>{" "}
                        <span className="font-mono">{event.id.substring(0, 12)}...</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
