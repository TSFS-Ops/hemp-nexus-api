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
import { useUserOrg, getMatchRole } from "@/hooks/use-user-org";
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
import { FileText, FileSignature, MessageSquare, ShieldAlert, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MatchStatusBadge } from "@/components/ui/match-status-badge";
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
  const isSettled = match.status === "settled";
  const isCompleted = currentState === "completed";

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
    enabled: !!match.id,
    staleTime: 10_000,
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
    description: poiHoldActive ? "Trade request generated. Awaiting trading partner engagement, the process is paused here." : "Generate a Trade Request: 1 credit (R10). Non-binding, irreversible, fully audited.",
    complete: poiComplete && engagementAccepted,
    locked: !commercialTermsComplete // POI gate is commercial-only; supporting evidence handled via waiver flow
  }, {
    id: "wad",
    label: "Signed Deal",
    description: poiHoldActive ? "Locked. Trading partner must accept before you can proceed to Signed Deal." : "Create a Signed Deal evidence bundle with 9-gate compliance validation.",
    complete: wadComplete,
    locked: !poiComplete || poiHoldActive // HOLD POINT: locked until engagement accepted
  }, {
    id: "evidence",
    label: "Evidence Pack",
    description: "Generate a SHA-256 hashed, tamper-evident evidence bundle for regulatory finality.",
    complete: evidenceComplete,
    locked: !wadComplete // Strict: locked until WaD sealed
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

  // Lifted sub-tab state for Match step so stepper can intercept
  const [matchSubTab, setMatchSubTab] = useState("terms");
  const subTabOrder = ["terms", "documents", "notes"] as const;

  const handleStepClick = useCallback((idx: number) => {
    if (steps[idx].locked) return;
    // Strict sequential walking: from Match step, clicking POI walks the user
    // through Documents and Notes one sub-tab at a time before leaving Match.
    if (activeStep === 1 && idx === 2) {
      const currentSubIdx = subTabOrder.indexOf(matchSubTab as any);
      if (currentSubIdx < subTabOrder.length - 1) {
        setMatchSubTab(subTabOrder[currentSubIdx + 1]);
        return;
      }
    }
    setActiveStep(idx);
  }, [steps, activeStep, matchSubTab]);
  return <div className="space-y-6">
      {/* Wizard Stepper */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <WizardStepper steps={steps} activeStep={activeStep} onStepClick={handleStepClick} />
        </CardContent>
      </Card>

      {/* Step Content */}
      {activeStep === 0 && <StepSearch match={match} />}
      {activeStep === 1 && <StepMatch match={match} currentState={currentState} onMatchUpdated={async () => {
        await onRefresh();
        // Strict walk-through: after a successful Terms save, advance to Documents.
        // Never auto-leave the Match step.
        if (matchSubTab === "terms") setMatchSubTab("documents");
      }} onProceedToPoi={() => setActiveStep(2)} subTab={matchSubTab} onSubTabChange={setMatchSubTab} />}
      {activeStep === 2 && <div className="space-y-4">
          <StepPoi match={match} onStateAction={onStateAction} loading={stateActionLoading || confirming} engagementStatus={engagementStatus} />
          {/* Hold-point notice shown on POI step since WaD step is locked */}
          {poiHoldActive && <Card className="border-dashed border-primary/30">
              <CardContent className="py-6 text-center space-y-3">
                <ShieldAlert className="h-7 w-7 text-primary mx-auto" />
                <h3 className="font-semibold text-sm">Signed Deal Step Locked, Awaiting Trading Partner</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  The trade request has been generated. The next step (Signed Deal) is locked until the trading partner engagement is accepted.
                </p>
                {engagementStatus && <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border bg-muted/50 text-xs font-medium">
                    <span className={`h-2 w-2 rounded-full ${engagementStatus === "declined" || engagementStatus === "expired" ? "bg-destructive" : "bg-amber-500 animate-pulse"}`} />
                    Current status: {engagementStatus === "notification_sent" ? "Awaiting outreach" : engagementStatus === "contacted" ? "Contacted" : engagementStatus === "declined" ? "Declined" : engagementStatus === "expired" ? "Expired" : engagementStatus}
                  </div>}
              </CardContent>
            </Card>}
        </div>}
      {activeStep === 3 && (poiHoldActive ? <Card className="border-dashed border-primary/30">
            <CardContent className="py-8 text-center space-y-3">
              <ShieldAlert className="h-8 w-8 text-primary mx-auto" />
              <h3 className="font-semibold">Awaiting Trading Partner Engagement</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                The trade request has been generated and the trading partner has been notified. 
                This step is paused until the trading partner has been engaged and has responded.
              </p>
              {/* Inline engagement status, no need to scroll up */}
              {engagementStatus && <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border bg-muted/50 text-xs font-medium">
                  <span className={`h-2 w-2 rounded-full ${engagementStatus === "declined" || engagementStatus === "expired" ? "bg-destructive" : "bg-amber-500 animate-pulse"}`} />
                  Current status: {engagementStatus === "notification_sent" ? "Awaiting outreach" : engagementStatus === "contacted" ? "Contacted" : engagementStatus === "declined" ? "Declined" : engagementStatus === "expired" ? "Expired" : engagementStatus}
                </div>}
            </CardContent>
          </Card> : <StepWad match={match} onRefresh={onRefresh} />)}
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
      {allComplete && <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-lg border border-primary/30 bg-primary/5">
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