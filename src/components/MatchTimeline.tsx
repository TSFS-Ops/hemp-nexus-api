import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Clock, Download, Shield } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

interface MatchEvent {
  id: string;
  event_type: string;
  event_data: Json;
  payload_hash: string;
  previous_event_hash: string | null;
  created_at: string;
}

interface MatchTimelineProps {
  matchId: string;
}

export function MatchTimeline({ matchId }: MatchTimelineProps) {
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [chainValid, setChainValid] = useState<boolean | null>(null);

  useEffect(() => {
    fetchTimeline();
  }, [matchId]);

  const fetchTimeline = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("match_events")
        .select("*")
        .eq("match_id", matchId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      setEvents(data || []);

      // Verify chain integrity
      if (data && data.length > 0) {
        let isValid = true;
        for (let i = 0; i < data.length; i++) {
          const expectedPreviousHash = i === 0 ? null : data[i - 1].payload_hash;
          if (data[i].previous_event_hash !== expectedPreviousHash) {
            isValid = false;
            break;
          }
        }
        setChainValid(isValid);
      }
    } catch (error) {
      console.error("Error fetching timeline:", error);
      toast.error("Failed to load timeline");
    } finally {
      setLoading(false);
    }
  };

  const downloadEvidencePack = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/evidence-pack/${matchId}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) throw new Error("Failed to generate evidence pack");

      const evidencePack = await response.json();
      const blob = new Blob([JSON.stringify(evidencePack, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evidence-pack-${matchId}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("Evidence pack downloaded");
    } catch (error) {
      console.error("Error downloading evidence pack:", error);
      toast.error("Failed to download evidence pack");
    }
  };

  const getEventIcon = (eventType: string) => {
    if (eventType.includes("created")) return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    if (eventType.includes("settled") || eventType.includes("confirmed")) return <CheckCircle2 className="h-5 w-5 text-blue-500" />;
    return <Clock className="h-5 w-5 text-muted-foreground" />;
  };

  const getEventLabel = (eventType: string) => {
    // Map internal event types to user-friendly labels
    const labelMap: Record<string, string> = {
      "match.created": "Match Created",
      "match.settled": "Intent Confirmed",
      "intent.confirmed": "Intent Confirmed",
    };
    
    if (labelMap[eventType]) {
      return labelMap[eventType];
    }
    
    return eventType
      .split(".")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading timeline...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Event Timeline
            </CardTitle>
            <CardDescription>Tamper-evident chain of events for this match</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {chainValid !== null && (
              <Badge variant={chainValid ? "default" : "destructive"} className="gap-1">
                <Shield className="h-3 w-3" />
                {chainValid ? "Chain Verified" : "Chain Compromised"}
              </Badge>
            )}
            <Button onClick={downloadEvidencePack} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Evidence Pack
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No events recorded yet</div>
        ) : (
          <div className="space-y-4">
            {events.map((event, index) => (
              <div key={event.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  {getEventIcon(event.event_type)}
                  {index < events.length - 1 && (
                    <div className="w-px h-full bg-border mt-2" />
                  )}
                </div>
                <div className="flex-1 pb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium">{getEventLabel(event.event_type)}</h4>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(event.created_at), "MMM dd, yyyy HH:mm:ss")}
                      </p>
                    </div>
                    <Badge variant="outline" className="font-mono text-xs">
                      {event.payload_hash.substring(0, 8)}...
                    </Badge>
                  </div>
                  <div className="mt-2 text-sm bg-muted p-3 rounded-lg">
                    <pre className="text-xs overflow-x-auto">
                      {JSON.stringify(event.event_data, null, 2)}
                    </pre>
                  </div>
                  {event.previous_event_hash && (
                    <div className="mt-2 text-xs text-muted-foreground font-mono">
                      Previous: {event.previous_event_hash.substring(0, 16)}...
                    </div>
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
