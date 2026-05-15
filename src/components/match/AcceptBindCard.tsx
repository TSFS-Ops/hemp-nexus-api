/**
 * AcceptBindCard - Shown to invited trading partners on a unilateral match.
 *
 * If the current user is NOT the match creator and the match is unilateral
 * with an empty buyer/seller slot, this card lets them "Sign & Bind Deal",
 * converting the unilateral intent into a bilateral intent.
 */

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchEdgeFunction } from "@/lib/edge-invoke";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Handshake, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { queryClient } from "@/lib/query-client";
import { invalidateAllCreditBalanceQueries } from "@/lib/credit-balance-invalidation";
import { generateIdempotencyKey } from "@/lib/api-client";
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

interface AcceptBindCardProps {
  match: Match;
  onAccepted: () => void;
}

export function AcceptBindCard({ match, onAccepted }: AcceptBindCardProps) {
  const { session } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [userProfile, setUserProfile] = useState<{ org_id: string; full_name: string | null } | null>(null);

  useEffect(() => {
    if (!session?.user?.id) return;
    supabase
      .from("profiles")
      .select("org_id, full_name")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setUserProfile(data);
      });
  }, [session?.user?.id]);

  // Only show for unilateral matches
  const matchType = (match as any).match_type;
  if (matchType !== "unilateral") return null;

  // Only show if the current user is NOT the match creator
  if (!userProfile?.org_id || match.org_id === userProfile?.org_id) return null;

  // Check if there's an open slot for this user
  const buyerSlotOpen = !match.buyer_org_id;
  const sellerSlotOpen = !match.seller_org_id;
  if (!buyerSlotOpen && !sellerSlotOpen) return null;

  // Determine which role the invited user will fill
  const willBe = buyerSlotOpen ? "Buyer" : "Seller";

  const handleAccept = async () => {
    setShowConfirm(false);
    if (!session || !userProfile?.org_id) {
      toast.error("Please sign in first.");
      return;
    }

    // Double-click guard
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      const { data: freshSession } = await supabase.auth.getSession();
      if (!freshSession?.session) {
        toast.error("Session expired. Please sign in again.");
        return;
      }

      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", userProfile?.org_id)
        .maybeSingle();

      const myName = org?.name || userProfile?.full_name || "Organisation";
      const idempotencyKey = generateIdempotencyKey(`accept-bind-${match.id}`);

      // Call the match edge function to bind the trading partner
      try {
        await fetchEdgeFunction("match", {
          method: "PATCH",
          headers: { "Idempotency-Key": idempotencyKey },
          body: {
            matchId: match.id,
            action: "accept-bind",
            counterparty: {
              org_id: userProfile?.org_id,
              name: myName,
              role: buyerSlotOpen ? "buyer" : "seller",
            },
            expected_state: match.state || "discovery",
          },
          label: "accept the engagement",
        });
      } catch (e) {
        const err = e as { status?: number; message?: string };
        if (err.status === 409) {
          toast.warning("This match has already been updated. Refreshing…");
          onAccepted();
          return;
        }
        throw e;
      }

      invalidateAllCreditBalanceQueries(queryClient);
      toast.success("You have accepted this intent. This is now a bilateral intent.");
      onAccepted();
    } catch (error) {
      console.error("Sign & Bind Deal error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to accept. Try again.");
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
            You've been invited to this intent
          </CardTitle>
          <CardDescription>
            A trading partner has drafted a Trade Request for{" "}
            <strong>{match.commodity}</strong> and invited you to accept.
            Accepting binds you as the <Badge variant="outline" className="text-xs mx-1">{willBe}</Badge> and
            converts this into a formal bilateral intent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-md border border-primary/20 bg-background">
            <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground space-y-1">
              <p>By accepting, you acknowledge:</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                <li>Your organisation will be bound as the {willBe.toLowerCase()} in this intent</li>
                <li>This action is recorded in the immutable audit trail</li>
                <li>You can negotiate terms after acceptance via the Terms tab</li>
              </ul>
            </div>
          </div>

          <Button
            onClick={() => setShowConfirm(true)}
            disabled={isSubmitting}
            className="w-full sm:w-auto"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Binding…
              </>
            ) : (
              <>
                <Handshake className="h-4 w-4 mr-2" />
                Accept &amp; Bind as {willBe}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Accept this Trade Request?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  You are about to bind your organisation as the{" "}
                  <strong>{willBe.toLowerCase()}</strong> for{" "}
                  <strong>{match.commodity}</strong>.
                </p>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li>This converts a unilateral intent into a bilateral intent.</li>
                  <li>The action is tamper-proofally recorded and cannot be reversed.</li>
                  <li>Both parties can negotiate terms after binding.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAccept}>
              Accept &amp; Bind
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
