/**
 * BulkConfirmDialog - Shows credit cost, current balance, and remaining
 * balance before a bulk Trade Request action.
 *
 * Stays open during processing to show progress. Refetches balance on open.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, AlertTriangle, Coins } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
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

const CREDITS_PER_MATCH = 500;

interface BulkConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matchCount: number;
  isSettling: boolean;
  onConfirm: () => void;
}

export function BulkConfirmDialog({
  open,
  onOpenChange,
  matchCount,
  isSettling,
  onConfirm,
}: BulkConfirmDialogProps) {
  const { session } = useAuth();

  const { data: balance, isLoading: balanceLoading, refetch } = useQuery({
    queryKey: ["token-balance-confirm"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_balances")
        .select("balance")
        .maybeSingle();
      if (error) throw error;
      return data?.balance ?? 0;
    },
    enabled: !!session && open,
    staleTime: 5_000,
  });

  // Refetch balance every time dialog opens to prevent stale display
  useEffect(() => {
    if (open && session) {
      refetch();
    }
  }, [open, session, refetch]);

  const totalCost = matchCount * CREDITS_PER_MATCH;
  const currentBalance = balance ?? 0;
  const remainingBalance = currentBalance - totalCost;
  const hasEnough = remainingBalance >= 0;

  return (
    <AlertDialog open={open} onOpenChange={(v) => {
      // Prevent closing while processing
      if (isSettling) return;
      onOpenChange(v);
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isSettling
              ? `Sending trade request…`
              : `Send trade request for ${matchCount} match${matchCount > 1 ? "es" : ""}?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              {isSettling ? (
                <div className="space-y-3 py-2">
                  <p className="text-sm text-muted-foreground">
                    Processing {matchCount} match{matchCount > 1 ? "es" : ""} sequentially. Please do not close this dialog.
                  </p>
                  <Progress value={undefined} className="h-2 animate-pulse" />
                  <p className="text-xs text-muted-foreground">
                    Each match is confirmed individually to ensure accurate credit deductions. This may take a moment.
                  </p>
                </div>
              ) : (
                <>
                  <p>
                    This does not create a contract, payment, or legal obligation.
                    It records your interest so the seller can prepare final terms.
                  </p>

                  {balanceLoading ? (
                    <div className="space-y-2 py-2">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-5 w-36" />
                    </div>
                  ) : (
                    <div className="rounded-md border border-border p-3 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cost per match</span>
                        <span className="font-medium text-foreground">{CREDITS_PER_MATCH.toLocaleString()} credits</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Matches selected</span>
                        <span className="font-medium text-foreground">× {matchCount}</span>
                      </div>
                      <div className="border-t border-border my-1" />
                      <div className="flex justify-between font-semibold">
                        <span className="text-foreground">Total cost</span>
                        <span className="text-foreground">{totalCost.toLocaleString()} credits</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Your balance</span>
                        <span className="font-medium text-foreground">{currentBalance.toLocaleString()} credits</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Remaining Balance</span>
                        <span className={`font-medium ${hasEnough ? "text-foreground" : "text-destructive"}`}>
                          {remainingBalance.toLocaleString()} credits
                        </span>
                      </div>
                    </div>
                  )}

                  {!balanceLoading && !hasEnough && (
                    <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">Insufficient credits</p>
                        <p className="text-xs mt-0.5">
                          You need {totalCost.toLocaleString()} credits but only have {currentBalance.toLocaleString()}.{" "}
                          <a href="/billing" className="underline hover:no-underline">Purchase more credits</a>
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSettling}>
            {isSettling ? "Processing…" : "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isSettling || balanceLoading || !hasEnough}
          >
            {isSettling ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Confirming…
              </>
            ) : (
              <>
                <Coins className="h-4 w-4 mr-2" />
                Confirm - deduct {totalCost.toLocaleString()} credits
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
