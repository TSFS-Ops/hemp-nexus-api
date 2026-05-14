/**
 * AcceptEngagementCard, Shown to the invited trading partner on a bilateral
 * known-partner match when the engagement is awaiting their response.
 *
 * Provides Accept / Decline actions that call the trading-partner-facing
 * POST /poi-engagements/respond/:matchId endpoint.
 */

import { useState } from "react";
import { fetchEdgeFunction } from "@/lib/edge-invoke";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Handshake, XCircle, ShieldCheck, Clock } from "lucide-react";
import { toast } from "sonner";
import { queryClient } from "@/lib/query-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Match } from "@/hooks/use-match-details";
import { useUserOrg, getMatchRole } from "@/hooks/use-user-org";

interface AcceptEngagementCardProps {
  match: Match;
  engagementStatus: string | null;
  onResponded: () => void;
}

export function AcceptEngagementCard({ match, engagementStatus, onResponded }: AcceptEngagementCardProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<"accepted" | "declined" | null>(null);
  const userOrgId = useUserOrg();
  const matchRole = getMatchRole(userOrgId, match as any);

  // Only show if:
  // 1. The user is NOT the creator (they are the trading partner)
  // 2. The engagement exists and is in a respondable state
  const isCreator = userOrgId === (match as any).org_id;
  const isCounterparty = !isCreator && (matchRole === "buyer" || matchRole === "seller");
  // Batch B Phase 5: only respondable while pre-acceptance. Once a late
  // acceptance has been recorded, the trading partner has already
  // responded and the next action sits with the initiator (reconfirm /
  // decline) — surfacing Accept here again would imply progression that
  // the workflow does not allow.
  // Batch D Test 7: 'expired' is also respondable from the counterparty
  // surface — the server routes accept-after-expiry into
  // atomic_record_late_acceptance and hands the next step (reconfirm /
  // decline) back to the initiator. We surface a clearly-labelled
  // "Accept (late)" affordance so the counterparty isn't left looking at
  // an expired row with no action.
  const canRespond =
    engagementStatus === "notification_sent" ||
    engagementStatus === "contacted" ||
    engagementStatus === "expired";

  if (!isCounterparty || !canRespond) return null;

  const isExpired = engagementStatus === "expired";
  const roleLabel = matchRole === "buyer" ? "Buyer" : "Seller";

  const handleRespond = async () => {
    if (!pendingAction) return;
    setPendingAction(null);
    setIsSubmitting(true);

    try {
      await fetchEdgeFunction(
        `poi-engagements/respond/${match.id}`,
        {
          method: "POST",
          body: { action: pendingAction },
          label: pendingAction === "accepted" ? "accept the engagement" : "decline the engagement",
        }
      );

      queryClient.invalidateQueries({ queryKey: ["engagement-tracker"] });
      queryClient.invalidateQueries({ queryKey: ["engagement-status-gate"] });

      if (pendingAction === "accepted") {
        toast.success("You have accepted this trade engagement. The deal can now proceed.");
      } else {
        toast.info("You have declined this trade engagement.");
      }

      onResponded();
    } catch (error) {
      console.error("Engagement response error:", error);
      const raw = error instanceof Error ? error.message : "Failed to respond. Try again.";
      // Translate the raw state-machine error so the counterparty understands
      // *why* their accept was refused. Stuck-at-notification_sent means the
      // initiator has not yet sent their outreach email — the engagement
      // can only progress to 'accepted' after the initiator transitions it
      // to 'contacted'. Translate any illegal-transition error from the
      // poi-engagements state machine into plain English so the counterparty
      // is never shown a raw "Cannot transition from 'X' to 'Y'" line. We
      // also catch the loose-quote / no-quote / INVALID_TRANSITION code
      // shapes so server wording drift doesn't silently re-expose the bug.
      const isInvalidTransition =
        /cannot\s+transition\s+from/i.test(raw) ||
        /invalid[_\s-]?transition/i.test(raw) ||
        /allowed\s*(transitions|:)/i.test(raw);
      const isFromNotificationSent =
        /from\s+["']?notification_sent["']?/i.test(raw);
      const isFromPending =
        /from\s+["']?pending["']?/i.test(raw);
      let friendly = raw;
      if (isInvalidTransition && (isFromNotificationSent || isFromPending)) {
        friendly =
          "We can't accept this trade yet — the initiating party hasn't sent their outreach email. Once they reach out (or an admin marks the engagement as contacted), Accept will work.";
      } else if (isInvalidTransition) {
        friendly =
          "This trade can't be accepted in its current state. Please refresh the page; if the problem persists, ask the initiator or an admin to advance the engagement to 'contacted'.";
      }
      toast.error(friendly);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Card className="border-primary/40 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Handshake className="h-5 w-5 text-primary" />
            You've been invited to this trade
          </CardTitle>
          <CardDescription>
            A trading partner has created a Trade Request for{" "}
            <strong>{match.commodity}</strong> and named you as the{" "}
            <Badge variant="outline" className="text-xs mx-1">{roleLabel}</Badge>.
            Please review the details below and accept or decline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-lg border border-primary/20 bg-background">
            <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground space-y-1">
              <p>By accepting, you acknowledge:</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                <li>You confirm your interest in this trade as the {roleLabel.toLowerCase()}</li>
                <li>The deal will progress to the next stage</li>
                <li>This action is recorded in the immutable audit trail</li>
              </ul>
            </div>
          </div>

          {engagementStatus === "notification_sent" && (
            <div
              role="status"
              className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10"
            >
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-900 dark:text-amber-100 space-y-1">
                <p className="font-medium">Waiting for the initiating party</p>
                <p className="text-xs">
                  Accept will become active as soon as the initiator sends their
                  outreach email (or an admin marks the engagement as
                  "contacted"). You can still decline at any time.
                </p>
              </div>
            </div>
          )}

          {isExpired && (
            <div
              role="status"
              className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10"
            >
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-900 dark:text-amber-100 space-y-1">
                <p className="font-medium">This engagement has expired</p>
                <p className="text-xs">
                  Because this engagement has expired, your acceptance will not
                  complete the workflow immediately. It will be sent back to the
                  initiator for reconfirmation, and they have a limited window
                  to confirm or decline.
                </p>
              </div>
            </div>
          )}

          {/* Button + banner alignment (P3): when the engagement is still
              "notification_sent" the backend will refuse Accept with an
              illegal-transition error, because the initiator has not yet
              advanced the engagement to "contacted". The amber banner above
              already says "Accept will become active as soon as…" — so the
              Accept button MUST visually agree with the banner and be
              disabled until status becomes "contacted". Decline stays
              available at all engagement states. */}
          {(() => {
            const acceptBlocked = engagementStatus === "notification_sent";
            const acceptReason = acceptBlocked
              ? "Accept becomes available once the initiator sends their outreach (or an admin marks the engagement as contacted)."
              : "Accept this trade engagement";
            return (
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={() => setPendingAction("accepted")}
                  disabled={isSubmitting || acceptBlocked}
                  className="flex-1 sm:flex-none"
                  title={acceptReason}
                  aria-label={acceptReason}
                  aria-disabled={acceptBlocked || undefined}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : acceptBlocked ? (
                    <Clock className="h-4 w-4 mr-2" />
                  ) : (
                    <Handshake className="h-4 w-4 mr-2" />
                  )}
                  {acceptBlocked ? "Accept (waiting for initiator)" : "Accept Trade"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPendingAction("declined")}
                  disabled={isSubmitting}
                  className="flex-1 sm:flex-none text-destructive border-destructive/30 hover:bg-destructive/5"
                  title="Decline this trade engagement"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Decline
                </Button>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      <AlertDialog open={!!pendingAction} onOpenChange={() => setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction === "accepted" ? "Accept this trade?" : "Decline this trade?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {pendingAction === "accepted" ? (
                  <>
                    <p>
                      You are confirming your interest as the{" "}
                      <strong>{roleLabel.toLowerCase()}</strong> for{" "}
                      <strong>{match.commodity}</strong>.
                    </p>
                    <p className="text-sm">
                      The trade will progress and both parties can negotiate terms.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      You are declining this trade for{" "}
                      <strong>{match.commodity}</strong>.
                    </p>
                    <p className="text-sm">
                      The initiator will be notified and may approach a different trading partner.
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRespond}
              className={pendingAction === "declined" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {pendingAction === "accepted" ? "Accept" : "Decline"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
