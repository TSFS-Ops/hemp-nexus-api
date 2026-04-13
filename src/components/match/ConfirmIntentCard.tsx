/**
 * ConfirmIntentCard - CTA card for sending a trade request on a match.
 *
 * Includes a confirmation dialog showing credit cost and current balance
 * before the irreversible action fires. Refetches balance when dialog opens.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Info, AlertTriangle, Coins } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const CREDITS_REQUIRED = 1;

interface ConfirmIntentCardProps {
  onConfirm: () => void;
  loading: boolean;
}

export function ConfirmIntentCard({ onConfirm, loading }: ConfirmIntentCardProps) {
  const [showDialog, setShowDialog] = useState(false);
  const { session } = useAuth();

  const { data: userProfile } = useQuery({
    queryKey: ["user-profile-org", session?.user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", session!.user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!session,
  });

  const { data: balance, isLoading: balanceLoading, refetch } = useQuery({
    queryKey: ["token-balance-confirm-single", userProfile?.org_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_balances")
        .select("balance")
        .eq("org_id", userProfile!.org_id)
        .single();
      if (error) throw error;
      return data?.balance ?? 0;
    },
    enabled: !!session && !!userProfile?.org_id,
    staleTime: 15_000,
  });

  const currentBalance = balance ?? 0;
  const hasEnough = currentBalance >= CREDITS_REQUIRED;
  const remaining = currentBalance - CREDITS_REQUIRED;

  const handleConfirmClick = () => {
    refetch();
    setShowDialog(true);
  };

  const handleDialogConfirm = () => {
    setShowDialog(false);
    onConfirm();
  };

  // Show insufficient credits warning instead of the confirm button
  if (!balanceLoading && !hasEnough) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h4 className="font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Insufficient credits
              </h4>
              <p className="text-sm text-muted-foreground">
                You need {CREDITS_REQUIRED} credit to generate POI. Your current balance is {currentBalance.toLocaleString()} credits.
              </p>
            </div>
            <a
              href="/billing"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Coins className="h-4 w-4 mr-2" />
              Purchase credits
            </a>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-2">
              <h4 className="font-semibold">Ready to Generate POI?</h4>
              <p className="text-sm text-muted-foreground">
                This generates a Proof of Intent record for this trade. {CREDITS_REQUIRED} credit (R10) will be deducted.
              </p>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>• <strong>Non-binding:</strong> No contract, payment, or legal obligation is created.</p>
                <p>• <strong>Irreversible:</strong> Once confirmed, this cannot be undone. Credits are not refundable.</p>
                <p>• <strong>What happens next:</strong> An immutable POI record is created. The trading partner is notified.</p>
              </div>
              {!balanceLoading && (
                <p className="text-xs text-muted-foreground">
                  Your balance: {currentBalance.toLocaleString()} credits
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <LoadingButton
                onClick={handleConfirmClick}
                loading={loading}
                size="lg"
                loadingText="Processing - do not close this page…"
              >
                Generate POI - {CREDITS_REQUIRED} credit
              </LoadingButton>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate POI for this match?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This generates a Proof of Intent (POI) record. 1 credit (R10) will be charged.
                </p>
                <div className="rounded-md border border-border p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cost</span>
                    <span className="font-medium text-foreground">{CREDITS_REQUIRED} credits</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Your balance</span>
                    <span className="font-medium text-foreground">{currentBalance.toLocaleString()} credits</span>
                  </div>
                  <div className="border-t border-border my-1" />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">After confirmation</span>
                    <span className="font-medium text-foreground">{remaining.toLocaleString()} credits</span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-1 p-3 rounded-md bg-muted/30">
                  <p><strong>Non-binding.</strong> No contract, payment, or legal obligation is created.</p>
                  <p><strong>Irreversible.</strong> This action cannot be undone. Credits will not be refunded.</p>
                  <p><strong>What happens next.</strong> An immutable POI record is created. The trading partner is notified and can view the intent.</p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel - no credits deducted</AlertDialogCancel>
            <AlertDialogAction onClick={handleDialogConfirm} disabled={loading}>
              <Coins className="h-4 w-4 mr-2" />
              Confirm - deduct {CREDITS_REQUIRED} credit (R10)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
