/**
 * ConfirmIntentCard — CTA card for declaring intent on a match.
 *
 * Includes a confirmation dialog showing credit cost and current balance
 * before the irreversible action fires. Refetches balance when dialog opens.
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Info, AlertTriangle, Coins } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
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

const CREDITS_REQUIRED = 500;

interface ConfirmIntentCardProps {
  onConfirm: () => void;
  loading: boolean;
}

export function ConfirmIntentCard({ onConfirm, loading }: ConfirmIntentCardProps) {
  const [showDialog, setShowDialog] = useState(false);
  const { session } = useAuth();

  const { data: balance, isLoading: balanceLoading, refetch } = useQuery({
    queryKey: ["token-balance-confirm-single"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_balances")
        .select("balance")
        .maybeSingle();
      if (error) throw error;
      return data?.balance ?? 0;
    },
    enabled: !!session,
    staleTime: 15_000,
  });

  const currentBalance = balance ?? 0;
  const hasEnough = currentBalance >= CREDITS_REQUIRED;
  const remaining = currentBalance - CREDITS_REQUIRED;

  const handleConfirmClick = () => {
    // Refetch balance right before showing the dialog to ensure freshness
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
                You need {CREDITS_REQUIRED} credits to confirm intent. Your current balance is {currentBalance.toLocaleString()} credits.
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
            <div className="space-y-1">
              <h4 className="font-semibold">Ready to Confirm Intent?</h4>
              <p className="text-sm text-muted-foreground">
                Upload any supporting documents above first. {CREDITS_REQUIRED} credits will be deducted. No legal obligation is created.
              </p>
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
                    <p>Confirms your intent and burns {CREDITS_REQUIRED} credits. This creates an immutable proof record that will appear in your logs.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm intent for this match?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will deduct {CREDITS_REQUIRED} credits from your balance and create an immutable
                  proof record. This action cannot be undone.
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
                <p className="text-xs text-muted-foreground">
                  No contract, payment, or legal obligation is created. This only records your intent.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDialogConfirm} disabled={loading}>
              <Coins className="h-4 w-4 mr-2" />
              Confirm — deduct {CREDITS_REQUIRED} credits
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
