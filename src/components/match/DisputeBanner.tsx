/**
 * DisputeBanner — Prominent alert shown on the Details tab when
 * an open or escalated dispute exists on the match.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

interface DisputeBannerProps {
  matchId: string;
  onNavigateToDisputes: () => void;
}

interface ActiveDispute {
  id: string;
  status: string;
  reason: string;
  created_at: string;
}

export function DisputeBanner({ matchId, onNavigateToDisputes }: DisputeBannerProps) {
  const [disputes, setDisputes] = useState<ActiveDispute[]>([]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("disputes")
      .select("id, status, reason, created_at")
      .eq("match_id", matchId)
      .in("status", ["open", "escalated", "under_review"])
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled && data && data.length > 0) {
          setDisputes(data as ActiveDispute[]);
        }
      });
    return () => { cancelled = true; };
  }, [matchId]);

  if (disputes.length === 0) return null;

  const isEscalated = disputes.some((d) => d.status === "escalated");

  return (
    <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
      <ShieldAlert className="h-4 w-4" />
      <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1">
          <span className="font-medium">
            {disputes.length === 1 ? "An active dispute" : `${disputes.length} active disputes`}
            {isEscalated ? " (escalated)" : ""} on this match.
          </span>
          <span className="text-muted-foreground ml-1">
            Settlement and deal term changes are frozen until resolved.
          </span>
          {disputes.length === 1 && (
            <p className="text-sm mt-1 text-muted-foreground">
              Reason: "{disputes[0].reason.length > 120 ? disputes[0].reason.slice(0, 120) + "…" : disputes[0].reason}"
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onNavigateToDisputes}
          className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10"
        >
          <ShieldAlert className="h-3.5 w-3.5 mr-1" />
          View Disputes
        </Button>
      </AlertDescription>
    </Alert>
  );
}
