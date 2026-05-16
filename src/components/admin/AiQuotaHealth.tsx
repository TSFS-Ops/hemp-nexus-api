/**
 * AiQuotaHealth — Batch F admin tile.
 * Surfaces per-org AI provider cooldown state and daily call meter so
 * platform admins can see when AI is rate-limited / quota-exhausted.
 * Renders empty data as "no signal" rather than green.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertTriangle } from "lucide-react";

interface ProviderState {
  org_id: string;
  provider: string;
  cooldown_until: string | null;
  last_status: string | null;
  last_status_code: number | null;
  last_error: string | null;
  updated_at: string;
}
interface MeterRow {
  org_id: string;
  call_type: string;
  day: string;
  count: number;
}

export function AiQuotaHealth() {
  const { data: states } = useQuery<ProviderState[]>({
    queryKey: ["ai-provider-state"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_provider_state" as any)
        .select("org_id, provider, cooldown_until, last_status, last_status_code, last_error, updated_at")
        .order("updated_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as ProviderState[];
    },
    refetchInterval: 60000,
  });

  const { data: meters } = useQuery<MeterRow[]>({
    queryKey: ["ai-call-meter-today"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("ai_call_meter" as any)
        .select("org_id, call_type, day, count")
        .eq("day", today)
        .order("count", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as MeterRow[];
    },
    refetchInterval: 60000,
  });

  const now = Date.now();
  const activeCooldowns = (states ?? []).filter(
    (s) => s.cooldown_until && new Date(s.cooldown_until).getTime() > now,
  );
  const monitored = states?.length ?? 0;
  const meterRows = meters ?? [];

  return (
    <Card data-testid="ai-quota-health-tile">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-muted-foreground" />
              AI Provider Quota &amp; Cooldown
            </CardTitle>
            <CardDescription>
              Per-org Lovable AI Gateway state. Cooldowns from 429s; daily meter from
              <code className="mx-1">ai_call_meter</code>.
            </CardDescription>
          </div>
          <Badge variant={activeCooldowns.length > 0 ? "destructive" : monitored === 0 ? "secondary" : "default"}>
            {monitored === 0
              ? "no signal"
              : activeCooldowns.length > 0
              ? `${activeCooldowns.length} cooldown${activeCooldowns.length > 1 ? "s" : ""}`
              : "clear"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {activeCooldowns.length === 0 && monitored === 0 && (
          <p className="text-xs text-muted-foreground">
            No AI calls recorded yet. Tile will populate once orgs invoke AI-backed features.
          </p>
        )}
        {activeCooldowns.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Active cooldowns
            </div>
            <ul className="space-y-1">
              {activeCooldowns.slice(0, 10).map((s) => (
                <li key={`${s.org_id}-${s.provider}`} className="flex items-center gap-2 text-xs">
                  <AlertTriangle className="h-3 w-3 text-amber-600" />
                  <span className="font-mono">{s.org_id.slice(0, 8)}</span>
                  <span className="text-muted-foreground">
                    {s.last_status ?? "rate_limited"} ({s.last_status_code ?? "?"})
                  </span>
                  <span className="text-muted-foreground">
                    until {new Date(s.cooldown_until!).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Today's top callers
          </div>
          {meterRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No AI calls today.</p>
          ) : (
            <ul className="space-y-1">
              {meterRows.slice(0, 10).map((m) => (
                <li key={`${m.org_id}-${m.call_type}`} className="flex items-center justify-between text-xs">
                  <span className="font-mono">{m.org_id.slice(0, 8)} · {m.call_type}</span>
                  <span className="font-medium">{m.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
