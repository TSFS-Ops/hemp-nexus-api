/**
 * DealWizard - Replaces the 9-tab MatchDetailsTabs with a strict linear 5-step wizard.
 *
 * Steps:
 *   1. Search (always complete on match detail, match already exists)
 *   2. Match Details (review trading partner, terms, docs, notes, disputes)
 *   3. Generate POI (readiness checklist + credit-burn action)
 *   4. WaD (governance docs + 9-gate validation), must be SEALED before completion
 *   5. Evidence Pack (sealed evidence bundle + timeline)
 *
 * Strict linear: future steps are locked until prior steps are fully complete.
 * Trade Request is a HOLD POINT: Signed Deal step is locked until trading partner engagement is accepted.
 * Signed Deal is a COMPLIANCE GATE: trade cannot complete unless wads.status === 'sealed'.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMatchEvidenceCounts } from "@/lib/match-evidence-counts-client";
import { useUserOrg, getMatchRole } from "@/hooks/use-user-org";
import * as MatchState from "@/lib/match-state";
import { isPendingEngagementActive } from "@/lib/engagement-state";
import { useMatchSubTab } from "@/hooks/use-match-sub-tab";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { WizardStepper, type WizardStepDef } from "./WizardStepper";
import { MatchDocuments } from "@/components/match/MatchDocuments";
import { DealTermsPanel } from "@/components/match/DealTermsPanel";
import { MatchNotes } from "@/components/match/MatchNotes";
import { StateProgressionCard } from "@/components/match/StateProgressionCard";
import { GovernanceDocSubmit } from "@/components/match/GovernanceDocSubmit";
import { WadModule } from "@/components/wad/WadModule";
import { EvidencePackPanel } from "@/components/match/EvidencePackPanel";
import { MatchTimeline } from "@/components/MatchTimeline";
import { PoiEventsTimeline } from "@/components/match/PoiEventsTimeline";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, FileSignature, MessageSquare, ShieldAlert, CheckCircle2, ArrowRight, HelpCircle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MatchStatusBadge } from "@/components/ui/match-status-badge";
import { ActionRequiredBanner } from "@/components/match/ActionRequiredBanner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Match } from "@/hooks/use-match-details";
export type EngagementStatus = "notification_sent" | "contacted" | "accepted" | "declined" | "expired" | null;
interface DealWizardProps {
  match: Match;
  canConfirm: boolean;
  confirming: boolean;
  stateActionLoading: boolean;
  onConfirm: () => void;
  onStateAction: (action: string) => Promise<void>;
  onRefresh: () => void;
  /** Engagement status, null means no engagement record exists */
  engagementStatus?: EngagementStatus;
}
export function DealWizard({
  match,
  canConfirm,
  confirming,
  stateActionLoading,
  onConfirm,
  onStateAction,
  onRefresh,
  engagementStatus
}: DealWizardProps) {
  const currentState = match.state || "discovery";
  // R3: route status/state checks through the match-state SSOT
  const isSettled = MatchState.isSettled(match.status);
  const isCompleted = MatchState.isCompleted(currentState);

  // Determine step completion
  const searchComplete = true; // always, match exists

  // Commercial terms validity (required for POI gate)
  const commercialTermsComplete = useMemo(() => {
    const hasCommodity = !!match.commodity;
    const hasBuyer = !!match.buyer_name;
    const hasSeller = !!match.seller_name;
    const hasQuantity = match.quantity_amount != null && match.quantity_amount > 0;
    const hasPrice = match.price_amount != null && match.price_amount > 0;
    return hasCommodity && hasBuyer && hasSeller && hasQuantity && hasPrice;
  }, [match]);

  // Supporting evidence presence (advisory, not gating — drives "fully complete" badge)
  const { data: evidenceCounts } = useQuery({
    queryKey: ["match-evidence-counts", match.id],
    queryFn: () => getMatchEvidenceCounts(match.id),
    enabled: !!match.id,
    staleTime: 0,
  });
  const documentCount = evidenceCounts?.documentCount ?? 0;
  const notesCount = evidenceCounts?.notesCount ?? 0;
  const hasSupportingEvidence = documentCount > 0 || notesCount > 0;

  // Match step is "fully" complete only when commercial terms AND supporting evidence
  // (or post-POI states where the wizard has moved on). The POI gate itself remains
  // commercial-only; this only governs the green checkmark on the stepper.
  const postMatchState = ["intent_declared", "counterparty_sighted", "committed", "completed"].includes(currentState);
  const matchComplete = commercialTermsComplete && (hasSupportingEvidence || postMatchState);
  const poiComplete = useMemo(() => {
    return isSettled || ["intent_declared", "counterparty_sighted", "committed", "completed"].includes(currentState);
  }, [currentState, isSettled]);

  // ── ENGAGEMENT HOLD-POINT GATE ──
  // Trade request is a hold point. Signed Deal is BLOCKED until trading partner engagement is accepted.
  const engagementAccepted = engagementStatus === "accepted";
  const poiHoldActive = poiComplete && !engagementAccepted && !isCompleted;

  // ── PRE-POI SOFT-ROUTE PENDING ──
  // UI-001/005: when the POI mint soft-routed (named-but-unregistered
  // counterparty), the server returned 202 ENGAGEMENT_PENDING, did NOT burn
  // credits, and did NOT progress `match.state`. The engagement row exists
  // and is non-terminal, but `match.state` stays `discovery`. Cross-surface
  // affordances (focal banner, mint CTA, hero badge) must reflect the block
  // even though the legacy state machine doesn't know about it.
  const softRoutePending =
    currentState === "discovery" &&
    isPendingEngagementActive({ engagement_status: engagementStatus ?? null });

  // ── WaD COMPLIANCE GATE ──
  // Query actual wads table to determine if WaD is sealed
  const {
    data: wadRecord
  } = useQuery({
    queryKey: ["wad-status", match.id],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.from("wads").select("id, status").eq("poi_id", match.id).neq("status", "revoked").neq("status", "superseded").maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: poiComplete && engagementAccepted
  });
  const wadSealed = wadRecord?.status === "sealed";
  const wadComplete = wadSealed || isCompleted;
  const evidenceComplete = isCompleted;
  const steps: WizardStepDef[] = useMemo(() => [{
    id: "search",
    label: "Search",
    description: "A trading partner has been identified and a match record created.",
    complete: searchComplete,
    locked: false
  }, {
    id: "match",
    label: "Match",
    description: "Review trading partner details, negotiate terms, and attach supporting documents.",
    complete: matchComplete,
    locked: false
  }, {
    id: "poi",
    label: "Proof of Intent",
    description: poiHoldActive ? "Trade request generated. Awaiting trading partner engagement, the process is paused here." : "Generate a Trade Request: 1 credit ($1.00 USD). Non-binding, irreversible, fully audited.",
    complete: poiComplete && engagementAccepted,
    locked: !commercialTermsComplete,
    lockedReason: !commercialTermsComplete ? "Complete the required commercial terms (commodity, parties, quantity, price) on the Match step before generating Proof of Intent." : undefined,
  }, {
    id: "wad",
    label: "Signed Deal",
    description: poiHoldActive ? "Locked. Trading partner must accept before you can proceed to Signed Deal." : "Create a Signed Deal evidence bundle with 9-gate compliance validation.",
    complete: wadComplete,
    locked: !poiComplete || poiHoldActive,
    lockedReason: !poiComplete
      ? "Generate a Proof of Intent first. Signed Deal compiles the 9-gate evidence bundle on top of a sealed POI."
      : poiHoldActive
        ? "The trading partner has been notified but has not yet accepted. Signed Deal unlocks when they engage."
        : undefined,
  }, {
    id: "evidence",
    label: "Evidence Pack",
    description: "Generate a SHA-256 hashed, tamper-evident evidence bundle for regulatory finality.",
    complete: evidenceComplete,
    locked: !wadComplete,
    lockedReason: !wadComplete ? "Seal the Signed Deal first. Evidence Pack bundles the sealed WaD and full audit trail into the final regulatory archive." : undefined,
  }], [searchComplete, matchComplete, poiComplete, wadComplete, evidenceComplete, poiHoldActive, engagementAccepted, commercialTermsComplete]);

  // Strict landing policy (Option B):
  //   - Never auto-skip the Match step. Pre-POI users always land on Match (Terms sub-tab).
  //   - Only skip Match if the deal is already past POI (intent_declared or beyond),
  //     in which case landing on the first incomplete unlocked step is correct.
  const [activeStep, setActiveStep] = useState(() => {
    if (!postMatchState) return 1; // Match step
    const first = steps.findIndex(s => !s.complete && !s.locked);
    return first >= 0 ? first : steps.length - 1;
  });

  // Lifted sub-tab state for Match step (persisted per user+match in backend)
  const { subTab: matchSubTab, setSubTab: setMatchSubTab } = useMatchSubTab(match.id);
  const subTabOrder = ["terms", "documents", "notes"] as const;

  // Live-region announcement for assistive tech when the stepper intercepts a
  // POI click and instead advances the Match sub-tab. Cleared after announce.
  const [stepperAnnouncement, setStepperAnnouncement] = useState("");

  const handleStepClick = useCallback((idx: number) => {
    if (steps[idx].locked) return;
    // Strict sequential walking: from Match step, clicking POI walks the user
    // through Documents and Notes one sub-tab at a time before leaving Match.
    if (activeStep === 1 && idx === 2) {
      const currentSubIdx = subTabOrder.indexOf(matchSubTab as any);
      if (currentSubIdx < subTabOrder.length - 1) {
        const nextSub = subTabOrder[currentSubIdx + 1];
        setMatchSubTab(nextSub);
        const nextLabel = nextSub === "documents" ? "Documents" : "Notes";
        setStepperAnnouncement(
          `Before opening Proof of Intent, please review ${nextLabel}. Now showing the ${nextLabel} sub-tab of the Match step.`,
        );
        return;
      }
    }
    setActiveStep(idx);
  }, [steps, activeStep, matchSubTab, setMatchSubTab]);
  // ── FOCAL BANNER DERIVATION ──
  // Computes the single most important "what now" message for the user.
  const focal = useMemo<{
    tone: "action" | "locked" | "complete";
    eyebrow: string;
    title: string;
    description: string;
    helpText?: string;
  }>(() => {
    if (isCompleted) {
      return {
        tone: "complete",
        eyebrow: "Trade complete",
        title: "Evidence record sealed",
        description: "All gates have been passed and the regulatory evidence pack is finalised. No further action is required.",
      };
    }
    const activeId = steps[activeStep]?.id;
    if (softRoutePending) {
      const statusText =
        engagementStatus === "notification_sent" ? "queued for outreach"
        : engagementStatus === "contacted" ? "outreach sent — awaiting reply"
        : engagementStatus === "declined" ? "counterparty declined"
        : engagementStatus === "expired" ? "engagement window elapsed"
        : "in progress";
      return {
        tone: "locked",
        eyebrow: "Waiting on counterparty",
        title: "Pending Engagement — outreach in progress",
        description: `A Pending Engagement has been recorded for this trade (${statusText}). No credits have been burned. POI minting will resume once your counterparty accepts. See the Pending Engagement card above for full status.`,
        helpText: "While a Pending Engagement is active the Generate POI action is held by the server (409 ENGAGEMENT_PENDING). You'll be notified by email when the counterparty responds.",
      };
    }
    if (poiHoldActive) {
      const statusText = engagementStatus === "notification_sent" ? "Awaiting outreach"
        : engagementStatus === "contacted" ? "Contacted"
        : engagementStatus === "declined" ? "Declined"
        : engagementStatus === "expired" ? "Expired"
        : "In progress";
      return {
        tone: "locked",
        eyebrow: "Waiting on counterparty",
        title: `Trading partner engagement — ${statusText}`,
        description: "Proof of Intent is sealed. The Signed Deal step unlocks once the trading partner accepts the engagement. No action required from you right now.",
        helpText: "Locked steps are gated by external events (counterparty acceptance, scheduled jobs). You'll be notified by email when this step unlocks.",
      };
    }
    if (activeId === "search") {
      return {
        tone: "action",
        eyebrow: "Your turn",
        title: "Open the Match step to review terms",
        description: "A trading partner has been identified. Move to the Match step to review the deal terms, attach evidence and prepare for Proof of Intent.",
      };
    }
    if (activeId === "match") {
      return {
        tone: commercialTermsComplete ? "complete" : "action",
        eyebrow: commercialTermsComplete ? "Ready to advance" : "Your turn",
        title: commercialTermsComplete
          ? "Commercial terms complete — proceed to Proof of Intent"
          : "Complete the commercial terms",
        description: commercialTermsComplete
          ? "Buyer, seller, commodity, quantity and price are all set. Before generating Proof of Intent (1 credit, $1.00 USD) you must also attach at least 1 supporting document from each side on the Documents tab."
          : "Set the buyer, seller, commodity, quantity and price on the Terms tab. You will also need to attach at least 1 supporting document from each side before you can generate a Proof of Intent.",
        helpText: "Commercial terms (5 fields) and at least 1 document per side are both required by the POI gate. Notes are optional.",
      };
    }
    if (activeId === "poi") {
      // POI already generated AND trading partner accepted → next action is Complete Trade.
      // Without this branch, the focal banner kept saying "Generate a Proof of Intent"
      // even though the POI was sealed and the in-card CTA correctly read "Complete Trade".
      if (poiComplete && engagementAccepted) {
        return {
          tone: "action",
          eyebrow: "Your turn",
          title: "Complete the trade",
          description: "Proof of Intent is sealed and the trading partner has accepted. Confirm completion to seal the evidence record. This action is free and irreversible.",
          helpText: "Completion finalises the trade lifecycle on the audit ledger. After completion you can build the Signed Deal evidence bundle and generate the regulatory Evidence Pack.",
        };
      }
      return {
        tone: "action",
        eyebrow: "Your turn",
        title: "Generate a Proof of Intent",
        description: "Mint a Proof of Intent on the audit ledger to formally signal commercial intent to your trading partner. Costs 1 credit ($1.00 USD), irreversible, fully audited. Requires at least 1 supporting document from each side.",
        helpText: "POI generation is the platform's hold-point. Once minted, your trading partner is notified and you cannot edit the commercial terms.",
      };
    }
    if (activeId === "wad") {
      return {
        tone: "action",
        eyebrow: "Your turn",
        title: "Build the Signed Deal evidence bundle",
        description: "Submit governance documents and run the 9-gate compliance validation. Once sealed, the Evidence Pack step unlocks for final regulatory archive.",
        helpText: "The Signed Deal (WaD — Without a Doubt) bundle is the platform's compliance certificate. It must be sealed before the trade is regulatorily complete.",
      };
    }
    if (activeId === "evidence") {
      return {
        tone: "action",
        eyebrow: "Final step",
        title: "Generate the regulatory Evidence Pack",
        description: "Bundle the sealed Signed Deal and full audit timeline into a SHA-256 hashed, tamper-evident archive for your records and your regulator.",
      };
    }
    return {
      tone: "locked",
      eyebrow: "Status",
      title: "No action available",
      description: "Continue when the next step unlocks.",
    };
  }, [activeStep, steps, poiHoldActive, engagementStatus, commercialTermsComplete, isCompleted, poiComplete, engagementAccepted]);

  return <div className="space-y-5">
      {/* a11y: announce stepper sub-tab interception to screen readers */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {stepperAnnouncement}
      </div>
      {/* ── HERO: Macro deal progression ── */}
      <Card className="border-border/80">
        <CardContent className="pt-6 pb-5 px-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-1.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">
                Deal progression
              </p>
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="About deal progression" className="text-muted-foreground/50 hover:text-foreground transition-colors">
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs text-xs">
                    The five-step lifecycle for every Izenzo trade. Steps unlock sequentially; locked steps either require you to complete an earlier step or are waiting on a counterparty.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              Step {activeStep + 1} of {steps.length}
            </span>
          </div>
          <WizardStepper steps={steps} activeStep={activeStep} onStepClick={handleStepClick} />
        </CardContent>
      </Card>

      {/* ── FOCAL POINT: What do I do next? ── */}
      <ActionRequiredBanner
        tone={focal.tone}
        eyebrow={focal.eyebrow}
        title={focal.title}
        description={focal.description}
        helpText={focal.helpText}
      />

      {/* Step Content */}
      {activeStep === 0 && <StepSearch match={match} />}
      {activeStep === 1 && <StepMatch match={match} currentState={currentState} onMatchUpdated={async () => {
        await onRefresh();
        // Strict walk-through: after a successful Terms save, advance to Documents.
        // Never auto-leave the Match step.
        if (matchSubTab === "terms") setMatchSubTab("documents");
      }} onProceedToPoi={() => setActiveStep(2)} subTab={matchSubTab} onSubTabChange={setMatchSubTab} />}
      {activeStep === 2 && (
        <div className="space-y-4">
          <StepPoi match={match} onStateAction={onStateAction} loading={stateActionLoading || confirming} engagementStatus={engagementStatus} />
        </div>
      )}
      {activeStep === 3 && (
        poiHoldActive ? (
          <Card className="border-dashed border-border bg-muted/30 shadow-none">
            <CardContent className="py-8 text-center space-y-3">
              <Lock className="h-7 w-7 text-muted-foreground/60 mx-auto" />
              <h3 className="font-semibold text-sm text-muted-foreground">Step locked — see status above</h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                The Signed Deal step opens once the trading partner accepts. The full status is tracked in the focal banner above and the engagement tracker beneath the page heading.
              </p>
            </CardContent>
          </Card>
        ) : (
          <StepWad match={match} onRefresh={onRefresh} />
        )
      )}
      {activeStep === 4 && <StepEvidence match={match} currentState={currentState} />}
    </div>;
}

// ─── Step 1: Search (Complete) ──────────────────────────────────────

function StepSearch({
  match
}: {
  match: Match;
}) {
  const isRevealed = true; // Names are always visible per client requirement
  const userOrgId = useUserOrg();
  const inferredRole = getMatchRole(userOrgId, match as any);

  // Derive role from canonical buyer_org_id / seller_org_id
  let roleBadgeLabel: string | null = null;
  if (inferredRole === "buyer") {
    roleBadgeLabel = "Buyer";
  } else if (inferredRole === "seller") {
    roleBadgeLabel = "Seller";
  }
  return <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg">Trading Partner Identified</CardTitle>
          {roleBadgeLabel && <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-primary/30 bg-primary/5 text-primary">
              Your role: {roleBadgeLabel}
            </span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Commodity:</span>{" "}
            <span className="font-medium">{match.commodity}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Status:</span>{" "}
            <MatchStatusBadge status={match.status} />
          </div>
          <div>
            <span className="text-muted-foreground">Buyer:</span>{" "}
            <span className="font-medium">{match.buyer_name || <span className="italic text-muted-foreground">Not set</span>}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Seller:</span>{" "}
            <span className="font-medium">{match.seller_name || <span className="italic text-muted-foreground">Not set</span>}</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          This match was created via the search or bilateral matching flow. Proceed to the next step to review terms.
        </p>
      </CardContent>
    </Card>;
}

// ─── Step 2: Match Details ──────────────────────────────────────────

function StepMatch({
  match,
  currentState,
  onMatchUpdated,
  onProceedToPoi,
  subTab,
  onSubTabChange
}: {
  match: Match;
  currentState: string;
  onMatchUpdated?: () => void;
  onProceedToPoi?: () => void;
  subTab: string;
  onSubTabChange: (tab: string) => void;
}) {
  // Check if all required fields are complete
  const allComplete = !!match.commodity && !!match.buyer_name && !!match.seller_name && match.quantity_amount != null && match.quantity_amount > 0 && match.price_amount != null && match.price_amount > 0;

  // Sequential sub-tab navigation: Terms → Documents → Notes → POI
  const subTabOrder = ["terms", "documents", "notes"] as const;
  const currentSubIndex = subTabOrder.indexOf(subTab as any);
  const isLastSubTab = currentSubIndex === subTabOrder.length - 1;
  const handleNextSubTab = () => {
    if (isLastSubTab && onProceedToPoi) {
      onProceedToPoi();
    } else if (currentSubIndex < subTabOrder.length - 1) {
      onSubTabChange(subTabOrder[currentSubIndex + 1]);
    }
  };

  // Label and description for the contextual next prompt
  const nextLabel = isLastSubTab ? "Proceed to Proof of Intent" : `Next: ${subTab === "terms" ? "Documents" : "Notes"}`;
  const nextDescription = isLastSubTab ? "All required fields complete" : subTab === "terms" ? "Terms saved. Review or attach supporting documents" : "Documents reviewed. Add any deal notes before proceeding";
  return <div className="space-y-4">
      {/* Sub-navigation within the match step */}
      <Tabs value={subTab} onValueChange={onSubTabChange}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="terms" className="gap-1.5">
            <FileSignature className="h-4 w-4" />
            Terms
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5">
            <FileText className="h-4 w-4" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-1.5">
            <MessageSquare className="h-4 w-4" />
            Notes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="terms" className="mt-4">
          <DealTermsPanel matchId={match.id} orgId={match.org_id} onMatchUpdated={onMatchUpdated} />
        </TabsContent>
        <TabsContent value="documents" className="mt-4">
          <MatchDocuments matchId={match.id} orgId={match.org_id} />
        </TabsContent>
        <TabsContent value="notes" className="mt-4">
          <MatchNotes matchId={match.id} orgId={match.org_id} />
        </TabsContent>
      </Tabs>

      {/* Contextual next-step prompt, only when required commercial fields are complete */}
      {allComplete && <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-md border border-primary/30 bg-primary/5">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            <p className="text-sm font-medium text-foreground">{nextDescription}</p>
          </div>
          <Button size="sm" onClick={handleNextSubTab} className="gap-1.5 shrink-0 w-full sm:w-auto">
            {nextLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>}
    </div>;
}

// ─── Step 3: POI ────────────────────────────────────────────────────

function StepPoi({
  match,
  onStateAction,
  loading,
  engagementStatus
}: {
  match: Match;
  onStateAction: (action: string) => Promise<void>;
  loading: boolean;
  engagementStatus?: EngagementStatus;
}) {
  return <div className="space-y-4">
      <StateProgressionCard match={match} onAction={onStateAction} loading={loading} engagementStatus={engagementStatus} />
    </div>;
}

// ─── Step 4: WaD ────────────────────────────────────────────────────

function StepWad({
  match,
  onRefresh
}: {
  match: Match;
  onRefresh: () => void;
}) {
  return <div className="space-y-4">
      <GovernanceDocSubmit matchId={match.id} orgId={match.org_id} />
      <WadModule match={match} onWadCreated={onRefresh} />
    </div>;
}

// ─── Step 5: Evidence Pack ──────────────────────────────────────────

function StepEvidence({
  match,
  currentState
}: {
  match: Match;
  currentState: string;
}) {
  return <div className="space-y-4">
      <EvidencePackPanel matchId={match.id} matchStatus={match.status} matchState={currentState} />
      <Separator />
      <MatchTimeline matchId={match.id} />
      <PoiEventsTimeline matchId={match.id} />
    </div>;
}