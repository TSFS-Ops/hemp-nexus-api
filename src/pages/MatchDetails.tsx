/**
 * MatchDetails Page - Thin orchestrator with breadcrumb back-navigation.
 * Fetches engagement status and passes it down to enforce the POI hold-point.
 */

import { useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { NamedContactPanel } from "@/components/match/NamedContactPanel";
import { DealWizard } from "@/components/match/wizard/DealWizard";
import { AcceptBindCard } from "@/components/match/AcceptBindCard";
import { EngagementTracker } from "@/components/match/EngagementTracker";
import { AcceptEngagementCard } from "@/components/match/AcceptEngagementCard";
import { AcceptanceReceiptCard } from "@/components/match/AcceptanceReceiptCard";
import { UnknownCounterpartyStatus } from "@/components/match/UnknownCounterpartyStatus";
import { PendingEngagementSection } from "@/components/match/PendingEngagementSection";
import { MatchDisputeBeingNamedPanel } from "@/components/match/MatchDisputeBeingNamedPanel";
import { MatchEmailChangeHistoryPanel } from "@/components/match/MatchEmailChangeHistoryPanel";
import { useAuth } from "@/contexts/AuthContext";
import type { PendingEngagementRow } from "@/components/match/PendingEngagementSection";
import { OrgAdminContactCompletionCard } from "@/components/match/OrgAdminContactCompletionCard";
import { ReconfirmLateAcceptanceCard } from "@/components/match/ReconfirmLateAcceptanceCard";
import { CounterpartyIntelPanel } from "@/components/match/CounterpartyIntelPanel";
import { ExecutionSection } from "@/components/match/execution/ExecutionSection";
import { SpineTimeline } from "@/components/match/SpineTimeline";
import { MatchChallengePanel } from "@/components/match/MatchChallengePanel";
import { ProgressionPausedBanner } from "@/components/match/ProgressionPausedBanner";
import { useMatchChallenge } from "@/hooks/useMatchChallenge";
import { ROUTES } from "@/lib/constants";
import { useUserOrg, getMatchRole } from "@/hooks/use-user-org";
import { fetchEdgeFunction } from "@/lib/edge-invoke";
import { isInconsistentMatch } from "@/lib/match-lifecycle";
import type { EngagementStatus } from "@/components/match/wizard/DealWizard";

function MatchDetailsContent() {
  const { matchId } = useParams<{ matchId: string }>();
  const userOrgId = useUserOrg();
  const { isPlatformAdmin } = useAuth();
  const { open: openChallenge } = useMatchChallenge(matchId);
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

  // UI-007: per-tab focus refetch. When this tab becomes visible after
  // being hidden for >5s, re-pull the match and the engagement-status gate
  // so a stale cache from another tab's mutation is corrected immediately.
  // We deliberately do NOT enable global `refetchOnWindowFocus` — this is
  // scoped to the open match page only.
  const queryClient = useQueryClient();
  const hiddenSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSinceRef.current = Date.now();
        return;
      }
      if (document.visibilityState === "visible") {
        const since = hiddenSinceRef.current;
        hiddenSinceRef.current = null;
        if (since && Date.now() - since > 5000) {
          void fetchMatch();
          if (matchId) {
            queryClient.invalidateQueries({ queryKey: ["engagement-status-gate", matchId] });
          }
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [matchId, fetchMatch, queryClient]);

  // Fetch the canonical engagement read-model envelope for this match.
  // Batch B Phase 1: we now consume `current_engagement` from the
  // {current_engagement, latest_historical_engagement, history,
  // read_model} envelope instead of the old `.maybeSingle()` row. The
  // `parseByMatchResponse` helper accepts either the new or legacy shape
  // so a stale edge-function deployment never blanks the page.
  const { data: engagementModel, isLoading: engagementLoading } = useQuery({
    queryKey: ["engagement-status-gate", matchId],
    queryFn: async () => {
      try {
        const result = await fetchEdgeFunction<unknown>(
          `poi-engagements/by-match/${matchId}`,
          { method: "GET", label: "load engagement status" },
        );
        const { parseByMatchResponse } = await import("@/lib/engagement-read-model");
        return parseByMatchResponse(result);
      } catch {
        return null;
      }
    },
    enabled: !!matchId,
    refetchInterval: 30000,
  });

  // Batch B Phase 9 F-B4 fix:
  //   • `engagementData` (current) drives action/progression cards (Reconfirm,
  //     Accept, POI/WaD gates) — strictly null when the row was swept back
  //     to expired so no stale buttons appear.
  //   • `displayEngagement` (current ?? latest_historical) drives read-only
  //     status/wording (PendingEngagementSection) so the F-B4 historical
  //     "initiator did not reconfirm / late acceptance remains recorded /
  //     original engagement remains expired" wording renders even though
  //     there is no current row.
  const engagementData = (engagementModel?.current_engagement ?? null) as unknown as
    | (PendingEngagementRow & { engagement_status: EngagementStatus; counterparty_type: string })
    | null;
  const displayEngagement = (engagementData ??
    (engagementModel?.latest_historical_engagement ?? null)) as unknown as
    | (PendingEngagementRow & { engagement_status: EngagementStatus; counterparty_type: string })
    | null;
  // Batch D Test 7 fix: AcceptEngagementCard needs to see `expired` so it
  // can render the "Accept (late)" affordance, but the read-model resolver
  // classifies expired/declined as *historical* and zeroes out
  // `current_engagement`. Drive the gate from `displayEngagement` (current
  // ∪ latest_historical) — the card itself enforces the respondable
  // status whitelist (`notification_sent` | `contacted` | `expired`) so
  // accepted/declined/cancelled never re-surface an action button.
  const engagementStatus: EngagementStatus = (displayEngagement?.engagement_status as EngagementStatus) || null;

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

  // Batch O Phase 2 (MT-008): if this match has inconsistent lifecycle data,
  // we render only a soft "under admin review" banner. We do not 404, do not
  // expose internal inconsistency details, and do not surface any
  // POI/WaD/execution/payment action affordances. Admin repair happens in
  // HQ → Legacy Repair.
  if (isInconsistentMatch(match as any)) {
    return (
      <PageContainer size="wide" className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <Breadcrumbs items={breadcrumbs} />
          <BackButton fallback={ROUTES.DASHBOARD_MATCHES} label="All Matches" className="self-start sm:self-auto" />
        </div>
        <div
          role="status"
          data-testid="legacy-repair-banner"
          className="rounded-md border border-amber-300 bg-amber-50 p-5"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 mt-0.5 text-amber-700 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900">
                This deal is temporarily unavailable
              </p>
              <p className="text-sm text-amber-900/90">
                Izenzo is verifying legacy deal data on this match. No action is required from you at this stage. We will notify you once the review is complete.
              </p>
            </div>
          </div>
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

      {(displayEngagement?.engagement_status as string | null) === "disputed_being_named" && displayEngagement?.id && (
        <MatchDisputeBeingNamedPanel
          engagementId={displayEngagement.id}
          engagementStatus={displayEngagement.engagement_status as string}
          operationalState={(displayEngagement as any).operational_state ?? null}
          counterpartyResponse={(displayEngagement as any).counterparty_response ?? null}
          viewerRole={
            matchRole === "creator" || userOrgId === (match as any).org_id
              ? "initiator"
              : matchRole === "buyer" || matchRole === "seller"
                ? "counterparty"
                : "other"
          }
          isPlatformAdmin={!!isPlatformAdmin}
          onResolved={fetchMatch}
        />
      )}

      <PendingEngagementSection
        engagement={displayEngagement}
        match={match as any}
        isInitiator={matchRole === "creator" || userOrgId === (match as any).org_id}
        isLoading={engagementLoading}
      />


      <UnknownCounterpartyStatus
        engagement={engagementData}
        isInitiator={matchRole === "creator" || userOrgId === (match as any).org_id}
      />

      <OrgAdminContactCompletionCard
        engagement={engagementData as any}
        match={match as any}
        viewerOrgId={userOrgId}
      />

      {matchId && <AcceptEngagementCard match={match} engagementStatus={engagementStatus} onResponded={fetchMatch} />}

      <ReconfirmLateAcceptanceCard
        match={match as any}
        engagement={engagementData as any}
        onResolved={fetchMatch}
      />

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

      <MatchChallengePanel match={match as any} />

      <ProgressionPausedBanner challenge={openChallenge ?? null} />

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

      <MatchHeroCard match={match} isSettled={isSettled} engagementStatus={engagementStatus} />

      {matchId && <NamedContactPanel matchId={matchId} match={match as any} />}

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
