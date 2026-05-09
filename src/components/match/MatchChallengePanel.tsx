/**
 * MatchChallengePanel — Phase 3B host wrapper.
 *
 * Single mount point that combines the three Phase 3B surfaces:
 *   • ChallengeStatusCard (when a challenge exists with a visible status)
 *   • Raise Challenge button (when canRaise=true and no active challenge)
 *
 * The ProgressionPausedBanner is intentionally NOT rendered here — it is
 * mounted directly above the progression CTA cluster (Deal Wizard) so that
 * the visual hint sits next to the actions it pauses.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { useMatchChallenge } from "@/hooks/useMatchChallenge";
import { useChallengePermissions } from "@/hooks/useChallengePermissions";
import { useUserOrg, getMatchRole } from "@/hooks/use-user-org";
import { useAuth } from "@/contexts/AuthContext";
import { ChallengeStatusCard } from "./ChallengeStatusCard";
import { RaiseChallengeDialog } from "./RaiseChallengeDialog";

export interface MatchChallengePanelProps {
  match: {
    id: string;
    org_id: string;
    buyer_org_id?: string | null;
    seller_org_id?: string | null;
  };
}

export function MatchChallengePanel({ match }: MatchChallengePanelProps) {
  const { open: openChallenge, latest } = useMatchChallenge(match.id);
  const perms = useChallengePermissions(match);
  const viewerOrgId = useUserOrg();
  const { isPlatformAdmin } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!perms.canViewCard && !perms.canRaise) return null;

  // Card visible when a challenge exists with a recognised status.
  const showCard = !!latest;
  // Raise button visible only when no active challenge exists and viewer can raise.
  const showRaise = perms.canRaise && !openChallenge;

  if (!showCard && !showRaise) return null;

  const role = getMatchRole(viewerOrgId, match);
  const viewerSide: "buyer" | "seller" | "platform_admin" = isPlatformAdmin
    ? "platform_admin"
    : role === "buyer"
    ? "buyer"
    : "seller";

  return (
    <section
      aria-label="Match challenge"
      className="space-y-3"
      data-testid="match-challenge-panel"
    >
      {showCard && <ChallengeStatusCard challenge={latest} />}

      {showRaise && (
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDialogOpen(true)}
            data-testid="raise-challenge-button"
            className="gap-2"
          >
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            Raise a challenge
          </Button>
        </div>
      )}

      <RaiseChallengeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        matchId={match.id}
        viewerSide={viewerSide}
        viewerOrgId={viewerOrgId}
      />
    </section>
  );
}
