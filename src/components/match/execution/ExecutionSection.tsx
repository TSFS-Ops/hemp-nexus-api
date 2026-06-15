/**
 * ExecutionSection - post-WaD execution pathway (Item 10 of canonical spine).
 *
 * Renders below MatchHeroCard when a WaD has been ISSUED for this match.
 * Resolves the chain: match.id → p3_wads.poi_id → pods.wad_id, then
 * delegates to ExecutionPanel for milestone management.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ExecutionPanel } from "./ExecutionPanel";

interface Props {
  matchId: string;
}

export function ExecutionSection({ matchId }: Props) {
  const { data: wad, isLoading } = useQuery({
    queryKey: ["execution-wad", matchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("p3_wads")
        .select("id, state, issued_at, org_id")
        .eq("poi_id", matchId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!matchId,
  });

  // Hide entirely until a WaD record exists at all - keeps the page
  // uncluttered for matches that haven't progressed through compliance.
  if (isLoading || !wad) return null;

  const isIssued = wad.state === "ISSUED";

  return (
    <Card id="execution" className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Execution
          </CardTitle>
          <Badge variant={isIssued ? "default" : "outline"} className="text-xs">
            {isIssued ? "WaD issued - ready" : `WaD ${wad.state.toLowerCase()}`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {!isIssued ? (
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <Lock className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              Execution becomes available once the WaD reaches the{" "}
              <span className="font-medium text-foreground">ISSUED</span> state.
              Complete the WaD attestation and sealing steps above to unlock
              milestone tracking and Proof-of-Delivery.
            </p>
          </div>
        ) : (
          <ExecutionPanel wadId={wad.id} matchId={matchId} />
        )}
      </CardContent>
    </Card>
  );
}
