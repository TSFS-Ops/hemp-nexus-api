import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Info, FileText, Shield, Clock, CheckCircle2, MessageSquare, FileSignature, ShieldAlert } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";
import { apiFetch, isAuthError, isApiError } from "@/lib/api-client";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { MATCH_STATUS } from "@/lib/constants";
import { MatchTimeline } from "@/components/MatchTimeline";
import { MatchDocuments } from "@/components/match/MatchDocuments";
import { ProofDocumentsList } from "@/components/match/ProofDocumentsList";
import { WadModule } from "@/components/wad/WadModule";
import { EvidencePackPanel } from "@/components/match/EvidencePackPanel";
import { MatchNotes } from "@/components/match/MatchNotes";
import { DealTermsPanel } from "@/components/match/DealTermsPanel";
import { DisputePanel } from "@/components/match/DisputePanel";
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
      await apiFetch(`match/${match.id}/settle`, { method: "POST" });
      toast.success("Intent confirmed successfully!");
      fetchMatch();
    } catch (error: any) {
      console.error("Error confirming intent:", error);
      if (isAuthError(error)) {
        toast.error("You must be logged in to confirm intent");
      } else if (isApiError(error, 402)) {
        toast.error("Insufficient credits. Please purchase credits on the Billing page to continue.");
      } else if (isApiError(error, 403)) {
        toast.error("You do not have permission. Please create an account or contact support.");
      } else {
        toast.error(error.message || "Failed to confirm intent");
      }
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return <FullPageLoader />;
  }

  if (!match) {
    return null;
  }

  const isSettled = match.status === MATCH_STATUS.SETTLED;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-4">
        <BackButton fallback="/dashboard/matches" label="Back" />
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

      {/* Tabbed sections */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="details" className="flex items-center gap-1">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Documents</span>
          </TabsTrigger>
          <TabsTrigger value="terms" className="flex items-center gap-1">
            <FileSignature className="h-4 w-4" />
            <span className="hidden sm:inline">Terms</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="flex items-center gap-1">
            <MessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">Notes</span>
          </TabsTrigger>
          <TabsTrigger value="evidence" className="flex items-center gap-1">
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">Evidence</span>
          </TabsTrigger>
          <TabsTrigger value="wad" className="flex items-center gap-1">
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">WaD</span>
          </TabsTrigger>
          <TabsTrigger value="disputes" className="flex items-center gap-1">
            <ShieldAlert className="h-4 w-4" />
            <span className="hidden sm:inline">Disputes</span>
          </TabsTrigger>
          <TabsTrigger value="timeline" className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            <span className="hidden sm:inline">Timeline</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4 space-y-4">
          <MatchDocuments matchId={match.id} orgId={match.org_id} />
          
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

        <TabsContent value="terms" className="mt-4">
          <DealTermsPanel matchId={match.id} orgId={match.org_id} />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <MatchNotes matchId={match.id} orgId={match.org_id} />
        </TabsContent>

        <TabsContent value="evidence" className="mt-4">
          <EvidencePackPanel matchId={match.id} matchStatus={match.status} />
        </TabsContent>

        <TabsContent value="wad" className="mt-4">
          <WadModule match={match} onWadCreated={fetchMatch} />
        </TabsContent>

        <TabsContent value="disputes" className="mt-4">
          <DisputePanel matchId={match.id} orgId={match.org_id} />
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <MatchTimeline matchId={match.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
