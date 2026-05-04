import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileCheck, AlertTriangle, Shield } from "lucide-react";
import { toast } from "sonner";
import { WadStepper } from "./WadStepper";
import { JurisdictionSelector } from "./JurisdictionSelector";
import { EvidenceStrengthIndicator } from "@/components/match/EvidenceStrengthIndicator";
import type { Tables } from "@/integrations/supabase/types";
import {
  fetchActiveWad,
  createWad,
  deriveConsequenceState,
  type WadRecord,
  type ConsequenceState,
} from "@/lib/modules/consequence";
import { supabase } from "@/integrations/supabase/client";

type Match = Tables<"matches">;

interface WadModuleProps {
  match: Match;
  onWadCreated?: () => void;
}

export function WadModule({ match, onWadCreated }: WadModuleProps) {
  const [wad, setWad] = useState<WadRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [gateFailures, setGateFailures] = useState<string[]>([]);
  const [userOrgId, setUserOrgId] = useState<string | null>(null);
  const [jurisdictionSelected, setJurisdictionSelected] = useState(false);
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<string | null>(null);
  const { data: govDocCount = 0 } = useQuery({
    queryKey: ["gov-doc-count", match.id],
    queryFn: async () => {
      const { count } = await supabase
        .from("governance_documents")
        .select("id", { count: "exact", head: true })
        .eq("deal_reference_id", match.id);
      return count ?? 0;
    },
    enabled: !!match.id,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    loadUserOrg();
    loadWad();
  }, [match.id]);
  const loadUserOrg = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", session.user.id)
        .single();
      if (profile) setUserOrgId(profile.org_id);
    }
  };

  const loadWad = async () => {
    try {
      setLoading(true);
      const result = await fetchActiveWad(match.id);
      if (result.success) {
        setWad(result.data ?? null);
      } else {
        console.error("Error fetching Signed Deal:", result.error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWad = async () => {
    if (creating) return;
    try {
      setCreating(true);
      const result = await createWad(match.id);

      if (result.success && result.data) {
        setWad(result.data);
        setGateFailures([]);
        toast.success("Signed Deal confirmed successfully");
        onWadCreated?.();
      } else if (result.gateFailures?.length) {
        // P4: gate failures are a workflow prerequisite, not a system error.
        // The persistent banner below (rendered when gateFailures.length > 0)
        // already lists each unmet gate with an actionable description, so we
        // do NOT raise a toast here — that conflates "the system failed" with
        // "you have prerequisites to complete" and dismisses before the user
        // can read it.
        setGateFailures(result.gateFailures);
      } else {
        // True infra/edge failure (no gate detail) — toast is appropriate.
        toast.error(result.error || "Failed to confirm Signed Deal");
      }
    } finally {
      setCreating(false);
    }
  };

  const handleJurisdictionComplete = (jurisdiction: string) => {
    setJurisdictionSelected(true);
    setSelectedJurisdiction(jurisdiction);
  };

  // Derive consequence state from the module
  const state: ConsequenceState = deriveConsequenceState(wad, match.status ?? "", userOrgId);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // POI must be confirmed (settled) to create WaD
  if (state.uiStatus === "blocked") {
    return (
      <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
               Signed Deal
            </CardTitle>
            <CardDescription>Sealed evidence bundle for this intent</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-4 bg-muted rounded-lg">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            <div>
              <p className="font-medium">Intent must be confirmed first</p>
              <p className="text-sm text-muted-foreground">
                {state.createBlockedReasons[0]?.reason ||
                  "Signed Deal can only be created after both parties have sent a trade request on this intent."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No WaD exists yet - show jurisdiction selector then create button
  if (state.uiStatus === "not_started") {
    return (
      <div className="space-y-4">
        {/* Jurisdiction selector - must be resolved before WaD creation */}
        {userOrgId && (
          <JurisdictionSelector
            matchId={match.id}
            orgId={userOrgId}
            onSelectionComplete={handleJurisdictionComplete}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Signed Deal
            </CardTitle>
            <CardDescription>Create a sealed evidence bundle for this intent</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted rounded-lg space-y-3">
              <p className="text-sm">
                Signed Deal creates an auditable, tamper-evident record that packages the full evidence trail
                for this trade request. It includes:
              </p>
              <ul className="text-sm list-disc list-inside space-y-1 text-muted-foreground">
                <li>Search query and match context</li>
                <li>Trade request timestamps and parties</li>
                <li>Document hashes and evidence bundle</li>
                <li>Multi-party attestations</li>
                <li>Tamper-Proof seal</li>
              </ul>
              {selectedJurisdiction && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    Documentary path: <Badge variant="outline" className="text-xs">{selectedJurisdiction}</Badge>
                  </p>
                </div>
              )}
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground italic">
                  <strong>Note:</strong> A Signed Deal is NOT a contract. No payment. No obligation.
                  It is an evidence-grade "proof bundle".
                </p>
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <EvidenceStrengthIndicator documentCount={govDocCount} />
            </div>
            {gateFailures.length > 0 && (
              <div
                role="alert"
                className="p-4 bg-destructive/5 border border-destructive/20 rounded-lg space-y-2"
              >
                <p className="text-sm font-medium text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Signed Deal blocked — {gateFailures.length} prerequisite{gateFailures.length > 1 ? "s" : ""} not yet met
                </p>
                <ol className="text-sm list-decimal list-inside space-y-1 text-foreground/80">
                  {gateFailures.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ol>
                <p className="text-xs text-muted-foreground mt-2">
                  Resolve every item above. <strong>Confirm Signed Deal</strong> will become active once all gates pass.
                </p>
              </div>
            )}
            <Button
              onClick={handleCreateWad}
              disabled={creating || !jurisdictionSelected || gateFailures.length > 0}
              className="w-full"
              title={
                !jurisdictionSelected
                  ? "Select a jurisdiction first."
                  : gateFailures.length > 0
                    ? `Resolve ${gateFailures.length} unmet prerequisite${gateFailures.length > 1 ? "s" : ""} listed above before confirming.`
                    : "Confirm the Signed Deal and seal the evidence bundle."
              }
            >
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <FileCheck className="h-4 w-4 mr-2" />
              {!jurisdictionSelected ? "Select jurisdiction first" : "Confirm Signed Deal"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // WaD exists - show stepper with derived state
  return (
    <WadStepper
      wad={wad!}
      match={match}
      consequenceState={state}
      userOrgId={userOrgId}
      onUpdate={loadWad}
    />
  );
}
