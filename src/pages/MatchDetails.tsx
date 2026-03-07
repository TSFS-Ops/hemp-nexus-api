import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Info, FileText, Shield, Clock, CheckCircle2, MessageSquare, FileSignature, ShieldAlert } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { InlineLoader } from "@/components/ui/inline-loader";
import * as MatchState from "@/lib/match-state";
import { MatchStatusBadge } from "@/components/ui/match-status-badge";
import { LoadingButton } from "@/components/ui/loading-button";
import { useAsyncAction } from "@/hooks/use-async-action";
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

// UUID v4 regex — blocks path-traversal and injection via URL param
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function MatchDetails() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("details");
  const mountedRef = useRef(true);

  // SCENARIO 4: Unmount race — track mount state to prevent setState on unmounted component
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // SCENARIO 2: Malicious matchId — validate UUID format before any DB call
  const isValidMatchId = matchId ? UUID_RE.test(matchId) : false;

  const fetchMatch = useCallback(async () => {
    if (!matchId || !UUID_RE.test(matchId)) {
      // SCENARIO 2: Non-UUID matchId — reject immediately, never hits DB
      if (mountedRef.current) {
        setFetchError("Invalid match ID format.");
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);
      setFetchError(null);

      // SCENARIO 1: Network timeout — AbortController with 15s deadline
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .abortSignal(controller.signal)
        .maybeSingle();

      clearTimeout(timeout);

      if (!mountedRef.current) return; // SCENARIO 4: component unmounted during fetch

      if (error) throw error;
      if (!data) {
        toast.error("Match not found");
        navigate("/dashboard");
        return;
      }

      // SCENARIO 5: Corrupt response — verify critical fields exist before storing
      if (!data.id || !data.commodity || typeof data.price_amount !== "number") {
        throw new Error("Received malformed match data from the server.");
      }

      setMatch(data);
    } catch (error: unknown) {
      if (!mountedRef.current) return; // SCENARIO 4

      console.error("Error fetching match:", error);

      // SCENARIO 1: Network / timeout detection
      if (error instanceof DOMException && error.name === "AbortError") {
        setFetchError("Request timed out. Please check your connection and try again.");
        toast.error("Request timed out.");
      } else if (error instanceof TypeError && error.message.includes("fetch")) {
        setFetchError("Network error. You may be offline.");
        toast.error("Network error. Please check your connection.");
      } else {
        const msg = error instanceof Error ? error.message : "Failed to load match";
        setFetchError(msg);
        toast.error(msg);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [matchId, navigate]);

  useEffect(() => {
    if (matchId) {
      fetchMatch();
    }
  }, [matchId, fetchMatch]);

  const { run: handleSettle, loading: confirming } = useAsyncAction(
    async () => {
      if (!match) return;

      // SCENARIO 3: Pre-check session before expensive API call
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Your session has expired. Please sign in again.");
        navigate("/auth");
        return;
      }

      const updated = await apiFetch<Match>(`match/${match.id}/settle`, { method: "POST" });

      // SCENARIO 5: Validate response shape before storing
      if (!updated || !updated.id || !updated.status) {
        throw new Error("Server returned an invalid confirmation response.");
      }

      if (mountedRef.current) {
        setMatch(updated);
        toast.success("Status updated to Confirmed. 500 credits deducted.");
      }
    },
    {
      successMessage: undefined,
      errorMessage: "Failed to confirm intent. Please try again.",
    }
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <BackButton fallback="/dashboard/matches" label="Back" />
        </div>
        <InlineLoader message="Loading match details…" />
      </div>
    );
  }

  // SCENARIO 2 + 1: Show error state with retry for invalid ID, network, or timeout errors
  if (fetchError || !isValidMatchId) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <BackButton fallback="/dashboard/matches" label="Back" />
        </div>
        <div className="text-center py-16 text-muted-foreground">
          <ShieldAlert className="h-10 w-10 mx-auto mb-3 text-destructive" />
          <p className="font-medium">{fetchError || "Invalid match ID"}</p>
          <p className="text-sm mt-1">
            {!isValidMatchId
              ? "The match ID in the URL is not valid."
              : "Something went wrong loading this match."}
          </p>
          {isValidMatchId && (
            <LoadingButton
              onClick={fetchMatch}
              loading={loading}
              variant="outline"
              className="mt-4"
              loadingText="Retrying…"
            >
              Retry
            </LoadingButton>
          )}
        </div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <BackButton fallback="/dashboard/matches" label="Back" />
        </div>
        <div className="text-center py-16 text-muted-foreground">
          <p className="font-medium">Match not found</p>
          <p className="text-sm mt-1">It may have been deleted or you don't have access.</p>
        </div>
      </div>
    );
  }

  const isSettled = MatchState.isSettled(match.status);
  const canConfirm = MatchState.canDo(match.status, "confirm_intent");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton fallback="/dashboard/matches" label="Back" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl mb-2">{match.commodity}</CardTitle>
              <div className="flex items-center gap-2">
                <MatchStatusBadge status={match.status} />
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
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="inline-flex w-auto min-w-full sm:grid sm:w-full sm:grid-cols-8">
            <TabsTrigger value="details" className="flex items-center gap-1.5 min-w-[44px]">
              <Info className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Details</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-1.5 min-w-[44px]">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Documents</span>
            </TabsTrigger>
            <TabsTrigger value="terms" className="flex items-center gap-1.5 min-w-[44px]">
              <FileSignature className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Terms</span>
            </TabsTrigger>
            <TabsTrigger value="notes" className="flex items-center gap-1.5 min-w-[44px]">
              <MessageSquare className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Notes</span>
            </TabsTrigger>
            <TabsTrigger value="evidence" className="flex items-center gap-1.5 min-w-[44px]">
              <Shield className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Evidence</span>
            </TabsTrigger>
            <TabsTrigger value="wad" className="flex items-center gap-1.5 min-w-[44px]">
              <Shield className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">WaD</span>
            </TabsTrigger>
            <TabsTrigger value="disputes" className="flex items-center gap-1.5 min-w-[44px]">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Disputes</span>
            </TabsTrigger>
            <TabsTrigger value="timeline" className="flex items-center gap-1.5 min-w-[44px]">
              <Clock className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Timeline</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="details" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Match Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted-foreground">Commodity:</span> <span className="font-medium">{match.commodity}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <MatchStatusBadge status={match.status} /></div>
                <div><span className="text-muted-foreground">Buyer:</span> <span className="font-medium">{match.buyer_name}</span></div>
                <div><span className="text-muted-foreground">Seller:</span> <span className="font-medium">{match.seller_name}</span></div>
                <div><span className="text-muted-foreground">Quantity:</span> <span className="font-medium">{match.quantity_amount} {match.quantity_unit}</span></div>
                <div><span className="text-muted-foreground">Price:</span> <span className="font-medium">{match.price_currency} {match.price_amount.toLocaleString()}</span></div>
                <div><span className="text-muted-foreground">Total Value:</span> <span className="font-medium">{match.price_currency} {(match.price_amount * match.quantity_amount).toLocaleString()}</span></div>
                <div><span className="text-muted-foreground">Hash:</span> <span className="font-mono text-xs">{match.hash}</span></div>
              </div>
              {match.terms && (
                <div className="pt-2 border-t">
                  <span className="text-sm text-muted-foreground">Terms:</span>
                  <p className="text-sm mt-1">{match.terms}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {canConfirm && (
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
                    <LoadingButton
                      onClick={handleSettle}
                      loading={confirming}
                      size="lg"
                      loadingText="Confirming…"
                    >
                      Confirm Intent
                    </LoadingButton>
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

        <TabsContent value="documents" className="mt-4 space-y-4">
          <MatchDocuments matchId={match.id} orgId={match.org_id} />
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
