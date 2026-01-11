import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { MatchTimeline } from "@/components/MatchTimeline";
import { MatchDocuments } from "@/components/match/MatchDocuments";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Tables } from "@/integrations/supabase/types";

type Match = Tables<"matches">;

export default function MatchDetails() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (matchId) {
      fetchMatch();
    }
  }, [matchId]);

  const fetchMatch = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        toast.error("Match not found");
        navigate("/dashboard");
        return;
      }

      setMatch(data);
    } catch (error) {
      console.error("Error fetching match:", error);
      toast.error("Failed to load match");
    } finally {
      setLoading(false);
    }
  };

  const handleSettle = async () => {
    if (!match) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in to confirm intent");
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/match/${match.id}/settle`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to confirm intent");
      }

      toast.success("Intent confirmed successfully");
      fetchMatch();
    } catch (error: any) {
      console.error("Error confirming intent:", error);
      toast.error(error.message || "Failed to confirm intent");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!match) {
    return null;
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl mb-2">{match.commodity}</CardTitle>
              <div className="flex items-center gap-2">
              <Badge variant={match.status === "settled" ? "default" : "secondary"}>
                  {match.status === "settled" ? "CONFIRMED" : "MATCHED"}
                </Badge>
                <span className="text-sm text-muted-foreground font-mono">
                  {match.hash.substring(0, 8)}...
                </span>
              </div>
            </div>
            {match.status === "matched" && (
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <Button onClick={handleSettle}>Confirm intent</Button>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>Signals your interest so the seller can prepare final terms. This does not create any contract, payment, or legal obligation.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <p className="text-xs text-muted-foreground text-right max-w-xs">
                  This does not create any legal obligation. It only signals interest so the seller can prepare final terms.
                </p>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-4">Buyer Information</h3>
              <dl className="space-y-2">
                <div>
                  <dt className="text-sm text-muted-foreground">Name</dt>
                  <dd className="font-medium">{match.buyer_name}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">ID</dt>
                  <dd className="font-mono text-sm">{match.buyer_id}</dd>
                </div>
              </dl>
            </div>

            <div>
              <h3 className="font-semibold mb-4">Seller Information</h3>
              <dl className="space-y-2">
                <div>
                  <dt className="text-sm text-muted-foreground">Name</dt>
                  <dd className="font-medium">{match.seller_name}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">ID</dt>
                  <dd className="font-mono text-sm">{match.seller_id}</dd>
                </div>
              </dl>
            </div>
          </div>

          <Separator className="my-6" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h3 className="font-semibold mb-4">Quantity</h3>
              <p className="text-2xl font-bold">
                {match.quantity_amount} <span className="text-base font-normal text-muted-foreground">{match.quantity_unit}</span>
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-4">Price</h3>
              <p className="text-2xl font-bold">
                {match.price_currency} {match.price_amount.toLocaleString()}
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-4">Total Value</h3>
              <p className="text-2xl font-bold">
                {match.price_currency} {(match.price_amount * match.quantity_amount).toLocaleString()}
              </p>
            </div>
          </div>

          {match.terms && (
            <>
              <Separator className="my-6" />
              <div>
                <h3 className="font-semibold mb-2">Terms & Conditions</h3>
                <p className="text-sm text-muted-foreground">{match.terms}</p>
              </div>
            </>
          )}

          {match.metadata && Object.keys(match.metadata).length > 0 && (
            <>
              <Separator className="my-6" />
              <div>
                <h3 className="font-semibold mb-2">Additional Metadata</h3>
                <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto">
                  {JSON.stringify(match.metadata, null, 2)}
                </pre>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <MatchDocuments matchId={match.id} orgId={match.org_id} />

      <MatchTimeline matchId={match.id} />
    </div>
  );
}
