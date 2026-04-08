/**
 * StateProgressionCard - Shows the current lifecycle stage and the next action CTA.
 *
 * Displays a horizontal stepper (Discovery → Intent → Reveal → Commit → Complete)
 * with the next action button that triggers the appropriate backend endpoint.
 * Each action costs 1 credit.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  CheckCircle2, Circle, ArrowRight, Coins, AlertTriangle, Loader2,
  Check, X, Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import * as MatchState from "@/lib/match-state";
import type { Match } from "@/hooks/use-match-details";

interface FieldCheck {
  label: string;
  filled: boolean;
  required: boolean;
  hint: string;
}

function getFieldChecklist(match: Match): FieldCheck[] {
  const isUnilateral = (match as any).match_type === "unilateral";

  const fields: FieldCheck[] = [
    {
      label: "Commodity",
      filled: !!match.commodity,
      required: true,
      hint: "Set via Search or edit the match",
    },
  ];

  if (!isUnilateral) {
    fields.push(
      {
        label: "Buyer name",
        filled: !!match.buyer_name,
        required: true,
        hint: "Add via the Terms tab or match creation",
      },
      {
        label: "Seller name",
        filled: !!match.seller_name,
        required: true,
        hint: "Add via the Terms tab or match creation",
      },
    );
  } else {
    // Unilateral: at least one party must be the declaring side
    const hasDeclarer = !!match.buyer_name || !!match.seller_name;
    fields.push({
      label: "Declaring party",
      filled: hasDeclarer,
      required: true,
      hint: "Set when creating the intent",
    });
  }

  fields.push(
    {
      label: "Quantity",
      filled: match.quantity_amount != null && match.quantity_amount > 0,
      required: true,
      hint: "Set quantity in the Terms tab",
    },
    {
      label: "Price",
      filled: match.price_amount != null && match.price_amount > 0,
      required: true,
      hint: "Set price in the Terms tab",
    },
    {
      label: "Terms",
      filled: !!match.terms,
      required: false,
      hint: "Optional - add payment/delivery terms",
    },
  );

  return fields;
}

const CREDITS_PER_ACTION = 1;

interface StateProgressionCardProps {
  match: Match;
  onAction: (action: string) => Promise<void>;
  loading: boolean;
}

export function StateProgressionCard({ match, onAction, loading }: StateProgressionCardProps) {
  const [showDialog, setShowDialog] = useState(false);
  const { session } = useAuth();

  const matchType = (match as any).match_type || "search";
  const isUnilateral = matchType === "unilateral";

  const currentState = match.state || "discovery";
  const currentIdx = MatchState.getStateIndex(currentState);
  const nextState = MatchState.getNextState(currentState);
  const nextLabel = MatchState.getNextActionLabel(currentState, matchType);
  const nextDescription = MatchState.getNextActionDescription(currentState, matchType);
  const actionPath = nextState ? MatchState.getTransitionAction(nextState) : null;
  const isTerminal = MatchState.isTerminal(currentState);

  // For unilateral intents in intent_declared state, block progression until counterparty attached
  const unilateralBlocked = isUnilateral && currentState === "intent_declared" &&
    (match.buyer_name == null || match.seller_name == null);

  const checklist = useMemo(() => getFieldChecklist(match), [match]);
  const requiredMissing = checklist.filter(f => f.required && !f.filled);
  const allRequiredFilled = requiredMissing.length === 0;

  const { data: balance, refetch } = useQuery({
    queryKey: ["token-balance-progression"],
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
  const hasEnough = currentBalance >= CREDITS_PER_ACTION;

  const handleConfirmClick = () => {
    refetch();
    setShowDialog(true);
  };

  const handleDialogConfirm = async () => {
    setShowDialog(false);
    if (actionPath) {
      await onAction(actionPath);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between">
          Deal Progression
          <Badge variant="outline" className="font-mono text-xs">
            {MatchState.statusLabel(currentState)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Stepper */}
        <div className="flex items-center justify-between gap-1">
          {MatchState.MATCH_STATES.map((state, idx) => {
            const isComplete = idx < currentIdx;
            const isCurrent = idx === currentIdx;
            return (
              <div key={state} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  {isComplete ? (
                    <CheckCircle2 className="h-6 w-6 text-green-500" />
                  ) : isCurrent ? (
                    <div className="h-6 w-6 rounded-full border-2 border-primary bg-primary/10 flex items-center justify-center">
                      <Circle className="h-3 w-3 fill-primary text-primary" />
                    </div>
                  ) : (
                    <Circle className="h-6 w-6 text-muted-foreground/30" />
                  )}
                  <span className={`text-[10px] text-center leading-tight max-w-[70px] ${
                    isCurrent ? "font-semibold text-foreground" : isComplete ? "text-green-600" : "text-muted-foreground"
                  }`}>
                    {MatchState.STATE_LABELS[state]}
                  </span>
                </div>
                {idx < MatchState.MATCH_STATES.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 ${
                    idx < currentIdx ? "bg-green-500" : "bg-muted"
                  }`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Current state description */}
        <p className="text-sm text-muted-foreground">
          {MatchState.STATE_DESCRIPTIONS[currentState]}
        </p>

        {/* Field readiness checklist */}
        {!isTerminal && nextLabel && (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground shrink-0" />
              <p className="text-sm font-medium">Readiness checklist</p>
              <Badge variant={allRequiredFilled ? "default" : "secondary"} className="ml-auto text-[10px]">
                {checklist.filter(f => f.filled).length}/{checklist.length} complete
              </Badge>
            </div>
            <div className="grid gap-1.5">
              {checklist.map((field) => (
                <div key={field.label} className="flex items-center gap-2 text-sm">
                  {field.filled ? (
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <X className={`h-3.5 w-3.5 shrink-0 ${field.required ? "text-destructive" : "text-muted-foreground"}`} />
                  )}
                  <span className={field.filled ? "text-muted-foreground" : "text-foreground"}>
                    {field.label}
                    {!field.required && <span className="text-muted-foreground text-xs ml-1">(optional)</span>}
                  </span>
                  {!field.filled && (
                    <span className="text-xs text-muted-foreground ml-auto">{field.hint}</span>
                  )}
                </div>
              ))}
            </div>
            {!allRequiredFilled && (
              <p className="text-xs text-muted-foreground border-t border-border pt-2">
                Complete the required fields above before proceeding. Go to the <strong>Terms</strong> tab to add missing data.
                No credits will be charged until you proceed.
              </p>
            )}
          </div>
        )}

        {/* Unilateral intent: awaiting counterparty */}
        {unilateralBlocked && (
          <div className="flex items-start gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Awaiting counterparty</p>
              <p className="text-xs text-muted-foreground">
                This is a unilateral intent record. The deal cannot progress further until a trading partner
                is identified and attached. Once a trading partner responds, the lifecycle will resume.
              </p>
            </div>
          </div>
        )}

        {/* Next action CTA */}
        {!isTerminal && nextLabel && !unilateralBlocked && (
          <>
            {!hasEnough ? (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/40 bg-amber-500/5">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                 <div className="space-y-1">
                   <p className="text-sm font-medium">Insufficient credits</p>
                   <p className="text-xs text-muted-foreground">
                     You need {CREDITS_PER_ACTION} credit (R10 ZAR) to proceed. Balance: {currentBalance}.
                   </p>
                   <a href="/billing" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                     <Coins className="h-3 w-3" /> Purchase credits
                   </a>
                 </div>
              </div>
            ) : (
              <button
                onClick={handleConfirmClick}
                disabled={loading || !allRequiredFilled}
                className="w-full flex items-center justify-center gap-2 h-11 px-6 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing…
                  </>
                ) : !allRequiredFilled ? (
                  <>
                    <AlertTriangle className="h-4 w-4" />
                    Complete required fields first
                  </>
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4" />
                    {nextLabel}
                  </>
                )}
              </button>
            )}
          </>
        )}

        {isTerminal && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-green-500/40 bg-green-500/5">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <p className="text-sm font-medium text-green-700">
              Transaction completed - evidence record sealed.
            </p>
          </div>
        )}
      </CardContent>

      {/* Confirmation dialog */}
      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{nextLabel?.replace(/ - .*/, "")}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{nextDescription}</p>
                 <div className="rounded-md border border-border p-3 space-y-2 text-sm">
                   <div className="flex justify-between">
                     <span className="text-muted-foreground">Cost</span>
                     <span className="font-medium text-foreground">{CREDITS_PER_ACTION} credit (R10 ZAR)</span>
                   </div>
                   <div className="flex justify-between">
                     <span className="text-muted-foreground">Your balance</span>
                     <span className="font-medium text-foreground">{currentBalance.toLocaleString()} credits</span>
                   </div>
                   <div className="border-t border-border my-1" />
                   <div className="flex justify-between">
                     <span className="text-muted-foreground">After confirmation</span>
                     <span className="font-medium text-foreground">{(currentBalance - CREDITS_PER_ACTION).toLocaleString()} credits</span>
                   </div>
                 </div>
                 <p className="text-xs text-muted-foreground">
                   <strong>Irreversible.</strong> This action cannot be undone. Credits will not be refunded.
                 </p>
               </div>
             </AlertDialogDescription>
           </AlertDialogHeader>
           <AlertDialogFooter>
             <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
             <AlertDialogAction onClick={handleDialogConfirm} disabled={loading}>
               <Coins className="h-4 w-4 mr-2" />
               Confirm - R10 ZAR
             </AlertDialogAction>
           </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
