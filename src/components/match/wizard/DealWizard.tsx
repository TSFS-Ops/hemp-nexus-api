/**
 * DealWizard - Replaces the 9-tab MatchDetailsTabs with a strict linear 5-step wizard.
 *
 * Steps:
 *   1. Search (always complete on match detail — match already exists)
 *   2. Match Details (review counterparty, terms, docs, notes, disputes)
 *   3. Generate POI (readiness checklist + credit-burn action)
 *   4. WaD (governance docs + 9-gate validation)
 *   5. Evidence Pack (sealed evidence bundle + timeline)
 *
 * Strict linear: future steps are locked until prior steps are fully complete.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { WizardStepper, type WizardStepDef } from "./WizardStepper";
import { MatchDocuments } from "@/components/match/MatchDocuments";
import { DealTermsPanel } from "@/components/match/DealTermsPanel";
import { MatchNotes } from "@/components/match/MatchNotes";
import { DisputePanel } from "@/components/match/DisputePanel";
import { DisputeBanner } from "@/components/match/DisputeBanner";
import { StateProgressionCard } from "@/components/match/StateProgressionCard";
import { GovernanceDocSubmit } from "@/components/match/GovernanceDocSubmit";
import { WadModule } from "@/components/wad/WadModule";
import { EvidencePackPanel } from "@/components/match/EvidencePackPanel";
import { MatchTimeline } from "@/components/MatchTimeline";
import { PoiEventsTimeline } from "@/components/match/PoiEventsTimeline";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, FileSignature, MessageSquare, ShieldAlert } from "lucide-react";
import { MatchStatusBadge } from "@/components/ui/match-status-badge";
import type { Match } from "@/hooks/use-match-details";

interface DealWizardProps {
  match: Match;
  canConfirm: boolean;
  confirming: boolean;
  stateActionLoading: boolean;
  onConfirm: () => void;
  onStateAction: (action: string) => Promise<void>;
  onRefresh: () => void;
}

export function DealWizard({
  match,
  canConfirm,
  confirming,
  stateActionLoading,
  onConfirm,
  onStateAction,
  onRefresh,
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
      description: "Generate a Proof of Intent — 1 credit (R10). Non-binding, irreversible, fully audited.",
      complete: poiComplete,
      locked: !matchComplete, // Strict: locked until match step complete
    },
    {
      id: "wad",
      label: "Without a Doubt",
      description: "Create a Without a Doubt (WaD) evidence bundle with 9-gate compliance validation.",
      complete: wadComplete,
      locked: !poiComplete, // Strict: locked until POI generated
    },
    {
      id: "evidence",
      label: "Evidence Pack",
      description: "Generate a SHA-256 hashed, tamper-evident evidence bundle for regulatory finality.",
      complete: evidenceComplete,
      locked: !wadComplete, // Strict: locked until WaD sealed
    },
  ], [searchComplete, matchComplete, poiComplete, wadComplete, evidenceComplete]);

  // Auto-select the first incomplete, unlocked step
  const defaultStep = useMemo(() => {
    const firstIncomplete = steps.findIndex(s => !s.complete && !s.locked);
    return firstIncomplete >= 0 ? firstIncomplete : steps.length - 1;
  }, [steps]);

  const [activeStep, setActiveStep] = useState(defaultStep);

  // Keep active step in bounds when completion changes
  useEffect(() => {
    if (steps[activeStep]?.locked) {
      setActiveStep(defaultStep);
    }
  }, [steps, activeStep, defaultStep]);

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
        <StepMatch match={match} currentState={currentState} />
      )}
      {activeStep === 2 && (
        <StepPoi
          match={match}
          onStateAction={onStateAction}
          loading={stateActionLoading || confirming}
        />
      )}
      {activeStep === 3 && (
        <StepWad match={match} onRefresh={onRefresh} />
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

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="text-lg">Trading Partner Identified</CardTitle>
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

function StepMatch({ match, currentState }: { match: Match; currentState: string }) {
  return (
    <div className="space-y-4">
      <DisputeBanner matchId={match.id} onNavigateToDisputes={() => {}} />

      {/* Sub-navigation within the match step */}
      <Tabs defaultValue="terms">
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
          <TabsTrigger value="disputes" className="gap-1.5">
            <ShieldAlert className="h-4 w-4" />
            Disputes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="terms" className="mt-4">
          <DealTermsPanel matchId={match.id} orgId={match.org_id} />
        </TabsContent>
        <TabsContent value="documents" className="mt-4">
          <MatchDocuments matchId={match.id} orgId={match.org_id} />
        </TabsContent>
        <TabsContent value="notes" className="mt-4">
          <MatchNotes matchId={match.id} orgId={match.org_id} />
        </TabsContent>
        <TabsContent value="disputes" className="mt-4">
          <DisputePanel matchId={match.id} orgId={match.org_id} />
        </TabsContent>
      </Tabs>
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
