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
import { Loader2, Handshake, XCircle, ShieldCheck } from "lucide-react";
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
  const canRespond = engagementStatus === "notification_sent" || engagementStatus === "contacted";

  if (!isCounterparty || !canRespond) return null;

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
      toast.error(error instanceof Error ? error.message : "Failed to respond. Try again.");
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

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={() => setPendingAction("accepted")}
              disabled={isSubmitting}
              className="flex-1 sm:flex-none"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Handshake className="h-4 w-4 mr-2" />
              )}
              Accept Trade
            </Button>
            <Button
              variant="outline"
              onClick={() => setPendingAction("declined")}
              disabled={isSubmitting}
              className="flex-1 sm:flex-none text-destructive border-destructive/30 hover:bg-destructive/5"
            >
              <XCircle className="h-4 w-4 mr-2" />
              Decline
            </Button>
          </div>
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
