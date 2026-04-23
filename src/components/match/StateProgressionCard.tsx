/**
 * StateProgressionCard - Shows the current lifecycle stage and the next action CTA.
 *
 * Displays a horizontal stepper (Discovery → POI Generated → Completed)
 * with the next action button that triggers the appropriate backend endpoint.
 * POI generation costs 1 credit (R10). Completion is free.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Coins,
  Info,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import * as MatchState from "@/lib/match-state";
import type { Match } from "@/hooks/use-match-details";
import { WaiverPacketDownloadButton } from "@/components/match/WaiverPacketDownloadButton";

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
      }
    );
  } else {
    fields.push({
      label: "Declaring party",
      filled: !!match.buyer_name || !!match.seller_name,
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
    }
  );

  return fields;
}

const CREDITS_PER_ACTION = 1;

interface StateProgressionCardProps {
  match: Match;
  onAction: (action: string) => Promise<void>;
  loading: boolean;
  engagementStatus?: "notification_sent" | "contacted" | "accepted" | "declined" | "expired" | null;
}

export function StateProgressionCard({ match, onAction, loading, engagementStatus }: StateProgressionCardProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [recheckingBalance, setRecheckingBalance] = useState(false);
  const [waiverAcknowledged, setWaiverAcknowledged] = useState(false);
  const [waiverReason, setWaiverReason] = useState("");
  const [waiverCategory, setWaiverCategory] = useState<string>("");
  const [waiverSubmitting, setWaiverSubmitting] = useState(false);
  const { session, roles } = useAuth();

  const matchType = (match as any).match_type || "search";
  const isUnilateral = matchType === "unilateral";

  const currentState = match.state || "discovery";
  const rawIdx = MatchState.getStateIndex(currentState);
  // When engagement is accepted at committed state, visually advance the stepper
  // so POI Generated shows as completed (green check) and Completed becomes current
  const currentIdx = (currentState === "committed" && engagementStatus === "accepted") ? rawIdx + 1 : rawIdx;
  const nextState = MatchState.getNextState(currentState);
  const nextLabel = MatchState.getNextActionLabel(currentState, matchType);
  const nextDescription = MatchState.getNextActionDescription(currentState, matchType);
  const actionPath = nextState ? MatchState.getTransitionAction(nextState) : null;
  const isTerminal = MatchState.isTerminal(currentState);

  // For committed state, block progression until engagement is accepted
  const engagementBlocked = currentState === "committed" && engagementStatus !== "accepted";
  // Completion is free, only POI generation costs credits
  const isFreeAction = currentState === "committed";

  const unilateralBlocked =
    isUnilateral &&
    currentState === "intent_declared" &&
    (match.buyer_name == null || match.seller_name == null);

  const checklist = useMemo(() => getFieldChecklist(match), [match]);
  const allRequiredFilled = checklist.every((field) => !field.required || field.filled);

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const {
    data: userProfile,
    isLoading: profileLoading,
    error: profileError,
  } = useQuery({
    queryKey: ["user-profile-org", session?.user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("org_id, full_name")
        .eq("id", session!.user.id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!session,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Advisory only: the server is the source of truth for POI eligibility.
  // We still surface the guidance to the acting user, but we do not hard-block
  // progression in the client because stale profile data can create false positives.
  const isActorForNextStep =
    !!userProfile?.org_id && userProfile.org_id === match.org_id;
  const showNameAdvisory = isActorForNextStep && (
    !userProfile?.full_name
    || userProfile.full_name.trim().length === 0
    || EMAIL_RE.test(userProfile.full_name.trim())
  );

  const canQueryBalance = !!session && !!userProfile?.org_id;

  const {
    data: balance,
    isLoading: balanceLoading,
    error: balanceError,
    refetch,
  } = useQuery({
    queryKey: ["token-balance-progression", userProfile?.org_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_balances")
        .select("balance")
        .eq("org_id", userProfile!.org_id)
        .single();

      if (error) throw error;
      return data.balance;
    },
    enabled: canQueryBalance,
    staleTime: 15_000,
  });

  // Surface the most recent evidence-waiver acknowledgement (if any) so users
  // and admins can download the audit packet PDF directly from the POI step.
  const { data: latestWaiver } = useQuery({
    queryKey: ["evidence-waiver-latest", match.id],
    enabled: !!match.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, created_at, metadata")
        .eq("entity_id", match.id)
        .eq("action", "poi.evidence_waiver_acknowledged")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; created_at: string; metadata: Record<string, unknown> | null } | null;
    },
  });

  const hasVerifiedBalance = typeof balance === "number";
  const currentBalance = hasVerifiedBalance ? balance : null;
  const isBalancePending =
    (!!session && profileLoading) || (!!session && canQueryBalance && (balanceLoading || recheckingBalance));
  const cannotVerifyBalance =
    (!!session && !profileLoading && (!userProfile?.org_id || !!profileError)) ||
    (!!session && canQueryBalance && !balanceLoading && !hasVerifiedBalance) ||
    !!balanceError;
  const showInsufficientBalance = hasVerifiedBalance && currentBalance < CREDITS_PER_ACTION;

  // ── STRICT EVIDENCE WAIVER GATE (POI generation only) ──
  // Block POI mint behind an explicit, audited acknowledgement when the deal
  // has zero supporting documents AND zero notes. Any present evidence skips
  // the waiver. Documents and notes remain non-mandatory by platform policy
  // (memory: evidence-strength-indicator) — but the *absence* must itself be
  // a recorded, attributed decision before a credit-burning, irreversible
  // POI is sealed on the ledger.
  const isPoiAction = actionPath === "generate-poi";
  const { data: evidenceCounts, refetch: refetchEvidence } = useQuery({
    queryKey: ["state-progression-evidence", match.id],
    queryFn: async () => {
      const [docsRes, notesRes] = await Promise.all([
        supabase.from("match_documents").select("id", { count: "exact", head: true }).eq("match_id", match.id),
        supabase.from("match_notes").select("id", { count: "exact", head: true }).eq("match_id", match.id),
      ]);
      return {
        documentCount: docsRes.count ?? 0,
        notesCount: notesRes.count ?? 0,
      };
    },
    enabled: !!match.id && isPoiAction,
    staleTime: 5_000,
  });
  const documentCount = evidenceCounts?.documentCount ?? 0;
  const notesCount = evidenceCounts?.notesCount ?? 0;
  const waiverRequired = isPoiAction && documentCount === 0 && notesCount === 0;
  const trimmedReason = waiverReason.trim();
  const waiverReasonValid = !waiverRequired || trimmedReason.length >= 10;
  const canConfirmDialog = !loading && !waiverSubmitting && (!waiverRequired || (waiverAcknowledged && waiverReasonValid));

  const handleConfirmClick = async () => {
    if (loading || recheckingBalance) return;

    setRecheckingBalance(true);

    try {
      if (canQueryBalance) {
        const result = await refetch();
        if (typeof result.data === "number" && result.data < CREDITS_PER_ACTION) {
          return;
        }
      }

      // Reset waiver state every time the dialog opens.
      setWaiverAcknowledged(false);
      setWaiverReason("");
      setShowDialog(true);
    } finally {
      setRecheckingBalance(false);
    }
  };

  const handleDialogConfirm = async () => {
    if (!actionPath) return;
    if (loading || waiverSubmitting) return;

    // Strict gate: when waiver is required, both acknowledgement and a
    // meaningful reason (>= 10 chars) must be present.
    if (waiverRequired && (!waiverAcknowledged || !waiverReasonValid)) return;

    // If a waiver applies, write the audit record FIRST. If the audit write
    // fails we MUST NOT proceed to mint the POI — zero swallowed errors.
    if (waiverRequired) {
      if (!session?.user?.id || !match.org_id) {
        toast.error("Cannot record evidence waiver: missing session context. Please refresh and try again.");
        return;
      }
      setWaiverSubmitting(true);
      try {
        const { error: auditError } = await supabase.from("audit_logs").insert({
          org_id: match.org_id,
          actor_user_id: session.user.id,
          action: "poi.evidence_waiver_acknowledged",
          entity_type: "match",
          entity_id: match.id,
          metadata: {
            document_count: documentCount,
            notes_count: notesCount,
            waiver_reason: trimmedReason,
            waived_at: new Date().toISOString(),
            match_state: currentState,
            commodity: match.commodity ?? null,
            // Actor's roles at time of waiver — recorded so audit reviewers
            // can verify post-hoc whether the signer actually held the
            // privilege they claimed in the acknowledgement copy.
            actor_roles: roles ?? [],
          },
        });
        if (auditError) {
          toast.error(`Could not record evidence waiver: ${auditError.message}. POI generation aborted.`);
          return;
        }
      } catch (err) {
        toast.error(`Could not record evidence waiver: ${(err as Error).message}. POI generation aborted.`);
        return;
      } finally {
        setWaiverSubmitting(false);
      }
    }

    setShowDialog(false);
    try {
      await onAction(actionPath);
    } catch (err) {
      // Race recovery: if the server enforces the evidence-waiver gate (409
      // EVIDENCE_WAIVER_REQUIRED) because our client counts were stale, force
      // the waiver dialog open so the user can complete the acknowledgement
      // and retry without losing their place. Re-throw any other error so the
      // upstream toast handler can surface it.
      const message = err instanceof Error ? err.message : String(err ?? "");
      if (/EVIDENCE_WAIVER_REQUIRED/i.test(message)) {
        toast.error(
          "Supporting documents and notes were removed before this Proof of Intent could be sealed. Please record an evidence waiver to continue.",
        );
        // Force-refresh counts and reopen the dialog. The waiverRequired flag
        // will recompute from the fresh query and render the waiver block.
        await refetchEvidence();
        setWaiverAcknowledged(false);
        setWaiverReason("");
        setShowDialog(true);
        return;
      }
      throw err;
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
        <div className="flex items-center justify-between gap-1">
          {MatchState.MATCH_STATES.map((state, idx) => {
            const isComplete = idx < currentIdx;
            const isCurrent = idx === currentIdx;

            return (
              <div key={state} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  {isComplete ? (
                    <CheckCircle2 className="h-6 w-6 text-primary" />
                  ) : isCurrent ? (
                    <div className="h-6 w-6 rounded-full border-2 border-primary bg-primary/10 flex items-center justify-center">
                      <Circle className="h-3 w-3 fill-primary text-primary" />
                    </div>
                  ) : (
                    <Circle className="h-6 w-6 text-muted-foreground/30" />
                  )}
                  <span
                    className={`text-[10px] text-center leading-tight max-w-[70px] ${
                      isCurrent
                        ? "font-semibold text-foreground"
                        : isComplete
                          ? "text-primary"
                          : "text-muted-foreground"
                    }`}
                  >
                    {MatchState.STATE_LABELS[state]}
                  </span>
                </div>
                {idx < MatchState.MATCH_STATES.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 ${idx < currentIdx ? "bg-primary" : "bg-muted"}`} />
                )}
              </div>
            );
          })}
        </div>

        <p className="text-sm text-muted-foreground">
          {engagementStatus === "accepted" && ["intent_declared", "counterparty_sighted", "committed"].includes(currentState)
            ? "Trading partner has accepted. You may now proceed to the next step."
            : engagementStatus === "declined" && ["intent_declared", "counterparty_sighted", "committed"].includes(currentState)
              ? "Trading partner has declined this engagement. You may re-use the trade details to create a new trade request with a different partner."
              : engagementStatus === "expired" && ["intent_declared", "counterparty_sighted", "committed"].includes(currentState)
                ? "The engagement invitation has expired without a response. You may re-use the trade details to try again or invite a different partner."
                : MatchState.STATE_DESCRIPTIONS[currentState]}
        </p>

        {latestWaiver && (
          <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                Evidence waiver on record
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-200">
                A POI on this match was minted without supporting documents or notes. The signed
                waiver and full audit timeline are available as a downloadable packet.
              </p>
              <div className="pt-1">
                <WaiverPacketDownloadButton waiverId={latestWaiver.id} />
              </div>
            </div>
          </div>
        )}

        {!isTerminal && nextLabel && (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground shrink-0" />
              <p className="text-sm font-medium">Readiness checklist</p>
              <Badge variant={allRequiredFilled ? "default" : "secondary"} className="ml-auto text-[10px]">
                {checklist.filter((field) => field.filled).length}/{checklist.length} complete
              </Badge>
            </div>
            <div className="grid gap-1.5">
              {checklist.map((field) => (
                <div key={field.label} className="flex items-center gap-2 text-sm">
                  {field.filled ? (
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <X
                      className={`h-3.5 w-3.5 shrink-0 ${field.required ? "text-destructive" : "text-muted-foreground"}`}
                    />
                  )}
                  <span className={field.filled ? "text-muted-foreground" : "text-foreground"}>
                    {field.label}
                    {!field.required && <span className="text-muted-foreground text-xs ml-1">(optional)</span>}
                  </span>
                  {!field.filled && <span className="text-xs text-muted-foreground ml-auto">{field.hint}</span>}
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

        {unilateralBlocked && (
          <div className="flex items-start gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Awaiting trading partner</p>
              <p className="text-xs text-muted-foreground">
                This is a unilateral intent record. The deal cannot progress further until a trading partner is identified and attached.
                Once a trading partner responds, the lifecycle will resume.
              </p>
            </div>
          </div>
        )}

        {engagementBlocked && !isTerminal && nextLabel && (
          <div className="flex items-start gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Awaiting trading partner engagement</p>
              <p className="text-xs text-muted-foreground">
                The trading partner must accept this trade engagement before you can complete it.
                You will be able to proceed once they respond.
              </p>
            </div>
          </div>
        )}

        {!isTerminal && nextLabel && showNameAdvisory && !profileLoading && (
          <div className="flex items-start gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Check your personal legal name on file</p>
              <p className="text-xs text-muted-foreground">
                This is about <strong>your personal name on file</strong>, not your company's legal name.
                If POI generation is rejected, open Desk → Settings → My Profile and make sure your full name is saved as your
                personal legal name rather than an email address.
              </p>
              <Link to="/desk/settings" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                Review your personal name in Desk → Settings → My Profile
              </Link>
            </div>
          </div>
        )}

        {!isTerminal && nextLabel && !unilateralBlocked && !engagementBlocked && (
          <>
            {!isFreeAction && isBalancePending ? (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
                <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Checking available credits</p>
                  <p className="text-xs text-muted-foreground">
                    Loading your current credit balance before you proceed.
                  </p>
                </div>
              </div>
            ) : !isFreeAction && showInsufficientBalance ? (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/10">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Insufficient credits</p>
                  <p className="text-xs text-muted-foreground">
                    You need {CREDITS_PER_ACTION} credit (R10 ZAR) to proceed. Balance: {currentBalance}.
                  </p>
                  <a href="/billing" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                    <Coins className="h-3 w-3" />
                    Purchase credits
                  </a>
                </div>
              </div>
            ) : !isFreeAction && cannotVerifyBalance ? (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Balance check unavailable on this screen</p>
                  <p className="text-xs text-muted-foreground">
                    You can still continue. Your balance will be validated when you confirm, and no credits will be charged unless the POI is generated successfully.
                  </p>
                </div>
              </div>
            ) : null}

            {(isFreeAction || (!showInsufficientBalance && !isBalancePending)) && (
              <button
                onClick={isFreeAction ? () => setShowDialog(true) : handleConfirmClick}
                disabled={loading || (!isFreeAction && recheckingBalance) || !allRequiredFilled}
                className="w-full flex items-center justify-center gap-2 h-11 px-6 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing…
                  </>
                ) : !isFreeAction && recheckingBalance ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking credits…
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
          <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/20 bg-primary/5">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <p className="text-sm font-medium text-foreground">Transaction completed - evidence record sealed.</p>
          </div>
        )}
      </CardContent>

      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{nextLabel?.replace(/ - .*/, "") || "Confirm action"}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{nextDescription}</p>
                {isFreeAction ? (
                  <div className="rounded-md border border-border p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cost</span>
                      <span className="font-medium text-foreground">Free</span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-border p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cost</span>
                      <span className="font-medium text-foreground">{CREDITS_PER_ACTION} credit (R10 ZAR)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Your balance</span>
                      <span className="font-medium text-foreground">
                        {hasVerifiedBalance ? `${currentBalance.toLocaleString()} credits` : "Will be checked on confirmation"}
                      </span>
                    </div>
                    {hasVerifiedBalance ? (
                      <>
                        <div className="border-t border-border my-1" />
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">After confirmation</span>
                          <span className="font-medium text-foreground">
                            {(currentBalance - CREDITS_PER_ACTION).toLocaleString()} credits
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="border-t border-border my-1" />
                        <p className="text-xs text-muted-foreground">
                          We could not verify your balance on this screen. Your balance will be checked again when you confirm. If it is insufficient, the action will be blocked and no credits will be charged.
                        </p>
                      </>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  <strong>Irreversible.</strong> This action cannot be undone.{!isFreeAction && " Credits will not be refunded."}
                </p>

                {/* ── STRICT EVIDENCE WAIVER (POI mint with no docs and no notes) ── */}
                {waiverRequired && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">
                          No supporting evidence attached
                        </p>
                        <p className="text-xs text-muted-foreground">
                          This Proof of Intent will be sealed on the audit ledger with{" "}
                          <strong>0 supporting documents</strong> and{" "}
                          <strong>0 deal notes</strong>. To proceed, you must explicitly
                          acknowledge this and record a reason. Both your acknowledgement
                          and reason will be permanently logged against your user account
                          and this match record.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="waiver-reason" className="text-xs font-medium text-foreground">
                        Reason for proceeding without supporting evidence{" "}
                        <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        id="waiver-reason"
                        value={waiverReason}
                        onChange={(e) => setWaiverReason(e.target.value)}
                        placeholder="e.g. Verbal agreement with long-standing partner; documentation to follow within 48h."
                        rows={3}
                        className="text-sm"
                        maxLength={500}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Minimum 10 characters. {trimmedReason.length}/500.
                      </p>
                    </div>

                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="waiver-ack"
                        checked={waiverAcknowledged}
                        onCheckedChange={(v) => setWaiverAcknowledged(v === true)}
                        className="mt-0.5"
                      />
                      <Label
                        htmlFor="waiver-ack"
                        className="text-xs leading-relaxed text-foreground cursor-pointer"
                      >
                        I confirm I am authorised by my organisation to seal
                        this Proof of Intent without supporting documents or
                        notes. My current platform roles
                        ({roles.length > 0 ? roles.join(", ") : "none"}) and
                        the time of this acknowledgement will be recorded on
                        the immutable audit trail and may be reviewed by
                        compliance.
                      </Label>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading || waiverSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDialogConfirm}
              disabled={!canConfirmDialog}
            >
              {waiverSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Recording waiver…
                </>
              ) : isFreeAction ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Confirm
                </>
              ) : (
                <>
                  <Coins className="h-4 w-4 mr-2" />
                  Confirm - R10 ZAR
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
