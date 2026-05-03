/**
 * StateProgressionCard - Shows the current lifecycle stage and the next action CTA.
 *
 * Displays a horizontal stepper (Discovery → POI Generated → Completed)
 * with the next action button that triggers the appropriate backend endpoint.
 * POI generation costs 1 credit ($1.00 USD). Completion is free.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { routeTo } from "@/lib/routes.generated";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMatchEvidenceCounts } from "@/lib/match-evidence-counts-client";
import { EvidenceDebugPanel } from "@/components/match/EvidenceDebugPanel";
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
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ScrollableAlertDialog,
  ScrollableAlertDialogBody,
  ScrollableAlertDialogFooter,
  ScrollableAlertDialogHeader,
} from "@/components/ui/scrollable-alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import * as MatchState from "@/lib/match-state";
import type { Match } from "@/hooks/use-match-details";

import { useOrgLegitimacy } from "@/hooks/use-org-legitimacy";
import { computeMatchTermsHash, type CanonicalTermsInput } from "@/lib/poi-terms-hash";

/** D-02: derive the canonical hash input from a Match row. */
function matchToCanonicalTerms(m: Match): CanonicalTermsInput {
  const a = m as any;
  return {
    buyer_id: a.buyer_id ?? null,
    buyer_name: m.buyer_name ?? null,
    buyer_org_id: a.buyer_org_id ?? null,
    commodity: m.commodity ?? null,
    destination_country: a.destination_country ?? null,
    match_type: a.match_type ?? null,
    origin_country: a.origin_country ?? null,
    price_amount: m.price_amount ?? null,
    price_currency: m.price_currency ?? null,
    quantity_amount: m.quantity_amount ?? null,
    quantity_unit: m.quantity_unit ?? null,
    seller_id: a.seller_id ?? null,
    seller_name: m.seller_name ?? null,
    seller_org_id: a.seller_org_id ?? null,
    terms: m.terms ?? null,
  };
}

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
    // PRODUCT DIRECTIVE (2026-04-27): no hard verification before POI.
    // POI mint requires only that each side has a NAME. Registered platform
    // identifiers are no longer required pre-POI; KYB/IDV remain mandatory
    // pre-WaD via the 9-gate engine.
    fields.push(
      {
        label: "Buyer named",
        filled: !!match.buyer_name,
        required: true,
        hint: !match.buyer_name
          ? "Add a buyer name in the Terms tab"
          : !(match as any).buyer_id
            ? `Buyer “${match.buyer_name}” is named (not yet a registered organisation). POI can still be generated; full verification will be required at WaD.`
            : "Buyer is a registered organisation on the platform",
      },
      {
        label: "Seller named",
        filled: !!match.seller_name,
        required: true,
        hint: !match.seller_name
          ? "Add a seller name in the Terms tab"
          : !(match as any).seller_id
            ? `Seller “${match.seller_name}” is named (not yet a registered organisation). POI can still be generated; full verification will be required at WaD.`
            : "Seller is a registered organisation on the platform",
      }
    );
  } else {
    const hasBuyer = !!match.buyer_name;
    const hasSeller = !!match.seller_name;
    fields.push({
      label: "Declaring party",
      filled: hasBuyer || hasSeller,
      required: true,
      hint: "At least one named party (buyer or seller) is required",
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

/**
 * Exact declaration sentence required by Daniel (2026-04-30 final POI scope).
 * Surfaced on EVERY POI mint, EVERY time. Both this acknowledgement and the
 * Authority-to-Bind tickbox below are sealed into the immutable POI ledger
 * payload + a `poi.acknowledgements_recorded` audit row.
 */
const DECLARATION_SENTENCE =
  "I confirm that I am authorised to submit this Proof of Intention on behalf of the named organisation, and that the information provided is true, accurate, and complete to the best of my knowledge.";

const ATB_SENTENCE =
  "I confirm I have the authority to bind my organisation to this Proof of Intention.";

const FALSE_DECLARATION_WARNING =
  "Submitting a false Proof of Intent may result in account suspension, removal from the platform, and referral to the relevant authorities.";

interface StateProgressionCardProps {
  match: Match;
  /** Receives the action path and an optional JSON body (used to forward the
   *  always-on declaration + authority-to-bind acknowledgements). */
  onAction: (action: string, body?: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  engagementStatus?: "notification_sent" | "contacted" | "accepted" | "declined" | "expired" | null;
}

export function StateProgressionCard({ match, onAction, loading, engagementStatus }: StateProgressionCardProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [recheckingBalance, setRecheckingBalance] = useState(false);
  const [declarationAck, setDeclarationAck] = useState(false);
  const [atbAck, setAtbAck] = useState(false);
  // D-02: hash of the commercial terms the user actually saw and acknowledged.
  // Captured when the ack dialog opens; re-checked at submit time. If the
  // server-side hash drifts (someone edited terms in another tab, or the
  // user navigated back and changed terms), the mint is rejected.
  const [acknowledgedTermsHash, setAcknowledgedTermsHash] = useState<string | null>(null);
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

  const hasVerifiedBalance = typeof balance === "number";
  const currentBalance = hasVerifiedBalance ? balance : null;
  const isBalancePending =
    (!!session && profileLoading) || (!!session && canQueryBalance && (balanceLoading || recheckingBalance));
  const cannotVerifyBalance =
    (!!session && !profileLoading && (!userProfile?.org_id || !!profileError)) ||
    (!!session && canQueryBalance && !balanceLoading && !hasVerifiedBalance) ||
    !!balanceError;
  const showInsufficientBalance = hasVerifiedBalance && currentBalance < CREDITS_PER_ACTION;

  // ── PER-SIDE MINIMUM EVIDENCE GATE (POI generation only) ──
  // Per the 2026-04-30 final POI scope: bilateral POI mint requires at least
  // one supporting document attached by EACH side (buyer and seller). The
  // evidence-waiver path has been removed entirely. Unilateral POIs remain
  // document-optional because there is no counterparty to protect yet.
  // The DB function (atomic_generate_poi_v2) is the source of truth; this
  // pre-flight gate just disables the button so users see the requirement
  // before the click rather than after a 409 MIN_EVIDENCE_PER_SIDE.
  const isPoiAction = actionPath === "generate-poi";
  const {
    data: evidenceCounts,
    refetch: refetchEvidence,
    isLoading: evidenceLoading,
    isFetching: evidenceFetching,
    error: evidenceError,
  } = useQuery({
    queryKey: ["state-progression-evidence", match.id],
    queryFn: () => getMatchEvidenceCounts(match.id),
    enabled: !!match.id && isPoiAction,
    staleTime: 0,
  });
  const documentCount = evidenceCounts?.documentCount ?? 0;
  const notesCount = evidenceCounts?.notesCount ?? 0;
  const buyerDocsCount = evidenceCounts?.buyerDocumentCount ?? 0;
  const sellerDocsCount = evidenceCounts?.sellerDocumentCount ?? 0;
  const minBundleSatisfied = !isPoiAction || (evidenceCounts?.minBundleSatisfied ?? false);
  const minBundleBlocksPoi = isPoiAction && !!evidenceCounts && !minBundleSatisfied;

  // Confirmation dialog requires BOTH always-on acknowledgements before the
  // mint button can be pressed. These are sent on every POI mint, every time.
  // For non-POI actions (e.g. complete), no acks are required.
  const canConfirmDialog =
    !loading && (!isPoiAction || (declarationAck && atbAck));

  // ── LEGITIMACY GATE (UX mirror of supabase/functions/_shared/legitimacy.ts) ──
  // Disable the POI mint button pre-flight when the org is not approved to
  // trade. The server enforces the same check; this hook is purely so users
  // see the recovery CTA *before* clicking, not after a 403.
  const { data: legitimacy, isLoading: legitimacyLoading } = useOrgLegitimacy();
  const legitimacyBlocksPoi = isPoiAction && !legitimacyLoading && legitimacy?.allowed === false;

  // ── COMPLETE-TRADE GATE: require a sealed WaD bundle ──
  // The /match/:id/complete edge function rejects with WAD_NOT_SEALED (422)
  // when no sealed WaD exists. Mirror that gate in the UI so the button is
  // visibly disabled with clear guidance instead of producing a misleading
  // server error after click.
  const isCompleteAction = actionPath === "complete";
  const { data: sealedWad, isLoading: wadLoading } = useQuery({
    queryKey: ["wad-sealed-state", match.id],
    enabled: isCompleteAction && !!match.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wads")
        .select("id, status")
        .eq("poi_id", match.id)
        .eq("status", "sealed")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
  });
  const wadGateBlocksComplete = isCompleteAction && !wadLoading && !sealedWad;

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

      // Reset acknowledgements every time the dialog opens. Both must be
      // re-affirmed on EVERY mint, EVERY time (2026-04-30 final POI scope).
      setDeclarationAck(false);
      setAtbAck(false);

      // Refresh per-side evidence counts so the gate decision is fresh.
      if (isPoiAction) {
        await refetchEvidence();
      }

      setShowDialog(true);
    } finally {
      setRecheckingBalance(false);
    }
  };

  const handleDialogConfirm = async () => {
    if (!actionPath) return;
    if (loading) return;

    let payload: Record<string, unknown> | undefined = undefined;

    if (isPoiAction) {
      // Always-on acknowledgements — never bypassable.
      if (!declarationAck || !atbAck) return;

      // Stale-evidence guard: re-check counts immediately before submit.
      const fresh = await refetchEvidence();
      if (fresh.data && !fresh.data.minBundleSatisfied) {
        toast.error(
          fresh.data.buyerSideSatisfied
            ? "Seller has no supporting documents attached. At least one document per side is required to seal a Proof of Intent."
            : "Buyer has no supporting documents attached. At least one document per side is required to seal a Proof of Intent.",
        );
        return;
      }

      payload = {
        acks: {
          declaration_ack: true,
          atb_ack: true,
          actor_roles: roles ?? [],
          ack_timestamp: new Date().toISOString(),
        },
      };
    }

    setShowDialog(false);
    try {
      await onAction(actionPath, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "");
      if (/MIN_EVIDENCE_PER_SIDE/i.test(message)) {
        toast.error(
          "At least one supporting document per side is required to seal this Proof of Intent. Please attach a document on the missing side and try again.",
        );
        await refetchEvidence();
        return;
      }
      if (/DECLARATION_ACK_REQUIRED|ATB_ACK_REQUIRED|ACKNOWLEDGEMENTS_REQUIRED/i.test(message)) {
        toast.error("Both the truthfulness declaration and authority-to-bind acknowledgement are required. Please tick both and try again.");
        return;
      }
      throw err;
    }
  };

  const handleDialogCancel = () => {
    setShowDialog(false);
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Readiness check</span>
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
            {MatchState.statusLabel(currentState)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        <p className="text-sm text-muted-foreground">
          {engagementStatus === "accepted" && ["intent_declared", "counterparty_sighted", "committed"].includes(currentState)
            ? "Trading partner has accepted. You may now proceed to the next step."
            : engagementStatus === "declined" && ["intent_declared", "counterparty_sighted", "committed"].includes(currentState)
              ? "Trading partner has declined this engagement. You may re-use the trade details to create a new trade request with a different partner."
              : engagementStatus === "expired" && ["intent_declared", "counterparty_sighted", "committed"].includes(currentState)
                ? "The engagement invitation has expired without a response. You may re-use the trade details to try again or invite a different partner."
                : MatchState.STATE_DESCRIPTIONS[currentState]}
        </p>

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
            {legitimacyBlocksPoi && legitimacy && legitimacy.allowed === false ? (
              <div
                role="alert"
                className="flex items-start gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/10"
              >
                <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    Company Identity (KYB) verification recommended before issuing a Proof of Intent
                  </p>
                  <p className="text-xs text-muted-foreground">{legitimacy.message}</p>
                  <p className="text-xs text-muted-foreground">
                    Complete the <strong>Company Identity</strong> step under Desk → Settings → Company
                    Identity. This is the Know-Your-Business (KYB) review that confirms your organisation
                    is authorised to issue a Proof of Intent and contact a counterparty under Izenzo's name.
                  </p>
                  <Link
                    to={routeTo("/desk/settings/company", { query: { step: "entity" } })}
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <ArrowRight className="h-3 w-3" />
                    Open Company Identity (KYB) review
                  </Link>
                </div>
              </div>
            ) : !isFreeAction && isBalancePending ? (
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
                    You need {CREDITS_PER_ACTION} credit ($1.00 USD) to proceed. Balance: {currentBalance}.
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
            ) : wadGateBlocksComplete ? (
              <div
                role="alert"
                className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800"
              >
                <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                    Signed Deal (WaD) bundle must be sealed before completing this trade
                  </p>
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    Proof of Intent is sealed and your trading partner has accepted, but the regulatory
                    Signed Deal evidence bundle has not yet been sealed. Open the <strong>Signed Deal</strong>
                    step to attest both sides and run the 9-gate compliance validation, then return here to
                    complete the trade. No credits will be charged until completion succeeds.
                  </p>
                </div>
              </div>
            ) : null}

            {isPoiAction && (
              <EvidenceDebugPanel
                matchId={match.id}
                data={evidenceCounts}
                isLoading={evidenceLoading}
                isFetching={evidenceFetching}
                error={evidenceError}
                onRefetch={() => { void refetchEvidence(); }}
                effectiveWaiverRequired={false}
              />
            )}

            {/* ── PER-SIDE EVIDENCE GATE (POI mint, bilateral only) ──
                Pre-flight mirror of the DB MIN_EVIDENCE_PER_SIDE check. The
                button below is disabled when this banner is shown. */}
            {minBundleBlocksPoi && (
              <div role="alert" className="flex items-start gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/10">
                <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    At least one supporting document per side is required
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Each side of a Proof of Intent must have at least one
                    supporting document of any type attached. Currently:
                    buyer = <strong>{buyerDocsCount}</strong>,
                    seller = <strong>{sellerDocsCount}</strong>.
                    Open the <strong>Documents</strong> tab to attach a file
                    on the missing side, then return here to seal the POI.
                  </p>
                </div>
              </div>
            )}

            {/* Button always renders when balance/credits are OK. */}
            {(isFreeAction || (!showInsufficientBalance && !isBalancePending)) && (
              <button
                onClick={isFreeAction ? () => setShowDialog(true) : handleConfirmClick}
                disabled={
                  loading ||
                  (!isFreeAction && recheckingBalance) ||
                  !allRequiredFilled ||
                  wadGateBlocksComplete ||
                  (isCompleteAction && wadLoading) ||
                  minBundleBlocksPoi
                }
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
                ) : minBundleBlocksPoi ? (
                  <>
                    <ShieldAlert className="h-4 w-4" />
                    Attach 1 document per side first
                  </>
                ) : isCompleteAction && wadLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking Signed Deal status…
                  </>
                ) : wadGateBlocksComplete ? (
                  <>
                    <ShieldAlert className="h-4 w-4" />
                    Seal Signed Deal first
                  </>
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4" />
                    {nextLabel}
                  </>
                )}
              </button>
            )}

            {/* ── Counterparty-not-yet-registered NOTICE (informational only) ──
                Per product directive (2026-04-27): a POI may be issued and the
                credit burned regardless of whether the counterparty is
                registered on the platform. Hard verification (KYB/IDV/UBO) is
                enforced later at WaD via the 9-gate engine. */}
            {isPoiAction && (() => {
              const missingBuyerId =
                !isUnilateral && !!match.buyer_name && !(match as any).buyer_id;
              const missingSellerId =
                !isUnilateral && !!match.seller_name && !(match as any).seller_id;

              if (!missingBuyerId && !missingSellerId) return null;

              return (
                <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/40">
                  <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="space-y-2 text-left w-full">
                    <p className="text-sm font-semibold text-foreground">
                      Counterparty is not yet registered — POI will still be issued
                    </p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {missingBuyerId && (
                        <li>
                          Buyer <strong>“{match.buyer_name}”</strong> is named
                          but not yet a registered organisation.
                        </li>
                      )}
                      {missingSellerId && (
                        <li>
                          Seller <strong>“{match.seller_name}”</strong> is named
                          but not yet a registered organisation.
                        </li>
                      )}
                    </ul>
                    <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
                      You can proceed with <strong>Generate POI</strong> now —
                      the credit will be burned and the Proof of Intent sealed
                      on the audit ledger. To progress beyond POI to a Signed
                      Deal (WaD), the counterparty will need to register and
                      accept (you can invite them from the <strong>Terms</strong> tab).
                      Hard verification (KYB/IDV/UBO) is enforced at WaD, not at POI.
                    </p>
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {isTerminal && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/20 bg-primary/5">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <p className="text-sm font-medium text-foreground">Transaction completed - evidence record sealed.</p>
          </div>
        )}
      </CardContent>

      <ScrollableAlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <ScrollableAlertDialogHeader>
          <AlertDialogTitle>{nextLabel?.replace(/ - .*/, "") || "Confirm action"}?</AlertDialogTitle>
        </ScrollableAlertDialogHeader>
        <ScrollableAlertDialogBody className="space-y-3">
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
                      <span className="font-medium text-foreground">{CREDITS_PER_ACTION} credit ($1.00 USD)</span>
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

                {/* ── ALWAYS-ON ACKNOWLEDGEMENTS (POI mint, every time) ── */}
                {isPoiAction && (
                  <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                      <p className="text-xs text-foreground">
                        <strong>{FALSE_DECLARATION_WARNING}</strong>
                      </p>
                    </div>

                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="declaration-ack"
                        checked={declarationAck}
                        onCheckedChange={(v) => setDeclarationAck(v === true)}
                        className="mt-0.5"
                      />
                      <Label htmlFor="declaration-ack" className="text-xs leading-relaxed text-foreground cursor-pointer">
                        {DECLARATION_SENTENCE}
                      </Label>
                    </div>

                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="atb-ack"
                        checked={atbAck}
                        onCheckedChange={(v) => setAtbAck(v === true)}
                        className="mt-0.5"
                      />
                      <Label htmlFor="atb-ack" className="text-xs leading-relaxed text-foreground cursor-pointer">
                        {ATB_SENTENCE} My current platform roles ({roles.length > 0 ? roles.join(", ") : "none"}) and the time of this acknowledgement will be recorded on the immutable audit trail.
                      </Label>
                    </div>

                    <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
                      Sealing this POI does not satisfy execution-readiness checks.
                      The Signed Deal (WaD) 9-gate compliance review is still pending.
                    </p>
                  </div>
                )}
        </ScrollableAlertDialogBody>
        <ScrollableAlertDialogFooter>
          <AlertDialogCancel disabled={loading} onClick={handleDialogCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDialogConfirm}
            disabled={!canConfirmDialog}
          >
            {isFreeAction ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Confirm
              </>
            ) : (
              <>
                <Coins className="h-4 w-4 mr-2" />
                Confirm - $1.00
              </>
            )}
          </AlertDialogAction>
        </ScrollableAlertDialogFooter>
      </ScrollableAlertDialog>
    </Card>
  );
}
