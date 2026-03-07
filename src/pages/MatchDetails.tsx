/**
 * MatchDetails Page — Thin orchestrator.
 *
 * Delegates to:
 *  - useMatchDetails (data fetching + mutations)
 *  - MatchHeroCard (top-level match summary)
 *  - MatchDetailsTabs (tabbed sub-sections incl. ConfirmIntentCard)
 */

import { useParams } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { InlineLoader } from "@/components/ui/inline-loader";
import { LoadingButton } from "@/components/ui/loading-button";
import * as MatchState from "@/lib/match-state";
import { useMatchDetails } from "@/hooks/use-match-details";
import { MatchHeroCard } from "@/components/match/MatchHeroCard";
import { MatchDetailsTabs } from "@/components/match/MatchDetailsTabs";

export default function MatchDetails() {
  const { matchId } = useParams<{ matchId: string }>();
  const {
    match,
    loading,
    fetchError,
    isValidMatchId,
    confirming,
    fetchMatch,
    handleSettle,
  } = useMatchDetails(matchId);

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

      <MatchHeroCard match={match} isSettled={isSettled} />

      <MatchDetailsTabs
        match={match}
        canConfirm={canConfirm}
        confirming={confirming}
        onConfirm={handleSettle}
        onRefresh={fetchMatch}
      />
    </div>
  );
}
