import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileCheck, AlertTriangle, Shield } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { WadStepper } from "./WadStepper";
import type { Tables } from "@/integrations/supabase/types";
import * as WadState from "@/lib/wad-state";

type Match = Tables<"matches">;

interface WadModuleProps {
  match: Match;
  onWadCreated?: () => void;
}

interface Wad {
  id: string;
  poi_id: string;
  status: string;
  evidence_bundle: any;
  seal_hash: string | null;
  sealed_at: string | null;
  created_at: string;
  buyer_org_id: string | null;
  seller_org_id: string | null;
  attestations?: Attestation[];
}

interface Attestation {
  id: string;
  wad_id: string;
  user_id: string;
  org_id: string;
  role: string;
  attested_name: string;
  attested_at: string;
  attestation_text: string;
}

export function WadModule({ match, onWadCreated }: WadModuleProps) {
  const [wad, setWad] = useState<Wad | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [gateFailures, setGateFailures] = useState<string[]>([]);

  useEffect(() => {
    fetchWad();
  }, [match.id]);

  const fetchWad = async () => {
    try {
      setLoading(true);
      const wads = await apiFetch<Wad[]>(`wad?poi_id=${match.id}`);
      const activeWad = wads.find((w: Wad) => !WadState.isTerminal(w.status));
      if (activeWad) {
        const detail = await apiFetch<Wad>(`wad/${activeWad.id}`);
        setWad(detail);
      }
    } catch (error) {
      console.error("Error fetching WaD:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWad = async () => {
    if (creating) return;
    try {
      setCreating(true);
      const newWad = await apiFetch<Wad>("wad", {
        method: "POST",
        body: JSON.stringify({ poi_id: match.id }),
      });
      setWad(newWad);
      setGateFailures([]);
      toast.success("WaD created successfully");
      onWadCreated?.();
    } catch (error: any) {
      console.error("Error creating WaD:", error);
      // Surface specific gate failures from the backend
      if (error.failures && Array.isArray(error.failures)) {
        setGateFailures(error.failures);
      }
      toast.error(error.message || "Failed to create WaD");
    } finally {
      setCreating(false);
    }
  };

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
  if (match.status !== "settled") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            WaD (Without-a-Doubt)
          </CardTitle>
          <CardDescription>Sealed evidence bundle for this POI</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-4 bg-muted rounded-lg">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            <div>
              <p className="font-medium">Intent must be confirmed first</p>
              <p className="text-sm text-muted-foreground">
                WaD can only be created after both parties have confirmed intent on this POI.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No WaD exists yet - show create button
  if (!wad) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            WaD (Without-a-Doubt)
          </CardTitle>
          <CardDescription>Create a sealed evidence bundle for this POI</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-muted rounded-lg space-y-3">
            <p className="text-sm">
              WaD creates an auditable, tamper-evident record that packages the full evidence trail 
              for this proof-of-intent. It includes:
            </p>
            <ul className="text-sm list-disc list-inside space-y-1 text-muted-foreground">
              <li>Search query and match context</li>
              <li>Confirm intent timestamps and parties</li>
              <li>Document hashes and evidence bundle</li>
              <li>Multi-party attestations</li>
              <li>Cryptographic seal</li>
            </ul>
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground italic">
                <strong>Note:</strong> WaD is NOT a contract. No payment. No obligation. 
                It is an evidence-grade "proof bundle".
              </p>
            </div>
          </div>
          {gateFailures.length > 0 && (
            <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-lg space-y-2">
              <p className="text-sm font-medium text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                WaD creation blocked — {gateFailures.length} gate{gateFailures.length > 1 ? 's' : ''} failed:
              </p>
              <ul className="text-sm list-disc list-inside space-y-1 text-muted-foreground">
                {gateFailures.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-2">
                Resolve the above issues and try again. Each gate must pass for the evidence bundle to be sealed.
              </p>
            </div>
          )}
          <Button onClick={handleCreateWad} disabled={creating} className="w-full">
            {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <FileCheck className="h-4 w-4 mr-2" />
            {gateFailures.length > 0 ? 'Retry WaD Creation' : 'Create WaD'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // WaD exists - show stepper
  return (
    <WadStepper 
      wad={wad} 
      match={match} 
      onUpdate={fetchWad} 
    />
  );
}
