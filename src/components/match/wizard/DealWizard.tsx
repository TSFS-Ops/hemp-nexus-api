/**
 * DealWizard - Replaces the 9-tab MatchDetailsTabs with a strict linear 5-step wizard.
 *
 * Steps:
 *   1. Search (always complete on match detail — match already exists)
 *   2. Match Details (review trading partner, terms, docs, notes, disputes)
 *   3. Generate POI (readiness checklist + credit-burn action)
 *   4. WaD (governance docs + 9-gate validation)
 *   5. Evidence Pack (sealed evidence bundle + timeline)
 *
 * Strict linear: future steps are locked until prior steps are fully complete.
 * POI is a HOLD POINT: WaD step is locked until counterparty engagement is accepted.
 */

import { useState, useMemo, useCallback } from "react";
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
  /** Engagement status — null means no engagement record exists */
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
  engagementStatus,
}: DealWizardProps) {
  const currentState = match.state || "discovery";
  const isSettled = match.status === "settled";
  const isCompleted = currentState === "completed";

  // Determine step completion
  const searchComplete = true; // always — match exists
  const matchComplete = useMemo(() => {
    // Match step is complete when all required fields are filled
    const hasCommodity = !!match.commodity;
    const hasBuyer = !!match.buyer_name;
    const hasSeller = !!match.seller_name;
    const hasQuantity = match.quantity_amount != null && match.quantity_amount > 0;
    const hasPrice = match.price_amount != null && match.price_amount > 0;
    return hasCommodity && hasBuyer && hasSeller && hasQuantity && hasPrice;
  }, [match]);

  const poiComplete = useMemo(() => {
    return isSettled || ["intent_declared", "counterparty_sighted", "committed", "completed"].includes(currentState);
  }, [currentState, isSettled]);

  // ── ENGAGEMENT HOLD-POINT GATE ──
  // POI is a hold point. WaD is BLOCKED until counterparty engagement is accepted.
  const engagementAccepted = engagementStatus === "accepted";
  const poiHoldActive = poiComplete && !engagementAccepted && !isCompleted;

  // WaD completion requires checking WaD status — simplified: we check if match is completed
  // or if the match has progressed past the WaD stage
  const wadComplete = isCompleted;

  const evidenceComplete = isCompleted;

  const steps: WizardStepDef[] = useMemo(() => [
    {
      id: "search",
      label: "Search",
      description: "A trading partner has been identified and a match record created.",
      complete: searchComplete,
      locked: false,
    },
    {
      id: "match",
      label: "Match",
      description: "Review trading partner details, negotiate terms, and attach supporting documents.",
      complete: matchComplete,
      locked: false,
    },
    {
      id: "poi",
      label: "Proof of Intent",
      description: poiHoldActive
        ? "POI generated. Awaiting counterparty engagement — the process is paused here."
        : "Generate a Proof of Intent — 1 credit (R10). Non-binding, irreversible, fully audited.",
      complete: poiComplete && engagementAccepted,
      locked: !matchComplete, // Strict: locked until match step complete
    },
    {
      id: "wad",
      label: "WaD",
      description: poiHoldActive
        ? "Locked — counterparty must accept before you can proceed to WaD."
        : "Create a WaD evidence bundle with 9-gate compliance validation.",
      complete: wadComplete,
      locked: !poiComplete || poiHoldActive, // HOLD POINT: locked until engagement accepted
    },
    {
      id: "evidence",
      label: "Evidence Pack",
      description: "Generate a SHA-256 hashed, tamper-evident evidence bundle for regulatory finality.",
      complete: evidenceComplete,
      locked: !wadComplete, // Strict: locked until WaD sealed
    },
  ], [searchComplete, matchComplete, poiComplete, wadComplete, evidenceComplete, poiHoldActive, engagementAccepted]);

  // Auto-select the first incomplete, unlocked step
  const defaultStep = useMemo(() => {
    const firstIncomplete = steps.findIndex(s => !s.complete && !s.locked);
    return firstIncomplete >= 0 ? firstIncomplete : steps.length - 1;
  }, [steps]);

  const [activeStep, setActiveStep] = useState(() => {
    // Start on the first incomplete, unlocked step — but only on mount
    const first = steps.findIndex(s => !s.complete && !s.locked);
    return first >= 0 ? first : steps.length - 1;
  });

  const handleStepClick = useCallback((idx: number) => {
    if (!steps[idx].locked) {
      setActiveStep(idx);
    }
  }, [steps]);

  return (
    <div className="space-y-6">
      {/* Wizard Stepper */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <WizardStepper
            steps={steps}
            activeStep={activeStep}
            onStepClick={handleStepClick}
          />
        </CardContent>
      </Card>

      {/* Step Content */}
      {activeStep === 0 && (
        <StepSearch match={match} />
      )}
      {activeStep === 1 && (
        <StepMatch match={match} currentState={currentState} onMatchUpdated={onRefresh} onProceedToPoi={() => setActiveStep(2)} />
      )}
      {activeStep === 2 && (
        <StepPoi
          match={match}
          onStateAction={onStateAction}
          loading={stateActionLoading || confirming}
        />
      )}
      {activeStep === 3 && (
        poiHoldActive ? (
          <Card className="border-dashed border-primary/30">
            <CardContent className="py-8 text-center space-y-3">
              <ShieldAlert className="h-8 w-8 text-primary mx-auto" />
              <h3 className="font-semibold">Awaiting Counterparty Engagement</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                The POI has been generated and the counterparty has been notified. 
                This step is paused until the counterparty has been engaged and has responded.
              </p>
              {/* Inline engagement status — no need to scroll up */}
              {engagementStatus && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border bg-muted/50 text-xs font-medium">
                  <span className={`h-2 w-2 rounded-full ${
                    engagementStatus === "declined" || engagementStatus === "expired" ? "bg-destructive" :
                    "bg-amber-500 animate-pulse"
                  }`} />
                  Current status: {engagementStatus === "notification_sent" ? "Notification sent" :
                    engagementStatus === "contacted" ? "Contacted" :
                    engagementStatus === "declined" ? "Declined" :
                    engagementStatus === "expired" ? "Expired" : engagementStatus}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <StepWad match={match} onRefresh={onRefresh} />
        )
      )}
      {activeStep === 4 && (
        <StepEvidence match={match} currentState={currentState} />
      )}
    </div>
  );
}

// ─── Step 1: Search (Complete) ──────────────────────────────────────

function StepSearch({ match }: { match: Match }) {
  const isRevealed = true; // Names are always visible per client requirement
  const userOrgId = useUserOrg();
  const metaSide = (match.metadata as any)?.tradeSide || (match.metadata as any)?.bidOfferSide;
  const inferredRole = getMatchRole(userOrgId, match as any);
  const roleBadgeLabel = metaSide
    ? (metaSide === "buyer" || metaSide === "bid" ? "Buyer" : "Seller")
    : inferredRole === "buyer"
      ? "Buyer"
      : inferredRole === "seller"
        ? "Seller"
        : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg">Trading Partner Identified</CardTitle>
          {roleBadgeLabel && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-primary/30 bg-primary/5 text-primary">
              Your role: {roleBadgeLabel}
            </span>
          )}
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
    </Card>
  );
}

// ─── Step 2: Match Details ──────────────────────────────────────────

function StepMatch({ match, currentState, onMatchUpdated, onProceedToPoi }: { match: Match; currentState: string; onMatchUpdated?: () => void; onProceedToPoi?: () => void }) {
  const [subTab, setSubTab] = useState("terms");

  // Check if all required fields are complete
  const allComplete = !!match.commodity && !!match.buyer_name && !!match.seller_name
    && match.quantity_amount != null && match.quantity_amount > 0
    && match.price_amount != null && match.price_amount > 0;

  return (
    <div className="space-y-4">
      {/* Sub-navigation within the match step */}
      <Tabs value={subTab} onValueChange={setSubTab}>
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

      {/* Next-step prompt when all required fields are complete */}
      {allComplete && onProceedToPoi && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-primary/30 bg-primary/5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            <p className="text-sm font-medium text-foreground">All required fields complete</p>
          </div>
          <Button size="sm" onClick={onProceedToPoi} className="gap-1.5 shrink-0">
            Proceed to Proof of Intent
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Step 3: POI ────────────────────────────────────────────────────

function StepPoi({
  match,
  onStateAction,
  loading,
}: {
  match: Match;
  onStateAction: (action: string) => Promise<void>;
  loading: boolean;
}) {
  return (
    <div className="space-y-4">
      <StateProgressionCard
        match={match}
        onAction={onStateAction}
        loading={loading}
      />
    </div>
  );
}

// ─── Step 4: WaD ────────────────────────────────────────────────────

function StepWad({ match, onRefresh }: { match: Match; onRefresh: () => void }) {
  return (
    <div className="space-y-4">
      <GovernanceDocSubmit matchId={match.id} orgId={match.org_id} />
      <WadModule match={match} onWadCreated={onRefresh} />
    </div>
  );
}

// ─── Step 5: Evidence Pack ──────────────────────────────────────────

function StepEvidence({ match, currentState }: { match: Match; currentState: string }) {
  return (
    <div className="space-y-4">
      <EvidencePackPanel matchId={match.id} matchStatus={match.status} matchState={currentState} />
      <Separator />
      <MatchTimeline matchId={match.id} />
      <PoiEventsTimeline matchId={match.id} />
    </div>
  );
}
