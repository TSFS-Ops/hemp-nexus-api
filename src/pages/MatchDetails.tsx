import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Loader2, Info, FileText, Shield, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { MatchTimeline } from "@/components/MatchTimeline";
import { MatchDocuments } from "@/components/match/MatchDocuments";
import { ProofDocumentsList } from "@/components/match/ProofDocumentsList";
import { WadModule } from "@/components/wad/WadModule";
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
  const [searchParams] = useSearchParams();
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [activeTab, setActiveTab] = useState("details");

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
    if (!match || confirming) return;

    try {
      setConfirming(true);
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
        let errorMessage = "Failed to confirm intent";
        try {
          const error = await response.json();
          if (response.status === 401) {
            errorMessage = "Please sign in to confirm intent.";
          } else if (response.status === 402) {
            errorMessage = "Insufficient credits. Please purchase credits on the Billing page to continue.";
          } else if (response.status === 403) {
            errorMessage = "You do not have permission. Please create an account or contact support.";
          } else {
            errorMessage = error.error || error.message || errorMessage;
          }
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      toast.success("Intent confirmed successfully! Redirecting to logs...");
      
      // Navigate to logs page to show proof
      setTimeout(() => {
        navigate("/dashboard?section=logs");
      }, 1000);
    } catch (error: any) {
      console.error("Error confirming intent:", error);
      toast.error(error.message || "Failed to confirm intent");
    } finally {
      setConfirming(false);
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

  const isSettled = match.status === "settled";

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
                <Badge variant={isSettled ? "default" : "secondary"}>
                  {isSettled ? "CONFIRMED" : "MATCHED"}
                </Badge>
                <span className="text-sm text-muted-foreground font-mono">
                  {match.hash.substring(0, 8)}...
                </span>
              </div>
            </div>
            {isSettled && (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-medium">Intent Confirmed</span>
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

          {/* Show documents directly on proof page when settled */}
          {isSettled && (
            <>
              <Separator className="my-6" />
              <ProofDocumentsList matchId={match.id} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Tabbed sections for Documents, WaD, and Timeline */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="details" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="wad" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            WaD
          </TabsTrigger>
          <TabsTrigger value="timeline" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Timeline
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4 space-y-4">
          <MatchDocuments matchId={match.id} orgId={match.org_id} />
          
          {/* Confirm Intent button below documents - only for unconfirmed matches */}
          {!isSettled && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h4 className="font-semibold">Ready to Confirm Intent?</h4>
                    <p className="text-sm text-muted-foreground">
                      Upload any supporting documents above first. 500 credits will be deducted. No legal obligation is created.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      onClick={handleSettle} 
                      disabled={confirming}
                      size="lg"
                    >
                      {confirming ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Confirming...
                        </>
                      ) : (
                        "Confirm Intent"
                      )}
                    </Button>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>Confirms your intent and burns 500 credits. This creates an immutable proof record that will appear in your logs.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="wad" className="mt-4">
          <WadModule match={match} onWadCreated={fetchMatch} />
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <MatchTimeline matchId={match.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
