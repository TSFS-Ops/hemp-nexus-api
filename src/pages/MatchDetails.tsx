/**
 * MatchDetails Page - Thin orchestrator with breadcrumb back-navigation.
 * Fetches engagement status and passes it down to enforce the POI hold-point.
 */

import { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { RequireAuth } from "@/components/RequireAuth";
import { ShieldAlert } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineLoader } from "@/components/ui/inline-loader";
import { LoadingButton } from "@/components/ui/loading-button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PageContainer } from "@/components/ui/page-container";
import * as MatchState from "@/lib/match-state";
import { useMatchDetails } from "@/hooks/use-match-details";
import { MatchHeroCard } from "@/components/match/MatchHeroCard";
import { DealWizard } from "@/components/match/wizard/DealWizard";
import { AcceptBindCard } from "@/components/match/AcceptBindCard";
import { EngagementTracker } from "@/components/match/EngagementTracker";
import { AcceptEngagementCard } from "@/components/match/AcceptEngagementCard";
import { AcceptanceReceiptCard } from "@/components/match/AcceptanceReceiptCard";
import { UnknownCounterpartyStatus } from "@/components/match/UnknownCounterpartyStatus";
import { PendingEngagementSection } from "@/components/match/PendingEngagementSection";
import type { PendingEngagementRow } from "@/components/match/PendingEngagementSection";
import { CounterpartyIntelPanel } from "@/components/match/CounterpartyIntelPanel";
import { ExecutionSection } from "@/components/match/execution/ExecutionSection";
import { SpineTimeline } from "@/components/match/SpineTimeline";
import { ROUTES } from "@/lib/constants";
import { useUserOrg, getMatchRole } from "@/hooks/use-user-org";
import { fetchEdgeFunction } from "@/lib/edge-invoke";
import type { EngagementStatus } from "@/components/match/wizard/DealWizard";

function MatchDetailsContent() {
  const { matchId } = useParams<{ matchId: string }>();
  const userOrgId = useUserOrg();
  const {
    match,
    loading,
    fetchError,
    isValidMatchId,
    confirming,
    stateActionLoading,
    fetchMatch,
    handleSettle,
    handleStateAction,
  } = useMatchDetails(matchId);
  // Record that this user just opened the match. The Deal Pipeline reads
  // match_ui_prefs.updated_at to surface a true "last viewed" timestamp on
  // each card, so a deal Daniel is actively reviewing no longer appears as
  // "3d ago" just because that's when it was sealed. Fire-and-forget; any
  // error is logged but never blocks the page.
  useEffect(() => {
    if (!matchId) return;
    void (async () => {
      try {
        // Lazy import to avoid a hard coupling in the page module.
        const { supabase } = await import("@/integrations/supabase/client");
        await supabase.rpc("touch_match_view", { _match_id: matchId });
      } catch (err) {
        console.warn("[MatchDetails] touch_match_view failed", err);
      }
    })();
  }, [matchId]);

  // Fetch engagement status for this match to enforce the hold-point gate
  const { data: engagementData } = useQuery({
    queryKey: ["engagement-status-gate", matchId],
    queryFn: async () => {
      try {
        // by-match returns the full poi_engagements row (`select("*")`),
        // so we pull the wider shape here for the PendingEngagementSection.
        const result = await fetchEdgeFunction<{
          engagement?: PendingEngagementRow & {
            engagement_status: EngagementStatus;
            counterparty_type: string;
          };
        } | null>(`poi-engagements/by-match/${matchId}`, {
          method: "GET",
          label: "load engagement status",
        });
        return result?.engagement || null;
      } catch {
        return null;
      }
    },
    enabled: !!matchId,
    refetchInterval: 30000,
  });

  const engagementStatus: EngagementStatus = engagementData?.engagement_status || null;

  const matchRole = match ? getMatchRole(userOrgId, match as any) : null;

  const breadcrumbs = [
    { label: "Console", href: ROUTES.DASHBOARD },
    { label: "Matches", href: ROUTES.DASHBOARD_MATCHES },
    { label: match?.commodity ? `${match.commodity} #${matchId?.slice(0, 8)}` : `Match #${matchId?.slice(0, 8) ?? ""}` },
  ];

  if (loading) {
    return (
      <PageContainer size="wide" className="space-y-6">
        <Breadcrumbs items={breadcrumbs} />
        <InlineLoader message="Loading match details…" />
      </PageContainer>
    );
  }

  if (fetchError || !isValidMatchId) {
    return (
      <PageContainer size="wide" className="space-y-6">
        <Breadcrumbs items={breadcrumbs} />
        <div className="text-center py-16 text-muted-foreground">
          <ShieldAlert className="h-10 w-10 mx-auto mb-3 text-destructive" />
          <p className="font-medium">{fetchError || "Invalid match ID"}</p>
          <p className="text-sm mt-1 max-w-md mx-auto">
            {!isValidMatchId
              ? "The match ID in the URL is not valid. Check the link and try again."
              : "Something went wrong loading this match. Please retry, or contact support@izenzo.co.za if the problem persists."}
          </p>
          <div className="flex items-center justify-center gap-3 mt-4">
            {isValidMatchId && (
              <LoadingButton
                onClick={fetchMatch}
                loading={loading}
                variant="outline"
                loadingText="Retrying…"
              >
                Retry
              </LoadingButton>
            )}
            <BackButton fallback={ROUTES.DASHBOARD_MATCHES} label="Back to Matches" />
          </div>
        </div>
      </PageContainer>
    );
  }

  if (!match) {
    return (
      <PageContainer size="wide" className="space-y-6">
        <Breadcrumbs items={breadcrumbs} />
        <div className="text-center py-16 text-muted-foreground">
          <p className="font-medium">Match not found</p>
          <p className="text-sm mt-1">It may have been deleted or you don't have access.</p>
          <BackButton fallback={ROUTES.DASHBOARD_MATCHES} label="Back to Matches" className="mt-4" />
        </div>
      </PageContainer>
    );
  }

  const isSettled = MatchState.isSettled(match.status);
  const showPrePoiVerification = MatchState.isPrePoi(match.state || match.status);

  return (
    <PageContainer size="wide" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center flex-wrap gap-2 min-w-0">
          <Breadcrumbs items={breadcrumbs} />
          {matchRole && matchRole !== "creator" && (
            <Badge variant="outline" className="text-xs border-accent-foreground/30 bg-accent/50 text-accent-foreground shrink-0">
              You: {matchRole === "buyer" ? "Buyer" : "Seller"}
            </Badge>
          )}
        </div>
        <BackButton fallback={ROUTES.DASHBOARD_MATCHES} label="All Matches" className="self-start sm:self-auto" />
      </div>

      <AcceptBindCard match={match} onAccepted={fetchMatch} />

      <PendingEngagementSection
        engagement={engagementData}
        isInitiator={matchRole === "creator" || userOrgId === (match as any).org_id}
      />

      <UnknownCounterpartyStatus
        engagement={engagementData}
        isInitiator={matchRole === "creator" || userOrgId === (match as any).org_id}
      />

      {matchId && <AcceptEngagementCard match={match} engagementStatus={engagementStatus} onResponded={fetchMatch} />}

      {matchId && <AcceptanceReceiptCard matchId={matchId} />}

      {matchId && <EngagementTracker matchId={matchId} match={match} />}

      {showPrePoiVerification && <CounterpartyIntelPanel match={match} />}
      {/*
        Per Daniel Davies (2026-04-29): the user-facing "Request Enhanced
        Verification" affordance is removed from the Match page until the
        proper pre-POI hard-check module is built. The admin clip-on
        (HQ → Verification Queue) remains available for operator-led cases,
        but no priced light-check option is shown to traders here.
      */}

      {matchId && <SpineTimeline matchId={matchId} />}

      <DealWizard
        match={match}
        canConfirm={MatchState.canDo(match.state || "discovery", "confirm_intent")}
        confirming={confirming}
        stateActionLoading={stateActionLoading}
        onConfirm={handleSettle}
        onStateAction={handleStateAction}
        onRefresh={fetchMatch}
        engagementStatus={engagementStatus}
      />

      <MatchHeroCard match={match} isSettled={isSettled} />

      {matchId && <ExecutionSection matchId={matchId} />}
    </PageContainer>
  );
}

export default function MatchDetails() {
  return (
    <RequireAuth>
      <MatchDetailsContent />
    </RequireAuth>
  );
}
