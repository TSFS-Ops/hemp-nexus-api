/**
 * MatchDetails Page - Thin orchestrator with breadcrumb back-navigation.
 */

import { useParams, Link } from "react-router-dom";
import { RequireAuth } from "@/components/RequireAuth";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineLoader } from "@/components/ui/inline-loader";
import { LoadingButton } from "@/components/ui/loading-button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import * as MatchState from "@/lib/match-state";
import { useMatchDetails } from "@/hooks/use-match-details";
import { MatchHeroCard } from "@/components/match/MatchHeroCard";
import { DealWizard } from "@/components/match/wizard/DealWizard";
import { AcceptBindCard } from "@/components/match/AcceptBindCard";
import { ROUTES } from "@/lib/constants";
import { useUserOrg, getMatchRole } from "@/hooks/use-user-org";

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

  const matchRole = match ? getMatchRole(userOrgId, match as any) : null;

  const breadcrumbs = [
    { label: "Console", href: ROUTES.DASHBOARD },
    { label: "Matches", href: ROUTES.DASHBOARD_MATCHES },
    { label: match?.commodity ? `${match.commodity} #${matchId?.slice(0, 8)}` : `Match #${matchId?.slice(0, 8) ?? ""}` },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={breadcrumbs} />
        <InlineLoader message="Loading match details…" />
      </div>
    );
  }

  if (fetchError || !isValidMatchId) {
    return (
      <div className="space-y-6">
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
            <Button variant="outline" asChild>
              <Link to={ROUTES.DASHBOARD_MATCHES}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Matches
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={breadcrumbs} />
        <div className="text-center py-16 text-muted-foreground">
          <p className="font-medium">Match not found</p>
          <p className="text-sm mt-1">It may have been deleted or you don't have access.</p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to={ROUTES.DASHBOARD_MATCHES}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Matches
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const isSettled = MatchState.isSettled(match.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Breadcrumbs items={breadcrumbs} />
          {matchRole && matchRole !== "creator" && (
            <Badge variant="outline" className="text-xs border-accent-foreground/30 bg-accent/50 text-accent-foreground">
              You: {matchRole === "buyer" ? "Buyer" : "Seller"}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to={ROUTES.DASHBOARD_MATCHES}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            All Matches
          </Link>
        </Button>
      </div>

      <AcceptBindCard match={match} onAccepted={fetchMatch} />
      <MatchHeroCard match={match} isSettled={isSettled} />

      <DealWizard
        match={match}
        canConfirm={MatchState.canDo(match.state || "discovery", "confirm_intent")}
        confirming={confirming}
        stateActionLoading={stateActionLoading}
        onConfirm={handleSettle}
        onStateAction={handleStateAction}
        onRefresh={fetchMatch}
      />
    </div>
  );
}
